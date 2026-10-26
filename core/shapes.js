/**
 * Solid shapes drawn as shaded ASCII.
 *
 * Each shape is a signed distance function plus a bounding box ({ d(x, y), x0, y0, x1, y1 },
 * in pixels; d < 0 inside). paint() rasterises one into the grid: supersampled coverage
 * for soft edges, and light from the top-left read off the distance field's gradient, so a
 * capsule looks rounded and a box looks bevelled. Dense glyphs on lit faces, sparse in shade.
 */
(() => {
  "use strict";

  const { clamp } = Wallpaper.math;
  const style = Wallpaper.style;

  const RAMP = ".:-=+*#%@";
  const EDGE = ".'`,";
  // Unit vector toward the light (up and to the left).
  const LX = -0.55, LY = -0.83;
  const SUB = [-0.25, -0.25, 0.25, -0.25, -0.25, 0.25, 0.25, 0.25];

  function circle(cx, cy, r) {
    return { d: (x, y) => Math.hypot(x - cx, y - cy) - r, x0: cx - r, y0: cy - r, x1: cx + r, y1: cy + r };
  }

  function ellipse(cx, cy, rx, ry) {
    const m = Math.min(rx, ry);
    return {
      d: (x, y) => (Math.hypot((x - cx) / rx, (y - cy) / ry) - 1) * m,
      x0: cx - rx, y0: cy - ry, x1: cx + rx, y1: cy + ry,
    };
  }

  function capsule(ax, ay, bx, by, r) {
    const bax = bx - ax, bay = by - ay, l2 = bax * bax + bay * bay || 1;
    return {
      d: (x, y) => {
        const pax = x - ax, pay = y - ay;
        const h = clamp((pax * bax + pay * bay) / l2, 0, 1);
        return Math.hypot(pax - bax * h, pay - bay * h) - r;
      },
      x0: Math.min(ax, bx) - r, y0: Math.min(ay, by) - r, x1: Math.max(ax, bx) + r, y1: Math.max(ay, by) + r,
    };
  }

  /** Box of half-size hw × hh centred at (cx, cy), corner radius `round`, turned by `angle`. */
  function box(cx, cy, hw, hh, round = 0, angle = 0) {
    const c = Math.cos(angle), s = Math.sin(angle);
    const ext = angle ? Math.hypot(hw, hh) : 0;
    return {
      d: (x, y) => {
        let px = x - cx, py = y - cy;
        if (angle) {
          const t = c * px + s * py;
          py = -s * px + c * py;
          px = t;
        }
        const qx = Math.abs(px) - hw + round, qy = Math.abs(py) - hh + round;
        return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - round;
      },
      x0: cx - (ext || hw), y0: cy - (ext || hh), x1: cx + (ext || hw), y1: cy + (ext || hh),
    };
  }

  function triangle(ax, ay, bx, by, cx, cy) {
    const e0x = bx - ax, e0y = by - ay, e1x = cx - bx, e1y = cy - by, e2x = ax - cx, e2y = ay - cy;
    const l0 = e0x * e0x + e0y * e0y, l1 = e1x * e1x + e1y * e1y, l2 = e2x * e2x + e2y * e2y;
    const sg = Math.sign(e0x * e2y - e0y * e2x);
    return {
      d: (x, y) => {
        const v0x = x - ax, v0y = y - ay, v1x = x - bx, v1y = y - by, v2x = x - cx, v2y = y - cy;
        const t0 = clamp((v0x * e0x + v0y * e0y) / l0, 0, 1);
        const t1 = clamp((v1x * e1x + v1y * e1y) / l1, 0, 1);
        const t2 = clamp((v2x * e2x + v2y * e2y) / l2, 0, 1);
        const q0x = v0x - e0x * t0, q0y = v0y - e0y * t0;
        const q1x = v1x - e1x * t1, q1y = v1y - e1y * t1;
        const q2x = v2x - e2x * t2, q2y = v2y - e2y * t2;
        const dist = Math.min(q0x * q0x + q0y * q0y, q1x * q1x + q1y * q1y, q2x * q2x + q2y * q2y);
        const side = Math.min(sg * (v0x * e0y - v0y * e0x), sg * (v1x * e1y - v1y * e1x), sg * (v2x * e2y - v2y * e2x));
        return -Math.sqrt(dist) * Math.sign(side);
      },
      x0: Math.min(ax, bx, cx), y0: Math.min(ay, by, cy), x1: Math.max(ax, bx, cx), y1: Math.max(ay, by, cy),
    };
  }

  /** `a` with `b` carved out of it. */
  function cut(a, b) {
    return { d: (x, y) => Math.max(a.d(x, y), -b.d(x, y)), x0: a.x0, y0: a.y0, x1: a.x1, y1: a.y1 };
  }

  /**
   * Visit every cell `shape` covers: fn(i, c, r, cover, light), where cover is the fraction of
   * the cell inside (0.25 steps) and light the top-left lighting (≈0.25 shade … 1.2 lit).
   */
  function sample(grid, shape, fn, bevelPx) {
    const { cw, ch, cols, rows } = grid;
    const c0 = Math.max(0, Math.floor(shape.x0 / cw)), c1 = Math.min(cols - 1, Math.floor(shape.x1 / cw));
    const r0 = Math.max(0, Math.floor(shape.y0 / ch)), r1 = Math.min(rows - 1, Math.floor(shape.y1 / ch));
    if (c0 > c1 || r0 > r1) return;
    const diag = Math.hypot(cw, ch) * 0.5;
    const bevel = bevelPx || cw * 2.5;
    const e = cw * 0.5;

    for (let r = r0; r <= r1; r++) {
      const y = (r + 0.5) * ch;
      for (let c = c0; c <= c1; c++) {
        const x = (c + 0.5) * cw;
        const d = shape.d(x, y);
        if (d > diag) continue;
        let hits = 0;
        for (let j = 0; j < 8; j += 2) {
          if (shape.d(x + SUB[j] * cw, y + SUB[j + 1] * ch) < 0) hits++;
        }
        if (!hits) continue;
        const nx = shape.d(x + e, y) - d, ny = shape.d(x, y + e) - d;
        const nl = Math.hypot(nx, ny) || 1;
        const inside = clamp(-d / bevel, 0, 1);
        const light = clamp(0.66 + 0.42 * ((nx * LX + ny * LY) / nl) * (1 - inside) + 0.08 * inside, 0.25, 1.2);
        fn(r * cols + c, c, r, hits / 4, light);
      }
    }
  }

  /**
   * Rasterise `shape` into the grid. Material `m`:
   *   rgb     base colour
   *   ramp    glyphs from shade to light (default ".:-=+*#%@")
   *   flat    no shading (lights, screens, decals); `glyph` then picks the character
   *   bevel   px over which an edge rounds off into the flat face (default 2.5 cells)
   *   alpha   opacity
   * Painted cell indices are appended to `out`, when given.
   */
  function paint(grid, shape, m, out) {
    const ramp = m.ramp || RAMP, edge = m.edge || EDGE;
    const [R, G, B] = m.rgb;
    const alpha = m.alpha === undefined ? 1 : m.alpha;
    sample(grid, shape, (i, c, r, cover, light) => {
      const b = m.flat ? 1 : light;
      let g;
      if (cover < 0.5) g = edge[(c * 7 + r * 3) % edge.length];
      else if (m.glyph) g = m.glyph;
      else if (cover < 1) g = ramp[Math.min(2, ramp.length - 1)];
      else g = ramp[Math.min(ramp.length - 1, Math.floor(((b - 0.25) / 0.95) * ramp.length))];
      grid.glyph[i] = g;
      grid.color[i] = style(R * b, G * b, B * b, alpha * (0.55 + 0.45 * cover));
      grid.bg[i] = "";
      if (out) out.push(i);
    }, m.bevel);
  }

  Wallpaper.shapes = { circle, ellipse, capsule, box, triangle, cut, sample, paint };
})();
