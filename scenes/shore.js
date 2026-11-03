/**
 * Shore — the koi pond and its bank, with cats, all seen from above.
 *
 * The top of the screen is the koi pond (same fish, lily pads, caustics and clock-driven
 * colours as the koi scene); the bottom is a grassy bank with stones along the waterline
 * and clumps of reeds and cattails. The cats are a top-down rig rasterised like the koi: a
 * spine from hips to head that bends (and curls into a ring when asleep), head with ears
 * and whiskers, paws that peek out from under the body or reach out on a leg, and a tail
 * chain. They live on the bank:
 *   - they watch koi that swim up to the bank, creep along the edge after them, crouch,
 *     wiggle and swat at the water: a splash, ripples, and the koi dart away;
 *   - now and then a koi flicks its tail and soaks the cat, which leaps back and shakes off;
 *   - they walk to the edge to drink, and curious koi come up to see;
 *   - wet paws leave prints on the bank for a while.
 * Koi wander up to the bank every so often, and crowd there when you drop food near it.
 *
 * Play: click the water to drop food; click the bank to call a cat over; rest the cursor on
 * a cat to pet it (click it to make it purr).
 *
 * URL params: koi=6, pads=4, cats=3 (1-5), hour=13.5, cycle=120.
 */
Wallpaper.scene("shore", (api) => {
  "use strict";

  const { grid, intParam, floatParam, pointer, setTheme } = api;
  const { clamp, lerp, smoothstep, wrapAngle, rand, hash2, noise2 } = Wallpaper.math;
  const style = Wallpaper.style;
  const shapes = Wallpaper.shapes;

  const KOI_COUNT = intParam("koi", 6);
  const PAD_COUNT = intParam("pads", 4);
  const CAT_COUNT = clamp(intParam("cats", 3), 1, 5);
  const PIN_HOUR = floatParam("hour", NaN);
  const CYCLE = floatParam("cycle", 0);

  // -------------------------------------------------------------- palette

  const WHITE = [240, 236, 226];
  const RED = [230, 74, 36];
  const BLACK = [64, 66, 80];
  const GOLD = [240, 188, 68];
  const SLATE = [112, 146, 178];
  const PELLET = [196, 150, 96];

  /** The koi scene's pond through the day: [hour, centre, edge, floor dots, wake, koi light, shadow]. */
  const SKY = [
    [0, [6, 32, 41], [1, 7, 11], [40, 112, 128], [120, 230, 255], 0.78, 0],
    [5, [6, 32, 41], [1, 7, 11], [40, 112, 128], [120, 230, 255], 0.78, 0],
    [6.5, [50, 52, 92], [12, 16, 36], [130, 120, 190], [200, 190, 255], 0.86, 0.1],
    [7.5, [160, 122, 108], [48, 54, 80], [255, 196, 150], [255, 230, 200], 0.95, 0.3],
    [10, [250, 247, 238], [226, 220, 206], [150, 168, 172], [80, 140, 160], 0.72, 0.35],
    [16, [250, 247, 238], [226, 220, 206], [150, 168, 172], [80, 140, 160], 0.72, 0.35],
    [18.5, [178, 112, 78], [54, 44, 72], [255, 186, 120], [255, 225, 180], 0.95, 0.3],
    [20, [34, 38, 74], [10, 12, 30], [100, 104, 170], [180, 190, 255], 0.86, 0.05],
    [21.5, [6, 32, 41], [1, 7, 11], [40, 112, 128], [120, 230, 255], 0.78, 0],
    [24, [6, 32, 41], [1, 7, 11], [40, 112, 128], [120, 230, 255], 0.78, 0],
  ];
  /** day: 0 at night .. 1 at noon, for the bank and the cats. */
  const sky = { hour: -1, centre: [0, 0, 0], edge: [0, 0, 0], dot: [0, 0, 0], wake: [0, 0, 0], light: 1, shadow: 0, day: 1 };
  const startTime = performance.now();
  let skyPainted = 0;

  function currentHour(now) {
    const d = new Date();
    const clock = Number.isFinite(PIN_HOUR) ? PIN_HOUR : d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
    if (!(CYCLE > 0)) return clock;
    return (clock + ((now - startTime) / 1000 / CYCLE) * 24) % 24;
  }

  function setSky(hour) {
    let i = 0;
    while (SKY[i + 1][0] <= hour && i < SKY.length - 2) i++;
    const a = SKY[i], b = SKY[i + 1];
    const t = smoothstep(a[0], b[0], hour);
    const mixInto = (out, j) => {
      for (let k = 0; k < 3; k++) out[k] = lerp(a[j][k], b[j][k], t);
    };
    mixInto(sky.centre, 1);
    mixInto(sky.edge, 2);
    mixInto(sky.dot, 3);
    mixInto(sky.wake, 4);
    sky.light = lerp(a[5], b[5], t);
    sky.shadow = lerp(a[6], b[6], t);
    sky.day = smoothstep(5.5, 8, hour) * (1 - smoothstep(17.5, 20.5, hour));
    sky.hour = hour;
    setTheme(hour >= 8.5 && hour < 18 ? "light" : "dark");
  }

  const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  const rgb = (c, a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;
  const lum = (c) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
  const night = () => sky.day < 0.3;

  const BODY_RAMP = "+*%#@";
  const EDGE_GLYPHS = ".',`";

  // ----------------------------------------------------------------- grid

  let W = 0, H = 0, cw = 10, ch = 15, cols = 0, rows = 0;
  let glyph = [], color = [];
  /** A cat's body length (nose to rump) in px. */
  let U = 200;
  let floorGlyph = [], floorColor = [], padGlyph = [], padColor = [], bankGlyph = [], bankColor = [];
  let frameNo = 0;
  let dotChar = [];
  let energy = new Float32Array(0), energyTmp = new Float32Array(0);

  const put = (c, r, g, st) => grid.put(c, r, g, st);

  // ---------------------------------------------------------------- shore

  const shoreSeed = rand(0, 100);
  /** The waterline (px) at x: pond above it, bank below. */
  const shoreY = (x) => H * (0.68 + 0.025 * Math.sin((x / W) * 5.2 + shoreSeed) + 0.012 * Math.sin((x / W) * 13 + shoreSeed * 2));
  /** First bank row per column; everything above it is water. */
  let shoreRow = new Int16Array(0);
  const inWater = (c, r) => c >= 0 && c < cols && r >= 0 && r < shoreRow[c];
  const waterAt = (x, y) => y < shoreY(x);

  // ------------------------------------------------------- backdrop & ink

  /** Backdrop brightness per cell, read back after each backdrop paint. */
  let bgLum = new Uint8Array(0);
  const lumCanvas = document.createElement("canvas");

  function sampleBackdrop(g) {
    const src = g.canvas, dpr = grid.dpr;
    const sw = Math.min(src.width, Math.round(cols * cw * dpr)), sh = Math.min(src.height, Math.round(rows * ch * dpr));
    lumCanvas.width = cols;
    lumCanvas.height = rows;
    const lc = lumCanvas.getContext("2d", { willReadFrequently: true });
    lc.drawImage(src, 0, 0, sw, sh, 0, 0, Math.round(sw / (cw * dpr)), Math.round(sh / (ch * dpr)));
    const d = lc.getImageData(0, 0, cols, rows).data;
    bgLum = new Uint8Array(cols * rows);
    for (let i = 0; i < bgLum.length; i++) bgLum[i] = 0.3 * d[i * 4] + 0.59 * d[i * 4 + 1] + 0.11 * d[i * 4 + 2];
  }

  /** A colour for cell (c, r) that stays readable over the backdrop there (see the cats scene). */
  function ink(c3, c, r, a = 1, need = 90) {
    let [R, G, B] = c3;
    const back = c >= 0 && r >= 0 && c < cols && r < rows ? bgLum[r * cols + c] : 0;
    const l = lum(c3);
    if (Math.abs(l - back) < need) {
      if (back > 128) {
        const k = Math.max(0, back - need) / Math.max(1, l);
        R *= k; G *= k; B *= k;
      } else {
        const k = (Math.min(255, back + need) - l) / Math.max(1, 255 - l);
        R += (255 - R) * k; G += (255 - G) * k; B += (255 - B) * k;
      }
    }
    return style(R, G, B, a);
  }

  function inkText(c, r, str, c3, a = 1, need = 90) {
    for (let k = 0; k < str.length; k++) if (str[k] !== " ") grid.put(c + k, r, str[k], ink(c3, c + k, r, a, need));
  }

  /** The bank by daylight: wet mud at the edge, grass, a darker foreground. */
  function bankColours() {
    const tint = mix(sky.centre, [255, 255, 255], 0.3);
    const at = (dayC, nightC) => mix(mix(nightC, dayC, sky.day), tint, 0.08 + 0.1 * (1 - Math.abs(sky.day - 0.5) * 2));
    return {
      mud: at([118, 100, 74], [26, 28, 32]),
      grass: at([104, 148, 72], [20, 36, 32]),
      deep: at([70, 112, 56], [12, 24, 22]),
      blade: at([150, 196, 104], [44, 78, 62]),
      stone: at([150, 146, 136], [58, 64, 72]),
      reed: at([112, 150, 74], [40, 64, 52]),
      cattail: at([122, 78, 46], [52, 38, 32]),
    };
  }
  let bank = bankColours();

  function paintBackdrop(g, w, h) {
    if (sky.hour < 0) setSky(currentHour(performance.now()));
    bank = bankColours();
    const cx = w * 0.5, cy = h * 0.35;
    const grad = g.createRadialGradient(cx, cy, 0, cx, cy, Math.hypot(w, h) * 0.6);
    grad.addColorStop(0, rgb(sky.centre));
    grad.addColorStop(1, rgb(sky.edge));
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);

    g.beginPath();
    g.moveTo(0, h);
    for (let x = 0; x <= w + 8; x += 8) g.lineTo(x, shoreY(x));
    g.lineTo(w, h);
    g.closePath();
    const top = h * 0.68;
    const land = g.createLinearGradient(0, top, 0, h);
    land.addColorStop(0, rgb(bank.mud));
    land.addColorStop(0.12, rgb(bank.grass));
    land.addColorStop(1, rgb(bank.deep));
    g.fillStyle = land;
    g.fill();
    // A dark lip where the water meets the bank.
    g.strokeStyle = rgb(mix(bank.mud, [0, 0, 0], 0.4), 0.8);
    g.lineWidth = 2;
    g.beginPath();
    for (let x = 0; x <= w + 8; x += 8) g.lineTo(x, shoreY(x) + 1);
    g.stroke();

    sampleBackdrop(g);
    bankDirty = true;
  }

  // ------------------------------------------------------------- bank layer

  const stones = [];
  const reeds = [];
  let bankDirty = true;

  function spawnBankThings() {
    stones.length = 0;
    for (let x = rand(0, 40); x < W; x += rand(cw * 4, cw * 16)) {
      const rx = rand(1.1, 2.6) * ch;
      stones.push({ x, y: shoreY(x) + rx * 0.08, rx, ry: rx * rand(0.42, 0.6), seed: rand(0, 100) });
    }
    reeds.length = 0;
    const clump = (x0) => {
      const x = x0 + rand(-0.3, 0.3) * U, y = shoreY(x) + rand(-0.2, 0.25) * U;
      const blades = [];
      for (let i = 0; i < 11; i++) blades.push({ a: rand(0, TAU), len: rand(0.25, 0.6) * U, tail: Math.random() < 0.35, seed: rand(0, 100) });
      reeds.push({ x, y, blades });
    };
    clump(W * 0.03);
    clump(W * 0.07);
    clump(W * 0.95);
    if (W > U * 9) clump(W * rand(0.35, 0.65));
  }

  /** Grass, flowers and stones, rasterised once per backdrop paint. */
  function bakeBank() {
    bankGlyph.fill("");
    for (let c = 0; c < cols; c++) {
      for (let r = shoreRow[c]; r < rows; r++) {
        const i = r * cols + c;
        const depth = (r - shoreRow[c]) / Math.max(1, rows - shoreRow[c]);
        const n = noise2(c * 0.09, r * 0.22, 11) * 0.7 + noise2(c * 0.4, r * 0.8, 12) * 0.3;
        const h = hash2(c, r, 5);
        const dens = 0.05 + 0.5 * smoothstep(0.35, 0.8, n);
        if (r === shoreRow[c]) {
          bankGlyph[i] = h < 0.5 ? "_" : ".";
          bankColor[i] = style(...mix(bank.mud, [0, 0, 0], 0.25), 0.7);
        } else if (h < 0.012 && depth > 0.1) {
          const petal = [[250, 170, 200], [250, 226, 110], [245, 245, 250]][(h * 250) | 0];
          bankGlyph[i] = "*";
          bankColor[i] = style(...mix(petal, bank.grass, 0.7 - sky.day * 0.5), 0.9);
        } else if (h < dens) {
          const k = 0.75 + 0.5 * n - 0.2 * depth;
          const c3 = mix(bank.grass, bank.blade, clamp(n, 0, 1));
          const u = h / dens;
          bankGlyph[i] = u < 0.12 && depth > 0.15 ? (n > 0.6 ? "w" : "v") : ",'\"`."[(u * 5) | 0];
          bankColor[i] = style(c3[0] * k, c3[1] * k, c3[2] * k, 0.85);
        }
      }
    }
    for (const s of stones) {
      const c0 = Math.floor((s.x - s.rx) / cw), c1 = Math.floor((s.x + s.rx) / cw);
      const r0 = Math.floor((s.y - s.ry) / ch), r1 = Math.floor((s.y + s.ry) / ch);
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
          const dx = ((c + 0.5) * cw - s.x) / s.rx, dy = ((r + 0.5) * ch - s.y) / s.ry;
          const d = dx * dx + dy * dy;
          if (d > 1) continue;
          const light = clamp(0.95 - 0.45 * dx - 0.55 * dy + 0.15 * (noise2(c * 0.7, r * 0.7, s.seed) - 0.5), 0.3, 1.25);
          const i = r * cols + c;
          bankGlyph[i] = d > 0.7 ? (dy < 0 ? "_" : dx < 0 ? "(" : ")") : light > 1 ? "@" : light > 0.7 ? "%" : "#";
          bankColor[i] = style(bank.stone[0] * light, bank.stone[1] * light, bank.stone[2] * light, 1);
        }
      }
    }
    bankDirty = false;
  }

  /** Water lapping at the bank, brighter where ripples arrive. */
  function drawLapping(t) {
    for (let c = 0; c < cols; c++) {
      const r = shoreRow[c] - 1;
      if (r < 0) continue;
      const i = r * cols + c;
      const s = Math.sin(t * 1.3 - c * 0.35) + 0.6 * Math.sin(t * 0.7 + c * 0.11);
      const a = clamp(0.2 + 0.18 * s + energy[i] * 0.8, 0, 0.9);
      if (a < 0.08) continue;
      put(c, r, s > 0.3 ? "~" : "-", style(sky.wake[0], sky.wake[1], sky.wake[2], a));
    }
  }

  /** Reed clumps seen from above: blades fan out from the root and bend in a slow breeze. */
  function drawReeds(t) {
    const breeze = Math.sin(t * 0.35) * 0.6 + Math.sin(t * 0.9) * 0.25;
    const stem = style(bank.reed[0], bank.reed[1], bank.reed[2], 0.95);
    const head = style(bank.cattail[0], bank.cattail[1], bank.cattail[2], 1);
    for (const rd of reeds) {
      for (const bl of rd.blades) {
        const sway = (breeze + 0.4 * Math.sin(t * 1.4 + bl.seed)) * 0.3;
        const n = Math.max(2, Math.round(bl.len / cw));
        for (let k = 1; k <= n; k++) {
          const u = k / n, a = bl.a + sway * u * u;
          const d = bl.len * u;
          const c = Math.floor((rd.x + Math.cos(a) * d) / cw), r = Math.floor((rd.y + Math.sin(a) * d) / ch);
          const top = bl.tail && u > 0.8;
          put(c, r, top ? (u === 1 ? "@" : "0") : lineGlyph(a), top ? head : stem);
        }
      }
      put(Math.floor(rd.x / cw), Math.floor(rd.y / ch), "*", stem);
    }
  }

  // ------------------------------------------------------------------ koi

  const VARIETIES = ["kohaku", "sanke", "showa", "ogon", "tancho", "asagi", "butterfly"];
  const NODES = 14;

  const koiLength = (scale) => clamp(Math.min(W, H) * 0.21, 110, 320) * scale;

  /** Top-down half-width at s ∈ [0, 1] (nose → tail root), as a fraction of body length. */
  function halfWidth(s) {
    if (s < 0.12) return 0.1 * Math.pow(Math.sin(((s / 0.12) * Math.PI) / 2), 0.55);
    if (s < 0.34) return 0.1 + 0.035 * smoothstep(0.12, 0.34, s);
    return 0.026 + 0.109 * Math.pow(1 - (s - 0.34) / 0.66, 1.3);
  }

  const koi = [];

  function spawnKoi(variety) {
    const scale = rand(0.7, 1.15);
    const k = {
      variety,
      scale,
      L: koiLength(scale),
      seed: (Math.random() * 1e6) | 0,
      depth: rand(0.3, 1),
      angle: rand(0, Math.PI * 2),
      speed: 0,
      cruise: rand(0.22, 0.4),
      wander: 0,
      wanderTarget: 0,
      wanderTimer: 0,
      phase: rand(0, 10),
      finScale: variety === "butterfly" ? 1.7 : 1,
      flee: 0, fleeX: 0, fleeY: 0,
      visit: null,
      px: new Float32Array(NODES),
      py: new Float32Array(NODES),
    };
    const x = rand(W * 0.15, W * 0.85), y = rand(H * 0.12, H * 0.5);
    const seg = k.L / (NODES - 1);
    for (let i = 0; i < NODES; i++) {
      k.px[i] = x - Math.cos(k.angle) * seg * i;
      k.py[i] = y - Math.sin(k.angle) * seg * i;
    }
    k.speed = k.cruise * k.L;
    koi.push(k);
  }

  /** Startle every koi near (x, y): they dart away for a second or two. */
  function scare(x, y, radius) {
    for (const k of koi) {
      if (Math.hypot(k.px[2] - x, k.py[2] - y) > radius + k.L * 0.4) continue;
      k.flee = rand(1.2, 2);
      k.fleeX = x;
      k.fleeY = y;
      k.visit = null;
    }
  }

  /** Send koi `k` cruising up to a point near the bank. */
  function visit(k, x, y, time = 10) {
    if (k.flee > 0) return;
    k.visit = { x, y: Math.min(y, shoreY(x) - k.L * 0.22), t: time };
  }

  function stepKoi(k, dt) {
    const L = k.L;
    const hx = k.px[0], hy = k.py[0];
    let fx = Math.cos(k.angle), fy = Math.sin(k.angle);
    let urgency = 0;

    // Soft walls: the screen edges, and the bank (closer, so they can come up to it).
    const m = L * 0.9, mb = L * 0.45, bank = shoreY(hx) - L * 0.1;
    if (hx < m) fx += ((m - hx) / m) * 2.5;
    if (hx > W - m) fx -= ((hx - (W - m)) / m) * 2.5;
    if (hy < m) fy += ((m - hy) / m) * 2.5;
    if (hy > bank - mb) fy -= ((hy - (bank - mb)) / mb) * 2.5;

    for (const o of koi) {
      if (o === k) continue;
      const mx = o.px[NODES >> 1], my = o.py[NODES >> 1];
      const dx = hx - mx, dy = hy - my;
      const d = Math.hypot(dx, dy);
      const r = (L + o.L) * 0.4;
      if (d > 0 && d < r) {
        const w = ((r - d) / r) * 1.4;
        fx += (dx / d) * w;
        fy += (dy / d) * w;
      }
    }

    // Fleeing a paw beats food, food beats a visit to the bank, which beats a resting cursor.
    let best = null, bestD = Infinity;
    for (const p of food) {
      const d = Math.hypot(p.x - hx, p.y - hy);
      if (d < bestD && d < Math.max(W, H) * 0.6) {
        best = p;
        bestD = d;
      }
    }
    if (k.flee > 0) {
      k.flee -= dt;
      const dx = hx - k.fleeX, dy = hy - k.fleeY - L * 0.3, d = Math.hypot(dx, dy) || 1;
      fx += (dx / d) * 3;
      fy += (dy / d) * 3;
      urgency = 1.6 * Math.min(1, k.flee);
    } else if (best) {
      fx += ((best.x - hx) / bestD) * 2.2;
      fy += ((best.y - hy) / bestD) * 2.2;
      urgency = 1;
      if (bestD < L * 0.08) {
        food.splice(food.indexOf(best), 1);
        addRipple(best.x, best.y, 0.6, L * 0.6);
        addEnergy(best.x, best.y, 1);
      }
    } else if (k.visit) {
      const v = k.visit, dx = v.x - hx, dy = v.y - hy, d = Math.hypot(dx, dy) || 1;
      fx += (dx / d) * 1.8;
      fy += (dy / d) * 1.8;
      urgency = 0.2;
      // Linger a moment at the bank, then lose interest.
      if (d < L * 0.25) v.t = Math.min(v.t, 2.5);
      if ((v.t -= dt) <= 0) k.visit = null;
    } else if (pointer.active && waterAt(pointer.x, pointer.y) && performance.now() - pointer.moved > 600) {
      const dx = pointer.x - hx, dy = pointer.y - hy;
      const d = Math.hypot(dx, dy);
      if (d > L * 0.4 && d < Math.min(W, H) * 0.45) {
        fx += (dx / d) * 0.9;
        fy += (dy / d) * 0.9;
        urgency = 0.35;
      }
    }

    k.wanderTimer -= dt;
    if (k.wanderTimer <= 0) {
      k.wanderTarget = rand(-0.7, 0.7);
      k.wanderTimer = rand(1.5, 5);
    }
    k.wander += (k.wanderTarget - k.wander) * Math.min(1, dt * 0.8);

    const diff = wrapAngle(Math.atan2(fy, fx) - k.angle);
    const maxTurn = 1.4 + urgency;
    k.angle = wrapAngle(k.angle + (clamp(diff * 2.2, -maxTurn, maxTurn) + k.wander * (1 - Math.min(1, urgency))) * dt);

    const target = L * (k.cruise + urgency * 0.35);
    k.speed += (target - k.speed) * Math.min(1, dt * (k.flee > 0 ? 4 : 1.2));
    k.phase += dt * (2.2 + (k.speed / L) * 9);

    k.px[0] += Math.cos(k.angle) * k.speed * dt;
    k.py[0] += Math.sin(k.angle) * k.speed * dt;
    const seg = L / (NODES - 1);
    for (let i = 1; i < NODES; i++) {
      const dx = k.px[i - 1] - k.px[i], dy = k.py[i - 1] - k.py[i];
      const d = Math.hypot(dx, dy) || 1;
      k.px[i] = k.px[i - 1] - (dx / d) * seg;
      k.py[i] = k.py[i - 1] - (dy / d) * seg;
    }

    addEnergy(k.px[1], k.py[1], 0.05 + (k.speed / L) * 0.12);
    addEnergy(k.px[NODES - 1], k.py[NODES - 1], 0.08);
  }

  // Scratch spine for the koi being drawn (with the swimming wave applied).
  const sx = new Float32Array(NODES), sy = new Float32Array(NODES);
  const segDx = new Float32Array(NODES), segDy = new Float32Array(NODES), segLen2 = new Float32Array(NODES);
  let tailX = 0, tailY = 0, tailDx = 1, tailDy = 0;
  let hitFlag = 0, hitS = 0, hitV = 0, hitU = 0, hitDist = 0;

  const F_BODY = 1, F_FIN = 2, F_TAIL = 3, F_EYE = 4;

  function prepareSpine(k) {
    const L = k.L;
    for (let i = 0; i < NODES; i++) {
      const s = i / (NODES - 1);
      const a = Math.max(0, i - 1), b = Math.min(NODES - 1, i + 1);
      const dx = k.px[a] - k.px[b], dy = k.py[a] - k.py[b];
      const d = Math.hypot(dx, dy) || 1;
      const wave = Math.sin(k.phase - s * 4.5) * L * 0.035 * (0.12 + s * s);
      sx[i] = k.px[i] - (dy / d) * wave;
      sy[i] = k.py[i] + (dx / d) * wave;
    }
    for (let i = 0; i < NODES - 1; i++) {
      segDx[i] = sx[i + 1] - sx[i];
      segDy[i] = sy[i + 1] - sy[i];
      segLen2[i] = segDx[i] * segDx[i] + segDy[i] * segDy[i] || 1;
    }
    tailX = sx[NODES - 1];
    tailY = sy[NODES - 1];
    const d = Math.sqrt(segLen2[NODES - 2]);
    tailDx = segDx[NODES - 2] / d;
    tailDy = segDy[NODES - 2] / d;
  }

  /** Classify one point against the koi: body, fin, tail fan or nothing. */
  function sampleKoi(k, x, y) {
    const L = k.L;
    let best = Infinity, bestI = 0, bestT = 0, side = 1;
    for (let i = 0; i < NODES - 1; i++) {
      const ax = x - sx[i], ay = y - sy[i];
      const t = clamp((ax * segDx[i] + ay * segDy[i]) / segLen2[i], 0, 1);
      const qx = ax - segDx[i] * t, qy = ay - segDy[i] * t;
      const d2 = qx * qx + qy * qy;
      if (d2 < best) {
        best = d2;
        bestI = i;
        bestT = t;
        side = segDx[i] * ay - segDy[i] * ax < 0 ? -1 : 1;
      }
    }
    const d = Math.sqrt(best);
    const s = (bestI + bestT) / (NODES - 1);
    const w = halfWidth(s) * L;
    hitS = s;
    hitDist = d;

    if (d < w) {
      hitV = (d / w) * side;
      hitFlag = s > 0.05 && s < 0.1 && Math.abs(hitV) > 0.45 && Math.abs(hitV) < 0.95 ? F_EYE : F_BODY;
      return hitFlag;
    }

    // Pectoral and pelvic fins: points further out map to an earlier root, so fins sweep back.
    const out = d - w;
    const sr = s - (out / L) * 0.9;
    const flap = 0.75 + 0.25 * Math.sin(k.phase * 0.5 + side * 1.3);
    if (sr > 0.19 && sr < 0.36) {
      const u = (sr - 0.19) / 0.17;
      const reach = L * 0.12 * k.finScale * Math.sin(Math.PI * Math.pow(u, 0.6)) * flap;
      if (out < reach) {
        hitU = out / reach;
        hitV = side;
        hitFlag = F_FIN;
        return hitFlag;
      }
    }
    if (sr > 0.52 && sr < 0.62) {
      const reach = L * 0.045 * k.finScale * Math.sin(Math.PI * (sr - 0.52) / 0.1);
      if (out < reach) {
        hitU = out / reach;
        hitV = side;
        hitFlag = F_FIN;
        return hitFlag;
      }
    }

    // Tail fan, in the frame of the last segment, swishing with the body wave.
    const rx = x - tailX, ry = y - tailY;
    const along = rx * tailDx + ry * tailDy;
    const T = L * 0.26 * k.finScale;
    if (along > -L * 0.02 && along < T) {
      const lat = -rx * tailDy + ry * tailDx - Math.sin(k.phase - 4.8) * along * 0.45;
      const spread = L * 0.025 + Math.max(0, along) * 0.75;
      const notch = along > T * 0.6 && Math.abs(lat) < (along - T * 0.6) * 1.1;
      if (Math.abs(lat) < spread && !notch) {
        hitU = Math.max(0, along) / T;
        hitV = lat / spread;
        hitFlag = F_TAIL;
        return hitFlag;
      }
    }

    hitFlag = 0;
    return 0;
  }

  /** Skin colour of a koi at body coordinates (s along, v across). */
  function skin(k, s, v) {
    const n = noise2(s * 6 + k.seed * 0.001, v * 1.4 + 7, k.seed) * 0.7 + noise2(s * 13, v * 3, k.seed + 1) * 0.3;
    switch (k.variety) {
      case "kohaku":
      case "butterfly":
        return n > 0.5 && s < 0.86 ? RED : WHITE;
      case "tancho": {
        const dx = (s - 0.11) / 0.07, dy = v / 0.55;
        return dx * dx + dy * dy < 1 ? RED : WHITE;
      }
      case "sanke":
        if (s > 0.16 && noise2(s * 16, v * 3.5, k.seed + 2) > 0.74) return BLACK;
        return n > 0.52 && s < 0.86 ? RED : WHITE;
      case "showa": {
        if (n > 0.56) return RED;
        if (noise2(s * 9, v * 2.5, k.seed + 3) > 0.55) return WHITE;
        return BLACK;
      }
      case "ogon":
        return GOLD;
      case "asagi":
        if (s < 0.14 || Math.abs(v) > 0.72) return RED;
        return noise2(s * 26, v * 6, k.seed) > 0.62 ? WHITE : SLATE;
    }
    return WHITE;
  }

  function finColor(k, u) {
    switch (k.variety) {
      case "ogon":
        return GOLD;
      case "showa":
        return u < 0.35 ? BLACK : WHITE;
      case "asagi":
        return u < 0.5 ? RED : WHITE;
    }
    return WHITE;
  }

  function drawKoi(k, t) {
    prepareSpine(k);
    const L = k.L;
    const pad = L * (0.3 * k.finScale + 0.05);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < NODES; i++) {
      if (sx[i] < minX) minX = sx[i];
      if (sx[i] > maxX) maxX = sx[i];
      if (sy[i] < minY) minY = sy[i];
      if (sy[i] > maxY) maxY = sy[i];
    }
    const c0 = Math.max(0, Math.floor((minX - pad) / cw)), c1 = Math.min(cols - 1, Math.floor((maxX + pad) / cw));
    const r0 = Math.max(0, Math.floor((minY - pad) / ch)), r1 = Math.min(rows - 1, Math.floor((maxY + pad) / ch));
    // Deeper koi fade into a dark pond; by day they stay solid so they don't wash out.
    const depthAlpha = lerp(0.55 + 0.45 * k.depth, 1, clamp(sky.shadow / 0.35, 0, 1));
    // Beyond these distances from the spine nothing can be hit: skip the supersampling.
    const diag = Math.hypot(cw, ch) * 0.5;
    const bodyReach = L * (0.14 + 0.13 * k.finScale) + diag;
    const tailReach = L * 0.34 * k.finScale + diag;

    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (r >= shoreRow[c]) continue;
        // Supersample for coverage; remember the most "solid" hit for shading.
        if (!sampleKoi(k, (c + 0.5) * cw, (r + 0.5) * ch) && hitDist > (hitS > 0.97 ? tailReach : bodyReach)) continue;
        let hits = 0, flag = 0, s = 0, v = 0, u = 0;
        for (let j = 0; j < 8; j += 2) {
          const f = sampleKoi(k, (c + SUB[j]) * cw, (r + SUB[j + 1]) * ch);
          if (!f) continue;
          hits++;
          if (!flag || f === F_EYE || (f === F_BODY && flag !== F_EYE)) {
            flag = f;
            s = hitS;
            v = hitV;
            u = hitU;
          }
        }
        if (!hits) continue;
        const cover = hits / 4;

        if (flag === F_EYE) {
          put(c, r, "o", style(12, 14, 18, 1));
          continue;
        }

        if (flag === F_BODY) {
          const [cr, cg, cb] = skin(k, s, v);
          let light = 1 - 0.55 * v * v + (Math.abs(v + 0.3) < 0.18 ? 0.12 : 0);
          if (k.variety === "ogon") light += 0.18 * Math.sin(t * 2.5 + s * 18 - v * 3);
          light = clamp(light, 0.25, 1.1) * sky.light;
          const g = cover < 0.5
            ? EDGE_GLYPHS[(c + r) % EDGE_GLYPHS.length]
            : cover < 1 ? ":" : BODY_RAMP[Math.min(BODY_RAMP.length - 1, (light * BODY_RAMP.length) | 0)];
          put(c, r, g, style(cr * light, cg * light, cb * light, depthAlpha * (0.45 + 0.55 * cover)));
          continue;
        }

        // Fins: translucent, rays fading toward the tips.
        const [cr, cg, cb] = finColor(k, u).map((x) => x * sky.light);
        const a = depthAlpha * (0.75 - 0.4 * u) * (0.5 + 0.5 * cover);
        const g = flag === F_TAIL ? (u > 0.7 ? "'" : "~") : u > 0.65 ? "-" : "=";
        put(c, r, cover < 0.5 ? "." : g, style(cr, cg, cb, a));
      }
    }
  }

  /** A soft blob under each koi, offset away from the sun; only visible by day. */
  function drawShadow(k) {
    const strength = sky.shadow * (0.6 + 0.4 * k.depth);
    if (strength < 0.03) return;
    const L = k.L, ox = L * 0.07, oy = L * 0.1;
    const st = style(sky.edge[0] * 0.5, sky.edge[1] * 0.5, sky.edge[2] * 0.5, strength);
    for (let i = 0; i < NODES; i++) {
      const rad = halfWidth(i / (NODES - 1)) * L * 1.1;
      const x = k.px[i] + ox, y = k.py[i] + oy;
      for (let r = Math.floor((y - rad) / ch); r <= Math.floor((y + rad) / ch); r++) {
        for (let c = Math.floor((x - rad) / cw); c <= Math.floor((x + rad) / cw); c++) {
          const dx = (c + 0.5) * cw - x, dy = (r + 0.5) * ch - y;
          if (dx * dx + dy * dy < rad * rad && inWater(c, r)) put(c, r, "#", st);
        }
      }
    }
  }

  // ------------------------------------------------------- surface layer

  const food = [];
  const ripples = [];
  const pads = [];

  function addEnergy(x, y, amount) {
    const c = Math.floor(x / cw), r = Math.floor(y / ch);
    if (c < 0 || r < 0 || c >= cols || r >= rows) return;
    const i = r * cols + c;
    energy[i] = Math.min(1.5, energy[i] + amount);
  }

  function diffuseEnergy() {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const l = c > 0 ? energy[i - 1] : 0, rt = c < cols - 1 ? energy[i + 1] : 0;
        const u = r > 0 ? energy[i - cols] : 0, d = r < rows - 1 ? energy[i + cols] : 0;
        energyTmp[i] = (energy[i] * 4 + l + rt + u + d) * 0.125 * 0.985;
      }
    }
    const t = energy;
    energy = energyTmp;
    energyTmp = t;
  }

  function addRipple(x, y, strength, maxR) {
    ripples.push({ x, y, r: 0, strength, maxR: maxR || rand(120, 220) });
  }

  function drawRipples(dt) {
    for (let i = ripples.length - 1; i >= 0; i--) {
      const rp = ripples[i];
      rp.r += dt * 70;
      if (rp.r > rp.maxR) {
        ripples.splice(i, 1);
        continue;
      }
      const life = 1 - rp.r / rp.maxR;
      const a = rp.strength * life * 0.7;
      const st = style(sky.wake[0], sky.wake[1], sky.wake[2], a);
      const band = cw * 0.55;
      const c0 = Math.max(0, Math.floor((rp.x - rp.r - band) / cw)), c1 = Math.min(cols - 1, Math.floor((rp.x + rp.r + band) / cw));
      const r0 = Math.max(0, Math.floor((rp.y - rp.r - band) / ch)), r1 = Math.min(rows - 1, Math.floor((rp.y + rp.r + band) / ch));
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          if (r >= shoreRow[c]) continue;
          const dx = (c + 0.5) * cw - rp.x, dy = ((r + 0.5) * ch - rp.y) * (cw / ch) * 1.2;
          const off = Math.abs(Math.hypot(dx, dy) - rp.r);
          if (off < band) put(c, r, Math.abs(dy) > Math.abs(dx) ? "~" : dx < 0 ? "(" : ")", st);
        }
      }
    }
  }

  function drawFood(dt, t) {
    const st = style(PELLET[0], PELLET[1], PELLET[2], 0.95);
    for (let i = food.length - 1; i >= 0; i--) {
      const p = food[i];
      p.life -= dt;
      if (p.life <= 0) {
        food.splice(i, 1);
        continue;
      }
      p.x += Math.sin(t * 0.7 + p.seed) * dt * 4;
      p.y = Math.min(p.y + Math.cos(t * 0.6 + p.seed) * dt * 4, shoreY(p.x) - ch);
      put(Math.floor(p.x / cw), Math.floor(p.y / ch), "o", st);
    }
  }

  function spawnPads() {
    pads.length = 0;
    const base = clamp(Math.min(W, H) * 0.06, 32, 90);
    for (let tries = 0; pads.length < PAD_COUNT && tries < 400; tries++) {
      const R = base * rand(0.6, 1.3);
      const x = rand(R, W - R), y = rand(R, shoreY(x) - R * 2);
      if (pads.some((p) => Math.hypot(p.x - x, p.y - y) < p.R + R + 30)) continue;
      pads.push({
        x, y, R,
        rot: rand(0, Math.PI * 2),
        spin: rand(-0.02, 0.02),
        vx: rand(-3, 3), vy: rand(-2, 2),
        flower: Math.random() < 0.45,
        seed: rand(0, 100),
      });
    }
  }

  /** Pads barely move, so they are re-rasterised into their own layer every few frames. */
  function drawPads(dt, t) {
    padGlyph.fill("");
    for (const p of pads) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
      if (p.x < -p.R) p.x = W + p.R;
      if (p.x > W + p.R) p.x = -p.R;
      if (p.y < p.R * 0.5) p.vy = Math.abs(p.vy);
      if (p.y > shoreY(p.x) - p.R * 1.4) p.vy = -Math.abs(p.vy);

      const bob = 1 + 0.03 * Math.sin(t * 0.8 + p.seed);
      const R = p.R * bob;
      const c0 = Math.floor((p.x - R) / cw), c1 = Math.floor((p.x + R) / cw);
      const r0 = Math.floor((p.y - R) / ch), r1 = Math.floor((p.y + R) / ch);
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const dx = (c + 0.5) * cw - p.x, dy = (r + 0.5) * ch - p.y;
          const d = Math.hypot(dx, dy);
          if (d > R || !inWater(c, r)) continue;
          const i = r * cols + c;
          const ang = wrapAngle(Math.atan2(dy, dx) - p.rot);
          const k = d / R;

          if (p.flower && k < 0.36) {
            const petal = 0.36 * (0.55 + 0.45 * Math.abs(Math.cos(ang * 3 + t * 0.1)));
            if (k < 0.09) {
              padGlyph[i] = "o";
              padColor[i] = style(250, 214, 90, 1);
              continue;
            }
            if (k < petal) {
              const pink = 1 - k / 0.36;
              padGlyph[i] = k < petal * 0.6 ? "@" : "*";
              padColor[i] = style(lerp(236, 255, pink), lerp(120, 200, pink), lerp(170, 220, pink), 0.95);
              continue;
            }
          }
          // The notch: a thin wedge cut from the rim to the centre.
          if (Math.abs(ang) < 0.28 * (1 - k * 0.4) && k > 0.08) continue;

          const shade = 0.78 + 0.22 * (-(dx + dy) / (R * 1.4));
          const vein = Math.abs(((ang + Math.PI) * 9) / Math.PI % 2 - 1) < 0.18 && k > 0.15;
          let g, rgb;
          if (k > 0.86) {
            g = "@";
            rgb = [40, 118, 58];
          } else if (vein) {
            g = "+";
            rgb = [110, 196, 100];
          } else {
            g = ((d / cw) | 0) % 2 ? "%" : "#";
            rgb = [62, 156, 74];
          }
          padGlyph[i] = g;
          padColor[i] = style(rgb[0] * shade, rgb[1] * shade, rgb[2] * shade, 1);
        }
      }
    }
  }

  // ------------------------------------------------------- pond floor

  function drawFloor(t) {
    for (let r = frameNo % 3; r < rows; r += 3) {
      const y = (r + 0.5) * ch;
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        if (r >= shoreRow[c]) {
          floorGlyph[i] = "";
          continue;
        }
        const e = energy[i];
        let g = dotChar[i];
        if (!g) {
          floorGlyph[i] = "";
          if (e < 0.06) continue;
          g = e > 0.3 ? "~" : ".";
        }
        const x = (c + 0.5) * cw;
        const caustic = Math.max(0,
          Math.sin(x * 0.011 + t * 0.5 + Math.sin(y * 0.013 - t * 0.35) * 2) *
          Math.sin(y * 0.015 - t * 0.45 + Math.sin(x * 0.008 + t * 0.3) * 2));
        const w = clamp(e * 1.4, 0, 1);
        const a = clamp(0.12 + caustic * caustic * 0.45 + w * 0.6, 0, 1);
        floorGlyph[i] = g;
        floorColor[i] = style(lerp(sky.dot[0], sky.wake[0], w), lerp(sky.dot[1], sky.wake[1], w), lerp(sky.dot[2], sky.wake[2], w), a);
      }
    }
  }

  // ------------------------------------------------------ cat rig (top-down)

  // Signed distance shapes in screen px (d < 0 inside), with a bounding box.
  /** A capsule whose radius goes from ra at a to rb at b. */
  function roundCone(ax, ay, bx, by, ra, rb) {
    const dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy) || 1e-6;
    const ux = dx / l, uy = dy / l;
    const b = clamp((ra - rb) / l, -0.999, 0.999), a = Math.sqrt(1 - b * b);
    return {
      d: (x, y) => {
        const px = x - ax, py = y - ay;
        const qy = px * ux + py * uy, qx = Math.abs(px * -uy + py * ux);
        const k = -b * qx + a * qy;
        if (k < 0) return Math.hypot(qx, qy) - ra;
        if (k > a * l) return Math.hypot(qx, qy - l) - rb;
        return qx * a + qy * b - ra;
      },
      x0: Math.min(ax - ra, bx - rb), y0: Math.min(ay - ra, by - rb), x1: Math.max(ax + ra, bx + rb), y1: Math.max(ay + ra, by + rb),
    };
  }

  const smin = (a, b, k) => {
    const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1);
    return lerp(b, a, h) - k * h * (1 - h);
  };

  /** Smooth union of `list` (blend radius k), hard union of `hard`. */
  function union(list, k, hard = []) {
    const all = list.concat(hard);
    return {
      d: (x, y) => {
        let d = list[0].d(x, y);
        for (let i = 1; i < list.length; i++) d = smin(d, list[i].d(x, y), k);
        for (const s of hard) d = Math.min(d, s.d(x, y));
        return d;
      },
      x0: Math.min(...all.map((s) => s.x0)) - k, y0: Math.min(...all.map((s) => s.y0)) - k,
      x1: Math.max(...all.map((s) => s.x1)) + k, y1: Math.max(...all.map((s) => s.y1)) + k,
    };
  }

  /**
   * Poses seen from above, in body lengths. The spine runs hips → middle → shoulders → head:
   * db = hips to shoulders, dn = shoulders to head, bend = curl at each joint (a sleeping cat
   * curls into a ring), look = head turn. rh / rs / hr = hip, shoulder and head radii (a
   * sitting cat is all haunches). Paws (lf / rf front, lh / rh hind) sit relative to their
   * shoulder or hip, x forward and y to the right; a paw reaching far out gets a leg drawn.
   * ta = tail angle off straight back, tc = curl per segment, tw = wave, tl = length.
   * eyes 1 open..0 shut, ear 1 = flattened, belly 1 = rolled over.
   */
  const BASE = {
    db: 0.44, dn: 0.3, bend: 0, look: 0, rs: 0.15, rh: 0.165, hr: 0.14,
    lfx: 0.05, lfy: -0.1, rfx: 0.05, rfy: 0.1, lhx: 0, lhy: -0.11, rhx: 0, rhy: 0.11,
    ta: 0, tc: 0.04, tw: 0.12, tl: 0.7, eyes: 1, ear: 0, belly: 0,
  };
  const SIT = {
    db: 0.2, dn: 0.22, rs: 0.14, rh: 0.22, hr: 0.14,
    lfx: 0.2, lfy: -0.07, rfx: 0.2, rfy: 0.07, lhx: 0.17, lhy: -0.16, rhx: 0.17, rhy: 0.16,
    ta: 1.9, tc: 0.3, tw: 0.03, tl: 0.62,
  };
  const CROUCH = {
    db: 0.36, dn: 0.27, rs: 0.165, rh: 0.18, lfx: 0.12, rfx: 0.12, lhx: 0.06, rhx: 0.06, ear: 0.8, ta: 0, tc: 0, tw: 0.2,
  };
  const LOAF = {
    db: 0.28, dn: 0.22, rs: 0.17, rh: 0.18,
    lfx: 0.02, lfy: -0.06, rfx: 0.02, rfy: 0.06, lhx: 0, lhy: -0.07, rhx: 0, rhy: 0.07, ta: 1.7, tc: 0.28, tw: 0.02, tl: 0.62,
  };
  const pose = (...parts) => Object.assign({}, BASE, ...parts);
  const POSES = {
    stand: pose(),
    walk: pose({ tw: 0.1 }),
    creep: pose({ db: 0.48, dn: 0.33, rs: 0.145, rh: 0.155, ear: 0.7, ta: 0, tc: 0, tw: 0.05 }),
    crouch: pose(CROUCH),
    swat: pose(CROUCH, { rfx: 0.44, rfy: 0.04, lfx: 0.06, ear: 0.5 }),
    sit: pose(SIT),
    petted: pose(SIT, { eyes: 0, ear: 0.2 }),
    shake: pose(SIT, { ear: 0.4, eyes: 0 }),
    groom: pose(SIT, { look: 1.4, rfx: 0.05, rfy: 0.18, eyes: 0.3 }),
    wash: pose(SIT, { lfx: 0.3, lfy: -0.04, look: 0.25, eyes: 0 }),
    loaf: pose(LOAF, { eyes: 0.6 }),
    knead: pose(LOAF, { lfx: 0.16, rfx: 0.16, eyes: 0 }),
    sleep: pose(LOAF, { db: 0.32, dn: 0.19, bend: 1.0, rs: 0.15, look: 0.6, ta: 2.1, tc: 0.36, tw: 0.01, eyes: 0 }),
    side: pose({
      db: 0.48, bend: 0.12, rs: 0.12, rh: 0.13,
      lfx: 0.1, lfy: 0.3, rfx: 0.15, rfy: 0.26, lhx: -0.05, lhy: 0.3, rhx: 0, rhy: 0.26, ta: 0.4, tc: 0.03, tw: 0.04, eyes: 0.4, belly: 0.4,
    }),
    belly: pose({
      db: 0.46, bend: -0.1, rs: 0.13, rh: 0.14,
      lfx: 0.08, lfy: -0.25, rfx: 0.08, rfy: 0.25, lhx: -0.05, lhy: -0.24, rhx: -0.05, rhy: 0.24, ta: 0.3, tw: 0.1, eyes: 0, belly: 1,
    }),
    stretch: pose({ db: 0.55, dn: 0.36, lfx: 0.32, lfy: -0.08, rfx: 0.34, rfy: 0.08, lhx: -0.1, rhx: -0.1, ear: 0.3, eyes: 0 }),
    drink: pose(CROUCH, { dn: 0.42, hr: 0.115, ear: 0.2, eyes: 0.3, tw: 0.06 }),
    leap: pose({ db: 0.58, dn: 0.32, rs: 0.12, rh: 0.13, lfx: 0.26, rfx: 0.26, lhx: -0.24, rhx: -0.24, ta: 0, tc: 0, tw: 0.02, ear: 0.6 }),
  };
  const POSE_KEYS = Object.keys(BASE);
  const LYING = new Set(["loaf", "knead", "side", "sleep", "belly"]);
  const ASLEEP = new Set(["sleep"]);
  /** Poses that look about (and turn round to watch a koi). */
  const UPRIGHT = new Set(["sit", "stand", "loaf", "crouch", "petted"]);
  /** Per-key easing: the head leads, the body follows, the tail trails behind. */
  const LAG = { look: 0.6, ear: 0.3, ta: 1.6, tc: 1.6, tw: 1.4, tl: 1.4 };
  const TAU = Math.PI * 2;
  const zeroV = () => Object.fromEntries(POSE_KEYS.map((k) => [k, 0]));

  /** Critically damped spring (Unity's SmoothDamp): eases B[k] toward goal, carrying velocity. */
  function damp(B, V, k, goal, st, dt) {
    const w = 2 / Math.max(st, 1e-3), x = w * dt;
    const e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    const change = B[k] - goal, temp = (V[k] + w * change) * dt;
    V[k] = (V[k] - w * temp) * e;
    B[k] = goal + (change + temp) * e;
  }

  const SUB = [0.25, 0.25, 0.75, 0.25, 0.25, 0.75, 0.75, 0.75];
  // Few, dense glyphs (as on the koi) so fur reads as one solid mass of colour.
  const FUR = "+*%#@";
  const LX = -0.55, LY = -0.83;

  /** A soft rim glyph that hugs the silhouette: low dots along the top, high ticks below. */
  function rim(nx, ny) {
    if (ny < -0.45) return ".";
    if (ny > 0.45) return "'";
    return ":";
  }

  /** A stroke glyph along screen angle a. */
  const lineGlyph = (a) => "-\\|/"[Math.round((((a % Math.PI) + Math.PI) % Math.PI) / (Math.PI / 4)) % 4];

  /** Point (x, y) turned by angle a and added to p. */
  const at = (p, a, x, y) => [p[0] + x * Math.cos(a) - y * Math.sin(a), p[1] + x * Math.sin(a) + y * Math.cos(a)];

  /**
   * Build the cat's parts in screen px, front-most first. Local coordinates are body
   * lengths from the middle of the back, x toward the head, y to its right (mirrored by
   * cat.side so cats curl either way); a leaping cat (z > 0) is drawn a little larger.
   */
  function buildRig(cat, P) {
    const S = U * cat.scale * (1 + cat.z * 0.35), f = cat.side;
    const ca = Math.cos(cat.a), sa = Math.sin(cat.a);
    const wx = (p) => cat.x + (p[0] * ca - p[1] * f * sa) * S;
    const wy = (p) => cat.y + (p[0] * sa + p[1] * f * ca) * S;
    const cone = (p, q, ra, rb) => roundCone(wx(p), wy(p), wx(q), wy(q), ra * S, rb * S);
    const circ = (p, r) => shapes.circle(wx(p), wy(p), r * S);

    const b = P.bend, h = P.db / 2;
    const mid = [0, 0], sh = [h * Math.cos(b), h * Math.sin(b)], hp = [-h * Math.cos(b), h * Math.sin(b)];
    const ha = 2 * b + P.look, hd = at(sh, ha, P.dn, 0);

    // Body: hips, back, shoulders, neck, head and muzzle blended; ears added sharp.
    const rm = (P.rh + P.rs) * 0.52;
    const ears = [-1, 1].map((s) => {
      const pt = (x, y) => at(hd, ha, x * P.hr, s * y * P.hr);
      const a = pt(0.3, 0.45), c = pt(-0.45, 0.72), tip = pt(0.05 - P.ear * 0.55, 1.2 + P.ear * 0.1);
      return shapes.triangle(wx(a), wy(a), wx(c), wy(c), wx(tip), wy(tip));
    });
    const body = union([
      cone(hp, mid, P.rh, rm), cone(mid, sh, rm, P.rs), cone(sh, hd, P.rs * 0.72, P.hr * 0.8),
      circ(hd, P.hr), circ(at(hd, ha, P.hr * 0.72, 0), P.hr * 0.5),
    ], 0.04 * S, ears);
    body.mat = "body";

    // Paws tucked under the body, or a whole leg when one reaches out.
    const legs = [], under = [], paws = {};
    for (const [k, base, a] of [["lf", sh, b], ["rf", sh, b], ["lh", hp, -b], ["rh", hp, -b]]) {
      const y = P[k + "y"], p = at(base, a, P[k + "x"], y), q = at(base, a, 0, Math.sign(y) * 0.07);
      paws[k] = [wx(p), wy(p)];
      if (Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.14) {
        const leg = union([cone(q, p, 0.05, 0.04), circ(p, 0.05)], 0.01 * S);
        leg.mat = "leg";
        legs.push(leg);
      } else {
        const paw = circ(p, 0.05);
        paw.mat = "leg";
        under.push(paw);
      }
    }

    // Tail: a chain of tapering segments that curls the same way as the spine.
    let t = at(hp, Math.PI - b, P.rh * 0.8, 0);
    const N = 9, seg = P.tl / N, pts = [t];
    for (let i = 1; i <= N; i++) {
      const a = Math.PI - b - P.ta - P.tc * i + P.tw * Math.sin(cat.tailPhase - i * 0.55) * (i / N) * 3;
      t = [t[0] + Math.cos(a) * seg, t[1] + Math.sin(a) * seg];
      pts.push(t);
    }
    const segs = [];
    for (let i = 0; i < N; i++) segs.push(cone(pts[i], pts[i + 1], lerp(0.05, 0.032, i / N), lerp(0.05, 0.032, (i + 1) / N)));
    const tail = union(segs, 0.01 * S);
    tail.mat = "tail";

    return {
      // A curled-up cat wraps its tail over its paws and nose.
      parts: P.bend > 0.5 ? [...legs, tail, body, ...under] : [...legs, body, tail, ...under], S, ca, sa, f, wx, wy, mid, sh, hp, hd, ha, pts, paws,
      nose: [wx(at(hd, ha, P.hr * 1.2, 0)), wy(at(hd, ha, P.hr * 1.2, 0))],
    };
  }

  /** Fur colour at local point (lx, ly) on part `mat`. */
  function furColour(cat, mat, lx, ly, P, rig) {
    const br = cat.breed;
    if (mat === "leg") return br.pattern === "tux" || br.pattern === "points" ? br.p1 : mix(br.fur, br.belly, 0.35);
    if (mat === "tail") {
      let best = Infinity, u = 0;
      rig.pts.forEach((p, i) => {
        const d = (p[0] - lx) ** 2 + (p[1] - ly) ** 2;
        if (d < best) {
          best = d;
          u = i / (rig.pts.length - 1);
        }
      });
      if (br.pattern === "tabby" && Math.sin(u * 26) > 0.2) return br.p1;
      if (br.pattern === "points" || (br.pattern === "calico" && u > 0.55)) return br.p1;
      return br.fur;
    }
    // Head frame (hx forward, hy across, in head radii) and spine frame (s head → hips, v across).
    const dx = lx - rig.hd[0], dy = ly - rig.hd[1];
    const hx = (dx * Math.cos(rig.ha) + dy * Math.sin(rig.ha)) / P.hr, hy = (-dx * Math.sin(rig.ha) + dy * Math.cos(rig.ha)) / P.hr;
    const inHead = hx * hx + hy * hy < 1.5;
    const chain = [rig.hd, rig.sh, rig.mid, rig.hp], radii = [P.hr, P.rs, (P.rh + P.rs) * 0.52, P.rh];
    let best = Infinity, s = 0, v = 0;
    for (let i = 0; i < 3; i++) {
      const [ax, ay] = chain[i], ex = chain[i + 1][0] - ax, ey = chain[i + 1][1] - ay;
      const k = clamp(((lx - ax) * ex + (ly - ay) * ey) / (ex * ex + ey * ey || 1), 0, 1);
      const qx = lx - ax - ex * k, qy = ly - ay - ey * k, d = Math.hypot(qx, qy);
      if (d < best) {
        best = d;
        s = (i + k) / 3;
        v = (d / lerp(radii[i], radii[i + 1], k)) * (ex * qy - ey * qx < 0 ? -1 : 1);
      }
    }
    let c = br.fur;
    switch (br.pattern) {
      case "tabby":
        if (inHead) {
          if (hx < 0.2 && Math.abs(hy) < 0.45 && Math.sin(hy * 22) > 0.3) c = br.p1;
        } else if (Math.abs(v) < 0.16 || Math.sin(s * 24 + noise2(s * 4, v * 3, 3) * 2.5) > 0.2) c = br.p1;
        break;
      case "calico": {
        // Big patches, like a koi's: two or three per cat.
        const n = noise2(lx * 3 + 10, ly * 3, 7);
        if (n > 0.58) c = br.p1;
        else if (n < 0.3) c = br.p2;
        break;
      }
      case "tux":
        if (inHead && hx > 0.5) c = br.p1;
        break;
      case "points": {
        const d = inHead ? clamp(0.3 + hx, 0, 1) : 0;
        c = mix(br.fur, br.p1, smoothstep(0.1, 0.8, d));
        break;
      }
    }
    if (P.belly > 0.3 && !inHead && Math.abs(v) < 0.6) c = mix(c, br.belly, smoothstep(0.3, 0.9, P.belly));
    return c;
  }

  function rasterCat(cat) {
    const P = cat.P;
    const rig = buildRig(cat, P);
    const { parts, S, ca, sa, f } = rig;
    const diag = Math.hypot(cw, ch) * 0.5, bevel = 0.07 * S, e = cw * 0.5;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of parts) {
      x0 = Math.min(x0, p.x0); y0 = Math.min(y0, p.y0); x1 = Math.max(x1, p.x1); y1 = Math.max(y1, p.y1);
    }
    const c0 = Math.max(0, Math.floor(x0 / cw)), c1 = Math.min(cols - 1, Math.floor(x1 / cw));
    const r0 = Math.max(0, Math.floor(y0 / ch)), r1 = Math.min(rows - 1, Math.floor(y1 / ch));
    const dim = lerp(0.72, 1, sky.day);
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;

    for (let r = r0; r <= r1; r++) {
      const y = (r + 0.5) * ch;
      for (let c = c0; c <= c1; c++) {
        const x = (c + 0.5) * cw;
        let near = false;
        for (const p of parts) {
          if (x < p.x0 - diag || x > p.x1 + diag || y < p.y0 - diag || y > p.y1 + diag) continue;
          if (p.d(x, y) < diag) {
            near = true;
            break;
          }
        }
        if (!near) continue;
        let hits = 0, front = parts.length;
        for (let j = 0; j < 8; j += 2) {
          const px = (c + SUB[j]) * cw, py = (r + SUB[j + 1]) * ch;
          for (let k = 0; k < parts.length; k++) {
            const p = parts[k];
            if (px < p.x0 || px > p.x1 || py < p.y0 || py > p.y1) continue;
            if (p.d(px, py) < 0) {
              hits++;
              if (k < front) front = k;
              break;
            }
          }
        }
        if (!hits) continue;
        const part = parts[front];
        const d = part.d(x, y);
        const nx = part.d(x + e, y) - d, ny = part.d(x, y + e) - d, nl = Math.hypot(nx, ny) || 1;
        // Lit from the top left: rims shade by their normal, the back is a rounded top.
        const inside = clamp(-d / bevel, 0, 1);
        const light = clamp(0.66 + 0.42 * ((nx * LX + ny * LY) / nl) * (1 - inside) + 0.12 * inside, 0.25, 1.2);
        const dx = x - cat.x, dy = y - cat.y;
        const lx = (dx * ca + dy * sa) / S, ly = ((-dx * sa + dy * ca) / S) * f;
        const base = furColour(cat, part.mat, lx, ly, P, rig);
        const k = light * dim;
        const cover = hits / 4;
        const tone = clamp((light - 0.3) / 0.8, 0, 1) * FUR.length;
        // Legs and tail are only a couple of cells wide: keep them solid rather than rimmed.
        const thin = part.mat !== "body";
        const g = cover < 0.5 ? rim(nx / nl, ny / nl)
          : cover < 1 && !thin ? ":" : FUR[clamp(Math.floor(tone) - (cover < 1 ? 1 : 0), 0, FUR.length - 1)];
        grid.put(c, r, g, ink([base[0] * k, base[1] * k, base[2] * k], c, r, 0.5 + 0.5 * cover, 45));
        if (x < bx0) bx0 = x;
        if (x > bx1) bx1 = x;
        if (y < by0) by0 = y;
        if (y > by1) by1 = y;
      }
    }
    cat.box = { x0: bx0 - cw, y0: by0 - ch, x1: bx1 + cw, y1: by1 + ch };
    cat.paws = rig.paws;
    cat.nose = rig.nose;
    drawFace(cat, rig);
  }

  /** Eyes, nose and whiskers on top of the rasterised head. */
  function drawFace(cat, rig) {
    const P = cat.P, br = cat.breed, { hd, ha, wx, wy } = rig;
    const cell = (x, y) => {
      const p = at(hd, ha, x * P.hr, y * P.hr);
      return [Math.floor(wx(p) / cw), Math.floor(wy(p) / ch)];
    };
    // The head's direction on screen, for glyphs that point.
    const tip = at(hd, ha, 1, 0), dir = Math.atan2(wy(tip) - wy(hd), wx(tip) - wx(hd));
    const lid = mix(br.fur, [0, 0, 0], 0.55);
    for (const s of [-1, 1]) {
      const [c, r] = cell(0.4, s * 0.45);
      if (P.eyes < 0.3) grid.put(c, r, P.belly > 0.5 || cat.state === "petted" ? "^" : "-", ink(lid, c, r, 1, 50));
      else if (P.eyes < 0.7) grid.put(c, r, "=", ink(lid, c, r, 1, 50));
      else {
        const eye = night() ? mix(br.eyes, [255, 255, 255], 0.3) : mix(br.eyes, [0, 0, 0], 0.25);
        grid.put(c, r, night() ? "●" : "o", style(eye[0], eye[1], eye[2], 1));
      }
    }
    const [nc, nr] = cell(1.2, 0);
    grid.put(nc, nr, ">v<^"[((Math.round(dir / (Math.PI / 2)) % 4) + 4) % 4], style(br.nose[0], br.nose[1], br.nose[2], 1));
    if (cat.state === "drink" && Math.sin(performance.now() / 90) > 0) {
      const [tc, tr] = cell(1.6, 0);
      grid.put(tc, tr, "~", style(240, 110, 130, 1));
    }
    for (const s of [-1, 1]) {
      for (const k of [0, 1]) {
        const [c, r] = cell(1 + k * 0.1, s * (1.2 + k * 0.35));
        grid.put(c, r, lineGlyph(dir + s * rig.f * (1.2 - k * 0.3)), ink([235, 235, 240], c, r, 0.7, 70));
      }
    }
  }

  /** A soft shadow under each cat; it drifts off as the cat leaps. */
  function drawCatShadow(cat) {
    const P = cat.P, S = U * cat.scale;
    const st = style(...mix(bank.deep, [0, 0, 0], 0.6), 0.15 + 0.2 * sky.day);
    const len = (P.db / 2 + P.dn * 0.5) * S, wid = Math.max(P.rs, P.rh) * S;
    const cx = cat.x + Math.cos(cat.a) * P.dn * 0.3 * S + S * (0.035 + cat.z * 0.4);
    const cy = cat.y + Math.sin(cat.a) * P.dn * 0.3 * S + S * (0.05 + cat.z * 0.5);
    const ca = Math.cos(cat.a), sa = Math.sin(cat.a);
    for (let r = Math.floor((cy - len) / ch); r <= Math.floor((cy + len) / ch); r++) {
      for (let c = Math.floor((cx - len) / cw); c <= Math.floor((cx + len) / cw); c++) {
        const dx = (c + 0.5) * cw - cx, dy = (r + 0.5) * ch - cy;
        const u = (dx * ca + dy * sa) / len, w = (-dx * sa + dy * ca) / wid;
        if (u * u + w * w < 1) put(c, r, ".", st);
      }
    }
  }

  // ------------------------------------------------------------------ cats

  const BREEDS = [
    { name: "Mochi", fur: [244, 238, 226], p1: [228, 128, 52], p2: [70, 58, 60], belly: [252, 250, 244], eyes: [80, 196, 120], nose: [255, 150, 170], pattern: "calico", jump: 1.4, nap: 0.8 },
    { name: "Tora", fur: [236, 146, 54], p1: [176, 84, 22], p2: [255, 196, 120], belly: [255, 222, 176], eyes: [240, 184, 50], nose: [255, 150, 160], pattern: "tabby", jump: 1, nap: 1 },
    { name: "Oreo", fur: [40, 44, 54], p1: [245, 245, 250], p2: [40, 44, 54], belly: [245, 245, 250], eyes: [232, 214, 60], nose: [250, 160, 170], pattern: "tux", jump: 1.2, nap: 0.9 },
    { name: "Chai", fur: [240, 228, 210], p1: [92, 64, 56], p2: [120, 86, 72], belly: [248, 240, 228], eyes: [70, 160, 245], nose: [100, 66, 60], pattern: "points", jump: 1, nap: 1 },
    { name: "Luna", fur: [40, 42, 54], p1: [40, 42, 54], p2: [60, 62, 76], belly: [52, 54, 66], eyes: [150, 240, 80], nose: [70, 60, 70], pattern: "solid", jump: 1.3, nap: 0.9 },
    { name: "Yuki", fur: [250, 250, 255], p1: [250, 250, 255], p2: [255, 232, 240], belly: [255, 255, 255], eyes: [100, 190, 250], nose: [255, 160, 180], pattern: "solid", jump: 0.8, nap: 1.2 },
    { name: "Smokey", fur: [160, 170, 186], p1: [96, 104, 120], p2: [210, 218, 228], belly: [215, 222, 232], eyes: [236, 196, 66], nose: [236, 150, 160], pattern: "tabby", jump: 0.7, nap: 1.8 },
  ];

  const cats = [];
  const prints = [];
  const particles = [];

  const START = ["sit", "loaf", "sleep", "groom", "side", "wash"];
  /** Idle poses and how much cats like them (sleep is scaled by the breed's `nap`). */
  const IDLE = [["sit", 3], ["loaf", 2], ["groom", 1.2], ["wash", 1], ["side", 1], ["stretch", 0.5], ["sleep", 1.6]];

  const lo = () => U * 0.6;
  const hi = () => W - U * 0.6;
  /** Keep a cat's middle on the bank. */
  const bankY = (x, y) => clamp(y, shoreY(x) + U * 0.3, H - U * 0.3);
  /** Where a cat stands to reach the water at x: its head just short of the waterline. */
  const edgeSpot = (cat, x, reach = 0.52) => {
    const cx = clamp(x, lo(), hi());
    return [cx, shoreY(cx) + U * cat.scale * reach];
  };
  /** A heading toward (x, y), but never turned more than ~50° away from the water. */
  function faceWater(cat, x, y) {
    const up = -Math.PI / 2;
    return up + clamp(wrapAngle(Math.atan2(y - cat.y, x - cat.x) - up), -0.9, 0.9);
  }

  function createCat(i) {
    const first = START[Math.floor(rand(0, START.length))];
    const a = rand(-Math.PI, Math.PI);
    const cat = {
      breed: BREEDS[i % BREEDS.length], scale: i === 0 ? 1 : rand(0.85, 1.02),
      x: 0, y: 0, z: 0, a, face: a, turn: 0, side: rand() > 0.5 ? 1 : -1, speed: 0,
      state: "idle", pose: first, timer: rand(3, 10),
      P: { ...POSES[first] }, base: { ...POSES[first] }, V: zeroV(), ease: 0.2, prevPose: first, layerW: 1, poseT: 0,
      amp: 0, seed: rand(0, 1000), glance: null, twitch: 0, flick: 0,
      gait: 0, tailPhase: rand(0, 6.28), blink: rand(2, 6), blinking: false,
      hover: 0, goal: null, jump: null, say: null, box: null, paws: null, nose: null,
      prey: null, watch: null, cool: rand(2, 8), wet: 0, splashed: false, soaked: false, lap: 0,
    };
    const spot = freeSpot(cat) || [rand(lo(), hi()), H - U];
    [cat.x, cat.y] = [spot[0], bankY(spot[0], spot[1])];
    return cat;
  }

  /** A spot on the bank clear of the other cats, or null. */
  function freeSpot(self) {
    let best = null, bestGap = -1;
    for (let k = 0; k < 8; k++) {
      const x = rand(lo(), hi()), y = rand(shoreY(x) + U * 0.45, H - U * 0.35);
      let gap = Infinity;
      for (const o of cats) {
        if (o === self) continue;
        const [ox, oy] = o.goal ? [o.goal.x, o.goal.y] : [o.x, o.y];
        gap = Math.min(gap, Math.hypot(ox - x, oy - y));
      }
      if (gap > bestGap) {
        best = [x, y];
        bestGap = gap;
      }
    }
    return bestGap >= U * 0.9 ? best : null;
  }

  /** Ease into a pose over roughly `dur` seconds (0 = snap). */
  function setPose(cat, name, dur = 0.4) {
    if (cat.pose === name) return;
    cat.prevPose = cat.pose;
    cat.pose = name;
    cat.poseT = 0;
    if (dur > 0) {
      cat.ease = dur * 0.5;
      cat.layerW = 0;
    } else {
      cat.base = { ...POSES[name] };
      cat.V = zeroV();
      cat.layerW = 1;
    }
  }

  function idle(cat, name, time) {
    cat.state = "idle";
    cat.speed = 0;
    cat.timer = time;
    cat.goal = null;
    setPose(cat, name, LYING.has(name) || LYING.has(cat.pose) ? 0.7 : 0.4);
  }

  function walkTo(cat, x, y, kind, state = "walk", face = null) {
    const gx = clamp(x, lo(), hi());
    cat.goal = { x: gx, y: kind === "walk" || kind === "come" ? bankY(gx, y) : y, kind, face };
    cat.state = state;
    cat.timer = 20;
    setPose(cat, state, ASLEEP.has(cat.pose) ? 0.8 : 0.3);
  }

  function hopTo(cat, x, y, then) {
    const tx = clamp(x, lo(), hi());
    cat.jump = { sx: cat.x, sy: cat.y, tx, ty: bankY(tx, y), t: 0, dur: 0.55, then };
    cat.state = "hop";
    cat.speed = 0;
    setPose(cat, "leap", 0.12);
  }

  /** Walk toward cat.goal, turning as it goes; true on arrival. */
  function steer(cat, dt) {
    const g = cat.goal, dx = g.x - cat.x, dy = g.y - cat.y, d = Math.hypot(dx, dy);
    if (d < 4) {
      cat.speed = 0;
      cat.amp = 0;
      return true;
    }
    const diff = wrapAngle(Math.atan2(dy, dx) - cat.a);
    const turn = clamp(diff * 4, -3, 3) * dt;
    cat.a = wrapAngle(cat.a + turn);
    cat.face = cat.a;
    cat.turn = turn / Math.max(dt, 1e-3);
    const creep = cat.state === "creep", cycle = creep ? 0.36 : 0.5;
    const max = (creep ? 0.22 : 0.4) * U, acc = U * 1.2;
    // Slow down to turn, and brake to arrive.
    const want = Math.min(max, Math.sqrt(2 * acc * d)) * clamp(1 - Math.abs(diff) / 1.6, 0, 1);
    cat.speed += clamp(want - cat.speed, -acc * dt, acc * dt);
    const step = Math.min(cat.speed * dt, d);
    cat.x += Math.cos(cat.a) * step;
    cat.y += Math.sin(cat.a) * step;
    cat.amp = clamp(cat.speed / (U * 0.2), 0, 1);
    const before = cat.gait;
    cat.gait += (step / (U * cycle)) * TAU;
    if (cat.wet > 0 && cat.paws && Math.floor(before / Math.PI) !== Math.floor(cat.gait / Math.PI)) {
      addPrint(cat.paws[Math.floor(cat.gait / Math.PI) % 2 ? "lh" : "rh"]);
    }
    return false;
  }

  function say(cat, text, time = 1.8) {
    cat.say = { text, t: time };
  }

  function puff(x, y, text, c3, vx = 0, vy = -30, life = 1.4, g = 0) {
    if (particles.length > 200) particles.shift();
    particles.push({ x, y, vx, vy, g, text, c3, life, max: life });
  }

  const headTop = (cat) => (cat.box ? cat.box.y0 : cat.y - U * 0.5);
  const pick = (list) => list[Math.floor(rand(0, list.length))];

  function pet(cat, strong) {
    if (cat.state !== "idle" && cat.state !== "petted") return;
    const heart = () => puff(cat.x + rand(-0.2, 0.2) * U, headTop(cat), "♥", [255, 110, 150], rand(-15, 15), -30);
    if (ASLEEP.has(cat.pose) && !strong) {
      if (rand() < 0.04) puff(cat.x, headTop(cat), "~", [255, 150, 180]);
      return;
    }
    if (cat.state !== "petted" || strong) {
      say(cat, strong ? "purr~ nya!" : rand() > 0.5 ? "purr~" : "prrr...");
      heart();
      cat.state = "petted";
      if (LYING.has(cat.pose)) setPose(cat, rand() < 0.6 ? "belly" : "knead", 0.7);
      else setPose(cat, rand() < 0.25 ? "knead" : "petted", 0.4);
    } else if (rand() < 0.05) heart();
    cat.timer = strong ? 3 : 1.5;
    cat.goal = null;
  }

  /** The koi head nearest to a cat, close to the bank and within `reach` along it. */
  function koiNear(cat, reach) {
    let best = null, bestD = reach;
    for (const k of koi) {
      const hx = k.px[0], hy = k.py[0];
      if (shoreY(hx) - hy > U * 1.1 || hx < lo() - U * 0.3 || hx > hi() + U * 0.3) continue;
      const d = Math.abs(hx - cat.x);
      if (d < bestD) {
        best = k;
        bestD = d;
      }
    }
    return best;
  }

  function hunt(cat, k) {
    cat.prey = k;
    if (rand() < 0.4) say(cat, "!", 0.8);
    const [x, y] = edgeSpot(cat, k.px[0]);
    walkTo(cat, x, y, "prey", "creep");
  }

  function pickAction(cat) {
    if (ASLEEP.has(cat.pose) && rand() < 0.6) {
      idle(cat, "stretch", rand(1.8, 2.6));
      return;
    }
    const r = rand();
    if (r < 0.25) {
      const spot = freeSpot(cat);
      if (spot) return walkTo(cat, spot[0], spot[1], "walk");
    } else if (r < 0.37 && !ASLEEP.has(cat.pose)) {
      const [x, y] = edgeSpot(cat, cat.x + rand(-1.5, 1.5) * U, 0.56);
      if (!cats.some((o) => o !== cat && Math.hypot(o.x - x, o.y - y) < U * 0.8)) return walkTo(cat, x, y, "drink", "walk", -Math.PI / 2);
    }
    let sum = 0;
    const w = IDLE.map(([name, v]) => (sum += name === "sleep" ? v * cat.breed.nap : v));
    const roll = rand(0, sum);
    const name = IDLE[w.findIndex((v) => roll < v)][0];
    idle(cat, name, ASLEEP.has(name) ? rand(14, 30) : name === "stretch" ? rand(1.8, 2.6) : rand(3, 8));
  }

  /** The paw hits the water: a splash, ripples, and the koi scatter. */
  function splash(cat) {
    const S = U * cat.scale;
    const paw = cat.paws ? cat.paws.rf : [cat.x, cat.y - S * 0.6];
    const x = paw[0], y = Math.min(paw[1], shoreY(x) - ch * 0.5);
    addRipple(x, y, 1, S * 1.3);
    addRipple(x, y, 0.6, S * 0.7);
    addEnergy(x, y, 1.4);
    for (let i = 0; i < 9; i++) puff(x + rand(-0.15, 0.15) * S, y, pick(["'", ".", ",", "°"]), sky.wake, rand(-0.9, 0.9) * S, -rand(0.6, 1.2) * S, rand(0.5, 0.9), S * 3);
    const k = cat.prey;
    const close = k && Math.hypot(k.px[0] - x, k.py[0] - y) < S * 0.7;
    scare(x, y, S * 0.8);
    if (close && rand() < 0.3) {
      // The koi answers with a flick of its tail.
      cat.soaked = true;
      const tx = k.px[NODES - 1], ty = Math.min(k.py[NODES - 1], shoreY(k.px[NODES - 1]) - ch);
      addRipple(tx, ty, 1, S);
      for (let i = 0; i < 14; i++) {
        const fx = (cat.x - tx) * rand(0.9, 1.4), fy = (cat.y - ty) * rand(0.9, 1.4);
        puff(tx, ty, pick(["'", ".", "°", "o"]), sky.wake, fx + rand(-0.3, 0.3) * S, fy - rand(0.4, 0.8) * S, rand(0.8, 1.1), S * 1.2);
      }
    } else if (close) say(cat, pick(["so close!", "nya!", "mrrp!"]), 1.2);
    cat.wet = 9;
  }

  function behave(cat, dt) {
    cat.cool -= dt;
    cat.wet -= dt;

    if (cat.state === "hop") {
      const j = cat.jump;
      j.t += dt;
      const p = clamp(j.t / j.dur, 0, 1);
      cat.x = lerp(j.sx, j.tx, p);
      cat.y = lerp(j.sy, j.ty, p);
      cat.z = 4 * p * (1 - p) * 0.7;
      if (p >= 1) {
        cat.z = 0;
        cat.jump = null;
        for (const s of [-1, 1]) puff(cat.x + s * U * 0.25, cat.y, "'", bank.blade, s * 25, -10, 0.5);
        j.then(cat);
      }
      return;
    }

    if (pointer.active && hits(cat, pointer.x, pointer.y)) {
      cat.hover += dt;
      if (cat.hover > 0.3) pet(cat, false);
    } else cat.hover = 0;

    // Watch the water; a koi coming up to the bank is hard to resist.
    cat.watch = ASLEEP.has(cat.pose) ? null : koiNear(cat, U * 3.5);
    if ((cat.state === "idle" || cat.state === "walk") && cat.watch && cat.cool <= 0 && rand() < dt * 0.9) hunt(cat, cat.watch);

    cat.timer -= dt;
    switch (cat.state) {
      case "walk":
      case "creep": {
        if (cat.state === "creep") {
          const k = cat.prey;
          // Give up if the koi swam off.
          if (!k || shoreY(k.px[0]) - k.py[0] > U * 1.4 || k.flee > 0) {
            cat.prey = null;
            cat.cool = rand(3, 6);
            idle(cat, pick(["sit", "loaf"]), rand(2, 4));
            if (rand() < 0.5) say(cat, "...", 1.2);
            break;
          }
          [cat.goal.x, cat.goal.y] = edgeSpot(cat, k.px[0]);
        }
        if (steer(cat, dt)) arrive(cat);
        else if (cat.timer <= 0) pickAction(cat);
        break;
      }
      case "stalk":
        if (cat.prey) cat.face = faceWater(cat, cat.prey.px[0], cat.prey.py[0]);
        if (cat.timer <= 0) {
          cat.state = "swat";
          cat.timer = 0.9;
          cat.splashed = false;
          setPose(cat, "swat", 0.1);
        }
        break;
      case "swat":
        if (!cat.splashed && cat.poseT > 0.18) {
          cat.splashed = true;
          splash(cat);
        }
        if (cat.timer <= 0) {
          cat.prey = null;
          if (cat.soaked) {
            // Leap back from the water, then shake it off.
            cat.soaked = false;
            say(cat, "!!", 1);
            hopTo(cat, cat.x - Math.cos(cat.a) * U * 0.8, cat.y - Math.sin(cat.a) * U * 0.8, (c) => {
              c.state = "shake";
              c.timer = 1.6;
              c.flick = 1.6;
              setPose(c, "shake", 0.2);
              say(c, "*shake shake*", 1.6);
            });
          } else {
            cat.cool = rand(5, 12);
            idle(cat, pick(["sit", "crouch", "loaf"]), rand(1.5, 3));
          }
        }
        break;
      case "shake":
        if (rand() < dt * 18) {
          const a = rand(0, TAU);
          puff(cat.x + Math.cos(a) * U * 0.25, cat.y + Math.sin(a) * U * 0.25, pick(["'", ".", ","]), sky.wake, Math.cos(a) * U, Math.sin(a) * U, 0.5);
        }
        if (cat.timer <= 0) {
          cat.cool = rand(15, 25);
          idle(cat, "wash", rand(4, 6));
          say(cat, pick(["hmph.", "...", "mew"]), 1.5);
        }
        break;
      case "drink":
        if ((cat.lap -= dt) <= 0) {
          cat.lap = rand(0.5, 0.9);
          if (cat.nose) {
            const x = cat.nose[0], y = Math.min(cat.nose[1], shoreY(x) - ch * 0.5);
            addRipple(x, y, 0.5, U * 0.6);
            addEnergy(x, y, 0.5);
          }
        }
        if (cat.timer <= 0) {
          cat.wet = 8;
          idle(cat, pick(["wash", "groom", "sit"]), rand(3, 6));
        }
        break;
      case "petted":
        if (rand() < dt * 0.6) puff(cat.x, headTop(cat), "♥", [255, 120, 170], rand(-15, 15), -30);
        if (cat.timer <= 0) idle(cat, LYING.has(cat.pose) ? "side" : "sit", rand(2, 5));
        break;
      default: // idle
        if (ASLEEP.has(cat.pose) && rand() < dt * 0.8) {
          puff(cat.x, headTop(cat), rand() > 0.5 ? "z" : "Z", [180, 196, 224], 10, -14, 2.4);
        }
        // Shuffle round to keep a koi in view.
        if (cat.watch && UPRIGHT.has(cat.pose)) {
          const a = Math.atan2(cat.watch.py[0] - cat.y, cat.watch.px[0] - cat.x);
          if (Math.abs(wrapAngle(a - cat.a)) > 1.1) cat.face = a;
        }
        if (cat.timer <= 0) pickAction(cat);
    }
  }

  function arrive(cat) {
    const goal = cat.goal;
    cat.goal = null;
    if (goal.face !== null) cat.face = goal.face;
    if (goal.kind === "prey") {
      cat.state = "stalk";
      cat.timer = rand(0.8, 1.6);
      if (cat.prey) cat.face = faceWater(cat, cat.prey.px[0], cat.prey.py[0]);
      setPose(cat, "crouch", 0.25);
    } else if (goal.kind === "drink") {
      cat.state = "drink";
      cat.timer = rand(4, 7);
      cat.lap = 0.6;
      setPose(cat, "drink", 0.4);
      say(cat, "lap lap", 1.5);
      // A curious koi comes up to see.
      const x = cat.x, y = shoreY(x);
      const k = koi.slice().sort((a, b) => Math.hypot(a.px[0] - x, a.py[0] - y) - Math.hypot(b.px[0] - x, b.py[0] - y))[0];
      if (k) visit(k, x + rand(-0.3, 0.3) * U, y, 8);
    } else if (goal.kind === "come") {
      idle(cat, "sit", rand(3, 5));
      say(cat, pick(["mew?", "nya?", "mrrp"]), 1.5);
    } else pickAction(cat);
  }

  const TAIL_SPEED = { leap: 6, crouch: 12, swat: 12, walk: 3, creep: 2, petted: 4, knead: 4, sleep: 0.4, loaf: 0.8, side: 0.8 };

  function updateCat(cat, dt, t) {
    cat.tailPhase += dt * (TAIL_SPEED[cat.pose] || 1.6) * (cat.flick > 0 ? 2.5 : 1) * (cat.watch ? 1.6 : 1);
    cat.poseT += dt;
    cat.blink -= dt;
    if (cat.blink <= 0) {
      cat.blinking = !cat.blinking;
      cat.blink = cat.blinking ? 0.14 : rand(2.5, 6);
    }
    if (cat.say && (cat.say.t -= dt) <= 0) cat.say = null;
    behave(cat, dt);
    fidget(cat, dt);
    // Cats on the ground step aside rather than walk through each other.
    for (const o of cats) {
      if (o === cat || cat.z || o.z) continue;
      const dx = cat.x - o.x, dy = cat.y - o.y, d = Math.hypot(dx, dy) || 1, r = U * 0.55 * (cat.scale + o.scale);
      if (d < r) {
        cat.x = clamp(cat.x + (dx / d) * (r - d) * dt * 2, lo(), hi());
        cat.y = bankY(cat.x, cat.y + (dy / d) * (r - d) * dt * 2);
      }
    }
    // Away from walking, the body turns on the spot to face where the cat wants to look.
    if (cat.state !== "walk" && cat.state !== "creep" && cat.state !== "hop") {
      const before = cat.a;
      if (!LYING.has(cat.pose)) cat.a = wrapAngle(cat.a + clamp(wrapAngle(cat.face - cat.a) * 3, -2.5, 2.5) * dt);
      cat.turn = wrapAngle(cat.a - before) / Math.max(dt, 1e-3);
    }

    // The pose eases in on springs, and the looping motion of the new pose fades in.
    const goal = target(cat, t), B = cat.base, V = cat.V;
    for (const k of POSE_KEYS) damp(B, V, k, goal[k], cat.ease * (LAG[k] || 1), dt);
    cat.layerW = Math.min(1, cat.layerW + dt / 0.35);
    const w = smoothstep(0, 1, cat.layerW), P = { ...B };
    addLayer(P, cat, cat.pose, B, t, w);
    if (w < 1) addLayer(P, cat, cat.prevPose, B, t, 1 - w);

    // Breathing, slower and deeper when asleep.
    const asleep = ASLEEP.has(cat.pose);
    const br = 1 + (asleep ? 0.035 : 0.015) * Math.sin(t * (asleep ? 1.3 : 2.2) + cat.seed);
    P.rh *= br;
    P.rs *= br;
    if (cat.blinking) P.eyes = Math.min(P.eyes, 0);
    cat.P = P;
  }

  /** Little unprompted things: ear twitches, tail flicks, glances around. */
  function fidget(cat, dt) {
    cat.twitch -= dt;
    cat.flick -= dt;
    if (cat.glance && (cat.glance.t -= dt) <= 0) cat.glance = null;
    const asleep = ASLEEP.has(cat.pose);
    if (rand() < dt * (asleep ? 0.08 : 0.3)) cat.twitch = 0.18;
    if (rand() < dt * (asleep ? 0.05 : 0.2)) cat.flick = rand(0.4, 0.9);
    if (!cat.glance && !cat.watch && cat.state === "idle" && UPRIGHT.has(cat.pose) && rand() < dt * 0.12) {
      cat.glance = { look: rand(-1, 1), t: rand(1, 2.5) };
    }
  }

  /** The pose a cat is easing toward: its pose plus gaze (at you, or at a koi), fidgets and turns. */
  function target(cat, t) {
    const P = { ...POSES[cat.pose] };
    const n = (k) => noise2(t * 0.35, k, cat.seed) - 0.5;
    P.ta += 0.25 * n(5);
    P.tc += 0.05 * n(4);
    if (cat.flick > 0) P.tw += 0.12;
    if (cat.twitch > 0) P.ear = Math.max(P.ear, 0.5);
    // The spine bends into a turn.
    if (cat.state === "walk" || cat.state === "creep") P.bend += clamp(cat.turn * 0.1 * cat.side, -0.3, 0.3);
    // Gaze: a nearby cursor, else the koi it is watching or stalking, else a glance about.
    if (UPRIGHT.has(cat.pose) || cat.state === "stalk" || cat.state === "swat") {
      const near = pointer.active && Math.hypot(pointer.x - cat.x, pointer.y - cat.y) < U * 2.5;
      const k = cat.prey || cat.watch;
      const look = near ? [pointer.x, pointer.y] : k ? [k.px[0], k.py[0]] : null;
      if (look) P.look = clamp(wrapAngle(Math.atan2(look[1] - cat.y, look[0] - cat.x) - cat.a) * cat.side, -1.1, 1.1);
      else P.look += 0.5 * n(1) + (cat.glance ? cat.glance.look : 0);
    }
    return P;
  }

  /** Add pose `name`'s looping motion (relative to the eased pose B) to P, at weight w. */
  function addLayer(P, cat, name, B, t, w) {
    if (w <= 0.001) return;
    const Q = { ...B };
    animate(cat, name, Q, t);
    for (const k of POSE_KEYS) if (Q[k] !== B[k]) P[k] += (Q[k] - B[k]) * w;
  }

  /**
   * The looping motion of pose `name`, applied to P. Walking paws are planted: during the
   * stance they slide back exactly as fast as the body moves forward (the gait phase is
   * driven by distance), then swing forward again.
   */
  function animate(cat, name, P, t) {
    const ph = cat.gait;
    switch (name) {
      case "walk":
      case "creep": {
        const a = cat.amp, beta = 0.62, stride = name === "creep" ? 0.36 : 0.5;
        const A = (beta * stride) / (2 * cat.scale);
        for (const [k, o] of [["lh", 0], ["lf", 0.25], ["rh", 0.5], ["rf", 0.75]]) {
          const u = (((ph / TAU + o) % 1) + 1) % 1;
          let fx = A * (1 - (2 * u) / beta);
          if (u >= beta) {
            const s = (u - beta) / (1 - beta);
            fx = A * (-1 + 2 * s * s * (3 - 2 * s));
          }
          P[k + "x"] += fx * a;
        }
        // The spine sways with the stride; the head stays steadier.
        P.bend += 0.05 * Math.sin(ph) * a;
        P.look -= 0.08 * Math.sin(ph) * a;
        break;
      }
      case "crouch": {
        // A stalking cat treads its back feet and wiggles its hips before it pounces.
        const a = cat.state === "stalk" ? smoothstep(0.15, 0.6, cat.poseT) : 0;
        P.bend += 0.07 * Math.sin(t * 14) * a;
        P.lhx += Math.max(0, Math.sin(t * 14)) * 0.03 * a;
        P.rhx += Math.max(0, -Math.sin(t * 14)) * 0.03 * a;
        P.tw += 0.1 * a;
        break;
      }
      case "swat":
        P.rfx += 0.1 * Math.sin(t * 16);
        P.rfy += 0.06 * Math.cos(t * 16);
        break;
      case "groom":
        P.look += 0.12 * Math.sin(t * 5);
        P.rfx += 0.03 * Math.sin(t * 5);
        break;
      case "wash":
        P.lfx += 0.04 * Math.cos(t * 3);
        P.lfy += 0.04 * Math.sin(t * 3);
        P.look += 0.15 * Math.sin(t * 3);
        break;
      case "knead": {
        const s = Math.sin(t * 5);
        P.lfx += Math.max(0, s) * 0.06;
        P.rfx += Math.max(0, -s) * 0.06;
        break;
      }
      case "belly":
        // Rolling from side to side, paws batting at the air.
        P.bend += 0.14 * Math.sin(t * 2.5);
        P.lfx += 0.04 * Math.sin(t * 6);
        P.rfx += 0.04 * Math.cos(t * 6);
        break;
      case "shake":
        P.look += 0.5 * Math.sin(t * 30);
        P.bend += 0.12 * Math.sin(t * 30 + 1);
        break;
      case "drink":
        P.dn += 0.02 * Math.sin(t * 8);
        break;
      case "petted":
        P.look += 0.15 * Math.sin(t * 2.5);
        break;
      case "stretch":
        P.db += 0.03 * Math.sin(t * 1.5);
        break;
    }
    return P;
  }

  function hits(cat, x, y) {
    const b = cat.box;
    return !!b && x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1;
  }

  function drawLabel(cat) {
    const label = cat.say ? `(${cat.say.text})` : null;
    const near = pointer.active && hits(cat, pointer.x, pointer.y);
    const txt = label || (near ? cat.breed.name : null);
    if (!txt || !cat.box) return;
    const c = Math.round(cat.x / cw) - (txt.length >> 1), r = Math.floor(cat.box.y0 / ch) - 1;
    inkText(c, r, txt, label ? [255, 255, 255] : [210, 220, 235], label ? 0.95 : 0.75, 110);
  }

  // ------------------------------------------------------ prints & puffs

  function addPrint([x, y]) {
    if (prints.length > 60) prints.shift();
    prints.push({ c: Math.floor(x / cw), r: Math.floor(y / ch), life: 7 });
  }

  function drawPrints(dt) {
    for (let i = prints.length - 1; i >= 0; i--) {
      const p = prints[i];
      if ((p.life -= dt) <= 0) {
        prints.splice(i, 1);
        continue;
      }
      put(p.c, p.r, ":", ink(mix(bank.mud, sky.wake, 0.3), p.c, p.r, 0.7 * clamp(p.life / 7, 0, 1), 40));
    }
  }

  /** Puffs and droplets; droplets (with gravity) vanish when they fall back into the water. */
  function stepParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      p.vy += p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.life <= 0 || (p.g && p.vy > 0 && waterAt(p.x, p.y) && p.y > shoreY(p.x) - U * 0.5 && rand() < dt * 6)) {
        particles.splice(i, 1);
        if (p.g && p.life > 0) addEnergy(p.x, p.y, 0.3);
      }
    }
  }

  function drawParticles() {
    for (const p of particles) {
      const c = Math.round(p.x / cw), r = Math.round(p.y / ch);
      grid.put(c, r, p.text, ink(p.c3, c, r, clamp(p.life / p.max, 0, 1), 60));
    }
  }

  // ------------------------------------------------------------ the scene

  function resize() {
    ({ W, H, cw, ch, cols, rows, glyph, color } = grid);
    U = clamp(Math.min(W, H) * 0.23, 100, 400);
    const n = cols * rows;
    floorGlyph = new Array(n).fill("");
    floorColor = new Array(n).fill("");
    padGlyph = new Array(n).fill("");
    padColor = new Array(n).fill("");
    bankGlyph = new Array(n).fill("");
    bankColor = new Array(n).fill("");
    dotChar = new Array(n);
    energy = new Float32Array(n);
    energyTmp = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      dotChar[i] = Math.random() < 0.2 ? ".`',"[(Math.random() * 4) | 0] : "";
    }
    shoreRow = new Int16Array(cols);
    for (let c = 0; c < cols; c++) shoreRow[c] = Math.floor(shoreY((c + 0.5) * cw) / ch);
    spawnBankThings();
    bankDirty = true;

    if (!koi.length) {
      for (let i = 0; i < KOI_COUNT; i++) spawnKoi(VARIETIES[i % VARIETIES.length]);
      spawnPads();
    }
    for (const k of koi) k.L = koiLength(k.scale);
    if (!cats.length) for (let i = 0; i < CAT_COUNT; i++) cats.push(createCat(i));
    for (const cat of cats) {
      cat.x = clamp(cat.x, lo(), hi());
      cat.y = bankY(cat.x, cat.y);
      cat.jump = null;
      cat.z = 0;
      if (cat.state !== "idle") idle(cat, "sit", rand(1, 3));
    }
    prints.length = 0;
  }

  let padDt = 0, rainTimer = 3, visitTimer = 4;

  function step(dt, t) {
    const now = performance.now();
    const hour = currentHour(now);
    if (Math.abs(hour - sky.hour) > 0.02 && now - skyPainted > 250) {
      setSky(hour);
      grid.repaintBackdrop();
      skyPainted = now;
    }

    for (const k of koi) stepKoi(k, dt);
    diffuseEnergy();

    // Every so often a koi cruises up to the bank.
    if ((visitTimer -= dt) <= 0) {
      visitTimer = rand(5, 12);
      const k = pick(koi);
      if (k && !k.visit) {
        const x = rand(lo(), hi());
        visit(k, x, shoreY(x));
      }
    }

    rainTimer -= dt;
    if (rainTimer <= 0) {
      const x = rand(0, W), y = rand(0, shoreY(x) - ch * 2);
      addRipple(x, y, 0.45, rand(60, 140));
      addEnergy(x, y, 0.6);
      rainTimer = rand(2, 7);
    }

    for (const cat of cats) updateCat(cat, dt, t);
    stepParticles(dt);
  }

  function draw(t, dt) {
    frameNo++;
    if (bankDirty) bakeBank();
    drawFloor(t);
    padDt += dt;
    if (frameNo % 4 === 1) {
      drawPads(padDt, t);
      padDt = 0;
    }
    for (let i = 0; i < glyph.length; i++) {
      glyph[i] = floorGlyph[i];
      color[i] = floorColor[i];
    }
    const order = koi.slice().sort((a, b) => a.depth - b.depth);
    for (const k of order) drawShadow(k);
    for (const k of order) drawKoi(k, t);
    drawFood(dt, t);
    drawRipples(dt);
    drawLapping(t);
    for (let i = 0; i < glyph.length; i++) {
      if (padGlyph[i]) {
        glyph[i] = padGlyph[i];
        color[i] = padColor[i];
      } else if (bankGlyph[i]) {
        glyph[i] = bankGlyph[i];
        color[i] = bankColor[i];
      }
    }
    drawReeds(t);
    drawPrints(dt);
    const cs = cats.slice().sort((a, b) => a.z - b.z || a.y - b.y);
    for (const cat of cs) drawCatShadow(cat);
    for (const cat of cs) rasterCat(cat);
    for (const cat of cs) drawLabel(cat);
    drawParticles();
  }

  function pointerMove(x, y, moved) {
    if (waterAt(x, y)) addEnergy(x, y, Math.min(0.25, moved * 0.01));
  }

  function click(x, y) {
    for (const cat of cats) {
      if (hits(cat, x, y)) {
        if (cat.state !== "idle" && cat.state !== "petted") idle(cat, "sit", 2);
        pet(cat, true);
        return;
      }
    }
    if (waterAt(x, y)) {
      addRipple(x, y, 1, 200);
      addEnergy(x, y, 1.2);
      for (let i = 0; i < 5; i++) {
        food.push({ x: x + rand(-24, 24), y: Math.min(y + rand(-16, 16), shoreY(x) - ch), life: 30, seed: rand(0, 100) });
      }
      // The cats nearby turn to look.
      for (const cat of cats) {
        if (cat.state === "idle" && UPRIGHT.has(cat.pose) && Math.hypot(cat.x - x, cat.y - y) < U * 4) {
          cat.face = Math.atan2(y - cat.y, x - cat.x);
        }
      }
      return;
    }
    // On the bank: the nearest cat comes over.
    const cat = cats.slice().sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0];
    if (cat && (cat.state === "idle" || cat.state === "walk")) {
      say(cat, ASLEEP.has(cat.pose) ? "...mew?" : "!", 1);
      const a = Math.atan2(y - cat.y, x - cat.x);
      walkTo(cat, x - Math.cos(a) * U * 0.4, y - Math.sin(a) * U * 0.4, "come", "walk", a);
    }
  }

  setSky(currentHour(performance.now()));

  return { resize, paintBackdrop, step, draw, pointerMove, click };
});
