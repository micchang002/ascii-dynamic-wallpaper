/**
 * Tank — a goldfish aquarium seen through the front glass.
 *
 * The fish are small 3D bodies (core/solid.js): an egg-shaped tube around a spine that
 * swings side to side, with see-through fins on top: a flowing double tail (single and
 * forked on comets and shubunkin) that trails behind every turn, a dorsal fin, and pectoral,
 * pelvic and anal fins that scull while they hover. Because they are solid, a fish that
 * turns round swings through a head-on view, big eyes and all, and when you rest the
 * cursor on the glass the nearest ones come to the front and look at you.
 *
 * Varieties: ryukin, oranda (and a red-capped tancho oranda), black telescope-eye
 * demekin, ranchu (no dorsal fin), comet and calico shubunkin.
 *
 * The tank has gravel, swaying vallisneria (some in front of the fish), a bubbling air
 * stone and rippling light from the lamp. The lamp follows the clock: off at night, when
 * a dim blue light comes on and the fish doze near the bottom.
 *
 * Click to sprinkle flakes: they float, then sink, and the fish chase them up and down.
 * The fish pick at the gravel now and then. A fast cursor startles them. The tank runs on
 * past the screen's sides; when a fish swims off one, another swims in, so `fish` stay in view.
 *
 * URL params: fish=7 (in view), hour=13.5, cycle=120.
 */
