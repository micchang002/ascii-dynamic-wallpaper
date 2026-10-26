/**
 * Koi pond — inspired by stackedlol/ascii-sharks.
 *
 * Layers, bottom to top:
 *   1. shimmering caustic dots on the pond floor, lit by the wake field
 *   2. koi shadows on the floor, strongest at midday
 *   3. koi rasterised cell-by-cell along an undulating spine, with patterned skin
 *      (kohaku, sanke, showa, ...) and flowing pectoral and tail fins
 *   4. surface things: food pellets, ripple rings, lily pads and lotus flowers
 * The colours follow the local clock: dark at night, warm at dawn and dusk, milk-white by day.
 *
 * URL params: koi=7, pads=5, hour=13.5 (pin the time of day), cycle=120 (a whole day in
 * this many seconds). Click to drop food; koi drift towards a resting cursor.
 */
Wallpaper.scene("koi", (api) => {
  "use strict";

  const { grid, intParam, floatParam, pointer, setTheme } = api;
  const { clamp, lerp, smoothstep, wrapAngle, rand, noise2 } = Wallpaper.math;
  const style = Wallpaper.style;

  const KOI_COUNT = intParam("koi", 7);
  const PAD_COUNT = intParam("pads", 5);
  const PIN_HOUR = floatParam("hour", NaN);
  const CYCLE = floatParam("cycle", 0);

  // -------------------------------------------------------------- palette

  const WHITE = [240, 236, 226];
  const RED = [230, 74, 36];
  const BLACK = [64, 66, 80];
  const GOLD = [240, 188, 68];
  const SLATE = [112, 146, 178];
  const PELLET = [196, 150, 96];

  /**
   * The pond through the day, interpolated by local hour:
   * [hour, backdrop centre, backdrop edge, floor dots, wake, koi light, shadow strength].
   */
  const SKY = [
    [0, [6, 32, 41], [1, 7, 11], [40, 112, 128], [120, 230, 255], 0.78, 0],
    [5, [6, 32, 41], [1, 7, 11], [40, 112, 128], [120, 230, 255], 0.78, 0],
    [6.5, [50, 52, 92], [12, 16, 36], [130, 120, 190], [200, 190, 255], 0.86, 0.1],
    [7.5, [160, 122, 108], [48, 54, 80], [255, 196, 150], [255, 230, 200], 0.95, 0.3],
    // Milk-white by day; koi are dimmed so white scales still stand out against it.
    [10, [250, 247, 238], [226, 220, 206], [150, 168, 172], [80, 140, 160], 0.72, 0.35],
    [16, [250, 247, 238], [226, 220, 206], [150, 168, 172], [80, 140, 160], 0.72, 0.35],
    [18.5, [178, 112, 78], [54, 44, 72], [255, 186, 120], [255, 225, 180], 0.95, 0.3],
    [20, [34, 38, 74], [10, 12, 30], [100, 104, 170], [180, 190, 255], 0.86, 0.05],
    [21.5, [6, 32, 41], [1, 7, 11], [40, 112, 128], [120, 230, 255], 0.78, 0],
    [24, [6, 32, 41], [1, 7, 11], [40, 112, 128], [120, 230, 255], 0.78, 0],
  ];
  const sky = { hour: -1, centre: [0, 0, 0], edge: [0, 0, 0], dot: [0, 0, 0], wake: [0, 0, 0], light: 1, shadow: 0 };
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
    const mix = (out, j) => {
      for (let k = 0; k < 3; k++) out[k] = lerp(a[j][k], b[j][k], t);
    };
    mix(sky.centre, 1);
    mix(sky.edge, 2);
    mix(sky.dot, 3);
    mix(sky.wake, 4);
    sky.light = lerp(a[5], b[5], t);
    sky.shadow = lerp(a[6], b[6], t);
    sky.hour = hour;
    // The chat box goes dark-on-light while the pond is milk-white (wallpaper.py matches this).
    setTheme(hour >= 8.5 && hour < 18 ? "light" : "dark");
  }

  const BODY_RAMP = "+*%#@";
  const EDGE_GLYPHS = ".',`";

  // ----------------------------------------------------------------- grid

  // Mirrors of the grid's size, refreshed in resize().
  let W = 0, H = 0, cw = 10, ch = 15, cols = 0, rows = 0;
  let glyph = [], color = [];
  /** Slow layers, refreshed a slice at a time and composited every frame. */
  let floorGlyph = [], floorColor = [], padGlyph = [], padColor = [];
  let frameNo = 0;
  let dotChar = [];
  let energy = new Float32Array(0), energyTmp = new Float32Array(0);

  const put = (c, r, g, st) => grid.put(c, r, g, st);

  function resize() {
    ({ W, H, cw, ch, cols, rows, glyph, color } = grid);
    const n = cols * rows;
    floorGlyph = new Array(n).fill("");
    floorColor = new Array(n).fill("");
    padGlyph = new Array(n).fill("");
    padColor = new Array(n).fill("");
    dotChar = new Array(n);
    energy = new Float32Array(n);
    energyTmp = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      dotChar[i] = Math.random() < 0.2 ? ".`',"[(Math.random() * 4) | 0] : "";
    }

    if (!koi.length) {
      for (let i = 0; i < KOI_COUNT; i++) spawnKoi(VARIETIES[i % VARIETIES.length]);
      spawnPads();
    }
    for (const k of koi) k.L = koiLength(k.scale);
  }

  function paintBackdrop(g, w, h) {
    const cx = w * 0.5, cy = h * 0.45;
    const grad = g.createRadialGradient(cx, cy, 0, cx, cy, Math.hypot(w, h) * 0.6);
    grad.addColorStop(0, `rgb(${sky.centre.map(Math.round)})`);
    grad.addColorStop(1, `rgb(${sky.edge.map(Math.round)})`);
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  }

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

  // ------------------------------------------------------------------ koi

  const VARIETIES = ["kohaku", "sanke", "showa", "ogon", "tancho", "asagi", "butterfly"];
  const NODES = 14;

  const koiLength = (scale) => clamp(Math.min(W, H) * 0.3, 150, 440) * scale;

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
      px: new Float32Array(NODES),
      py: new Float32Array(NODES),
    };
    const x = rand(W * 0.15, W * 0.85), y = rand(H * 0.15, H * 0.85);
    const seg = k.L / (NODES - 1);
    for (let i = 0; i < NODES; i++) {
      k.px[i] = x - Math.cos(k.angle) * seg * i;
      k.py[i] = y - Math.sin(k.angle) * seg * i;
    }
    k.speed = k.cruise * k.L;
    koi.push(k);
  }

  function stepKoi(k, dt) {
    const L = k.L;
    const hx = k.px[0], hy = k.py[0];
    let fx = Math.cos(k.angle), fy = Math.sin(k.angle);
    let urgency = 0;

    // Soft walls: turn back well before the edge.
    const m = L * 0.9;
    if (hx < m) fx += ((m - hx) / m) * 2.5;
    if (hx > W - m) fx -= ((hx - (W - m)) / m) * 2.5;
    if (hy < m) fy += ((m - hy) / m) * 2.5;
    if (hy > H - m) fy -= ((hy - (H - m)) / m) * 2.5;

    // Keep a little personal space (head vs. the other fish's middle).
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

    // Food first, then a resting cursor.
    let best = null, bestD = Infinity;
    for (const p of food) {
      const d = Math.hypot(p.x - hx, p.y - hy);
      if (d < bestD && d < Math.max(W, H) * 0.6) {
        best = p;
        bestD = d;
      }
    }
    if (best) {
      fx += ((best.x - hx) / bestD) * 2.2;
      fy += ((best.y - hy) / bestD) * 2.2;
      urgency = 1;
      if (bestD < L * 0.08) {
        food.splice(food.indexOf(best), 1);
        addRipple(best.x, best.y, 0.6, L * 0.6);
        addEnergy(best.x, best.y, 1);
      }
    } else if (pointer.active && performance.now() - pointer.moved > 600) {
      const dx = pointer.x - hx, dy = pointer.y - hy;
      const d = Math.hypot(dx, dy);
      if (d > L * 0.4 && d < Math.min(W, H) * 0.45) {
        fx += (dx / d) * 0.9;
        fy += (dy / d) * 0.9;
        urgency = 0.35;
      }
    }

    // Lazy wander: a slowly drifting turn bias.
    k.wanderTimer -= dt;
    if (k.wanderTimer <= 0) {
      k.wanderTarget = rand(-0.7, 0.7);
      k.wanderTimer = rand(1.5, 5);
    }
    k.wander += (k.wanderTarget - k.wander) * Math.min(1, dt * 0.8);

    const diff = wrapAngle(Math.atan2(fy, fx) - k.angle);
    const maxTurn = 1.4 + urgency;
    k.angle = wrapAngle(k.angle + (clamp(diff * 2.2, -maxTurn, maxTurn) + k.wander * (1 - urgency)) * dt);

    const target = L * (k.cruise + urgency * 0.35);
    k.speed += (target - k.speed) * Math.min(1, dt * 1.2);
    k.phase += dt * (2.2 + (k.speed / L) * 9);

    // Head leads; every node follows at a fixed spacing.
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
  // Scratch outputs of sampleKoi().
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

  const SUB = [0.25, 0.25, 0.75, 0.25, 0.25, 0.75, 0.75, 0.75];

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
          if (dx * dx + dy * dy < rad * rad) put(c, r, "#", st);
        }
      }
    }
  }

  // ------------------------------------------------------- surface layer

  const food = [];
  const ripples = [];
  const pads = [];

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
      p.y += Math.cos(t * 0.6 + p.seed) * dt * 4;
      put(Math.floor(p.x / cw), Math.floor(p.y / ch), "o", st);
    }
  }

  function spawnPads() {
    pads.length = 0;
    const base = clamp(Math.min(W, H) * 0.065, 36, 100);
    for (let tries = 0; pads.length < PAD_COUNT && tries < 400; tries++) {
      const R = base * rand(0.6, 1.3);
      const x = rand(R, W - R), y = rand(R, H - R);
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
      if (p.y < -p.R) p.y = H + p.R;
      if (p.y > H + p.R) p.y = -p.R;

      const bob = 1 + 0.03 * Math.sin(t * 0.8 + p.seed);
      const R = p.R * bob;
      const c0 = Math.floor((p.x - R) / cw), c1 = Math.floor((p.x + R) / cw);
      const r0 = Math.floor((p.y - R) / ch), r1 = Math.floor((p.y + R) / ch);
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const dx = (c + 0.5) * cw - p.x, dy = (r + 0.5) * ch - p.y;
          const d = Math.hypot(dx, dy);
          if (d > R || c < 0 || r < 0 || c >= cols || r >= rows) continue;
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

  /** Caustics drift slowly, so each frame refreshes only every third row. */
  function drawFloor(t) {
    for (let r = frameNo % 3; r < rows; r += 3) {
      const y = (r + 0.5) * ch;
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
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

  // ------------------------------------------------------------ the scene

  let padDt = 0, rainTimer = 3;

  function step(dt) {
    // Repaint the sky about once a minute (or a few times a second in cycle mode).
    const now = performance.now();
    const hour = currentHour(now);
    if (Math.abs(hour - sky.hour) > 0.02 && now - skyPainted > 250) {
      setSky(hour);
      grid.repaintBackdrop();
      skyPainted = now;
    }

    for (const k of koi) stepKoi(k, dt);
    diffuseEnergy();

    rainTimer -= dt;
    if (rainTimer <= 0) {
      const x = rand(0, W), y = rand(0, H);
      addRipple(x, y, 0.45, rand(60, 140));
      addEnergy(x, y, 0.6);
      rainTimer = rand(2, 7);
    }
  }

  function draw(t, dt) {
    frameNo++;
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
    for (let i = 0; i < glyph.length; i++) {
      if (padGlyph[i]) {
        glyph[i] = padGlyph[i];
        color[i] = padColor[i];
      }
    }
  }

  function pointerMove(x, y, moved) {
    addEnergy(x, y, Math.min(0.25, moved * 0.01));
  }

  function click(x, y) {
    addRipple(x, y, 1, 200);
    addEnergy(x, y, 1.2);
    for (let i = 0; i < 5; i++) {
      food.push({ x: x + rand(-24, 24), y: y + rand(-16, 16), life: 30, seed: rand(0, 100) });
    }
  }

  setSky(currentHour(performance.now()));

  return { resize, paintBackdrop, step, draw, pointerMove, click };
});
