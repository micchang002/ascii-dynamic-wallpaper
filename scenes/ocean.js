/**
 * Ocean — manta rays and humpback whales, seen from above or from the side.
 *
 * Every animal is a small 3D body (core/solid.js) swimming in screen space, so one
 * simulation can be drawn two ways:
 *   top   a sunlit lagoon from above: sand ripples and caustics on the floor, shadows that
 *         drift with depth, and at night the plankton glows wherever something moves;
 *   side  the open water from a little below, filling the screen (the surface and seabed
 *         lie just past its edges): light shafts, marine snow and kelp, the white bellies
 *         of the mantas overhead.
 * Mantas are a flapping disc (a wave runs out along each wing) that banks into turns and
 * somersaults when it feeds; whales are a tube around a spine that beats up and down, with
 * long white pectoral fins and a fluke that pitches with the stroke. Whales come up to
 * blow now and then. A school of small fish keeps clear of everything bigger. The sea runs
 * on past the screen's edges; when a manta or whale swims off one, another swims in, so the
 * numbers in view stay the same (the school stays on screen).
 *
 * Across monitors: with ?pxmm= the animals keep the same size on each, and ?eye= gives them one
 * perspective (see core/app.js). Monitors with the same view and species share one sea: a manta
 * or whale (a mother with her calf at her side) that swims into a door carries on in the next
 * (core/crossing.js), any side from above, left and right from the side. The host keeps count
 * of each kind, so on an edge with no door they swim off and in only when the group is short
 * or over.
 *
 * Click to release a plankton bloom: the mantas come and loop through it. Mantas drift
 * toward a resting cursor; the school scatters from a moving one.
 *
 * Switch with the scene menu, keys V (view) and S (species), the HUD (H or hud=1 shows
 * it, top left), or URL params:
 * view=top|side, species=mix|manta|whale, mantas=3, whales=1, fish=60, hud=1,
 * hour=13.5, cycle=120.
 */