Wallpaper.scene("tank", (api) => {
  "use strict";

  const { grid, intParam, floatParam, pointer, setTheme } = api;
  const { clamp, lerp, smoothstep, rand, hash2, noise2 } = Wallpaper.math;
  const style = Wallpaper.style;
  const { Solid, Chain, dot, cross, len, norm, add, rotate, turnToward } = Wallpaper.solid;

  const FISH = clamp(intParam("fish", 7), 1, 14);
  /** Fish waiting out of sight, to swim in when one leaves. */
  const RESERVE = Math.max(2, Math.ceil(FISH / 3));
  const PIN_HOUR = floatParam("hour", NaN);
  const CYCLE = floatParam("cycle", 0);

  // -------------------------------------------------------------- palette

  /** The tank through the day: [hour, water top, water bottom, light (0 = lamp off)]. */
  const SKY = [
    [0, [22, 44, 68], [8, 22, 40], 0],
    [6.5, [22, 44, 68], [8, 22, 40], 0],
    [7.5, [110, 176, 160], [36, 92, 96], 1],
    [21.5, [110, 176, 160], [36, 92, 96], 1],
    [22.5, [22, 44, 68], [8, 22, 40], 0],
    [24, [22, 44, 68], [8, 22, 40], 0],
  ];
  const sky = { hour: -1, top: [0, 0, 0], bottom: [0, 0, 0], lamp: 1 };
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
    for (let k = 0; k < 3; k++) {
      sky.top[k] = lerp(a[1][k], b[1][k], t);
      sky.bottom[k] = lerp(a[2][k], b[2][k], t);
    }
    sky.lamp = lerp(a[3], b[3], t);
    sky.hour = hour;
    setTheme("dark");
  }

  const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  const rgb = (c) => `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`;

  // ----------------------------------------------------------------- grid

  let W = 0, H = 0, cw = 10, ch = 15, cols = 0, rows = 0;
  const solid = new Solid(grid);
  const put = (c, r, g, st) => grid.put(c, r, g, st);

  const UP = [0, -1, 0];
  const LIGHT = norm([-0.25, -0.85, 0.45]);
  const FILL = norm([0.3, 0.2, 0.93]);
  /** Rows of the waterline and the top of the gravel; the tank's depth range. */
  let surfaceRow = 0, gravelRow = 0, surfaceY = 0, gravelY = 0, D0 = -300, D1 = 60;
  let dotChar = [];
  let frameNo = 0;

  function resize() {
    ({ W, H, cw, ch, cols, rows } = grid);
    solid.resize();
    surfaceRow = Math.max(3, Math.round(rows * 0.09));
    gravelRow = rows - Math.max(4, Math.round(rows * 0.13));
    surfaceY = surfaceRow * ch;
    gravelY = gravelRow * ch;
    D0 = -Math.min(W, H) * 0.45;
    D1 = Math.min(W, H) * 0.08;
    dotChar = new Array(cols * rows);
    for (let i = 0; i < dotChar.length; i++) dotChar[i] = Math.random() < 0.12 ? ".`'"[(Math.random() * 3) | 0] : "";
    if (!fish.length) {
      for (let i = 0; i < FISH + RESERVE; i++) spawnFish(VARIETIES[i % VARIETIES.length]).away = i >= FISH;
    }
    for (const f of fish) {
      f.L = fishSize(f.scale);
      f.chain.seg = f.L / (NODES - 1);
    }
    plantSeeds = null;
  }

  function paintBackdrop(g, w, h) {
    const water = g.createLinearGradient(0, surfaceY, 0, gravelY);
    water.addColorStop(0, rgb(sky.top));
    water.addColorStop(1, rgb(sky.bottom));
    g.fillStyle = rgb(mix(sky.top, [0, 0, 0], 0.55));
    g.fillRect(0, 0, w, surfaceY);
    g.fillStyle = water;
    g.fillRect(0, surfaceY, w, gravelY - surfaceY);
    g.fillStyle = rgb(mix(sky.bottom, [0, 0, 0], 0.35));
    g.fillRect(0, gravelY, w, h - gravelY);
    // The lamp (or the night light) shining down from above the middle of the tank.
    const glow = g.createRadialGradient(w * 0.5, surfaceY, 0, w * 0.5, surfaceY, h * 0.8);
    const lamp = sky.lamp > 0.5 ? "255,250,220" : "150,190,255";
    glow.addColorStop(0, `rgba(${lamp},${0.19 + 0.1 * sky.lamp})`);
    glow.addColorStop(1, `rgba(${lamp},0)`);
    g.fillStyle = glow;
    g.fillRect(0, 0, w, h);
  }

  const waterAt = (y) => mix(sky.top, sky.bottom, clamp((y - surfaceY) / Math.max(1, gravelY - surfaceY), 0, 1));
  const fogAt = (d) => clamp((-d + D1) / (D1 - D0), 0, 1) * 0.5;

  // ----------------------------------------------------------------- fish

  const VARIETIES = ["ryukin", "oranda", "demekin", "comet", "tancho", "ranchu", "shubunkin"];
  const NODES = 10;
  const fish = [];
  let nextId = 1;

  const fishSize = (scale) => clamp(Math.min(W, H) * 0.22, 80, 260) * scale;

  /** Body shape per variety: depth (back to belly) and width, as fractions of length. */
  const BUILD = {
    ryukin: { depth: 0.4, width: 0.24, tail: 0.6, double: true, dorsal: 0.32, hump: 0.08 },
    oranda: { depth: 0.34, width: 0.24, tail: 0.58, double: true, dorsal: 0.3, wen: true },
    tancho: { depth: 0.34, width: 0.24, tail: 0.58, double: true, dorsal: 0.3, wen: true },
    demekin: { depth: 0.34, width: 0.25, tail: 0.55, double: true, dorsal: 0.28, eyes: true },
    ranchu: { depth: 0.38, width: 0.28, tail: 0.38, double: true, dorsal: 0, wen: true },
    comet: { depth: 0.26, width: 0.17, tail: 0.5, double: false, dorsal: 0.24 },
    shubunkin: { depth: 0.27, width: 0.18, tail: 0.45, double: false, dorsal: 0.24 },
  };

  const RED = [232, 70, 36], ORANGE = [244, 128, 40], WHITE = [248, 244, 234], BLACK = [30, 30, 38];
  const BRONZE = [96, 76, 56], BLUE = [130, 156, 196];

  function spawnFish(variety) {
    const scale = rand(0.8, 1.15);
    const f = {
      variety, b: BUILD[variety], id: nextId++, scale, L: fishSize(scale), seed: (Math.random() * 1e6) | 0,
      pos: [rand(W * 0.15, W * 0.85), rand(surfaceY + H * 0.15, gravelY - H * 0.15), rand(D0 * 0.7, D1 * 0.5)],
      f: [rand() > 0.5 ? 1 : -1, 0, rand(-0.3, 0.3)], l: [0, 0, 1], u: [0, -1, 0], bank: 0,
      speed: 0, cruise: rand(0.18, 0.3), phase: rand(0, 10), fin: rand(0, 10), yaw: 0, yawGoal: 0, yawTimer: 0, pitch: 0,
      state: "cruise", timer: rand(8, 20), gulp: 0, goal: null, turnLag: 0, home: null, away: false, leaving: 0,
    };
    f.f = norm(f.f);
    f.l = norm(cross(UP, f.f));
    f.u = cross(f.f, f.l);
    f.chain = new Chain(NODES, f.L / (NODES - 1));
    f.chain.place(f.pos, f.f);
    fish.push(f);
    return f;
  }

  /**
   * Keep FISH fish in view. One whose middle swims off a side is on its way out (it doesn't
   * turn back), so a waiting fish comes in from a random side to take its place. (A fish's
   * pos is its head; the body trails behind along the chain.)
   */
  function keepInView() {
    let showing = 0;
    for (const f of fish) {
      if (f.away || f.leaving) continue;
      const [sx] = screenOf(f.chain.p[NODES >> 1]);
      if (f.home == null && (sx < 0 || sx > W)) f.leaving = sx < 0 ? -1 : 1;
      else showing++;
    }
    if (showing >= FISH) return;
    const waiting = fish.filter((f) => f.away);
    if (waiting.length) enter(waiting[Math.floor(rand(0, waiting.length))]);
  }

  /** Bring a waiting fish in, head just past one side, at a random height and depth. */
  function enter(f) {
    const fromLeft = rand() < 0.5;
    const d = rand(D0 * 0.7, D1 * 0.5), s = solid.scaleAt(d);
    const sx = fromLeft ? -f.L * 0.05 : W + f.L * 0.05, sy = rand(surfaceY + H * 0.15, gravelY - H * 0.15);
    f.pos = [solid.cx + (sx - solid.cx) / s, solid.cy + (sy - solid.cy) / s, d];
    f.f = norm([fromLeft ? 1 : -1, 0, rand(-0.2, 0.2)]);
    f.l = norm(cross(UP, f.f));
    f.u = cross(f.f, f.l);
    f.bank = f.turnLag = f.yaw = 0;
    f.speed = f.L * f.cruise;
    f.state = "cruise";
    f.timer = rand(8, 20);
    f.goal = null;
    f.home = rand(W * 0.2, W * 0.8);
    f.away = false;
    f.leaving = 0;
    f.chain.place(f.pos, f.f);
  }

  /** Turn toward `want` (easing in), wander about "up", bank a little and stay upright. */
  function steer(f, want, maxTurn, wander, dt) {
    const f0 = f.f;
    const off = Math.acos(clamp(dot(f0, norm(want)), -1, 1));
    let f1 = turnToward(f0, want, Math.min(maxTurn, off * 2) * dt);
    if (wander) f1 = norm(rotate(f1, UP, wander * dt));
    const axis = cross(f0, f1);
    const yawRate = dot(axis, UP) / Math.max(dt, 1e-3);
    f.turnLag = lerp(f.turnLag, yawRate, Math.min(1, dt * 3));
    f.bank = lerp(f.bank, clamp(-yawRate * 0.4, -0.35, 0.35), Math.min(1, dt * 2));
    f.f = f1;
    let l = cross(UP, f.f);
    l = len(l) < 0.1 ? f.l : rotate(norm(l), f.f, f.bank);
    f.l = l;
    f.u = cross(f.f, f.l);
  }

  function screenOf(p) {
    solid.project(p[0], p[1], p[2]);
    return [solid.px, solid.py];
  }

  function stepFish(f, dt, t) {
    const L = f.L;
    const night = sky.lamp < 0.5;
    const [sx, sy] = screenOf(f.pos);
    let want = f.f.slice(), urgency = 0;

    // The tank runs on past the screen's sides: a fish that swims well out of sight waits
    // there (see keepInView), unless it's on its way in. The surface and the gravel are
    // real, so those still turn them.
    const out = L * 1.6;
    if ((sx < -out || sx > W + out) && f.home == null) {
      f.away = true;
      return;
    }
    if (f.leaving) want[0] += f.leaving * 3;
    if (f.home != null) {
      want[0] += Math.sign(f.home - f.pos[0]) * 3;
      // In once its middle is (see keepInView).
      const [mx] = screenOf(f.chain.p[NODES >> 1]);
      if (mx > 0 && mx < W) f.home = null;
    }
    const top = surfaceY + L * (night ? 1.2 : 0.45), bottom = gravelY - L * 0.35;
    if (sy < top) want[1] += clamp((top - sy) / L, 0, 2) * 2;
    if (sy > bottom) want[1] -= clamp((sy - bottom) / L, 0, 2) * 2;
    if (f.pos[2] < D0) want[2] += ((D0 - f.pos[2]) / L) * 2;
    if (f.pos[2] > D1) want[2] -= ((f.pos[2] - D1) / L) * 2;

    for (const o of fish) {
      if (o === f || o.away) continue;
      const dx = f.pos[0] - o.pos[0], dy = f.pos[1] - o.pos[1], dd = f.pos[2] - o.pos[2];
      const d = Math.hypot(dx, dy, dd), r = (L + o.L) * 0.5;
      if (d > 0 && d < r) want = add(want, [dx / d, dy / d, dd / d], ((r - d) / r) * 1.2);
    }

    // Startled by a fast cursor.
    const now = performance.now();
    if (pointer.active && now - pointer.moved < 200 && Math.hypot(pointer.x - sx, pointer.y - sy) < L * 1.5) {
      f.state = "dart";
      f.timer = 0.8;
      const dx = sx - pointer.x, dy = sy - pointer.y, d = Math.hypot(dx, dy) || 1;
      f.goal = [f.pos[0] + (dx / d) * L * 3, f.pos[1] + (dy / d) * L * 2, f.pos[2] - L];
    }

    // Food: the nearest flake, anywhere in the tank.
    let best = null, bestD = Infinity;
    if (!night || flakes.length) {
      for (const p of flakes) {
        const d = Math.hypot(p.x - f.pos[0], p.y - f.pos[1], (p.d - f.pos[2]) * 0.5);
        if (d < bestD) {
          best = p;
          bestD = d;
        }
      }
    }

    f.timer -= dt;
    if (f.state === "dart") {
      urgency = 1;
      if (f.timer <= 0) f.state = "cruise";
    } else if (best) {
      f.state = "feed";
      const v = norm([best.x - f.pos[0], best.y - f.pos[1], best.d - f.pos[2]]);
      want = add(want, v, 3);
      urgency = 0.8;
      // Floating flakes are sucked down from just beneath the surface.
      if (bestD < L * (best.float > 0 ? 0.55 : 0.3)) {
        flakes.splice(flakes.indexOf(best), 1);
        f.gulp = 0.5;
        if (best.y < surfaceY + 8) addRipple(best.x);
      }
    } else if (f.state === "feed") {
      f.state = "cruise";
    }

    // A resting cursor: come to the front glass and look out.
    const resting = pointer.active && now - pointer.moved > 900;
    if (!best && f.state !== "dart" && resting && !night) {
      const s = solid.scaleAt(D1);
      const gx = solid.cx + (pointer.x - solid.cx) / s, gy = solid.cy + (pointer.y - solid.cy) / s;
      const d = Math.hypot(gx - f.pos[0], gy - f.pos[1]);
      if (d < Math.min(W, H) * 0.6) {
        const goal = [gx + (f.seed % 2 ? 1 : -1) * L * 0.6 * (f.seed % 3), gy + ((f.seed >> 2) % 3 - 1) * L * 0.5, D1];
        const v = [goal[0] - f.pos[0], goal[1] - f.pos[1], goal[2] - f.pos[2]];
        const dl = Math.hypot(v[0], v[1], v[2]);
        if (dl > L * 0.4) want = add(want, norm(v), 1.6);
        else want = [0, 0, 1];
        urgency = Math.max(urgency, 0.3);
      }
    }

    // Now and then, nose down into the gravel.
    if (f.state === "cruise" && f.timer <= 0) {
      if (rand() < 0.45) {
        f.state = "forage";
        f.goal = [f.pos[0] + rand(-L, L) * 2, gravelY - L * 0.15, f.pos[2]];
        f.timer = rand(5, 9);
      } else f.timer = rand(6, 15);
    }
    if (f.state === "forage") {
      const v = [f.goal[0] - f.pos[0], f.goal[1] - f.pos[1], f.goal[2] - f.pos[2]];
      const d = Math.hypot(v[0], v[1], v[2]);
      if (d > L * 0.3) want = add(want, norm(v), 2);
      else {
        want = [f.f[0], 1.4, f.f[2]];
        if (rand() < dt * 3) gravelPuff(f);
      }
      if (f.timer <= 0) {
        f.state = "cruise";
        f.timer = rand(8, 18);
      }
    }
    if (f.state === "dart" && f.goal) want = add(want, norm([f.goal[0] - f.pos[0], f.goal[1] - f.pos[1], f.goal[2] - f.pos[2]]), 3);

    // Sleepy at night: stay low and drift.
    if (night && f.state === "cruise") want[1] += 0.4;

    f.yawTimer -= dt;
    if (f.yawTimer <= 0) {
      f.yawGoal = rand(-0.6, 0.6);
      f.pitch = rand(-0.15, 0.15);
      f.yawTimer = rand(2, 5);
    }
    f.yaw += (f.yawGoal - f.yaw) * Math.min(1, dt);
    want = norm(want);
    // Level, except when foraging (head down) or chasing food.
    // Steeper when chasing food or foraging, but only a gentle tilt up at the surface.
    const nearTop = sy < surfaceY + L * 0.8;
    const climb = dot(want, UP), cap = f.state === "forage" || f.state === "feed" ? (nearTop && climb > 0 ? 0.45 : 0.8) : 0.3;
    want = add(want, UP, clamp(climb + f.pitch * 0.3, -cap, cap) - climb);
    steer(f, want, 1.2 + urgency * 1.5, f.yaw * (1 - urgency) * 0.6, dt);

    const target = L * (night ? f.cruise * (2 / 3) : f.cruise + urgency * 0.6 + (f.state === "forage" ? -0.1 : 0));
    f.speed += (target - f.speed) * Math.min(1, dt * 1.5);
    f.phase += dt * (2 + (f.speed / L) * 10);
    f.fin += dt * (night ? 1.5 : 4);
    f.gulp = Math.max(0, f.gulp - dt);
    f.pos = add(f.pos, f.f, f.speed * dt);
    f.chain.follow(f.pos);
    keepUnder(f);
  }

  /** How far above the spine the fish reaches at s (body, dorsal fin, tail), in lengths. */
  function reach(f, s) {
    const dorsal = s > 0.28 && s < 0.72 ? f.b.dorsal * Math.pow(Math.sin((Math.PI * (s - 0.28)) / 0.44), 0.7) : 0;
    return bodyR(f, s)[0] + dorsal + (f.b.wen && s < 0.3 ? 0.07 : 0) + (s > 0.9 ? f.b.tail * 0.25 : 0);
  }

  /**
   * Nothing breaks the surface. The head stays low enough for the fish to fit beneath it
   * tilted nose-up (about 33°), as a goldfish gulping at the top does; the rest follows.
   */
  function keepUnder(f) {
    const k = solid.scaleAt(f.pos[2]);
    const lid = solid.cy + (surfaceY + ch * 1.2 - solid.cy) / k;
    const p = f.chain.p;
    let head = 0;
    for (let i = 0; i < NODES; i++) head = Math.max(head, reach(f, i / (NODES - 1)) - (i / (NODES - 1)) * 0.55);
    p[0][1] = Math.max(p[0][1], lid + head * f.L);
    for (let i = 1; i < NODES; i++) {
      const y = lid + reach(f, i / (NODES - 1)) * f.L;
      if (p[i][1] < y) p[i][1] = y;
    }
    f.pos = p[0].slice();
  }

  // ---------------------------------------------------------------- shading

  const tmp = [0, 0, 0];

  function shade(base, light, d, y, out) {
    const night = 1 - sky.lamp;
    const lamp = lerp(0.72, 1, sky.lamp);
    // A cool rim fill keeps dark varieties legible against the water at night.
    const k = (0.48 + 0.78 * light) * lamp;
    const f = fogAt(d), w = waterAt(y);
    const blue = night * 0.22;
    const rim = night * (0.12 + 0.28 * light);
    out[0] = lerp(lerp(base[0] * k, 76, blue) + 42 * rim, w[0], f);
    out[1] = lerp(lerp(base[1] * k, 112, blue) + 64 * rim, w[1], f);
    out[2] = lerp(lerp(base[2] * k, 178, blue) + 82 * rim, w[2], f);
    return out;
  }

  const lightOf = (nx, ny, nd) =>
    clamp(0.15 + 0.7 * Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nd * LIGHT[2]) + 0.35 * Math.max(0, nx * FILL[0] + ny * FILL[1] + nd * FILL[2]), 0, 1);

  /** Skin colour at s (nose → tail root), v (belly -1 … back 1), side (±1). */
  function skin(f, s, v, side) {
    const n = noise2(s * 5 + 3, v * 2 + side * 3, f.seed % 1000);
    switch (f.variety) {
      case "ryukin":
        return n > 0.56 || v < -0.55 ? WHITE : RED;
      case "oranda":
        return v < -0.6 ? mix(ORANGE, WHITE, 0.5) : ORANGE;
      case "tancho":
        return WHITE;
      case "demekin":
        return v < -0.5 ? mix(BLACK, BRONZE, 0.6) : BLACK;
      case "ranchu":
        return v < -0.6 ? mix(ORANGE, WHITE, 0.6) : n > 0.62 ? WHITE : mix(RED, ORANGE, 0.5);
      case "comet":
        return n > 0.5 ? WHITE : RED;
      case "shubunkin": {
        if (noise2(s * 14, v * 5 + side * 7, f.seed % 997) > 0.7) return BLACK;
        if (n > 0.6) return [228, 110, 56];
        return v < -0.5 ? WHITE : BLUE;
      }
    }
    return ORANGE;
  }

  function finColour(f, u) {
    switch (f.variety) {
      case "demekin":
        return [40, 40, 50];
      case "tancho":
      case "comet":
        return u < 0.3 ? mix(WHITE, RED, 0.3) : WHITE;
      case "shubunkin":
        return u < 0.4 ? [200, 120, 80] : [190, 200, 220];
      case "ryukin":
        return u < 0.4 ? RED : [250, 210, 190];
    }
    return u < 0.5 ? ORANGE : [255, 200, 150];
  }

  /** Half depth / half width of the body at s, in body lengths: a short, round egg. */
  function bodyR(f, s) {
    const head = Math.pow(Math.sin(Math.PI * 0.5 * clamp(s / 0.32, 0, 1)), 0.6);
    const tail = s < 0.45 ? 1 : Math.pow(1 - (s - 0.45) / 0.55, 1.2) * 0.85 + 0.15;
    const k = Math.min(head, tail) * (s > 0.97 ? 0.8 : 1);
    return [f.b.depth * 0.5 * k + (f.b.hump || 0) * Math.sin(Math.PI * clamp((s - 0.2) / 0.5, 0, 1)) * 0.5, f.b.width * 0.5 * k];
  }

  const fr = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];

  function drawFish(f, t) {
    const L = f.L, chain = f.chain;
    chain.frames(UP, f.bank);
    const s0 = solid.scaleAt(f.pos[2]);
    const step = (cw * 0.42) / s0 / L;
    const swing = (s) => Math.sin(f.phase - s * 4) * 0.07 * (0.08 + s * s);
    const centre = (s) => {
      chain.at(s, fr);
      const off = swing(s) * L;
      return [fr[0][0] + fr[2][0] * off, fr[0][1] + fr[2][1] * off, fr[0][2] + fr[2][2] * off];
    };

    // Body.
    for (let s = 0; s <= 1; s += step) {
      const c = centre(s);
      const [, , l, u] = fr;
      let [rn, rl] = bodyR(f, s);
      rn *= L;
      rl *= L;
      const steps = Math.max(10, Math.ceil((Math.PI * 2 * Math.max(rn, rl)) / (step * L)));
      for (let k = 0; k < steps; k++) {
        const th = (k / steps) * Math.PI * 2, co = Math.cos(th), sn = Math.sin(th);
        // A wen: a bumpy hood over the head and cheeks.
        let bump = 0;
        if (f.b.wen && s < 0.3 && sn > -0.2) bump = (0.04 + 0.03 * noise2(s * 30, th * 4, f.seed % 777)) * L * smoothstep(0.3, 0.12, s) * (sn + 0.2);
        const rN = rn + bump, rL = rl + bump * 0.6;
        let nx = l[0] * co * rN + u[0] * sn * rL, ny = l[1] * co * rN + u[1] * sn * rL, nd = l[2] * co * rN + u[2] * sn * rL;
        const nl = Math.hypot(nx, ny, nd) || 1;
        nx /= nl; ny /= nl; nd /= nl;
        if (nd < -0.3) continue;
        const x = c[0] + l[0] * co * rL + u[0] * sn * rN;
        const y = c[1] + l[1] * co * rL + u[1] * sn * rN;
        const d = c[2] + l[2] * co * rL + u[2] * sn * rN;
        let light = lightOf(nx, ny, nd);
        // Metallic scales glint where they catch the lamp.
        const glint = Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nd * LIGHT[2]) > 0.9 && hash2(Math.round(s * 40), Math.round(th * 9), f.seed) > 0.5;
        let base = bump > 0.02 * L ? (f.variety === "oranda" || f.variety === "tancho" ? RED : f.variety === "ranchu" ? [236, 90, 30] : skin(f, s, sn, Math.sign(co))) : skin(f, s, sn, Math.sign(co));
        if (glint) {
          base = mix(base, [255, 255, 255], 0.5);
          light = 1;
        }
        const col = shade(base, light, d, y, tmp);
        solid.splat(x, y, d, f.id, light, col[0], col[1], col[2], 1);
      }
    }

    // Eyes (bulging on a demekin), and a mouth that gulps.
    chain.at(0.13, fr);
    {
      const c = centre(0.13);
      const [, , l, u] = fr;
      const [rn, rl] = bodyR(f, 0.13);
      for (const sd of [-1, 1]) {
        const out = f.b.eyes ? 1.5 : 0.92;
        const e = add(add(c, l, sd * rl * L * out), u, rn * L * 0.25);
        if (f.b.eyes) {
          for (const [ox, oy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const col = shade([50, 50, 60], 0.6, e[2], e[1], tmp);
            solid.splat(e[0] + ox * cw * 0.6, e[1] + oy * ch * 0.5, e[2] + 1, f.id, 0.6, col[0], col[1], col[2], 1);
          }
        }
        solid.splat(e[0], e[1], e[2] + 4, f.id, 0, 12, 12, 16, 1, f.b.eyes ? "@" : "o");
      }
      const m = centre(0);
      const open = f.gulp > 0 || Math.sin(t * 2.2 + f.seed) > 0.6;
      solid.splat(m[0], m[1], m[2] + 2, f.id, 0, 255, 170, 160, 1, open ? "o" : ".");
    }

    // Fins: see-through sheets, rays fading toward the tips (as on the koi).
    const finSample = (x, y, d, u, a) => {
      const base = finColour(f, u);
      const col = shade(base, 0.85, d + (D1 - d) * 0.4, y, tmp);
      solid.splat(x, y, d, f.id, 0.5, col[0], col[1], col[2], a * (1 - 0.4 * u), u > 0.7 ? "~" : u > 0.35 ? "=" : "%");
    };

    // Tail: one forked sheet, or two splayed sheets, flowing behind turns and drooping.
    chain.at(1, fr);
    const root = centre(1);
    const [, t1, l1, u1] = fr;
    const back = [-t1[0], -t1[1], -t1[2]];
    const TL = f.b.tail * L;
    const lobes = f.b.double ? [-0.55, 0.55] : [0];
    for (const tilt of lobes) {
      const vax = rotate(u1, back, tilt);
      for (let v = -1; v <= 1; v += step * L / (TL * 0.6)) {
        const av = Math.abs(v);
        // Forked comets; fancy tails are fuller, with a soft notch in the middle.
        const reach = f.b.double ? 1 - 0.3 * Math.pow(1 - av, 2) - 0.25 * av ** 6 : 1 - 0.7 * Math.pow(1 - av, 1.5);
        for (let a = 0; a <= reach; a += step / f.b.tail) {
          const h = TL * (0.08 + 0.42 * Math.pow(a, 0.75));
          const flow = Math.sin(f.phase - 4 - a * 3) * a * 0.25 * TL - f.turnLag * a * a * 0.5 * TL;
          const droop = a * a * TL * (f.b.double ? 0.22 : 0.05);
          const x = root[0] + back[0] * a * TL + vax[0] * v * h + l1[0] * flow + UP[0] * -droop;
          const y = root[1] + back[1] * a * TL + vax[1] * v * h + l1[1] * flow + UP[1] * -droop;
          const d = root[2] + back[2] * a * TL + vax[2] * v * h + l1[2] * flow + UP[2] * -droop;
          finSample(x, y, d, a / reach, 0.95);
        }
      }
    }

    // Dorsal fin along the back.
    if (f.b.dorsal) {
      for (let s = 0.28; s <= 0.72; s += step) {
        const c = centre(s);
        const [, tt, l, u] = fr;
        const [rn] = bodyR(f, s);
        const hgt = f.b.dorsal * L * Math.pow(Math.sin((Math.PI * (s - 0.28)) / 0.44), 0.7) * (0.85 + 0.15 * Math.sin(f.fin * 0.5));
        for (let k = 0; k <= 1; k += (step * L) / Math.max(hgt, 1)) {
          const sway = Math.sin(f.fin * 0.7 - s * 6 - k * 2) * k * 0.06 * L;
          const bx = c[0] + u[0] * (rn * L * 0.95 + k * hgt) - tt[0] * k * hgt * 0.45 + l[0] * sway;
          const by = c[1] + u[1] * (rn * L * 0.95 + k * hgt) - tt[1] * k * hgt * 0.45 + l[1] * sway;
          const bd = c[2] + u[2] * (rn * L * 0.95 + k * hgt) - tt[2] * k * hgt * 0.45 + l[2] * sway;
          finSample(bx, by, bd, k, 0.85);
        }
      }
    }

    // Paired and anal fins: small fans that scull.
    const fan = (s, out, down, back2, length, width, flap, sides) => {
      const c = centre(s);
      const [, tt, l, u] = fr;
      const [rn, rl] = bodyR(f, s);
      for (const sd of sides) {
        const root2 = add(add(c, l, sd * rl * L * out), u, -rn * L * down);
        let dir = norm(add(add(scale3(tt, -back2), l, sd * 0.45), u, -0.5));
        dir = rotate(dir, tt, sd * flap * Math.sin(f.fin * 1.6 + sd));
        const across = norm(cross(dir, l));
        for (let a = 0; a <= 1; a += step / length) {
          const wdt = width * Math.sin(Math.PI * Math.min(1, a * 1.2 + 0.1)) * L;
          for (let w = -0.5; w <= 0.5; w += (step * L) / Math.max(wdt, 1)) {
            const q = add(add(root2, dir, a * length * L), across, w * wdt);
            finSample(q[0], q[1], q[2], a, 0.8);
          }
        }
      }
    };
    fan(0.32, 0.85, 0.35, 0.8, 0.16, 0.09, 0.5, [-1, 1]);
    fan(0.5, 0.35, 0.92, 0.6, 0.12, 0.07, 0.25, [-1, 1]);
    fan(0.78, f.b.double ? 0.2 : 0, 0.85, 0.7, 0.12, 0.07, 0.15, f.b.double ? [-1, 1] : [0]);
  }

  const scale3 = (v, k) => [v[0] * k, v[1] * k, v[2] * k];

  // ------------------------------------------------- flakes, bubbles, gravel

  const flakes = [];
  const bubbles = [];
  const puffs = [];
  const ripples = [];
  let stone = { x: 0 };

  function sprinkle(x) {
    for (let i = 0; i < 9; i++) {
      flakes.push({ x: x + rand(-50, 50), y: surfaceY + rand(0, 6), d: rand(D0 * 0.4, D1 * 0.6), float: rand(1.5, 5), vy: rand(10, 22), seed: rand(0, 100), c: [[240, 170, 60], [220, 90, 60], [190, 200, 90]][i % 3], life: 60 });
    }
    addRipple(x);
  }

  function stepFlakes(dt, t) {
    for (let i = flakes.length - 1; i >= 0; i--) {
      const p = flakes[i];
      if ((p.life -= dt) <= 0) {
        flakes.splice(i, 1);
        continue;
      }
      if ((p.float -= dt) > 0) {
        p.x += Math.sin(t * 0.8 + p.seed) * dt * 6;
        continue;
      }
      if (p.y < gravelY - 4) {
        p.y += p.vy * dt;
        p.x += Math.sin(t * 2 + p.seed) * dt * 14;
      }
    }
  }

  function drawFlakes() {
    for (const p of flakes) {
      solid.project(p.x, p.y, p.d);
      put(Math.floor(solid.px / cw), Math.max(surfaceRow + 1, Math.floor(solid.py / ch)), p.y < gravelY - 6 ? "*" : ".", style(p.c[0], p.c[1], p.c[2], clamp(p.life / 5, 0, 1)));
    }
  }

  function stepBubbles(dt, t) {
    if (rand() < dt * 6) bubbles.push({ x: stone.x + rand(-4, 4), y: gravelY - ch, r: rand(0.3, 0.6), ph: rand(0, 6) });
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i];
      b.y -= (70 + b.r * 60) * dt;
      b.x += Math.sin(t * 4 + b.ph) * dt * 18;
      b.r = Math.min(1, b.r + dt * 0.08);
      if (b.y <= surfaceY + ch) {
        bubbles.splice(i, 1);
        addRipple(b.x, 0.4);
      }
    }
  }

  function drawBubbles() {
    const c3 = mix([220, 240, 255], [150, 170, 220], 1 - sky.lamp);
    for (const b of bubbles) put(Math.floor(b.x / cw), Math.floor(b.y / ch), b.r > 0.8 ? "O" : b.r > 0.5 ? "o" : "°", style(c3[0], c3[1], c3[2], 0.75));
  }

  function gravelPuff(f) {
    const [x, y] = screenOf(f.pos);
    for (let i = 0; i < 4; i++) puffs.push({ x: x + rand(-10, 10), y: Math.min(y, gravelY), vx: rand(-25, 25), vy: rand(-40, -15), life: rand(0.5, 1) });
  }

  function drawPuffs(dt) {
    for (let i = puffs.length - 1; i >= 0; i--) {
      const p = puffs[i];
      if ((p.life -= dt) <= 0) {
        puffs.splice(i, 1);
        continue;
      }
      p.vy += 60 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      put(Math.floor(p.x / cw), Math.floor(p.y / ch), ".", style(200, 190, 160, p.life));
    }
  }

  function addRipple(x, strength = 1) {
    ripples.push({ x, r: 0, s: strength });
  }

  /** The waterline seen from just below: a bright wavy band, rippled by gulps and bubbles. */
  function drawSurface(t, dt) {
    for (let i = ripples.length - 1; i >= 0; i--) {
      if ((ripples[i].r += dt * 120) > 260) ripples.splice(i, 1);
    }
    const c3 = mix([140, 170, 220], [235, 250, 245], sky.lamp);
    for (let c = 0; c < cols; c++) {
      const x = (c + 0.5) * cw;
      let h = Math.sin(x * 0.035 + t * 1.1) * 0.5 + Math.sin(x * 0.013 - t * 0.6) * 0.5;
      for (const rp of ripples) {
        const dd = Math.abs(Math.abs(x - rp.x) - rp.r);
        if (dd < 14) h += (1 - dd / 14) * rp.s * (1 - rp.r / 260) * 2;
      }
      put(c, surfaceRow, h > 0.7 ? "^" : h < -0.5 ? "_" : "~", style(c3[0], c3[1], c3[2], 0.8));
      if (h > 0.3) put(c, surfaceRow + 1, "~", style(c3[0], c3[1], c3[2], 0.2));
    }
  }

  /** Lamp light rippling through the water: drifting dots, brightest just under the surface. */
  function drawCaustics(t) {
    for (let r = surfaceRow + 2 + (frameNo % 2); r < gravelRow; r += 2) {
      const y = (r + 0.5) * ch, depth = (y - surfaceY) / Math.max(1, gravelY - surfaceY);
      for (let c = 0; c < cols; c++) {
        const g = dotChar[r * cols + c];
        if (!g) continue;
        const x = (c + 0.5) * cw;
        const k = Math.max(0, Math.sin(x * 0.02 + t * 0.6 + Math.sin(y * 0.02 - t * 0.4) * 2) * Math.sin(y * 0.025 - t * 0.5 + Math.sin(x * 0.012 + t * 0.3) * 2));
        const a = (0.05 + k * k * 0.35) * (1 - depth * 0.6) * lerp(0.4, 1, sky.lamp);
        if (a > 0.06) put(c, r, g, style(230, 250, 240, a));
      }
    }
  }

  const PEBBLES = [[220, 210, 190], [180, 140, 100], [130, 110, 90], [230, 120, 90], [120, 150, 190], [240, 240, 236], [90, 80, 74]];

  function drawGravel(t) {
    const lamp = lerp(0.45, 1, sky.lamp);
    for (let r = gravelRow; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const n = hash2(c, r, 13);
        const edge = r === gravelRow;
        if (edge && Math.sin(c * 0.21) + hash2(c, 1, 3) * 0.8 < -0.4) continue;
        const p = PEBBLES[Math.floor(hash2(c, r, 29) * PEBBLES.length)];
        const g = n > 0.85 ? "o" : n > 0.55 ? "." : n > 0.3 ? ":" : n > 0.15 ? "," : " ";
        if (g === " ") continue;
        const x = (c + 0.5) * cw, y = (r + 0.5) * ch;
        const k = Math.max(0, Math.sin(x * 0.03 + t * 0.7) * Math.sin(y * 0.05 - t * 0.5 + x * 0.01));
        const lit = lamp * (0.6 + 0.5 * k * k) * (1 - (r - gravelRow) / (rows - gravelRow) * 0.4);
        put(c, r, g, style(p[0] * lit, p[1] * lit, p[2] * lit, 0.6));
      }
    }
    // The air stone.
    put(Math.floor(stone.x / cw), gravelRow - 1, "@", style(150, 150, 160, 1));
  }

  // ---------------------------------------------------------------- plants

  let plantSeeds = null;

  /** Vallisneria: long ribbons rooted in the gravel, swaying. A few stand in front of the fish. */
  function drawPlants(t, front) {
    if (!plantSeeds) {
      plantSeeds = [];
      const n = Math.max(6, Math.round(cols / 9));
      for (let i = 0; i < n; i++) {
        const clump = hash2(i, 1, 55) < 0.5 ? 0.12 + hash2(i, 2, 55) * 0.2 : 0.7 + hash2(i, 2, 55) * 0.25;
        plantSeeds.push({
          c: Math.round(clump * cols + (hash2(i, 3, 55) - 0.5) * 10),
          len: Math.round((0.35 + hash2(i, 4, 55) * 0.5) * (gravelRow - surfaceRow)),
          front: hash2(i, 5, 55) < 0.25, ph: hash2(i, 6, 55) * 6,
        });
      }
      stone.x = Math.round(cols * 0.82) * cw;
    }
    const lamp = lerp(0.4, 1, sky.lamp);
    for (const p of plantSeeds) {
      if (p.front !== front) continue;
      const leaf = front ? [70, 170, 70] : [90, 180, 100];
      for (let j = 0; j < p.len; j++) {
        const k = j / p.len;
        const sway = Math.sin(t * 0.7 + p.ph - j * 0.15) * k * k * 6 + Math.sin(t * 0.3 + p.ph) * k * 2;
        const c = Math.round(p.c + sway), r = gravelRow - 1 - j;
        const lean = Math.cos(t * 0.7 + p.ph - j * 0.15) * k;
        const g = Math.abs(lean) < 0.25 ? "|" : lean > 0 ? "\\" : "/";
        const shadeK = lamp * (0.6 + 0.4 * k) * (front ? 0.75 : 0.9);
        put(c, r, g, style(leaf[0] * shadeK, leaf[1] * shadeK, leaf[2] * shadeK, front ? 0.95 : 0.8));
        if (front && j % 2 === 0) put(c + 1, r, g, style(leaf[0] * shadeK * 0.8, leaf[1] * shadeK * 0.8, leaf[2] * shadeK * 0.8, 0.9));
      }
    }
  }

  // ------------------------------------------------------------ the scene

  function step(dt, t) {
    const now = performance.now();
    const hour = currentHour(now);
    if (Math.abs(hour - sky.hour) > 0.02 && now - skyPainted > 250) {
      setSky(hour);
      grid.repaintBackdrop();
      skyPainted = now;
    }
    keepInView();
    for (const f of fish) if (!f.away) stepFish(f, dt, t);
    stepFlakes(dt, t);
    stepBubbles(dt, t);
  }

  function draw(t, dt) {
    frameNo++;
    drawCaustics(t);
    drawPlants(t, false);
    drawBubbles();
    drawFlakes();
    drawGravel(t);
    drawPuffs(dt);

    solid.begin();
    for (const f of fish) if (!f.away) drawFish(f, t);
    solid.resolve();

    drawPlants(t, true);
    drawSurface(t, dt);
  }

  function click(x, y) {
    sprinkle(x);
  }

  setSky(currentHour(performance.now()));

  return { resize, paintBackdrop, step, draw, click, chat: false };
});
