/**
 * Small 3D bodies drawn as ASCII: the renderer behind the ocean and tank scenes.
 *
 * Space is the screen's: a to the right, b down, d toward the viewer, all in px. A scene
 * describes each creature as surfaces (a tube around a spine, a flapping disc, fin sheets)
 * and splat()s points over them densely enough that every covered cell is hit. Points
 * are projected with a gentle perspective about the screen centre (or the eye monitors share,
 * see core/app.js); each cell keeps the
 * point nearest the viewer (a z-buffer). resolve() then turns the buffer into glyphs: a
 * dense ramp by light on solid parts, soft rims along silhouettes (like the koi), and
 * whatever stroke glyph the scene asked for on fins and features.
 *
 * Chain is the koi's spine in 3D: the head leads, every node follows at a fixed spacing,
 * and frames() gives each node a forward / right / dorsal frame for a given "up".
 */
(() => {
  "use strict";

  const { clamp, lerp } = Wallpaper.math;
  const style = Wallpaper.style;

  const RAMP = "+*%#@";

  // ------------------------------------------------------------- vectors

  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const len = (a) => Math.hypot(a[0], a[1], a[2]);
  const norm = (a) => {
    const l = len(a) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  };
  const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
  const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  /** v turned by angle about the unit axis k (Rodrigues). */
  function rotate(v, k, angle) {
    const c = Math.cos(angle), s = Math.sin(angle), kv = cross(k, v), d = dot(k, v) * (1 - c);
    return [v[0] * c + kv[0] * s + k[0] * d, v[1] * c + kv[1] * s + k[1] * d, v[2] * c + kv[2] * s + k[2] * d];
  }
  /** Turn unit vector `from` toward `to` by at most maxAngle. */
  function turnToward(from, to, maxAngle) {
    const t = norm(to), c = clamp(dot(from, t), -1, 1), a = Math.acos(c);
    if (a <= maxAngle || a < 1e-5) return t;
    let axis = cross(from, t);
    if (len(axis) < 1e-6) axis = Math.abs(from[2]) < 0.9 ? cross(from, [0, 0, 1]) : cross(from, [1, 0, 0]);
    return norm(rotate(from, norm(axis), maxAngle));
  }

  // -------------------------------------------------------------- buffer

  class Solid {
    /** eye: { x, y, dist } in px, the viewer's place when monitors share one (api.eye). */
    constructor(grid, eye = null) {
      this.grid = grid;
      this.eye = eye;
      this.frame = 0;
      this.count = 0;
      this.cx = 0;
      this.cy = 0;
      this.F = 1e9;
      this.resize();
    }

    resize() {
      const { cols, rows, W, H } = this.grid;
      const n = Math.max(1, cols * rows);
      this.depth = new Float32Array(n);
      this.stamp = new Uint32Array(n);
      this.id = new Int32Array(n);
      this.light = new Float32Array(n);
      this.rgb = new Float32Array(n * 3);
      this.alpha = new Float32Array(n);
      this.glyph = new Array(n).fill("");
      this.touched = new Int32Array(n);
      const eye = this.eye;
      this.cx = eye ? eye.x : W / 2;
      this.cy = eye ? eye.y : H / 2;
      this.F = eye ? eye.dist : Math.max(W, H) * 2.5;
      this.frame++;
      this.count = 0;
    }

    begin() {
      this.frame++;
      this.count = 0;
    }

    /** Perspective scale at depth d (1 at d = 0, larger toward the viewer). */
    scaleAt(d) {
      return this.F / Math.max(1, this.F - d);
    }

    /** Screen position of (x, y, d), written to this.px / this.py. */
    project(x, y, d) {
      const s = this.F / Math.max(1, this.F - d);
      this.px = this.cx + (x - this.cx) * s;
      this.py = this.cy + (y - this.cy) * s;
      return s;
    }

    /**
     * Offer a surface point. `light` (0..1) picks the glyph on solid parts; rgb and alpha
     * are its final colour. A non-empty `glyph` is drawn as is (fins, eyes, markings).
     */
    splat(x, y, d, id, light, r, g, b, a, glyph = "") {
      const s = this.F / Math.max(1, this.F - d);
      const { cw, ch, cols, rows } = this.grid;
      const c = Math.floor((this.cx + (x - this.cx) * s) / cw), row = Math.floor((this.cy + (y - this.cy) * s) / ch);
      if (c < 0 || row < 0 || c >= cols || row >= rows) return;
      const i = row * cols + c;
      if (this.stamp[i] === this.frame) {
        if (d <= this.depth[i]) return;
      } else {
        this.stamp[i] = this.frame;
        this.touched[this.count++] = i;
      }
      this.depth[i] = d;
      this.id[i] = id;
      this.light[i] = light;
      this.rgb[i * 3] = r;
      this.rgb[i * 3 + 1] = g;
      this.rgb[i * 3 + 2] = b;
      this.alpha[i] = a;
      this.glyph[i] = glyph;
    }

    /** Is cell i covered this frame (by body `id`, when given)? */
    covered(i, id) {
      return this.stamp[i] === this.frame && (id === undefined || this.id[i] === id);
    }

    /** Visit every covered cell: fn(i, c, r, depth, id). */
    each(fn) {
      const cols = this.grid.cols;
      for (let k = 0; k < this.count; k++) {
        const i = this.touched[k];
        fn(i, i % cols, (i / cols) | 0, this.depth[i], this.id[i]);
      }
    }

    /** Write every covered cell into the grid. */
    resolve() {
      const { cols, rows } = this.grid;
      const { stamp, id, frame } = this;
      for (let k = 0; k < this.count; k++) {
        const i = this.touched[k];
        const c = i % cols, r = (i / cols) | 0, me = id[i];
        let g = this.glyph[i];
        if (!g) {
          const up = r > 0 && stamp[i - cols] === frame && id[i - cols] === me;
          const dn = r < rows - 1 && stamp[i + cols] === frame && id[i + cols] === me;
          const lf = c > 0 && stamp[i - 1] === frame && id[i - 1] === me;
          const rt = c < cols - 1 && stamp[i + 1] === frame && id[i + 1] === me;
          // Rims hug the silhouette; anything only a cell or two thick stays solid.
          if (!up && dn && (lf || rt)) g = ".";
          else if (!dn && up && (lf || rt)) g = "'";
          else if (up && dn && lf !== rt) g = ":";
          else g = RAMP[clamp(Math.floor(this.light[i] * RAMP.length), 0, RAMP.length - 1)];
        }
        this.grid.put(c, r, g, style(this.rgb[i * 3], this.rgb[i * 3 + 1], this.rgb[i * 3 + 2], this.alpha[i]));
      }
    }
  }

  // --------------------------------------------------------------- chain

  class Chain {
    constructor(n, seg) {
      this.n = n;
      this.seg = seg;
      this.p = [];
      this.t = [];
      this.l = [];
      this.u = [];
      for (let i = 0; i < n; i++) {
        this.p.push([0, 0, 0]);
        this.t.push([1, 0, 0]);
        this.l.push([0, 1, 0]);
        this.u.push([0, 0, 1]);
      }
    }

    /** Lay the chain out straight behind (x, y, d), heading along f. */
    place(pos, f) {
      for (let i = 0; i < this.n; i++) this.p[i] = add(pos, f, -this.seg * i);
    }

    /** The head moves to pos; every node follows at a fixed spacing. */
    follow(pos) {
      this.p[0] = pos.slice();
      for (let i = 1; i < this.n; i++) {
        const a = this.p[i - 1], b = this.p[i];
        const dx = a[0] - b[0], dy = a[1] - b[1], dd = a[2] - b[2];
        const l = Math.hypot(dx, dy, dd) || 1;
        this.p[i] = [a[0] - (dx / l) * this.seg, a[1] - (dy / l) * this.seg, a[2] - (dd / l) * this.seg];
      }
    }

    /**
     * Per-node frames: t forward, l to the right, u dorsal ("up" for the body), rolled by
     * `roll` about t. The right vector keeps its last value when t lines up with `up`.
     */
    frames(up, roll = 0) {
      for (let i = 0; i < this.n; i++) {
        const a = this.p[Math.max(0, i - 1)], b = this.p[Math.min(this.n - 1, i + 1)];
        const t = norm([a[0] - b[0], a[1] - b[1], a[2] - b[2]]);
        let l = cross(up, t);
        l = len(l) < 0.05 ? this.l[i] : norm(l);
        if (roll) l = rotate(l, t, roll);
        this.t[i] = t;
        this.l[i] = l;
        this.u[i] = cross(t, l);
      }
    }

    /** Interpolated centre and frame at s ∈ [0, 1] (head → tail), into `out`. */
    at(s, out) {
      const f = clamp(s, 0, 1) * (this.n - 1), i = Math.min(this.n - 2, Math.floor(f)), k = f - i;
      const mixv = (A, j) => {
        const p = A[i], q = A[i + 1];
        out[j][0] = lerp(p[0], q[0], k);
        out[j][1] = lerp(p[1], q[1], k);
        out[j][2] = lerp(p[2], q[2], k);
      };
      mixv(this.p, 0);
      mixv(this.t, 1);
      mixv(this.l, 2);
      mixv(this.u, 3);
      return out;
    }
  }

  Wallpaper.solid = { Solid, Chain, dot, cross, len, norm, add, scale, rotate, turnToward, RAMP };
})();