Wallpaper.scene("ocean", (api) => {
  "use strict";

  const { grid, params, intParam, floatParam, pointer, setTheme, pxmm, eye, links } = api;
  const { clamp, lerp, smoothstep, rand, hash2, noise2 } = Wallpaper.math;
  const style = Wallpaper.style;
  const { Solid, Chain, dot, cross, len, norm, add, rotate, turnToward } = Wallpaper.solid;

  const VIEWS = ["top", "side"];
  const SPECIES = ["mix", "manta", "whale"];
  let view = VIEWS.includes(params.get("view")) ? params.get("view") : "top";
  let species = SPECIES.includes(params.get("species")) ? params.get("species") : "mix";
  const MANTAS = clamp(intParam("mantas", 3), 0, 8);
  const WHALES = clamp(intParam("whales", 1), 0, 3);
  const FISH = clamp(intParam("fish", 60), 0, 200);
  const PIN_HOUR = floatParam("hour", NaN);
  const CYCLE = floatParam("cycle", 0);
  let hudVisible = params.get("hud") === "1";

  // -------------------------------------------------------------- palette

  /**
   * The water through the day: [hour, shallow, deep, floor dots, glow (wakes, plankton),
   * light on the animals].
   */
  const SKY = [
    [0, [20, 58, 82], [6, 22, 40], [58, 126, 148], [100, 250, 224], 1],
    [5, [20, 58, 82], [6, 22, 40], [58, 126, 148], [100, 250, 224], 1],
    [6.5, [70, 84, 130], [14, 24, 56], [190, 150, 190], [200, 220, 255], 0.8],
    [8, [76, 186, 200], [14, 92, 132], [210, 250, 245], [235, 255, 255], 1],
    [16, [76, 186, 200], [14, 92, 132], [210, 250, 245], [235, 255, 255], 1],
    [18.3, [130, 120, 140], [20, 46, 84], [255, 200, 160], [255, 230, 200], 0.85],
    [20, [16, 46, 80], [3, 12, 28], [60, 110, 150], [120, 230, 230], 0.9],
    [21.5, [20, 58, 82], [6, 22, 40], [58, 126, 148], [100, 250, 224], 1],
    [24, [20, 58, 82], [6, 22, 40], [58, 126, 148], [100, 250, 224], 1],
  ];
  const sky = { hour: -1, shallow: [0, 0, 0], deep: [0, 0, 0], dot: [0, 0, 0], glow: [0, 0, 0], light: 1, day: 1 };
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
    mixInto(sky.shallow, 1);
    mixInto(sky.deep, 2);
    mixInto(sky.dot, 3);
    mixInto(sky.glow, 4);
    sky.light = lerp(a[5], b[5], t);
    sky.day = clamp((0.3 * sky.shallow[0] + 0.59 * sky.shallow[1] + 0.11 * sky.shallow[2] - 40) / 110, 0, 1);
    sky.hour = hour;
    setTheme(hour >= 8.5 && hour < 18 ? "light" : "dark");
  }

  const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  const rgb = (c) => `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`;

  // ----------------------------------------------------------------- grid

  let W = 0, H = 0, cw = 10, ch = 15, cols = 0, rows = 0;
  let glyph = [], color = [];
  const solid = new Solid(grid, eye);
  const put = (c, r, g, st) => grid.put(c, r, g, st);

  /** Side view: the waterline row and the seabed row, just off the screen. */
  let surfaceRow = 0, bedRow = 0, surfaceY = 0, bedY = 0;
  /** "Up" for the animals, in screen space: out of the screen from above, up the screen
   * (tilted, as if looking up from a little below) from the side. */
  let UP = [0, 0, 1];
  /** Toward the light (for shading), and the depth range animals swim in. */
  let LIGHT = norm([-0.35, -0.45, 0.82]);
  /** Side view: light scattered back up by the water, so bellies seen from below aren't black. */
  let FILL = [0, 0, 0];
  let D0 = -400, D1 = -20;

  let dotChar = [];
  let floorGlyph = [], floorColor = [];
  let energy = new Float32Array(0), energyTmp = new Float32Array(0);
  let frameNo = 0;

  function resize() {
    ({ W, H, cw, ch, cols, rows, glyph, color } = grid);
    solid.resize();
    const n = cols * rows;
    floorGlyph = new Array(n).fill("");
    floorColor = new Array(n).fill("");
    dotChar = new Array(n);
    energy = new Float32Array(n);
    energyTmp = new Float32Array(n);
    for (let i = 0; i < n; i++) dotChar[i] = Math.random() < 0.22 ? ".`',"[(Math.random() * 4) | 0] : "";
    setView(view, true);
  }

  function setView(name, force) {
    if (name === view && !force) return;
    view = name;
    surfaceRow = -1;
    bedRow = rows;
    surfaceY = surfaceRow * ch;
    bedY = bedRow * ch;
    if (view === "top") {
      UP = [0, 0, 1];
      LIGHT = norm([-0.35, -0.45, 0.82]);
      FILL = [0, 0, 0];
      // In mm when known, so the depth looks the same on every monitor.
      const deep = pxmm ? DEEP_MM * pxmm : Math.min(W, H);
      D0 = -deep * 0.45;
      D1 = -deep * 0.03;
    } else {
      UP = norm([0, -1, -0.36]);
      LIGHT = norm([-0.2, -0.85, 0.5]);
      FILL = norm([0.2, 0.6, 0.8]);
      const far = pxmm ? FAR_MM * pxmm : W;
      D0 = -far * 0.7;
      D1 = far * 0.1;
    }
    spawnAll();
    api.links.rekey();
    grid.repaintBackdrop();
  }

  function paintBackdrop(g, w, h) {
    if (view === "top") {
      const cx = w * 0.5, cy = h * 0.45;
      const grad = g.createRadialGradient(cx, cy, 0, cx, cy, Math.hypot(w, h) * 0.6);
      grad.addColorStop(0, rgb(sky.shallow));
      grad.addColorStop(1, rgb(sky.deep));
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
      return;
    }
    const water = g.createLinearGradient(0, 0, 0, h);
    water.addColorStop(0, rgb(mix(sky.shallow, [255, 255, 255], 0.12)));
    water.addColorStop(0.45, rgb(mix(sky.shallow, sky.deep, 0.55)));
    water.addColorStop(1, rgb(sky.deep));
    g.fillStyle = water;
    g.fillRect(0, 0, w, h);
    // Sun or moon glow through the surface.
    const sx = w * (0.15 + 0.7 * clamp((sky.hour - 6) / 12, 0, 1)), sr = h * 0.45;
    const glow = g.createRadialGradient(sx, 0, 0, sx, 0, sr);
    glow.addColorStop(0, `rgba(210,232,255,${0.25 + 0.12 * sky.day})`);
    glow.addColorStop(1, "rgba(255,250,230,0)");
    g.fillStyle = glow;
    g.fillRect(sx - sr, 0, sr * 2, sr * 2);
  }

  /** Water colour at screen y (side view) or mid-depth (top view). */
  function waterAt(y) {
    if (view === "top") return mix(sky.shallow, sky.deep, 0.35);
    return mix(sky.shallow, sky.deep, clamp((y - surfaceY) / Math.max(1, H - surfaceY), 0, 1) * 0.9);
  }

  /** How far a point at depth d has faded into the water. */
  function fogAt(d) {
    if (view === "top") return clamp((-d - 20) / (-D0), 0, 1) * 0.55;
    return clamp(-d / (-D0), 0, 1) * 0.72;
  }

  // ------------------------------------------------------------- energy

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
        energyTmp[i] = (energy[i] * 4 + l + rt + u + d) * 0.125 * 0.982;
      }
    }
    const t = energy;
    energy = energyTmp;
    energyTmp = t;
  }

  // -------------------------------------------------------------- animals

  const animals = [];
  let nextId = 1;

  /** In mm, about what the px sizes give on a 24" 1080p monitor; likewise the depth ranges. */
  const MANTA_MM = 60, WHALE_MM = 234, DEEP_MM = 300, FAR_MM = 530;
  const mantaSize = () => (pxmm ? MANTA_MM * pxmm : clamp(Math.min(W, H) * 0.2, 90, 260));
  const whaleSize = () => (pxmm ? WHALE_MM * pxmm : clamp(Math.min(W, H) * 0.78, 300, 900));
  const sizeOf = (kind) => (kind === "manta" ? mantaSize() : whaleSize());

  /** A random point to start at: on screen, inside the depth range. */
  function startPos(L) {
    const d = rand(D0 * 0.7, D1 * 0.5);
    const s = solid.scaleAt(d);
    const x = solid.cx + (rand(L * 0.6, W - L * 0.6) - solid.cx) / s;
    const y0 = view === "side" ? surfaceY + L * 0.4 : L * 0.4;
    const y = solid.cy + (rand(y0, H - L * 0.4) - solid.cy) / s;
    return [x, y, d];
  }

  /** A level heading in a random direction. */
  function levelHeading() {
    const a = rand(0, Math.PI * 2);
    let f = view === "top" ? [Math.cos(a), Math.sin(a), 0] : [Math.cos(a), 0, Math.sin(a) * 0.6];
    f = norm(add(f, UP, -dot(f, UP)));
    return f;
  }

  function makeAnimal(kind, L, extra) {
    const f = levelHeading();
    const l = norm(cross(UP, f));
    const a = {
      kind, id: nextId++, L, seed: (Math.random() * 1e6) | 0,
      pos: startPos(L), f, l, u: cross(f, l), bank: 0, speed: 0, phase: rand(0, 10),
      cruise: kind === "manta" ? rand(0.26, 0.36) : rand(0.07, 0.09),
      yaw: 0, yawGoal: 0, yawTimer: 0, pitchGoal: 0,
      state: "cruise", timer: rand(25, 50), loops: 0, home: null, away: false, leaving: null, ...extra,
    };
    a.speed = a.cruise * L;
    if (kind === "whale") {
      a.chain = new Chain(16, L / 15);
      a.chain.place(a.pos, f);
    }
    animals.push(a);
    return a;
  }

  function spawnAll() {
    animals.length = 0;
    food.length = 0;
    spouts.length = 0;
    if (!W) return;
    const mantas = species === "whale" ? 0 : species === "manta" ? Math.max(MANTAS, 5) : MANTAS;
    const whales = species === "manta" ? 0 : species === "whale" ? Math.max(WHALES, 1) : WHALES;
    wanted.manta = mantas;
    wanted.whale = whales;
    for (let i = 0; i < whales + reserve(whales); i++) {
      const mom = makeAnimal("whale", whaleSize() * rand(0.92, 1.05), { away: i >= whales });
      // A whale-only sea gets a calf that keeps to its mother's side.
      if (species === "whale" && i === 0) {
        const calf = makeAnimal("whale", mom.L * 0.42, { mother: mom, cruise: mom.cruise * 1.1 });
        calf.pos = add(mom.pos, mom.l, mom.L * 0.25);
        calf.f = mom.f.slice();
        calf.chain.place(calf.pos, calf.f);
      }
    }
    for (let i = 0; i < mantas + reserve(mantas); i++) makeAnimal("manta", mantaSize() * rand(0.75, 1.15), { away: i >= mantas });
    spawnFish();
  }

  /** How many of each kind stay in view; a few more wait out of sight (see keepInView). */
  const wanted = { manta: 0, whale: 0 };
  const reserve = (n) => (n ? Math.max(2, Math.ceil(n / 3)) : 0);
  const onScreen = (sx, sy, inset = 0) =>
    sx >= inset && sx <= W - inset && (view === "side" || (sy >= inset && sy <= H - inset));
  /** The middle of the body: a whale's pos is its head, with the spine trailing behind. */
  const middleOf = (a) => (a.chain ? a.chain.p[a.chain.n >> 1] : a.pos);

  /**
   * Keep the same number of each kind in view. One whose middle swims off an edge is on its
   * way out (it doesn't turn back), so a waiting one comes in to take its place. A mother
   * with a calf turns back instead, so the calf stays by her side; the calf isn't counted.
   */
  function keepInView() {
    const showing = { manta: 0, whale: 0 };
    for (const a of animals) {
      if (a.away || a.leaving || a.mother || a.crossing) continue;
      // A mother turns as her head nears an edge: a whale turns too slowly to wait longer.
      const mother = animals.some((c) => c.mother === a);
      const [sx, sy] = screenOf(mother ? a.pos : middleOf(a));
      const inset = mother ? a.L * 0.35 : 0;
      const side = sx < inset ? "l" : sx > W - inset ? "r" : view === "side" ? null : sy < inset ? "t" : sy > H - inset ? "b" : null;
      // An edge with a door to the next monitor: through it if open, else it's a wall (stepAnimal).
      const door = side && link.edge(a, side, side === "l" || side === "r" ? sy : sx, a.L * 0.15);
      if (door) showing[a.kind]++;
      else if (!a.home && !onScreen(sx, sy, inset)) {
        if (mother) {
          a.home = [rand(W * 0.2, W * 0.8), view === "side" ? rand(surfaceY + H * 0.2, bedY - H * 0.15) : rand(H * 0.2, H * 0.8)];
          showing[a.kind]++;
        } else {
          a.leaving = [sx < 0 ? -1 : sx > W ? 1 : 0, view === "top" ? (sy < 0 ? -1 : sy > H ? 1 : 0) : 0];
          // Linked, one swims in for it straight away; the host only evens out the group.
          if (linked()) bringIn(a.kind);
        }
      } else showing[a.kind]++;
    }
    if (linked()) return;
    for (const kind of ["manta", "whale"]) {
      if (showing[kind] >= wanted[kind]) continue;
      const waiting = animals.filter((a) => a.away && a.kind === kind && !a.mother);
      if (waiting.length) enter(waiting[Math.floor(rand(0, waiting.length))]);
    }
  }

  /**
   * Bring a waiting animal in from just past an edge (any edge from above), heading in: a
   * manta just out of sight, a whale with its head at the edge (its body trails behind).
   */
  function enter(a, side = null) {
    const L = a.L, d = rand(D0 * 0.7, D1 * 0.5), s = solid.scaleAt(d);
    const y0 = view === "side" ? surfaceY + L * 0.4 : L * 0.4;
    const edge = side ? "lrtb".indexOf(side) : view === "top" ? Math.floor(rand(0, 4)) : rand() < 0.5 ? 0 : 1;
    const o = a.chain ? L * 0.05 : L * 0.6;
    const sx = edge === 0 ? -o : edge === 1 ? W + o : rand(L * 0.6, W - L * 0.6);
    const sy = edge === 2 ? -o : edge === 3 ? H + o : rand(y0, H - L * 0.4);
    a.home = [rand(W * 0.2, W * 0.8), view === "side" ? rand(surfaceY + H * 0.2, bedY - H * 0.15) : rand(H * 0.2, H * 0.8)];
    a.pos = [solid.cx + (sx - solid.cx) / s, solid.cy + (sy - solid.cy) / s, d];
    a.f = view === "top" ? norm([a.home[0] - sx, a.home[1] - sy, 0]) : norm([edge === 0 ? 1 : -1, 0, rand(-0.15, 0.15)]);
    a.l = norm(cross(UP, a.f));
    a.u = cross(a.f, a.l);
    a.bank = a.yaw = 0;
    a.speed = a.cruise * L;
    a.state = "cruise";
    a.timer = rand(25, 50);
    a.loops = 0;
    a.away = false;
    a.leaving = null;
    a.crossing = null;
    if (a.chain) a.chain.place(a.pos, a.f);
    // A calf comes back with its mother.
    for (const c of animals) {
      if (c.mother !== a) continue;
      c.pos = add(a.pos, a.l, a.L * 0.25);
      c.f = a.f.slice();
      c.l = a.l.slice();
      c.u = a.u.slice();
      c.away = false;
      c.crossing = null;
      c.chain.place(c.pos, c.f);
    }
  }

  const linked = () => links.share !== null && links.doors.length > 0;

  /** A side with no door, to come in or go out by; else any. */
  function outerSide() {
    const all = view === "top" ? ["l", "r", "t", "b"] : ["l", "r"];
    const free = all.filter((side) => !links.doors.some((d) => d.side === side));
    const pick = free.length ? free : all;
    return pick[Math.floor(rand(0, pick.length))];
  }

  /** One of a kind swims in from outside, by a side with no door if there is one. */
  function bringIn(kind) {
    const a = animals.find((o) => o.away && o.kind === kind && !o.mother) || makeAnimal(kind, sizeOf(kind) * rand(0.85, 1.1), { away: true });
    enter(a, outerSide());
  }

  /** The host's count is off: n of a kind swim in from outside (n < 0: -n swim off). */
  function populate(n, kind) {
    if (kind !== "manta" && kind !== "whale") return;
    for (let i = 0; i < n; i++) bringIn(kind);
    // Rather not a mother (her calf would have to go too), nor the one on its way to a door.
    const going = animals.filter((a) => a.kind === kind && settled(a));
    const rank = (a) => (animals.some((c) => c.mother === a) ? 2 : 0) + (link.pull(a) ? 1 : 0);
    going.sort((a, b) => rank(a) - rank(b));
    for (const a of going.slice(0, Math.max(0, -n))) a.leaving = link.OUT[outerSide()].slice();
    link.end();
  }

  // Doors to the next monitors (core/crossing.js). What crosses goes over in body lengths, so
  // it keeps its shape whatever the neighbour's px per mm; a calf goes along with its mother.
  const KEPT = ["seed", "cruise", "phase", "yaw", "yawGoal", "yawTimer", "pitchGoal", "bank", "timer"];
  const counted = (a) => !a.away && !a.leaving && !a.mother;
  const settled = (a) => counted(a) && !a.crossing && !a.home && a.state === "cruise";
  const calfOf = (a) => animals.find((c) => c.mother === a && !c.away);
  const isVec = (v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);

  function packBody(a, origin, unit) {
    const data = { size: a.L / unit, speed: a.speed / a.L, at: [0, 1, 2].map((k) => (a.pos[k] - origin[k]) / unit), f: a.f, l: a.l, u: a.u };
    for (const key of KEPT) data[key] = a[key];
    if (a.chain) data.chain = a.chain.p.flatMap((p) => [0, 1, 2].map((k) => (p[k] - a.pos[k]) / a.L));
    return data;
  }

  /** A body from packBody, at `origin` + its offset; `mirror` flips vectors in the edge. */
  function unpackBody(data, kind, origin, unit, mirror, extra) {
    if (!data || !isVec(data.f) || !isVec(data.u) || !isVec(data.at)) return null;
    if (kind === "whale" && !(Array.isArray(data.chain) && data.chain.length === 48 && data.chain.every(Number.isFinite))) return null;
    const L = clamp(+data.size || 1, 0.3, 1.5) * unit;
    const a = makeAnimal(kind, L, extra);
    for (const key of KEPT) if (Number.isFinite(data[key])) a[key] = data[key];
    a.speed = clamp(+data.speed || a.cruise, 0.02, 1) * L;
    a.f = norm(mirror(data.f));
    a.u = norm(mirror(data.u));
    a.l = cross(a.u, a.f);
    a.pos = add(origin, mirror(data.at), unit);
    if (a.chain) {
      for (let i = 0; i < a.chain.n; i++) a.chain.p[i] = add(a.pos, mirror(data.chain.slice(i * 3, i * 3 + 3)), L);
    }
    return a;
  }

  const link = Wallpaper.crossing(api, {
    animals: () => animals,
    kindOf: (a) => a.kind,
    counted,
    settled,
    head: (a) => screenOf(a.pos),
    dir: (a) => [a.f[0], a.f[1]],
    // A manta's pos is its mouth, the disc trailing behind; a whale's spine.
    outline: (a) => (a.chain ? a.chain.p : [0, 0.5, 1].map((u) => add(a.pos, a.f, -u * a.L))).map(screenOf),
    reach: (a) => a.L * (a.chain ? 0.35 : 1.05),
    pack(a) {
      const data = { ...packBody(a, a.pos, sizeOf(a.kind)), d: a.pos[2] / a.L };
      const calf = calfOf(a);
      if (calf) data.calf = packBody(calf, a.pos, a.L);
      return data;
    },
    unpack(data, side, x, y, mirrored) {
      const kind = data.kind;
      if (kind !== "manta" && kind !== "whale") return null;
      // Sent back: flip it in the edge, so it heads back in.
      const flipX = mirrored && (side === "l" || side === "r"), flipY = mirrored && !flipX;
      const mirror = (v) => [flipX ? -v[0] : v[0], flipY ? -v[1] : v[1], v[2]];
      const unit = sizeOf(kind);
      // The head is where the host says on screen; the depth goes in lengths.
      const d = clamp(+data.d || 0, -30, 10) * clamp(+data.size || 1, 0.3, 1.5) * unit, s = solid.scaleAt(d);
      const head = [solid.cx + (x - solid.cx) / s, solid.cy + (y - solid.cy) / s, d];
      const a = unpackBody({ ...data, at: [0, 0, 0] }, kind, head, unit, mirror);
      if (!a) return null;
      const calf = kind === "whale" && data.calf ? unpackBody(data.calf, "whale", a.pos, a.L, mirror, { mother: a }) : null;
      return calf ? [a, calf] : a;
    },
    companions: (a) => [calfOf(a)].filter(Boolean),
  });

  /** Mid-crossing: straight on at an even speed, turning alike on both monitors. */
  function crossAnimal(a, dt) {
    const [ox, oy] = link.heading(a);
    steerFrame(a, [ox, oy, 0], a.kind === "manta" ? 0.6 : 0.22, 0, dt, a.kind === "manta" ? 1.6 : 1);
    a.phase += dt * (a.kind === "manta" ? 1.6 + (a.speed / a.L) * 2.2 : 0.7 + (a.speed / a.L) * 6);
    a.pos = add(a.pos, a.f, a.speed * dt);
    if (a.chain) a.chain.follow(a.pos);
  }

  /**
   * Turn an animal's frame toward `want` (easing in, like the koi: faster the further off
   * it is), add the wander as a turn rate about "up", bank into the turn and level out.
   */
  function steerFrame(a, want, maxTurn, wander, dt, level = 2) {
    const f0 = a.f;
    const off = Math.acos(clamp(dot(f0, norm(want)), -1, 1));
    let f1 = turnToward(f0, want, Math.min(maxTurn, off * 1.8) * dt);
    if (wander) f1 = norm(rotate(f1, UP, wander * dt));
    const axis = cross(f0, f1), s = len(axis);
    if (s > 1e-6) {
      const k = [axis[0] / s, axis[1] / s, axis[2] / s], ang = Math.atan2(s, dot(f0, f1));
      a.l = rotate(a.l, k, ang);
      a.u = rotate(a.u, k, ang);
    }
    a.f = f1;
    const yawRate = dot(axis, UP) / Math.max(dt, 1e-3);
    a.bank = lerp(a.bank, clamp(-yawRate * (a.kind === "manta" ? 0.9 : 0.6), -0.6, 0.6), Math.min(1, dt * 1.5));
    if (level) {
      const l0 = cross(UP, a.f);
      if (len(l0) > 0.1) {
        const lt = rotate(norm(l0), a.f, a.bank);
        const err = Math.atan2(dot(cross(a.l, lt), a.f), dot(a.l, lt));
        const turn = err * Math.min(1, dt * level);
        a.l = rotate(a.l, a.f, turn);
        a.u = rotate(a.u, a.f, turn);
      }
    }
    a.l = norm(add(a.l, a.f, -dot(a.l, a.f)));
    a.u = cross(a.f, a.l);
  }

  /** Where an animal's position lands on screen. */
  function screenOf(p) {
    solid.project(p[0], p[1], p[2]);
    return [solid.px, solid.py];
  }

  function stepAnimal(a, dt, t) {
    const L = a.L;
    const [sx, sy] = screenOf(a.pos);
    let want = a.f.slice();
    let urgency = 0;

    // The screen's edges aren't walls: an animal that swims well out of sight waits there
    // (see keepInView), unless it's on its way in. A calf only follows its mother, who
    // never leaves. The surface and the seabed of the side view are real, so those still
    // turn them.
    const m = a.kind === "whale" ? L * 0.15 : L * 0.7;
    const out = L * 1.2;
    const gone = sx < -out || sx > W + out || (view === "top" && (sy < -out || sy > H + out));
    if ((gone && !a.home && !a.mother) || (a.mother && a.mother.away)) {
      a.away = true;
      return;
    }
    if (a.leaving) want = add(want, [a.leaving[0], a.leaving[1], 0], 3);
    // A door it can't go through now is a wall (an edge with no door isn't: the sea runs on).
    if (!a.leaving && !a.mother) {
      const wall = a.kind === "whale" ? L * 0.5 : L * 0.7;
      for (const side of view === "top" ? "lrtb" : "lr") {
        const inside = -link.past(side, sx, sy);
        if (inside >= wall || link.edge(a, side, side === "l" || side === "r" ? sy : sx, L * 0.15) !== "shut") continue;
        const [ox, oy] = link.OUT[side];
        want = add(want, [-ox, -oy, 0], ((wall - Math.max(0, inside)) / wall) * 3);
      }
    }
    const sent = link.pull(a);
    if (sent) {
      const dx = sent[0] - sx, dy = sent[1] - sy, d = Math.hypot(dx, dy) || 1;
      want = add(want, [dx / d, dy / d, 0], 1.6);
    }
    if (a.home) {
      want = add(want, norm([a.home[0] - a.pos[0], a.home[1] - a.pos[1], 0]), 3);
      // In once its middle is (see keepInView).
      const [mx, my] = screenOf(middleOf(a));
      if (mx > 0 && mx < W && (view === "side" || (my > 0 && my < H))) a.home = null;
    }
    if (view === "side") {
      const top = surfaceY + (a.kind === "whale" ? L * 0.08 : L * 0.9);
      const bottom = bedY - (a.kind === "whale" ? L * 0.15 : L * 0.6);
      const push = 2.5;
      if (sy < top) want[1] += clamp((top - sy) / m, 0, 2) * push;
      if (sy > bottom) want[1] -= clamp((sy - bottom) / m, 0, 2) * push;
    }
    if (a.pos[2] < D0) want[2] += ((D0 - a.pos[2]) / L) * 2;
    if (a.pos[2] > D1) want[2] -= ((a.pos[2] - D1) / L) * 2;

    // Personal space.
    for (const o of animals) {
      if (o === a || o.away || o === a.mother || o.mother === a) continue;
      const dx = a.pos[0] - o.pos[0], dy = a.pos[1] - o.pos[1], dd = a.pos[2] - o.pos[2];
      const d = Math.hypot(dx, dy, dd), r = (a.L + o.L) * 0.45;
      if (d > 0 && d < r) {
        const w = ((r - d) / r) * 1.5;
        want = add(want, [dx / d, dy / d, dd / d], w);
      }
    }

    // A calf keeps to its mother's flank.
    if (a.mother) {
      const mo = a.mother;
      const spot = add(add(mo.pos, mo.l, mo.L * 0.2), mo.f, -mo.L * 0.15);
      const dx = spot[0] - a.pos[0], dy = spot[1] - a.pos[1], dd = spot[2] - a.pos[2];
      const d = Math.hypot(dx, dy, dd) || 1;
      want = add(want, [dx / d, dy / d, dd / d], clamp(d / (L * 0.5), 0.3, 3));
      urgency = clamp(d / (mo.L * 0.6), 0, 1);
    }

    // Mantas: plankton first, then a resting cursor.
    if (a.kind === "manta" && a.state !== "loop") {
      let best = null, bestD = Infinity;
      for (const p of food) {
        const d = Math.hypot(p.pos[0] - a.pos[0], p.pos[1] - a.pos[1], p.pos[2] - a.pos[2]);
        if (d < bestD) {
          best = p;
          bestD = d;
        }
      }
      if (best) {
        const v = norm([best.pos[0] - a.pos[0], best.pos[1] - a.pos[1], best.pos[2] - a.pos[2]]);
        want = add(want, v, 2.4);
        urgency = 1;
        if (bestD < L * 0.5) {
          a.state = "loop";
          a.loops = 0;
          a.timer = 0;
          best.amount -= 1;
          if (best.amount <= 0) food.splice(food.indexOf(best), 1);
        }
      } else if (pointer.active && performance.now() - pointer.moved > 700) {
        const dx = pointer.x - sx, dy = pointer.y - sy, d = Math.hypot(dx, dy);
        if (d > L * 0.6 && d < Math.min(W, H) * 0.5) {
          want = add(want, [dx / d, dy / d, 0], 0.8);
          urgency = 0.3;
        }
      }
    }

    // Whales: surface to blow every so often.
    if (a.kind === "whale" && !a.mother) {
      a.timer -= dt;
      if (a.state === "cruise" && a.timer <= 0) a.state = "rise";
      if (a.state === "rise") {
        if (view === "top") want[2] += 1.2;
        else want = add(want, UP, 1.2);
        const blowY = view === "side" ? surfaceY + L * 0.08 : 0;
        const atTop = view === "top" ? a.pos[2] > D1 - L * 0.02 : sy < blowY;
        if (atTop) {
          a.state = "blow";
          a.timer = 6;
          a.blows = 0;
        }
      } else if (a.state === "blow") {
        if (view === "top") want[2] += 0.4;
        a.blowT = (a.blowT || 0) - dt;
        if (a.blowT <= 0 && a.blows < 3) {
          spout(a);
          a.blows++;
          a.blowT = 1.8;
        }
        if (a.timer <= 0) {
          a.state = "cruise";
          a.timer = rand(30, 60);
        }
      }
    }

    // Lazy wander: a slowly drifting turn, plus a little up and down.
    a.yawTimer -= dt;
    if (a.yawTimer <= 0) {
      a.yawGoal = rand(-0.5, 0.5) * (a.kind === "manta" ? 1 : 0.4);
      a.pitchGoal = rand(-0.2, 0.2);
      a.yawTimer = rand(2, 6);
    }
    a.yaw += (a.yawGoal - a.yaw) * Math.min(1, dt * 0.7);
    // From the side, whales swim mostly across the view (their profile reads best); mantas
    // roam through depth, so their wings spread across the screen as they come and go.
    if (view === "side" && a.kind === "whale") want[2] *= 0.35;
    want = norm(want);
    // Mostly level: limit how steeply anything climbs or dives.
    const climb = dot(want, UP), maxClimb = a.state === "rise" ? 0.45 : 0.3;
    want = add(want, UP, clamp(climb + a.pitchGoal * 0.3, -maxClimb, maxClimb) - climb);

    if (a.state === "loop") {
      // A somersault through the bloom: nose up, over onto its back, and round.
      const rate = (Math.PI * 2) / 2.6;
      a.f = rotate(a.f, a.l, -rate * dt);
      a.u = rotate(a.u, a.l, -rate * dt);
      a.timer += dt;
      if (a.timer > 2.6) {
        a.loops++;
        a.timer = 0;
        const more = food.some((p) => Math.hypot(p.pos[0] - a.pos[0], p.pos[1] - a.pos[1], p.pos[2] - a.pos[2]) < L * 1.2);
        if (!more || a.loops >= 3) a.state = "cruise";
      }
      a.speed += (L * 0.22 - a.speed) * Math.min(1, dt * 2);
    } else {
      const turn = a.kind === "manta" ? 0.9 + urgency : 0.22 + urgency * 0.25;
      steerFrame(a, want, turn, a.yaw * (1 - urgency) * 0.5, dt, a.kind === "manta" ? 1.6 : 1);
      const target = L * (a.cruise + urgency * (a.kind === "manta" ? 0.25 : 0.06));
      a.speed += (target - a.speed) * Math.min(1, dt * 0.8);
    }

    a.phase += dt * (a.kind === "manta" ? 1.6 + (a.speed / L) * 2.2 : 0.7 + (a.speed / L) * 6);
    a.pos = add(a.pos, a.f, a.speed * dt);
    if (a.chain) a.chain.follow(a.pos);

    // Stir the water: wakes on the floor (top view), plankton glow at night.
    const [hx, hy] = screenOf(a.pos);
    // Plankton lights up much more readily at night.
    const near = (view === "top" ? clamp(1 + a.pos[2] / (-D0), 0.2, 1) : 0.6) * (2.2 - 1.2 * sky.day);
    if (a.kind === "manta") {
      for (const s of [-1, 1]) {
        const tip = add(a.pos, a.l, s * L);
        const [tx, ty] = screenOf(tip);
        addEnergy(tx, ty, 0.1 * near);
      }
    } else {
      addEnergy(hx, hy, 0.08 * near);
      const tail = a.chain.p[a.chain.n - 1];
      const [tx, ty] = screenOf(tail);
      addEnergy(tx, ty, 0.2 * near);
    }
  }

  // ------------------------------------------------------------- shading

  const DORSAL_MANTA = [34, 38, 48], VENTRAL_MANTA = [232, 236, 240], PATCH = [226, 232, 236];
  const DORSAL_WHALE = [58, 70, 92], VENTRAL_WHALE = [222, 226, 228], FIN = [236, 240, 240];

  /** Final colour of a surface point: lit, dimmed by the time of day, faded by distance. */
  function shade(base, light, d, y, out) {
    const k = (0.45 + 0.7 * light) * sky.light;
    // Moonlight: at night dark skin is lifted toward a cool blue so black backs still read.
    const moon = (1 - sky.day) * 76;
    const f = fogAt(d), w = waterAt(y);
    out[0] = lerp((base[0] + moon * 0.6) * k, w[0], f);
    out[1] = lerp((base[1] + moon * 0.8) * k, w[1], f);
    out[2] = lerp((base[2] + moon) * k, w[2], f);
    return out;
  }

  const tmp = [0, 0, 0];
  const lineGlyph = (dx, dy) => "-\\|/"[Math.round((((Math.atan2(dy, dx) % Math.PI) + Math.PI) % Math.PI) / (Math.PI / 4)) % 4];

  // --------------------------------------------------------------- manta

  /** Half-span of the disc at u (0 = mouth, 1 = tail root), in body lengths. */
  function mantaSpan(u) {
    if (u < 0) return 0.24;
    if (u < 0.5) return 0.2 + 0.85 * Math.pow(u / 0.5, 0.85);
    return 0.1 + 0.95 * Math.pow(1 - (u - 0.5) / 0.5, 2.1);
  }

  /** Height of the disc above its plane: the wing wave plus a rounded back. */
  function mantaZ(a, u, w) {
    const aw = Math.abs(w);
    let z = 0.38 * Math.pow(aw, 1.6) * Math.sin(a.phase - aw * 1.9) + 0.035 * aw * Math.sin(a.phase * 1.3 - u * 3);
    if (aw < 0.3) z += 0.06 * (1 - (aw / 0.3) ** 2) * Math.sin(Math.PI * clamp(u, 0, 1));
    return z;
  }

  /** Dorsal: black with white shoulder chevrons. Ventral: white, dark margins, a few spots. */
  function mantaColour(a, u, w, ventral) {
    const aw = Math.abs(w), span = mantaSpan(u);
    if (u < 0.02) return ventral ? [70, 74, 84] : [44, 48, 58];
    if (!ventral) {
      const inner = 0.24 + (u - 0.1) * 0.9, outer = 0.3 + span * 0.5;
      if (u > 0.1 && u < 0.46 && aw > inner && aw < outer) return PATCH;
      return DORSAL_MANTA;
    }
    if (aw > span * 0.82 || u > 0.92) return [70, 76, 88];
    if (u > 0.14 && u < 0.32 && aw > 0.12 && aw < 0.22 && Math.sin(u * 140) > 0.4) return [120, 126, 140];
    if (aw < 0.45 && noise2(u * 9, w * 9, a.seed % 97) > 0.78) return [60, 64, 76];
    return VENTRAL_MANTA;
  }

  function drawManta(a) {
    const L = a.L, { f, l, u: up } = a;
    const s = solid.scaleAt(a.pos[2]);
    const step = (cw * 0.45) / s / L;
    const V2 = 0, e = 0.01;
    for (let uu = -0.12; uu <= 1; uu += step) {
      const span = mantaSpan(uu);
      for (let w = -span; w <= span; w += step) {
        const aw = Math.abs(w);
        // Cephalic fins: two lobes ahead of the mouth.
        if (uu < 0.02 && (aw < 0.1 || aw > 0.22 || uu < -0.12 + (aw - 0.16) ** 2 * 3)) continue;
        const z = mantaZ(a, uu, w);
        const zw = (mantaZ(a, uu, w + e) - mantaZ(a, uu, w - e)) / (2 * e);
        const zu = (mantaZ(a, uu + e, w) - mantaZ(a, uu - e, w)) / (2 * e);
        const along = (0.45 - uu) * L, side = w * L, lift = z * L;
        const x = a.pos[0] + f[0] * along + l[0] * side + up[0] * lift;
        const y = a.pos[1] + f[1] * along + l[1] * side + up[1] * lift;
        const d = a.pos[2] + f[2] * along + l[2] * side + up[2] * lift;
        let nx = up[0] - l[0] * zw - f[0] * zu, ny = up[1] - l[1] * zw - f[1] * zu, nd = up[2] - l[2] * zw - f[2] * zu;
        const nl = Math.hypot(nx, ny, nd) || 1;
        nx /= nl; ny /= nl; nd /= nl;
        const ventral = nd < V2;
        if (ventral) {
          nx = -nx; ny = -ny; nd = -nd;
        }
        const diff = Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nd * LIGHT[2]) + 0.45 * Math.max(0, nx * FILL[0] + ny * FILL[1] + nd * FILL[2]);
        const light = clamp(0.25 + 0.75 * diff + (diff > 0.93 ? 0.2 : 0), 0, 1);
        const c = shade(mantaColour(a, uu, w, ventral), light, d, y, tmp);
        solid.splat(x, y, d, a.id, light, c[0], c[1], c[2], 1);
      }
    }
    // Eyes on the sides of the head, the whip of a tail.
    for (const sd of [-1, 1]) {
      const along = 0.38 * L, side = sd * 0.23 * L;
      const x = a.pos[0] + f[0] * along + l[0] * side, y = a.pos[1] + f[1] * along + l[1] * side, d = a.pos[2] + f[2] * along + l[2] * side;
      solid.splat(x, y, d + 2, a.id, 0, 10, 12, 16, 1, "o");
    }
    const t0 = add(a.pos, f, -0.55 * L);
    let prev = null;
    for (let k = 0; k <= 1; k += step * 1.5) {
      const sway = Math.sin(a.phase * 0.8 - k * 4) * 0.06 * k;
      const p = add(add(t0, f, -k * 0.75 * L), l, sway * L);
      solid.project(p[0], p[1], p[2]);
      const px = solid.px, py = solid.py;
      if (prev) {
        const c = shade([40, 44, 54], 0.4, p[2], p[1], tmp);
        solid.splat(p[0], p[1], p[2], a.id, 0, c[0], c[1], c[2], 0.9 - k * 0.5, lineGlyph(px - prev[0], py - prev[1]));
      }
      prev = [px, py];
    }
  }

  // --------------------------------------------------------------- whale

  /** Body radius at s (0 = snout, 1 = fluke notch), in body lengths. */
  function whaleR(s) {
    if (s < 0.14) return 0.03 + 0.065 * Math.sin(((s / 0.14) * Math.PI) / 2);
    if (s < 0.4) return 0.095 + 0.017 * smoothstep(0.14, 0.4, s);
    return 0.014 + 0.098 * Math.pow(Math.max(0, 1 - (s - 0.4) / 0.52), 1.15);
  }

  const frame = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];

  /** Body surface colour at (s, θ): dark back, white throat pleats, knobbly head. */
  function whaleColour(a, s, th) {
    const sn = Math.sin(th);
    let c = mix(DORSAL_WHALE, VENTRAL_WHALE, smoothstep(-0.1, -0.65, sn));
    if (sn < -0.45 && s > 0.03 && s < 0.5 && Math.sin(th * 26) > 0.35) c = mix(c, [120, 128, 140], 0.6);
    if (s < 0.17 && Math.abs(sn + 0.3) < 0.09) c = [26, 30, 40];
    if (s < 0.14 && sn > 0.25 && hash2(Math.round(s * 160), Math.round(th * 20), a.seed) > 0.8) c = [130, 140, 150];
    if (s < 0.16 && sn < -0.5 && hash2(Math.round(s * 120), Math.round(th * 14), a.seed + 1) > 0.86) c = [210, 214, 206];
    return c;
  }

  function drawWhale(a) {
    const L = a.L, ch3 = a.chain;
    ch3.frames(UP, a.bank);
    const s0 = solid.scaleAt(a.pos[2]);
    const step = (cw * 0.45) / s0 / L;
    const wave = (s) => 0.045 * Math.sin(a.phase - s * 4) * (0.04 + s * s * 1.6);

    for (let s = 0; s <= 0.92; s += step) {
      ch3.at(s, frame);
      const [p, t, l, u] = frame;
      const off = wave(s) * L;
      const cx = p[0] + u[0] * off, cy = p[1] + u[1] * off, cd = p[2] + u[2] * off;
      const r = whaleR(s) * L;
      const flat = s < 0.2 ? lerp(0.72, 1, s / 0.2) : 1;
      const fin = Math.exp(-(((s - 0.66) / 0.03) ** 2)) * 0.03 * L;
      const steps = Math.max(8, Math.ceil((Math.PI * 2 * r) / (step * L)));
      for (let k = 0; k < steps; k++) {
        const th = (k / steps) * Math.PI * 2;
        const co = Math.cos(th), sn = Math.sin(th);
        const rl = r, rn = r * flat + (sn > 0 ? fin * Math.pow(sn, 6) : 0);
        let nx = l[0] * co * rn + u[0] * sn * rl, ny = l[1] * co * rn + u[1] * sn * rl, nd = l[2] * co * rn + u[2] * sn * rl;
        const nl = Math.hypot(nx, ny, nd) || 1;
        nx /= nl; ny /= nl; nd /= nl;
        if (nd < -0.25) continue;
        const x = cx + l[0] * co * rl + u[0] * sn * rn;
        const y = cy + l[1] * co * rl + u[1] * sn * rn;
        const d = cd + l[2] * co * rl + u[2] * sn * rn;
        const diff = Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nd * LIGHT[2]) + 0.45 * Math.max(0, nx * FILL[0] + ny * FILL[1] + nd * FILL[2]);
        const light = clamp(0.2 + 0.8 * diff, 0, 1);
        const c = shade(whaleColour(a, s, th), light, d, y, tmp);
        solid.splat(x, y, d, a.id, light, c[0], c[1], c[2], 1);
      }
    }

    // Eyes, low on the sides behind the mouth.
    ch3.at(0.16, frame);
    for (const sd of [-1, 1]) {
      const [p, , l, u] = frame;
      const r = whaleR(0.16) * L;
      const th = sd > 0 ? -0.3 : Math.PI + 0.3;
      const q = add(add(p, l, Math.cos(th) * r * 1.02), u, Math.sin(th) * r * 0.9);
      solid.splat(q[0], q[1], q[2] + 3, a.id, 0, 12, 14, 20, 1, "o");
    }

    // Pectoral fins: long, white, swept back, slowly sculling.
    ch3.at(0.25, frame);
    {
      const [p, t, l, u] = frame;
      const r = whaleR(0.25) * L;
      for (const sd of [-1, 1]) {
        const root = add(add(p, l, sd * r * 0.85), u, -r * 0.35);
        let dir = norm(add(add(scale3(l, sd), t, -0.85), u, -0.35));
        dir = rotate(dir, t, sd * 0.28 * Math.sin(a.phase * 0.5 + sd));
        const chord = norm(cross(u, dir));
        let n = norm(cross(dir, chord));
        const lenF = 0.31 * L;
        for (let k = 0; k <= 1; k += step / 0.31) {
          const cwid = (0.055 - 0.035 * k) * L * (1 + 0.15 * Math.sin(k * 40));
          const steps = Math.max(2, Math.ceil(cwid / (step * L)));
          for (let j = 0; j <= steps; j++) {
            const c2 = (j / steps - 0.5) * cwid;
            const q = add(add(root, dir, k * lenF), chord, c2);
            const nn = n[2] < 0 ? scale3(n, -1) : n;
            const diff = Math.max(0, dot(nn, LIGHT)) + 0.45 * Math.max(0, dot(nn, FILL));
            const light = clamp(0.3 + 0.7 * diff, 0, 1);
            const base = n[2] >= 0 && noise2(k * 8, j, a.seed) > 0.62 ? [60, 70, 86] : FIN;
            const c = shade(base, light, q[2], q[1], tmp);
            solid.splat(q[0], q[1], q[2], a.id, light, c[0], c[1], c[2], 1);
          }
        }
      }
    }

    // Flukes: flat, wide, notched, pitching with the stroke.
    ch3.at(0.92, frame);
    {
      const [p, t, l, u0] = frame;
      const off = wave(0.92) * L;
      const root = add(p, u0, off);
      const pitch = 0.55 * Math.cos(a.phase - 0.92 * 4);
      const back = rotate(scale3(t, -1), l, pitch), u = rotate(u0, l, pitch);
      const span = 0.17;
      for (let w = -span; w <= span; w += step) {
        const aw = Math.abs(w) / span;
        const le = 0.0 + 0.09 * Math.pow(aw, 1.5);
        const te = 0.05 + 0.055 * Math.sin(aw * Math.PI * 0.5) - 0.006 * Math.sin(aw * 30);
        for (let x = le; x <= te; x += step) {
          const q = add(add(root, back, x * L), l, w * L);
          const under = u[2] < 0;
          const nn = under ? scale3(u, -1) : u;
          const diff = Math.max(0, dot(nn, LIGHT)) + 0.45 * Math.max(0, dot(nn, FILL));
          const light = clamp(0.3 + 0.7 * diff, 0, 1);
          const base = under && noise2(w * 30, x * 30, a.seed + 5) < 0.55 ? VENTRAL_WHALE : DORSAL_WHALE;
          const c = shade(base, light, q[2], q[1], tmp);
          solid.splat(q[0], q[1], q[2], a.id, light, c[0], c[1], c[2], 1);
        }
      }
    }
  }

  const scale3 = (v, k) => [v[0] * k, v[1] * k, v[2] * k];

  // ----------------------------------------------------- spouts and food

  const spouts = [];
  const food = [];
  const ripples = [];

  /** A blow: mist rising from the blowhole (toward you from above, up into the air from the side). */
  function spout(a) {
    a.chain.at(0.17, frame);
    const [p, , , u] = frame;
    const hole = add(p, u, whaleR(0.17) * a.L * 0.9);
    const [x, y] = screenOf(hole);
    const n = view === "top" ? 26 : 40;
    for (let i = 0; i < n; i++) {
      if (view === "top") {
        const ang = rand(0, Math.PI * 2), v = rand(10, 60);
        spouts.push({ x, y, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v, life: rand(1.2, 2.4), max: 2.4, g: 0 });
      } else {
        const v = rand(140, 260);
        spouts.push({ x: x + rand(-4, 4), y: Math.min(y, surfaceY), vx: rand(-25, 25), vy: -v, life: rand(1.2, 2.2), max: 2.2, g: 90 });
      }
    }
    addRipple(x, y, 0.8, a.L * 0.35);
    addEnergy(x, y, 1);
  }

  function stepSpouts(dt) {
    for (let i = spouts.length - 1; i >= 0; i--) {
      const s = spouts[i];
      s.life -= dt;
      if (s.life <= 0) {
        spouts.splice(i, 1);
        continue;
      }
      s.vy += s.g * dt;
      s.vx *= 1 - dt * 0.8;
      if (!s.g) s.vy *= 1 - dt * 0.8;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
    }
  }

  function drawSpouts() {
    for (const s of spouts) {
      const k = s.life / s.max;
      const g = k > 0.66 ? "*" : k > 0.33 ? "o" : ".";
      put(Math.floor(s.x / cw), Math.floor(s.y / ch), g, style(245, 250, 255, clamp(k * 1.2, 0, 0.95)));
    }
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
      if (view !== "top") continue;
      const a = rp.strength * (1 - rp.r / rp.maxR) * 0.6;
      const st = style(sky.glow[0], sky.glow[1], sky.glow[2], a);
      const band = cw * 0.55;
      const c0 = Math.max(0, Math.floor((rp.x - rp.r - band) / cw)), c1 = Math.min(cols - 1, Math.floor((rp.x + rp.r + band) / cw));
      const r0 = Math.max(0, Math.floor((rp.y - rp.r - band) / ch)), r1 = Math.min(rows - 1, Math.floor((rp.y + rp.r + band) / ch));
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const dx = (c + 0.5) * cw - rp.x, dy = ((r + 0.5) * ch - rp.y) * (cw / ch) * 1.2;
          if (Math.abs(Math.hypot(dx, dy) - rp.r) < band) put(c, r, Math.abs(dy) > Math.abs(dx) ? "~" : dx < 0 ? "(" : ")", st);
        }
      }
    }
  }

  /** A plankton bloom: a cloud of glowing specks the mantas loop through. */
  function bloom(x, y) {
    const d = view === "top" ? D1 * 2 : lerp(D0, D1, 0.75);
    const s = solid.scaleAt(d);
    const pos = [solid.cx + (x - solid.cx) / s, solid.cy + (y - solid.cy) / s, d];
    const specks = [];
    for (let i = 0; i < 40; i++) {
      const a = rand(0, Math.PI * 2), r = Math.sqrt(Math.random()) * 70;
      specks.push({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r * 0.7, ph: rand(0, 6), vx: rand(-6, 6), vy: rand(-6, 6) });
    }
    food.push({ pos, amount: 6, life: 40, specks });
    addRipple(x, y, 1, 200);
    addEnergy(x, y, 1.2);
  }

  function drawFood(dt, t) {
    for (let i = food.length - 1; i >= 0; i--) {
      const f = food[i];
      f.life -= dt;
      if (f.life <= 0) {
        food.splice(i, 1);
        continue;
      }
      const fade = clamp(f.life / 5, 0, 1) * clamp(f.amount / 3, 0.35, 1);
      for (const p of f.specks) {
        p.x += (p.vx + Math.sin(t * 0.7 + p.ph) * 5) * dt;
        p.y += (p.vy + Math.cos(t * 0.6 + p.ph) * 5) * dt;
        const tw = 0.5 + 0.5 * Math.sin(t * 3 + p.ph);
        const c = mix([200, 240, 160], sky.glow, 0.5);
        put(Math.floor(p.x / cw), Math.floor(p.y / ch), tw > 0.7 ? "*" : ".", style(c[0], c[1], c[2], fade * (0.4 + 0.6 * tw)));
      }
    }
  }

  // ---------------------------------------------------------------- fish

  const fish = [];

  function spawnFish() {
    fish.length = 0;
    const cx = rand(W * 0.2, W * 0.8), cy = view === "side" ? rand(surfaceY + H * 0.2, H * 0.75) : rand(H * 0.2, H * 0.8);
    const a = rand(0, Math.PI * 2);
    for (let i = 0; i < FISH; i++) {
      fish.push({ x: cx + rand(-60, 60), y: cy + rand(-40, 40), vx: Math.cos(a) * 60, vy: Math.sin(a) * 60, glint: 0, seed: rand(0, 100) });
    }
  }

  /** A loose school: boids that stay together, keep off the edges and flee anything big. */
  function stepFish(dt, t) {
    const R = 70, sep = 26, maxV = 95, flee = [];
    for (const a of animals) {
      if (a.away) continue;
      const [x, y] = screenOf(a.pos);
      flee.push([x, y, a.kind === "whale" ? a.L * 0.5 : a.L * 0.9]);
    }
    const moving = pointer.active && performance.now() - pointer.moved < 300;
    if (moving) flee.push([pointer.x, pointer.y, 110]);
    const top = surfaceY + 30, bottom = bedY - 20;
    for (const f of fish) {
      let ax = 0, ay = 0, cx = 0, cy = 0, vx = 0, vy = 0, n = 0;
      for (const o of fish) {
        if (o === f) continue;
        const dx = o.x - f.x, dy = o.y - f.y;
        if (Math.abs(dx) > R || Math.abs(dy) > R) continue;
        const d = Math.hypot(dx, dy);
        if (d > R) continue;
        n++;
        cx += o.x; cy += o.y; vx += o.vx; vy += o.vy;
        if (d < sep && d > 0) {
          ax -= (dx / d) * (sep - d) * 6;
          ay -= (dy / d) * (sep - d) * 6;
        }
      }
      if (n) {
        ax += (cx / n - f.x) * 0.8 + (vx / n - f.vx) * 1.2;
        ay += (cy / n - f.y) * 0.8 + (vy / n - f.vy) * 1.2;
      }
      ax += Math.cos(noise2(t * 0.1, f.seed * 0.01, 3) * 12) * 25;
      ay += Math.sin(noise2(t * 0.1, f.seed * 0.01, 3) * 12) * 25;
      let scared = false;
      for (const [x, y, r] of flee) {
        const dx = f.x - x, dy = f.y - y, d = Math.hypot(dx, dy);
        if (d < r && d > 0) {
          ax += (dx / d) * (r - d) * 8;
          ay += (dy / d) * (r - d) * 8;
          scared = true;
        }
      }
      // Soft walls just inside the edges keep the whole school in view.
      const m = 60;
      if (f.x < m) ax += (m - f.x) * 4;
      if (f.x > W - m) ax -= (f.x - (W - m)) * 4;
      if (view === "side") {
        if (f.y < top + m) ay += (top + m - f.y) * 4;
        if (f.y > bottom - m) ay -= (f.y - (bottom - m)) * 4;
      } else {
        if (f.y < m) ay += (m - f.y) * 4;
        if (f.y > H - m) ay -= (f.y - (H - m)) * 4;
      }
      const before = Math.sign(f.vx);
      f.vx += ax * dt;
      f.vy += ay * dt;
      const v = Math.hypot(f.vx, f.vy), cap = scared ? maxV * 2.2 : maxV;
      if (v > cap) {
        f.vx *= cap / v;
        f.vy *= cap / v;
      } else if (v < 30) {
        f.vx *= 30 / (v || 1);
        f.vy *= 30 / (v || 1);
      }
      // Fleeing a whale can push harder than the walls; the edge still stops them.
      f.x = clamp(f.x + f.vx * dt, 2, W - 2);
      f.y = clamp(f.y + f.vy * dt, 2, H - 2);
      // Silver flashes as a fish turns side-on to the light.
      if (Math.sign(f.vx) !== before) f.glint = 1;
      f.glint = Math.max(0, f.glint - dt * 2.5);
    }
  }

  function drawFish() {
    const base = mix([222, 238, 246], [230, 236, 240], sky.day);
    for (const f of fish) {
      const g = Math.abs(f.vx) > Math.abs(f.vy) * 0.6 ? (f.vx > 0 ? ">" : "<") : f.vy > 0 ? "v" : "^";
      const c = mix(mix(base, waterAt(f.y), 0.25), [255, 255, 255], f.glint);
      put(Math.floor(f.x / cw), Math.floor(f.y / ch), g, style(c[0], c[1], c[2], 0.75 + 0.25 * f.glint));
    }
  }

  // ------------------------------------------------------- the backdrops

  /** Top view: sand ripples and caustics on the lagoon floor, lit by the wake field. */
  function drawFloor(t) {
    for (let r = frameNo % 3; r < rows; r += 3) {
      const y = (r + 0.5) * ch;
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const e = energy[i];
        let g = dotChar[i];
        const x = (c + 0.5) * cw;
        // Sand ripples: faint ridges that run across the floor.
        const ridge = Math.sin(x * 0.045 + y * 0.018 + noise2(x * 0.004, y * 0.004, 9) * 6);
        if (!g && ridge > 0.92) g = "~";
        if (!g) {
          floorGlyph[i] = "";
          if (e < 0.06) continue;
          g = e > 0.3 ? "~" : ".";
        }
        const caustic = Math.max(0,
          Math.sin(x * 0.011 + t * 0.5 + Math.sin(y * 0.013 - t * 0.35) * 2) *
          Math.sin(y * 0.015 - t * 0.45 + Math.sin(x * 0.008 + t * 0.3) * 2));
        const w = clamp(e * (2.6 - 1.2 * sky.day), 0, 1);
        if (w > 0.45 && sky.day < 0.5) g = "*";
        const a = clamp(0.1 + caustic * caustic * 0.5 * (0.4 + 0.6 * sky.day) + w * 0.75, 0, 1);
        floorGlyph[i] = g;
        floorColor[i] = style(lerp(sky.dot[0], sky.glow[0], w), lerp(sky.dot[1], sky.glow[1], w), lerp(sky.dot[2], sky.glow[2], w), a);
      }
    }
  }

  /** Side view: light shafts, marine snow and wake glow, refreshed a third at a time. */
  function drawWater(t) {
    for (let r = Math.max(surfaceRow + 1, 0) + (frameNo % 3); r < bedRow; r += 3) {
      const y = (r + 0.5) * ch;
      const depth = clamp((y - surfaceY) / Math.max(1, bedY - surfaceY), 0, 1);
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const x = (c + 0.5) * cw;
        const e = energy[i];
        // Slanted shafts from the surface that sway and fade with depth.
        const shaft = Math.pow(Math.max(0, Math.sin((x + y * 0.42) * 0.012 + Math.sin(t * 0.15 + x * 0.002) * 1.5 + t * 0.05)), 10);
        const lit = shaft * (1 - depth) * (0.3 + 0.7 * sky.day);
        let g = dotChar[i];
        if (!g && (lit > 0.25 || e > 0.06)) g = lit > 0.5 ? ":" : ".";
        if (!g) {
          floorGlyph[i] = "";
          continue;
        }
        const w = clamp(e * 1.4, 0, 1);
        const a = clamp(0.05 + lit * 0.35 + w * 0.6 + (1 - depth) * 0.05, 0, 1);
        if (a < 0.06) {
          floorGlyph[i] = "";
          continue;
        }
        floorGlyph[i] = lit > 0.5 ? ":" : g;
        floorColor[i] = style(lerp(sky.dot[0], sky.glow[0], w), lerp(sky.dot[1], sky.glow[1], w), lerp(sky.dot[2], sky.glow[2], w), a);
      }
    }
  }

  const snow = [];

  function drawSnow(dt, t) {
    while (snow.length < Math.round(cols * rows * 0.004)) snow.push({ x: rand(0, W), y: rand(surfaceY, bedY), v: rand(4, 12), ph: rand(0, 6) });
    const c3 = mix(sky.dot, [255, 255, 255], 0.3);
    for (const p of snow) {
      p.y += p.v * dt;
      p.x += Math.sin(t * 0.3 + p.ph) * dt * 4;
      if (p.y > bedY) {
        p.y = surfaceY;
        p.x = rand(0, W);
      }
      put(Math.floor(p.x / cw), Math.floor(p.y / ch), "·", style(c3[0], c3[1], c3[2], 0.35));
    }
  }

  /** Side view: kelp rooted in the seabed below the screen, swaying with the swell. */
  function drawKelp(t) {
    const kelp = mix([30, 60, 50], [90, 150, 80], sky.day);
    const strands = Math.max(3, Math.round(cols / 24));
    for (let k = 0; k < strands; k++) {
      const c0 = Math.round(hash2(k, 1, 77) * cols), len = Math.round((0.25 + hash2(k, 2, 77) * 0.35) * (bedRow - surfaceRow));
      for (let j = 0; j < len; j++) {
        const sway = Math.sin(t * 0.6 + k * 1.7 - j * 0.12) * j * 0.12 + Math.sin(t * 0.25 + k) * j * 0.05;
        const c = Math.round(c0 + sway);
        put(c, bedRow - j, j % 3 === 0 ? (sway > 0 ? ")" : "(") : "|", style(kelp[0], kelp[1], kelp[2], 0.6 - (j / len) * 0.25));
        if (j % 4 === 2) put(c + (k % 2 ? 1 : -1), bedRow - j, k % 2 ? ">" : "<", style(kelp[0], kelp[1], kelp[2], 0.45));
      }
    }
  }

  /** Top view: each animal's shadow on the sand, further off the deeper the floor below it. */
  function drawShadows() {
    const strength = 0.08 + 0.2 * sky.day;
    const st = style(sky.deep[0] * 0.4, sky.deep[1] * 0.5, sky.deep[2] * 0.6, strength);
    solid.each((i, c, r, d) => {
      const lift = (d - D0 * 1.2) / Math.min(W, H);
      const sc = c + Math.round(lift * 8), sr = r + Math.round(lift * 4);
      if (sc < 0 || sr < 0 || sc >= cols || sr >= rows) return;
      if (!solid.covered(sr * cols + sc)) put(sc, sr, "#", st);
    });
  }

  // ------------------------------------------------------------------ HUD

  const HUD_ROW = 1;
  let hud = [];

  function drawHUD() {
    hud = [];
    if (!hudVisible) return;
    const lit = pointer.active && pointer.y < (HUD_ROW + 3) * ch;
    const ink = view === "top" && sky.day > 0.5 ? [16, 60, 80] : [200, 226, 236];
    const hot = [255, 196, 90];
    let c = 2;
    const item = (str, on, act) => {
      const col = on ? hot : ink;
      grid.text(c, HUD_ROW, str, style(col[0], col[1], col[2], lit ? 0.95 : on ? 0.7 : 0.45));
      if (act) hud.push({ c0: c, c1: c + str.length - 1, act });
      c += str.length + 1;
    };
    item("[V]", false);
    for (const v of VIEWS) item(v, v === view, () => setView(v));
    c += 2;
    item("[S]", false);
    for (const s of SPECIES) item(s, s === species, () => setSpecies(s));
    if (lit) {
      c += 2;
      item("[H hide]", false, () => (hudVisible = false));
    }
  }

  function setSpecies(name) {
    if (name === species) return;
    species = name;
    spawnAll();
    api.links.rekey();
  }

  window.addEventListener("keydown", (e) => {
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
    if (e.key === "v" || e.key === "V") setView(view === "top" ? "side" : "top");
    else if (e.key === "s" || e.key === "S") setSpecies(SPECIES[(SPECIES.indexOf(species) + 1) % SPECIES.length]);
    else if (e.key === "h" || e.key === "H") hudVisible = !hudVisible;
  });

  // ------------------------------------------------------------ the scene

  let rainTimer = 4;

  function step(dt, t) {
    const now = performance.now();
    const hour = currentHour(now);
    if (Math.abs(hour - sky.hour) > 0.02 && now - skyPainted > 250) {
      setSky(hour);
      grid.repaintBackdrop();
      skyPainted = now;
    }
    link.begin();
    keepInView();
    for (const a of animals) {
      if (a.away) continue;
      if (a.crossing) crossAnimal(a, dt);
      else stepAnimal(a, dt, t);
      if (link.update(a, dt)) a.gone = true;
    }
    for (let i = animals.length - 1; i >= 0; i--) if (animals[i].gone) animals.splice(i, 1);
    link.end();
    stepFish(dt, t);
    stepSpouts(dt);
    diffuseEnergy();
    if (view === "top" && (rainTimer -= dt) <= 0) {
      const x = rand(0, W), y = rand(0, H);
      addRipple(x, y, 0.35, rand(60, 140));
      addEnergy(x, y, 0.5);
      rainTimer = rand(3, 8);
    }
  }

  function draw(t, dt) {
    frameNo++;
    if (view === "top") drawFloor(t);
    else drawWater(t);
    for (let i = 0; i < glyph.length; i++) {
      glyph[i] = floorGlyph[i];
      color[i] = floorColor[i];
    }
    if (view === "side") {
      drawSnow(dt, t);
      drawKelp(t);
    }
    drawFood(dt, t);
    drawFish();

    solid.begin();
    for (const a of animals) {
      if (a.away) continue;
      if (a.kind === "manta") drawManta(a);
      else drawWhale(a);
    }
    if (view === "top") drawShadows();
    solid.resolve();

    drawRipples(dt);
    drawSpouts();
    drawHUD();
  }

  function pointerMove(x, y, moved) {
    addEnergy(x, y, Math.min(0.25, moved * 0.01));
  }

  function click(x, y) {
    const c = Math.floor(x / cw), r = Math.floor(y / ch);
    if (r === HUD_ROW) {
      const hit = hud.find((h) => c >= h.c0 && c <= h.c1);
      if (hit) {
        hit.act();
        return;
      }
    }
    bloom(x, y);
  }

  setSky(currentHour(performance.now()));

  // Across monitors, only the same view of the same animals line up.
  const linkKey = () => `${view}/${species}`;

  return {
    resize, paintBackdrop, step, draw, pointerMove, click, linkKey, populate,
    arrive: link.arrive,
    // From the side, the surface and the seabed aren't doors.
    linkSides: () => (view === "top" ? "lrtb" : "lr"),
    population: () => ({ ...wanted }),
    chat: false,
  };
});
