/**
 * Staghorn fern: a Platycerium on a tree branch that lives one day at a time.
 *
 *   - a sky that follows the clock, with the sun and moon crossing it, a tree trunk on the
 *     right, a crooked branch reaching across the screen with two twigs off it, and the host
 *     tree's leaves along the top
 *   - the fern on the branch: a tall shield frond with a lobed, rust-dry crown standing up
 *     behind it, and a mass of narrow antler fronds that fork again and again, arch out and
 *     hang down in long pointed tips, swaying in the breeze
 *   - a new fern sprouts at dawn and grows from a small tuft into a sprawling plant through
 *     the day; from sundown it wilts, yellowing, browning and drooping, and before the next
 *     dawn its dead fronds drop off one by one while the new sprout comes up
 *   - little birds perch on the branch and twigs: they hop, turn and peck, fly off and come
 *     back, and sleep at night
 *   - pollen drifting by day, stars and fireflies by night; click to send a gust of wind
 *     (and scare off any birds nearby)
 *
 * URL params: hour=13.5 (pin the time of day), cycle=120 (a whole day in this many seconds).
 * No chat box on this scene (it would cover the fern).
 */
Wallpaper.scene("plants", (api) => {
  "use strict";

  const { grid, floatParam, setTheme } = api;
  const { clamp, lerp, smoothstep, rand, noise2 } = Wallpaper.math;
  const S = Wallpaper.shapes;
  const style = Wallpaper.style;

  const PIN_HOUR = floatParam("hour", NaN);
  const CYCLE = floatParam("cycle", 0);

  setTheme("dark");

  // -------------------------------------------------------------- palette

  const LEAF_DARK = [46, 104, 62];
  const LEAF_SAGE = [100, 152, 100];
  const LEAF_PALE = [178, 208, 172];
  const DRY = [196, 170, 82];
  const DEAD = [122, 86, 52];
  const SHIELD = [128, 176, 78];
  const SHIELD_RIM = [176, 196, 96];
  const CORE = [150, 104, 60];
  const RUST = [214, 126, 48];
  const PAPER = [176, 132, 82];
  const BARK = [118, 88, 62];
  const MOSS = [96, 150, 70];
  const CANOPY = [54, 112, 58];
  const SUN = [255, 236, 170];
  const MOON = [220, 226, 240];
  const FIREFLY = [210, 255, 120];
  const POLLEN = [255, 226, 150];

  /** The sky through the day: [hour, top, horizon, light on things, tint on things]. */
  const SKY = [
    [0, [6, 10, 28], [20, 30, 62], 0.72, [0.72, 0.84, 1.18]],
    [4.5, [6, 10, 28], [20, 30, 62], 0.72, [0.72, 0.84, 1.18]],
    [6, [56, 58, 112], [226, 140, 104], 0.78, [1.12, 0.9, 0.85]],
    [8, [84, 146, 212], [212, 218, 206], 0.95, [1, 1, 0.95]],
    [12, [56, 126, 204], [168, 208, 230], 1.05, [1, 1, 1]],
    [16.5, [78, 138, 200], [224, 208, 174], 1, [1.05, 1, 0.9]],
    [18.5, [72, 62, 122], [240, 130, 76], 0.8, [1.2, 0.86, 0.72]],
    [20, [22, 22, 58], [58, 42, 74], 0.74, [0.86, 0.8, 1.05]],
    [21.5, [6, 10, 28], [20, 30, 62], 0.72, [0.72, 0.84, 1.18]],
    [24, [6, 10, 28], [20, 30, 62], 0.72, [0.72, 0.84, 1.18]],
  ];
  const sky = { hour: -1, top: [0, 0, 0], horizon: [0, 0, 0], light: 1, tint: [1, 1, 1], day: 1 };
  const startTime = performance.now();
  let skyPainted = 0;

  /** Local hours since the Unix epoch (sped up in cycle mode), so days can be counted. */
  function clockHours() {
    const d = new Date();
    const day = Math.floor((d.getTime() - d.getTimezoneOffset() * 60000) / 86400000);
    const clock = Number.isFinite(PIN_HOUR)
      ? PIN_HOUR
      : d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600 + d.getMilliseconds() / 3.6e6;
    const hours = day * 24 + clock;
    return CYCLE > 0 ? hours + ((performance.now() - startTime) / 1000 / CYCLE) * 24 : hours;
  }

  function setSky(hour) {
    let i = 0;
    while (SKY[i + 1][0] <= hour && i < SKY.length - 2) i++;
    const a = SKY[i], b = SKY[i + 1];
    const t = smoothstep(a[0], b[0], hour);
    for (let k = 0; k < 3; k++) {
      sky.top[k] = lerp(a[1][k], b[1][k], t);
      sky.horizon[k] = lerp(a[2][k], b[2][k], t);
      sky.tint[k] = lerp(a[4][k], b[4][k], t);
    }
    sky.light = lerp(a[3], b[3], t);
    sky.day = smoothstep(5, 7, hour) * (1 - smoothstep(18, 20, hour));
    sky.hour = hour;
  }

  /** rgb lit by `k` under the current sky. */
  const lit = (rgb, k, a = 1) =>
    style(rgb[0] * k * sky.light * sky.tint[0], rgb[1] * k * sky.light * sky.tint[1], rgb[2] * k * sky.light * sky.tint[2], a);
  const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

  /** Where the sun (by day) or the moon (by night) is: { x, y, sun } or null. */
  function skyBody(hour) {
    const sun = hour >= 5.5 && hour < 18.5;
    const p = sun ? (hour - 5.5) / 13 : (((hour - 18.5) % 24) + 24) % 24 / 11;
    if (p > 1) return null;
    return { x: W * lerp(0.04, 0.78, p), y: H * (0.8 - 0.52 * Math.sin(Math.PI * p)), sun };
  }

  // ------------------------------------------------------------ the fern's day

  // Each fern sprouts at 05:00 and lives a day: [0, 1) h it comes up, then grows until
  // 16:30, wilts 18:00 → 21:30 and drops its dead fronds 04:00 → 05:30 the next morning.
  const SPROUT_HOUR = 5;
  const SPROUT = 0.06;

  function life(age) {
    const x = clamp((age - 1) / 10.5, 0, 1);
    const growth = age < 1 ? SPROUT * smoothstep(0, 1, age) : lerp(SPROUT, 1, (smoothstep(0, 1, x) + x) / 2);
    return { growth, wilt: smoothstep(13, 16.5, age), shed: clamp((age - 23) / 1.5, 0, 1) };
  }

  function seeded(seed) {
    let a = seed >>> 0;
    return (lo = 0, hi = 1) => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return lo + (((t ^ (t >>> 14)) >>> 0) / 4294967296) * (hi - lo);
    };
  }

  /**
   * An antler frond's forks: each node is a strap that splits in two, or ends in a long
   * pointed tip that curls a little.
   */
  function fork(rnd, depth) {
    const node = { len: 1, turn: 0, bend: rnd(-0.25, 0.25), curl: 0, kids: [] };
    if (depth > 0) {
      const spread = rnd(0.4, 0.8), tilt = rnd(-0.15, 0.15);
      for (const s of [-1, 1]) {
        const kid = fork(rnd, depth - (rnd() < 0.25 ? 2 : 1));
        kid.turn = (s * spread) / 2 + tilt;
        kid.len = kid.kids.length ? rnd(0.55, 0.8) : rnd(0.7, 1.05);
        node.kids.push(kid);
      }
    } else {
      node.curl = rnd(-1.2, 1.2);
    }
    return node;
  }

  const ferns = new Map();

  /** The fern that sprouted on `day`; every day's fern is a little different. */
  function fernFor(day) {
    let fern = ferns.get(day);
    if (fern) return fern;
    const rnd = seeded(day * 7919 + 13);
    const fronds = [];
    const n = 16 + Math.floor(rnd(0, 6));
    for (let k = 0; k < n; k++) {
      // The first fronds stand up; of the rest a few do, most reach out, arch over and hang.
      const side = k % 2 ? 1 : -1;
      const up = k < 2 || rnd() < 0.15;
      fronds.push({
        angle: side * (up ? rnd(0.2, 0.8) : rnd(0.8, 2.4)),
        len: up ? rnd(0.07, 0.1) : rnd(0.11, 0.19),
        width: rnd(0.8, 1.2),
        stiff: rnd(0.8, 1.2),
        tone: up ? rnd(0.6, 1) : rnd(),
        born: k < 2 ? k * 0.02 : rnd(0.04, 0.6),
        lag: rnd(),
        dropAt: rnd(0.05, 0.75),
        tree: fork(rnd, up ? 2 : rnd() < 0.4 ? 4 : 3),
      });
    }
    fronds.sort((a, b) => a.born - b.born);
    fern = { day, fronds, lobes: 6 + Math.floor(rnd(0, 3)), phase: rnd(0, 1), shedSeen: undefined };
    ferns.set(day, fern);
    for (const d of ferns.keys()) if (d < day - 2) ferns.delete(d);
    return fern;
  }

  // ----------------------------------------------------------------- grid

  let W = 0, H = 0, cw = 10, ch = 15, cols = 0, rows = 0;
  let glyph = [], color = [];
  /** Trunk, branch and canopy: rebuilt when the light changes, composited every frame. */
  let staticGlyph = [], staticColor = [], staticBg = [], staticDirty = true;
  /** Which frond last drew each cell this frame, and how close to its middle. */
  let owner = new Int32Array(0), ownRatio = new Float32Array(0), stampId = 0;

  // Layout, in px: the trunk's left edge, the branch, its twigs ([x, y, r] samples), where
  // the fern sits, and the spots a bird can perch on ({ x, y, limb }, in order along each limb).
  let trunkX = 0, branchY0 = 0, ax = 0, ay = 0, shieldR = 0;
  let twigs = [], perches = [];
  let stars = [], motes = [], flies = [];
  const bits = [], falling = [], birds = [];

  function resize() {
    ({ W, H, cw, ch, cols, rows, glyph, color } = grid);
    const n = cols * rows;
    staticGlyph = new Array(n).fill("");
    staticColor = new Array(n).fill("");
    staticBg = new Array(n).fill("");
    owner = new Int32Array(n);
    ownRatio = new Float32Array(n);
    staticDirty = true;

    trunkX = W * 0.85;
    branchY0 = H * 0.42;
    ax = W * 0.4;
    ay = branchY(ax) - branchR(ax) * 0.35;
    shieldR = H * 0.12;

    const fromBranch = (x) => [x, branchTop(x) + branchR(x) * 0.5];
    twigs = [
      curve([fromBranch(W * 0.19), [W * 0.17, H * 0.24], [W * 0.07, H * 0.32], [W * 0.015, H * 0.17]], H * 0.02, H * 0.005),
      curve([fromBranch(W * 0.66), [W * 0.63, H * 0.2], [W * 0.75, H * 0.27], [W * 0.77, H * 0.12]], H * 0.017, H * 0.005),
    ];
    findPerches();
    birds.length = 0;
    for (let k = 0; k < 3; k++) birds.push(newBird(true));

    stars = [];
    for (let k = 0; k < cols * rows * 0.004; k++) {
      stars.push({ c: (Math.random() * cols) | 0, r: (Math.random() * rows * 0.6) | 0, seed: rand(0, 100), big: Math.random() < 0.15 });
    }
    motes = Array.from({ length: 40 }, () => ({ x: rand(0, W), y: rand(0, H), seed: rand(0, 100) }));
    flies = Array.from({ length: 16 }, () => ({ x: rand(0, W * 0.8), y: rand(H * 0.3, H), seed: rand(0, 100) }));
  }

  // The branch: rising away from the trunk, with a sag and a hump along the way.
  const trunkEdge = (y) => trunkX + Math.sin(y * 0.006) * cw * 1.5 + (noise2(y * 0.01, 0, 5) - 0.5) * cw * 2.5;
  const branchY = (x) => branchY0 - ((trunkX - x) / trunkX) * H * 0.05
    + Math.sin((x / W) * 7 + 0.4) * H * 0.045 + Math.sin((x / W) * 16 + 2) * H * 0.012;
  const branchR = (x) =>
    lerp(H * 0.026, H * 0.06, Math.pow(clamp(x / trunkX, 0, 1), 1.6)) + H * 0.05 * smoothstep(trunkX - W * 0.07, trunkX, x);
  const branchSlope = (x) => (branchY(x + 1) - branchY(x - 1)) / 2;
  /** Vertical half-thickness: a sloping limb is thicker measured straight down. */
  const branchHalf = (x) => branchR(x) * Math.hypot(1, branchSlope(x));
  const branchTop = (x) => branchY(x) - branchHalf(x);

  /** A cubic Bézier through 4 points, as [x, y, r] samples tapering r0 → r1. */
  function curve([p0, p1, p2, p3], r0, r1) {
    const out = [];
    for (let k = 0; k <= 40; k++) {
      const t = k / 40, u = 1 - t;
      const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
      out.push([a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1], lerp(r0, r1, t)]);
    }
    return out;
  }

  /** Spots along the tops of the branch and twigs that are level enough to sit on. */
  function findPerches() {
    perches = [];
    for (let x = cw * 3; x < trunkX - W * 0.05; x += cw) {
      if (x > ax - W * 0.17 && x < ax + W * 0.15) continue; // the fern's in the way
      if (Math.abs(branchSlope(x)) < 0.45) perches.push({ x, y: branchTop(x), limb: 0 });
    }
    twigs.forEach((tw, limb) => {
      let last = -Infinity;
      for (let k = 6; k < tw.length - 3; k++) {
        const [x, y, r] = tw[k], slope = (tw[k + 1][1] - tw[k - 1][1]) / (tw[k + 1][0] - tw[k - 1][0] || 1e-6);
        if (Math.abs(slope) > 0.6 || Math.abs(x - last) < cw) continue;
        perches.push({ x, y: y - r * Math.hypot(1, slope), limb: limb + 1 });
        last = x;
      }
    });
  }

  function paintBackdrop(g, w, h) {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, `rgb(${sky.top.map(Math.round)})`);
    grad.addColorStop(1, `rgb(${sky.horizon.map(Math.round)})`);
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);

    const body = skyBody(sky.hour);
    if (!body) return;
    const rgb = body.sun ? "255, 236, 180" : "200, 214, 255";
    const r = Math.min(w, h) * (body.sun ? 0.32 : 0.2);
    const glow = g.createRadialGradient(body.x, body.y, 0, body.x, body.y, r);
    glow.addColorStop(0, `rgba(${rgb}, ${body.sun ? 0.55 : 0.22})`);
    glow.addColorStop(1, `rgba(${rgb}, 0)`);
    g.fillStyle = glow;
    g.fillRect(0, 0, w, h);
  }

  // -------------------------------------------------------------- the tree

  /** Wood and leaves are solid: a lighter glyph on a darker cell of the same colour. */
  function solid(i, g, rgb, k) {
    glyph[i] = g;
    color[i] = lit(rgb, k * 1.2);
    grid.bg[i] = lit(rgb, (Math.round(k * 4) / 4) * 0.5);
  }

  /** Paint trunk, branch, twigs and canopy into the grid, then keep them as a layer. */
  function buildStatic() {
    const midY = [], half = [];
    for (let c = 0; c < cols; c++) {
      const x = (c + 0.5) * cw;
      midY.push(branchY(x));
      half.push(branchHalf(x));
    }
    for (let r = 0; r < rows; r++) {
      const y = (r + 0.5) * ch;
      const te = trunkEdge(y);
      for (let c = 0; c < cols; c++) {
        const x = (c + 0.5) * cw, i = r * cols + c;

        // Trunk: lit on its left, with vertical fissures.
        if (x > te) {
          const across = clamp((x - te) / (W - te + cw * 6), 0, 1);
          let k = lerp(1.0, 0.5, across) * (x - te < cw * 1.2 ? 0.75 : 1);
          const fissure = ((noise2(x * 0.045, y * 0.005, 21) * 7) % 1) < 0.22;
          if (fissure) k *= 0.6;
          solid(i, fissure ? "|" : "!#%(=)"[((noise2(x * 0.2, y * 0.05, 22) * 6) | 0) % 6], BARK, k);
        }

        // Branch: a tapering limb lit from above, with grain along it and moss on top.
        if (x < te + cw * 3) {
          const v = (y - midY[c]) / half[c];
          if (Math.abs(v) < 1) {
            let k = clamp(0.72 - 0.4 * v + 0.12 * Math.sqrt(1 - v * v), 0.3, 1.1);
            const groove = ((noise2(x * 0.007, v * 2.2, 31) * 6) % 1) < 0.2;
            if (groove) k *= 0.65;
            let g = groove ? "=" : "-~=+:"[((noise2(x * 0.08, v * 4, 32) * 5) | 0) % 5];
            if (v < -0.85) g = "_";
            else if (v > 0.85) g = "'";
            if (v < -0.4 && noise2(x * 0.025, v, 41) > 0.56) solid(i, "\"',*"[(c * 7 + r * 3) % 4], MOSS, 0.9 - v * 0.2);
            else solid(i, g, BARK, k);
          }
        }
      }
    }

    // Twigs, with a few leaves of the host tree hanging off their outer halves.
    for (const tw of twigs) {
      for (let k = 0; k < tw.length - 1; k++) {
        const [x0, y0, w0] = tw[k], [x1, y1, w1] = tw[k + 1];
        body(x0, y0, x1, y1, w0, w1, (i, v) =>
          solid(i, Math.abs(v) > 0.6 ? dirGlyph(x1 - x0, y1 - y0) : "=+#"[(i * 7) % 3], BARK, 0.8 - 0.35 * v));
      }
      for (let k = 18, side = 1; k < tw.length; k += 5, side = -side) {
        const [x0, y0] = tw[k], [px, py] = tw[k - 1];
        const tx = x0 - px, ty = y0 - py, tl = Math.hypot(tx, ty) || 1;
        let lx = (-ty / tl) * side * 0.7 + (tx / tl) * 0.3, ly = (tx / tl) * side * 0.7 + 0.8;
        const ll = Math.hypot(lx, ly), L = H * 0.05;
        const x1 = x0 + (lx / ll) * L, y1 = y0 + (ly / ll) * L;
        body(x0, y0, x1, y1, H * 0.003, H * 0.015, (i, v, along) => {
          if (Math.abs(v) > Math.sin(Math.PI * Math.min(1, along * 1.15))) return;
          solid(i, Math.abs(v) < 0.2 ? dirGlyph(x1 - x0, y1 - y0) : "%#&"[(i * 5) % 3], CANOPY, 0.75 - 0.3 * v);
        });
      }
    }

    // The host tree's canopy along the top: clumps of leaves, thicker near the trunk.
    const band = H * 0.2;
    for (let r = 0; r < rows; r++) {
      const y = (r + 0.5) * ch;
      if (y > band * 1.3) break;
      for (let c = 0; c < cols; c++) {
        const x = (c + 0.5) * cw;
        const dense = noise2(x * 0.006, y * 0.014, 9) * 0.55 + noise2(x * 0.022, y * 0.045, 10) * 0.45
          - (y / band) * 0.6 + 0.18 * smoothstep(W * 0.4, W, x) + 0.1;
        if (dense < 0.42) continue;
        const i = r * cols + c;
        const shade = noise2(x * 0.03, y * 0.04, 11);
        const k = 0.55 + shade * 0.55 - (y / band) * 0.15;
        const rgb = mix(CANOPY, [104, 156, 66], shade);
        if (dense < 0.47) {
          glyph[i] = "',.`"[(c + r) % 4];
          color[i] = lit(rgb, k);
        } else solid(i, "&%@#*8"[((shade * 13) | 0) % 6], rgb, k);
      }
    }

    for (let i = 0; i < glyph.length; i++) {
      staticGlyph[i] = glyph[i];
      staticColor[i] = color[i];
      staticBg[i] = grid.bg[i];
    }
    grid.clear();
    staticDirty = false;
  }

  /**
   * Visit the cells of a tapered strap from (x0, y0) to (x1, y1), half-width w0 → w1:
   * fn(i, v, along) with v ∈ [-1, 1] across it (negative on the upper side).
   */
  function body(x0, y0, x1, y1, w0, w1, fn) {
    const dx = x1 - x0, dy = y1 - y0, l2 = dx * dx + dy * dy || 1;
    const pad = Math.max(w0, w1) + cw;
    const c0 = Math.max(0, Math.floor((Math.min(x0, x1) - pad) / cw)), c1 = Math.min(cols - 1, Math.floor((Math.max(x0, x1) + pad) / cw));
    const r0 = Math.max(0, Math.floor((Math.min(y0, y1) - pad) / ch)), r1 = Math.min(rows - 1, Math.floor((Math.max(y0, y1) + pad) / ch));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const px = (c + 0.5) * cw - x0, py = (r + 0.5) * ch - y0;
        const h = clamp((px * dx + py * dy) / l2, 0, 1);
        const qx = px - dx * h, qy = py - dy * h;
        const d = Math.hypot(qx, qy), w = Math.max(w0 + (w1 - w0) * h, cw * 0.5);
        if (d < w) fn(r * cols + c, (d / w) * (qy < 0 ? -1 : 1), h);
      }
    }
  }

  // -------------------------------------------------------------- the fern

  const LX = -0.55, LY = -0.83; // toward the light, up and to the left
  const RAMP = ":-=+*#%@";

  function dirGlyph(dx, dy) {
    const x = Math.abs(dx) / cw, y = Math.abs(dy) / ch;
    if (y < x * 0.4) return "-";
    if (x < y * 0.4) return "|";
    return dx * dy > 0 ? "\\" : "/";
  }

  /**
   * Draw one strap of a frond, from (x0, y0) to (x1, y1), half-width w0 → w1. Material `k`
   * gives { id, rgb, bg, alpha }; a cell keeps the frond's strap it is most inside.
   * Inside, the strap is solid (glyphs on a darker cell); its rim is drawn in line glyphs.
   */
  function stamp(x0, y0, x1, y1, w0, w1, k) {
    const dx = x1 - x0, dy = y1 - y0, l2 = dx * dx + dy * dy || 1, l = Math.sqrt(l2);
    // A strap narrower than a cell still covers one cell across.
    const reach = 0.5 * ((cw * Math.abs(dy)) / l + (ch * Math.abs(dx)) / l);
    const pad = Math.max(w0, w1, reach);
    const c0 = Math.max(0, Math.floor((Math.min(x0, x1) - pad) / cw)), c1 = Math.min(cols - 1, Math.floor((Math.max(x0, x1) + pad) / cw));
    const r0 = Math.max(0, Math.floor((Math.min(y0, y1) - pad) / ch)), r1 = Math.min(rows - 1, Math.floor((Math.max(y0, y1) + pad) / ch));
    const line = dirGlyph(dx, dy);
    const thin = Math.max(w0, w1) < cw * 0.6;
    for (let r = r0; r <= r1; r++) {
      const py = (r + 0.5) * ch - y0;
      for (let c = c0; c <= c1; c++) {
        const px = (c + 0.5) * cw - x0;
        const h = clamp((px * dx + py * dy) / l2, 0, 1);
        const qx = px - dx * h, qy = py - dy * h;
        const d = Math.hypot(qx, qy), w = w0 + (w1 - w0) * h, edge = Math.max(w, reach);
        if (d > edge) continue;
        const ratio = d / edge, i = r * cols + c;
        if (owner[i] === k.id && ownRatio[i] <= ratio) continue;
        owner[i] = k.id;
        ownRatio[i] = ratio;

        const facing = d > 0 ? (qx * LX + qy * LY) / d : 0;
        let light = 0.85 + 0.3 * facing * ratio, g;
        const inside = !thin && d <= w - cw * 0.3;
        if (!inside) g = line;
        else if (ratio < 0.2 && w > cw * 1.2) {
          g = line;
          light *= 1.15;
        } else g = RAMP[clamp(((light - 0.45) / 0.75) * RAMP.length, 0, RAMP.length - 1) | 0];
        if (inside) {
          grid.bg[i] = k.bg;
          light *= 1.15;
        }
        glyph[i] = g;
        color[i] = lit(k.rgb, light, k.alpha);
      }
    }
  }

  const strap = { id: 0, rgb: LEAF_DARK, bg: "", alpha: 1 };
  const bend = { droop: 0, limp: 0, wind: 0, open: 1, ref: 1 };

  /**
   * Walk one fork of a frond from (x, y) heading `ang` (radians clockwise from up), bending
   * under its own weight and the wind, then split into its kids. Straps widen into a web
   * where they fork; tips narrow to a point.
   */
  function walk(node, x, y, ang, len, w0, isRoot) {
    if (len < cw * 0.5) return;
    const tip = !node.kids.length;
    const w1 = isRoot ? w0 * 2.2 : tip ? w0 * 0.3 : w0 * 1.25;
    const steps = Math.max(1, Math.ceil(len / (cw * 1.4)));
    const ds = len / steps;
    for (let s = 0; s < steps; s++) {
      const sn = Math.sin(ang), cs = Math.cos(ang);
      ang += ((bend.droop * sn + bend.limp * Math.sign(sn || 1) * (1 + cs) * 0.5 + bend.wind * cs) * ds) / bend.ref
        + (node.bend * ds) / len + (tip && s >= steps * 0.45 ? (node.curl * ds * 1.6) / len : 0);
      const nx = x + Math.sin(ang) * ds, ny = y - Math.cos(ang) * ds;
      stamp(x, y, nx, ny, lerp(w0, w1, s / steps), lerp(w0, w1, (s + 1) / steps), strap);
      x = nx;
      y = ny;
    }
    for (const kid of node.kids) walk(kid, x, y, ang + kid.turn * bend.open, len * kid.len, w1 * 0.72, false);
  }

  function frondColor(wilt, young, tone) {
    const green = mix(mix(LEAF_DARK, LEAF_SAGE, tone), LEAF_PALE, young);
    return wilt < 0.5 ? mix(green, DRY, wilt / 0.5) : mix(DRY, DEAD, (wilt - 0.5) / 0.5);
  }

  /** One antler frond of a fern in state `p`, rooted at (x, y), turned by `rot`. */
  function drawFrond(fr, p, x, y, rot, alpha) {
    const grow = clamp((p.growth - fr.born) / (1 - fr.born), 0, 1);
    const size = lerp(0.2, 1, grow) * smoothstep(fr.born, fr.born + 0.04, p.growth);
    const w = clamp(p.wilt * 1.3 - fr.lag * 0.3, 0, 1);
    const len = fr.len * H * size * (1 - 0.12 * w);
    bend.droop = lerp(0.6, 1.4, grow) * fr.stiff + w * 2.2;
    bend.limp = w * 2.6;
    bend.wind = wind * (1 + w * 0.6) * (0.6 + 0.4 * grow);
    bend.open = lerp(0.5, 1, grow) * (1 - 0.35 * w);
    bend.ref = H * 0.3;
    strap.id = ++stampId;
    strap.rgb = frondColor(w, clamp(1 - (p.growth - fr.born) * 3, 0, 1), fr.tone);
    strap.alpha = alpha;
    strap.bg = lit(strap.rgb, 0.5, alpha);
    walk(fr.tree, x, y, fr.angle + rot, len, len * 0.065 * fr.width * (1 - 0.35 * w), true);
  }

  /**
   * A shield frond: a tall fan standing up from the branch, rounded where it clasps the
   * bark, its top split into upright lobes. `crown` is how dry the top is, `old` makes the
   * whole frond the papery brown of last season's shields.
   */
  function drawShield(fern, x, y, R, alpha, phase, crown, wilt, old) {
    R = Math.max(R, cw);
    const c0 = Math.max(0, Math.floor((x - R) / cw)), c1 = Math.min(cols - 1, Math.floor((x + R) / cw));
    const r0 = Math.max(0, Math.floor((y - R * 1.75) / ch)), r1 = Math.min(rows - 1, Math.floor((y + R * 0.5) / ch));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const dx = (c + 0.5) * cw - x, dy = (r + 0.5) * ch - y;
        const s = dx / R, u = -dy / R;
        const half = u < 0 ? 0.62 * Math.sqrt(Math.max(0, 1 - (u / 0.48) ** 2)) : 0.62 + 0.26 * smoothstep(0, 1.1, u);
        const f = ((((s + 3) * fern.lobes) / 2 + phase) % 1 + 1) % 1, finger = 1 - Math.abs(2 * f - 1);
        const top = 1.2 + 0.12 * Math.cos(s * 2.4) + 0.38 * finger * finger;
        const side = half - Math.abs(s), above = top - u;
        if (side <= 0 || above <= 0) continue;
        const i = r * cols + c;

        // Green with a yellower rim, a brown core where the fronds come out, a rusty crown.
        let rgb = mix(SHIELD, SHIELD_RIM, clamp(Math.abs(s) / half, 0, 1) * 0.6);
        rgb = mix(rgb, CORE, smoothstep(0.38, 0.1, Math.hypot(s, u - 0.15)));
        if (old) rgb = mix(PAPER, RUST, smoothstep(0.6, 1.3, u));
        rgb = mix(rgb, RUST, clamp(smoothstep(0.85, 1.35, u) * crown, 0, 1));
        rgb = mix(rgb, mix(PAPER, DEAD, wilt), wilt);

        let light = 0.72 + 0.28 * (1 - Math.abs(s) / half) - 0.12 * s, g;
        const veinAt = (((Math.atan2(s, u + 0.35) * 8) / Math.PI + 100.5) % 1) - 0.5;
        if (Math.min(side, above) * R < cw * 0.55) {
          g = above < side ? (finger > 0.6 ? "^" : "~") : s < 0 ? "(" : ")";
          light *= 0.9;
        } else {
          g = Math.abs(veinAt) < 0.12 && u > -0.1 ? dirGlyph(dx, dy + R * 0.35)
            : RAMP[clamp(((light - 0.45) / 0.75) * RAMP.length, 0, RAMP.length - 1) | 0];
          grid.bg[i] = lit(rgb, 0.5, alpha);
          light *= 1.15;
        }
        glyph[i] = g;
        color[i] = lit(rgb, light, alpha);
        owner[i] = 0;
      }
    }
  }

  function drawFern(p) {
    const { fern, growth, wilt, shed } = p;
    const fade = 1 - smoothstep(0.75, 1, shed);
    const R = shieldR * lerp(0.3, 1, growth);
    if (fade > 0.02) {
      // Last season's papery shield peeks out behind this season's green one.
      const back = smoothstep(0.25, 0.5, growth);
      if (back > 0) drawShield(fern, ax + R * 0.08, ay - R * 0.1, R * lerp(0.7, 1.08, back), fade * back, fern.phase + 0.5, 1, wilt, true);
      drawShield(fern, ax, ay, R, fade, fern.phase, smoothstep(0.4, 0.9, growth), wilt, false);
    }
    for (const fr of fern.fronds) {
      if (p.growth > fr.born && shed < fr.dropAt) drawFrond(fr, p, ax, ay - R * 0.1, 0, 1);
    }
  }

  // ---------------------------------------------------------------- birds

  // Sprites facing right, a row per line: [glyphs, parts]. Parts: h head, e eye, k beak,
  // b back, w wing, B breast, T tail, t tail tip, f feet, W a wing in flight. (ax, ay) is
  // the cell on the perch: the feet, or the middle of the body in flight.
  const SPRITES = {
    perch: { ax: 4, ay: 3, rows: [
      ["    (@o>", "    hhek"],
      ["  (%==%:", "  bbwwbB"],
      [" /=%%%; ", " tTbbbB "],
      ["/   /|  ", "t   ff  "],
    ] },
    peck: { ax: 4, ay: 3, rows: [
      ["         ", "         "],
      ["  (%==%(o", "  bbwwbhe"],
      [" /=%%%;\\v", " tTbbbBhk"],
      ["/   /|   ", "t   ff   "],
    ] },
    sleep: { ax: 4, ay: 3, rows: [
      ["   .--. ", "   bbhh "],
      ["  (%==-)", "  bbwweh"],
      [" /=%%%) ", " tTbbbB "],
      ["/   /|  ", "t   ff  "],
    ] },
    up: { ax: 3, ay: 2, rows: [
      ["  \\     ", "  W     "],
      ["   \\\\   ", "   WW   "],
      ["-=%%%(o>", "tTbbbhek"],
    ] },
    down: { ax: 3, ay: 0, rows: [
      ["-=%%%(o>", "tTbbbhek"],
      ["   //   ", "   WW   "],
      ["  /     ", "  W     "],
    ] },
  };
  const MIRROR = { "/": "\\", "\\": "/", "(": ")", ")": "(", ">": "<", "<": ">" };
  const SPECIES = [
    { head: [120, 84, 58], back: [140, 102, 70], wing: [100, 74, 52], breast: [214, 192, 160], beak: [80, 66, 50] }, // sparrow
    { head: [84, 78, 74], back: [106, 98, 90], wing: [78, 72, 66], breast: [232, 118, 58], beak: [230, 180, 70] }, // robin
    { head: [64, 116, 200], back: [70, 124, 204], wing: [50, 90, 160], breast: [224, 146, 86], beak: [50, 50, 60] }, // bluebird
    { head: [150, 176, 80], back: [136, 164, 74], wing: [100, 128, 58], breast: [226, 222, 170], beak: [60, 60, 50] }, // white-eye
  ];

  function newBird(perched) {
    const b = {
      sp: SPECIES[(Math.random() * SPECIES.length) | 0], perch: -1, mode: "away", leaving: false,
      x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0, flip: Math.random() < 0.5,
      timer: rand(2, 10), peck: 0, hop: null, seed: rand(0, 100),
    };
    if (perched) {
      b.perch = pickPerch(b);
      if (b.perch >= 0) {
        b.mode = "perch";
        b.x = perches[b.perch].x;
        b.y = perches[b.perch].y;
        b.timer = rand(0.5, 3);
      }
    }
    return b;
  }

  /** A perch no other bird has taken (or is flying to), or -1. */
  function freePerch(k, self) {
    const p = perches[k];
    return birds.every((b) => b === self || b.perch < 0 || Math.hypot(perches[b.perch].x - p.x, perches[b.perch].y - p.y) > cw * 10);
  }

  function pickPerch(self) {
    for (let tries = 0; tries < 40 && perches.length; tries++) {
      const k = (Math.random() * perches.length) | 0;
      if (freePerch(k, self)) return k;
    }
    return -1;
  }

  function takeOff(b) {
    b.perch = -1;
    b.hop = null;
    b.mode = "fly";
    b.leaving = true;
    b.tx = Math.random() < 0.5 ? -W * 0.08 : W * 1.08;
    b.ty = rand(-0.05, 0.25) * H;
    b.vx = 0;
    b.vy = -H * 0.3;
  }

  /** A few cells along the same limb. */
  function hop(b) {
    const k = b.perch + (Math.random() < 0.5 ? -1 : 1) * (1 + ((Math.random() * 3) | 0));
    const from = perches[b.perch], to = perches[k];
    if (!to || to.limb !== from.limb || Math.abs(to.x - from.x) > cw * 5 || !freePerch(k, b)) return;
    b.hop = { x: b.x, y: b.y, t: 0 };
    b.perch = k;
    b.flip = to.x < from.x;
  }

  function stepBird(b, dt, t) {
    if (b.mode === "away") {
      b.timer -= dt;
      if (b.timer > 0) return;
      b.perch = pickPerch(b);
      if (b.perch < 0) {
        b.timer = 3;
        return;
      }
      b.mode = "fly";
      b.leaving = false;
      b.sp = SPECIES[(Math.random() * SPECIES.length) | 0];
      b.x = Math.random() < 0.5 ? -W * 0.05 : W * 1.05;
      b.y = rand(0.02, 0.3) * H;
      b.vx = b.vy = 0;
      return;
    }

    if (b.mode === "fly") {
      const tx = b.leaving ? b.tx : perches[b.perch].x, ty = b.leaving ? b.ty : perches[b.perch].y;
      const dx = tx - b.x, dy = ty - b.y, d = Math.hypot(dx, dy) || 1;
      const speed = Math.min(W * 0.28, d * 2.5 + W * 0.03); // slows down to land
      const k = Math.min(1, dt * 3);
      b.vx += ((dx / d) * speed - b.vx) * k;
      b.vy += ((dy / d) * speed - b.vy) * k;
      b.x += b.vx * dt;
      b.y += (b.vy + Math.sin(t * 9 + b.seed) * 30) * dt;
      if (Math.abs(b.vx) > 5) b.flip = b.vx < 0;
      if (b.leaving && (b.x < -W * 0.06 || b.x > W * 1.06)) {
        b.mode = "away";
        b.timer = rand(5, 20);
      } else if (!b.leaving && d < cw * 1.5) {
        b.mode = "perch";
        b.x = tx;
        b.y = ty;
        b.timer = rand(1, 3);
      }
      return;
    }

    if (b.hop) {
      const to = perches[b.perch];
      b.hop.t = Math.min(1, b.hop.t + dt / 0.22);
      b.x = lerp(b.hop.x, to.x, b.hop.t);
      b.y = lerp(b.hop.y, to.y, b.hop.t) - Math.sin(Math.PI * b.hop.t) * ch * 0.9;
      if (b.hop.t >= 1) b.hop = null;
      return;
    }
    b.peck -= dt;
    b.timer -= dt;
    if (sky.day < 0.25 || b.timer > 0) return; // asleep, or just sitting
    const r = Math.random();
    if (r < 0.3) b.peck = rand(0.25, 0.5);
    else if (r < 0.5) b.flip = !b.flip;
    else if (r < 0.86) hop(b);
    else if (r < 0.9) takeOff(b);
    b.timer = rand(0.8, 3.5);
  }

  function drawBird(b, t) {
    if (b.mode === "away") return;
    const sprite = b.mode === "fly" ? (Math.sin(t * 16 + b.seed) > 0 ? SPRITES.up : SPRITES.down)
      : sky.day < 0.25 && !b.hop ? SPRITES.sleep : b.peck > 0 ? SPRITES.peck : SPRITES.perch;
    const sp = b.sp;
    const part = (rgb) => ({ fg: lit(rgb, 1.25), bg: lit(rgb, 0.6) });
    const parts = {
      h: part(sp.head), b: part(sp.back), w: part(sp.wing), B: part(sp.breast), T: part(mix(sp.back, sp.wing, 0.5)),
      e: { fg: style(24, 22, 20, 1), bg: lit(sp.head, 1.1) },
      k: { fg: lit(sp.beak, 1.1) }, t: { fg: lit(sp.wing, 1.1) }, f: { fg: lit([70, 58, 46], 1) }, W: { fg: lit(sp.wing, 1.3) },
    };
    const footC = Math.floor(b.x / cw), footR = Math.floor(b.mode === "fly" ? b.y / ch : b.y / ch - 0.5);
    for (let r = 0; r < sprite.rows.length; r++) {
      const [chars, codes] = sprite.rows[r], row = footR - sprite.ay + r;
      if (row < 0 || row >= rows) continue;
      for (let k = 0; k < chars.length; k++) {
        const code = codes[k];
        if (code === " ") continue;
        const col = b.flip ? footC + sprite.ax - k : footC - sprite.ax + k;
        if (col < 0 || col >= cols) continue;
        const i = row * cols + col, p = parts[code];
        glyph[i] = b.flip ? MIRROR[chars[k]] || chars[k] : chars[k];
        color[i] = p.fg;
        if (p.bg) grid.bg[i] = p.bg;
      }
    }
  }

  // ------------------------------------------------------------ the scene

  let alive = [], wind = 0, gust = 0, bitTimer = 0;

  /** Fronds whose time has come break off and fall. */
  function shedFronds(p) {
    const f = p.fern;
    if (f.shedSeen !== undefined && p.shed > f.shedSeen) {
      for (const fr of f.fronds) {
        if (p.growth > fr.born && f.shedSeen < fr.dropAt && fr.dropAt <= p.shed) {
          falling.push({ fr, p: { ...p }, x: ax, y: ay - shieldR * 0.1, vx: rand(-12, 12), vy: 0, rot: 0, spin: Math.sign(fr.angle) * rand(0.15, 0.5), age: 0 });
        }
      }
    }
    f.shedSeen = p.shed;
  }

  function step(dt, t) {
    const now = performance.now();
    const hours = clockHours();
    const hour = ((hours % 24) + 24) % 24;
    if (Math.abs(hour - sky.hour) > 0.02 && now - skyPainted > 250) {
      setSky(hour);
      grid.repaintBackdrop();
      staticDirty = true;
      skyPainted = now;
    }

    // Today's fern, and yesterday's while it drops its last fronds.
    const since = hours - SPROUT_HOUR, day = Math.floor(since / 24), age = since - day * 24;
    alive = [{ fern: fernFor(day), ...life(age) }];
    if (age < 0.5) alive.unshift({ fern: fernFor(day - 1), ...life(age + 24) });
    for (const p of alive) shedFronds(p);

    gust *= Math.exp(-dt * 0.9);
    wind = (noise2(t * 0.12, 0, 3) - 0.5) * 0.4 + 0.05 * Math.sin(t * 1.1) + gust;

    for (let k = falling.length - 1; k >= 0; k--) {
      const f = falling[k];
      f.age += dt;
      f.vy = (f.vy + H * 0.12 * dt) * (1 - 0.6 * dt);
      f.x += (f.vx + wind * 80) * dt;
      f.y += f.vy * dt;
      f.rot += f.spin * dt;
      if (f.age > 5 || f.y > H * 1.4) falling.splice(k, 1);
    }

    // Dry bits flutter down while the fern wilts, and more as it sheds.
    const old = alive[0];
    const rate = old.shed > 0 && old.shed < 1 ? 4 : old.wilt > 0.15 && old.wilt < 0.95 ? 1.5 : old.wilt >= 0.95 ? 0.15 : 0;
    bitTimer -= dt * rate;
    if (rate && bitTimer <= 0) {
      const R = shieldR * 2.2;
      bits.push({ x: ax + rand(-1, 1) * R, y: ay + rand(-0.3, 1.6) * shieldR, vy: rand(18, 34), seed: rand(0, 100) });
      bitTimer = rand(0.5, 1.5);
    }
    for (let k = bits.length - 1; k >= 0; k--) {
      const b = bits[k];
      b.y += b.vy * dt;
      b.x += (Math.sin(t * 2.2 + b.seed) * 22 + wind * 60) * dt;
      if (b.y > H) bits.splice(k, 1);
    }

    for (const b of birds) stepBird(b, dt, t);

    for (const m of motes) {
      m.x += (wind * 70 + Math.sin(t * 0.3 + m.seed) * 9) * dt;
      m.y += (Math.sin(t * 0.5 + m.seed * 2) * 7 - 3) * dt;
      if (m.x < 0) m.x += W;
      if (m.x > W) m.x -= W;
      if (m.y < 0) m.y += H;
    }
    for (const f of flies) {
      const a = noise2(t * 0.15, f.seed, 77) * Math.PI * 4;
      f.x = clamp(f.x + Math.cos(a) * 22 * dt, 0, trunkX);
      f.y = clamp(f.y + Math.sin(a) * 16 * dt, H * 0.25, H);
    }
  }

  function draw(t) {
    if (staticDirty) buildStatic();

    const night = 1 - sky.day;
    if (night > 0.05) {
      for (const s of stars) {
        const tw = 0.45 + 0.55 * noise2(t * 0.8, s.seed, 5);
        grid.put(s.c, s.r, s.big && tw > 0.7 ? "+" : ".", style(220, 230, 255, night * tw * (s.big ? 0.9 : 0.6)));
      }
    }
    const body = skyBody(sky.hour);
    if (body) {
      const r = H * (body.sun ? 0.042 : 0.038);
      S.paint(grid, S.circle(body.x, body.y, r), body.sun
        ? { rgb: SUN, flat: true, glyph: "@" }
        : { rgb: MOON, ramp: "-=+*#%@" });
    }

    for (let i = 0; i < glyph.length; i++) {
      if (staticGlyph[i]) {
        glyph[i] = staticGlyph[i];
        color[i] = staticColor[i];
        grid.bg[i] = staticBg[i];
      }
    }

    owner.fill(0);
    stampId = 0;
    for (const p of alive) drawFern(p);
    for (const f of falling) drawFrond(f.fr, f.p, f.x, f.y, f.rot, 1 - smoothstep(3, 5, f.age));
    for (const b of birds) drawBird(b, t);

    const deadSt = lit(DEAD, 1, 0.9);
    for (const b of bits) {
      grid.putAt(b.x, b.y, ",'`~"[Math.min(3, ((Math.sin(t * 4 + b.seed) + 1) * 2) | 0)], deadSt);
    }
    if (sky.day > 0.05) {
      for (const m of motes) {
        const a = sky.day * (0.25 + 0.35 * Math.sin(t * 0.8 + m.seed));
        if (a > 0.05) grid.putAt(m.x, m.y, ".", style(POLLEN[0], POLLEN[1], POLLEN[2], a));
      }
    }
    if (night > 0.05) {
      for (const f of flies) {
        const blink = Math.pow(Math.max(0, Math.sin(t * 1.3 + f.seed * 7)), 6);
        if (blink < 0.05) continue;
        const st = style(FIREFLY[0], FIREFLY[1], FIREFLY[2], night * blink);
        grid.putAt(f.x, f.y, blink > 0.5 ? "*" : ".", st);
        if (blink > 0.7) {
          const halo = style(FIREFLY[0], FIREFLY[1], FIREFLY[2], night * blink * 0.35);
          grid.putAt(f.x - cw, f.y, "-", halo);
          grid.putAt(f.x + cw, f.y, "-", halo);
        }
      }
    }
  }

  /** A gust, blowing away from where you click; birds close by fly off. */
  function click(x, y) {
    gust += (x < ax ? 1 : -1) * 0.9;
    for (let k = 0; k < 8; k++) motes.push({ x: x + rand(-30, 30), y: rand(0, H), seed: rand(0, 100) });
    if (motes.length > 80) motes.splice(0, motes.length - 80);
    for (const b of birds) {
      if (b.mode === "perch" && Math.hypot(b.x - x, b.y - y) < W * 0.1) takeOff(b);
    }
  }

  setSky(((clockHours() % 24) + 24) % 24);

  return { resize, paintBackdrop, step, draw, click, chat: false };
});
