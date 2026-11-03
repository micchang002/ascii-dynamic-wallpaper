/**
 * Microducks — little two-legged robot ducks running around a playroom floor.
 *
 * After Pollen Robotics' Microduck (2026): a 25 cm biped with a wide, flat half-dome head
 * (one camera eye in a grey face), a flat bill whose lower plate drops open to pick things
 * up, a black servo neck, straight legs whose knees bend forward, chunky two-tone feet and
 * a waddling gait, in cream, sky, lavender and graphite. It learns by trial and error, so it falls over a
 * lot and gets itself back up; it roller-skates, follows a laser dot, plays football and
 * races with its friends, and each one chirps in its own little voice.
 *
 * Each duck is a small 3D rig (head shell and face, bill, neck, body on a hip block, two
 * legs solved with two-bone IK) projected from its heading, so it turns smoothly from side-on to facing
 * you. The floor has depth: ducks walk toward and away from you and are drawn far to near.
 *
 * On their own they wander, look around, look at you, sit (and doze), dance, chat with
 * each other, roller-skate (sometimes wiping out, sometimes ending in a spin), carry toys
 * to the basket and back out, kick the ball about, walk to the dock to recharge when the
 * battery runs low, and now and then line up for a race across the room.
 *
 * Play: move the cursor and they chase it like a laser dot (pecking at it on the floor,
 * hopping at it on the wall); rest it on a duck to pet it; click a duck to boop it; click
 * anywhere else to drop a toy (ball, sock, block, rubber duck).
 *
 * URL params: ducks=4 (1–8), hour=13.5, cycle=120, pose=all (a still line-up: every
 * colourway from several angles, standing, sitting and with the bill open).
 */
Wallpaper.scene("microduck", (api) => {
  "use strict";

  const { grid, params, intParam, floatParam, pointer, setTheme } = api;
  const { clamp, lerp, smoothstep, wrapAngle, rand, hash2 } = Wallpaper.math;
  const style = Wallpaper.style;
  const shapes = Wallpaper.shapes;
  const PI = Math.PI;

  const GALLERY = params.get("pose") === "all";
  const COUNT = GALLERY ? 8 : clamp(intParam("ducks", 4), 1, 8);
  const PIN_HOUR = floatParam("hour", NaN);
  const CYCLE = floatParam("cycle", 0);
  const startTime = performance.now();
  let daylight = 0;
  let paintedDaylight = -1;

  function updateDaylight(now = performance.now()) {
    const d = new Date();
    const clock = Number.isFinite(PIN_HOUR) ? PIN_HOUR : d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
    const hour = CYCLE > 0 ? (clock + ((now - startTime) / 1000 / CYCLE) * 24) % 24 : clock;
    daylight = smoothstep(5.5, 8, hour) * (1 - smoothstep(17.5, 20.5, hour));
  }
  const mixColor = (night, day, amount) => `rgb(${night.map((v, i) => Math.round(lerp(v, day[i], amount))).join(",")})`;

  /** The four colourways, as on the real robots: shell, bill, eye ring, foot block and sole. */
  const LOOKS = [
    { shell: [236, 232, 222], beak: [244, 108, 44], ring: [250, 180, 36], foot: [250, 180, 36], sole: [244, 108, 44] }, // cream
    { shell: [140, 202, 236], beak: [244, 108, 44], ring: [250, 180, 36], foot: [244, 108, 44], sole: [250, 196, 50] }, // sky
    { shell: [192, 168, 228], beak: [246, 214, 60], ring: [120, 204, 236], foot: [246, 214, 60], sole: [156, 116, 214] }, // lavender
    { shell: [118, 120, 130], beak: [246, 214, 60], ring: [150, 108, 214], foot: [246, 214, 60], sole: [156, 116, 214] }, // graphite
  ];
  /** Black servos (lifted a little so they read on the dark floor), their silver horns, the grey face. */
  const JOINT = [84, 88, 102];
  const SILVER = [196, 200, 210];
  const FACE = [150, 152, 160];
  const EYE = [22, 24, 32];
  /** Every duck has its own voice. */
  const VOICES = [
    ["pip", "pip!", "pi-pip!"], ["kwa", "kwak!", "kwa-kwa!"], ["bip", "boop!", "bip-bop!"], ["wee", "wii!", "weee!"],
    ["mip", "meep!", "mi-mip!"], ["du", "duu!", "du-du!"], ["tik", "tiki!", "tik-tik!"], ["nyap", "nya!", "nya-nya!"],
  ];

  let W = 0, H = 0, cw = 10, ch = 15, cols = 0, rows = 0;
  /** A duck's height up close (px); the floor's back and front edges; px of depth per unit z. */
  let U = 100, floorTop = 0, floorBot = 0, DEPTH = 1;
  /** Set a cell's glyph, keeping any fill behind it (so a detail on a part doesn't punch a hole). */
  const put = (c, r, g, st) => {
    if (c < 0 || r < 0 || c >= cols || r >= rows) return;
    grid.glyph[r * cols + c] = g;
    grid.color[r * cols + c] = st;
  };
  /** z runs 0 (against the wall) to 1 (right in front). */
  const groundY = (z) => lerp(floorTop + U * 0.22, floorBot, z);
  const zAt = (y) => clamp((y - floorTop - U * 0.22) / (floorBot - floorTop - U * 0.22), 0, 1);
  const scaleAt = (z) => lerp(0.6, 1, z);
  const unit = (o) => U * scaleAt(o.z);
  const minX = () => U * 0.4;
  const maxX = () => W - U * 0.4;
  const pick = (list) => list[Math.floor(Math.random() * list.length)];

  const ducks = [];
  const toys = [];
  const particles = [];
  const dock = { x: 0, z: 0.06 };
  const basket = { x: 0, z: 0.1 };
  const laser = { on: false, x: 0, z: 0, floor: true };
  let hovered = null, petting = null;
  let race = null, raceTimer = rand(60, 120);
  let rug = [], stars = [];
  const win = { x0: 0, y0: 0, x1: 0, y1: 0 };

  // ------------------------------------------------------------ layout

  function resize() {
    ({ W, H, cw, ch, cols, rows } = grid);
    U = clamp(Math.min(W, H) * 0.3, ch * 12, ch * 34);
    floorTop = Math.round(H * 0.5);
    floorBot = H - Math.max(ch * 2, U * 0.1);
    DEPTH = (floorBot - floorTop) * 2.2;
    dock.x = Math.max(U * 0.9, W * 0.1);
    basket.x = W - Math.max(U * 0.9, W * 0.1);
    Object.assign(win, { x0: W * 0.36, x1: W * 0.64, y0: H * 0.1, y1: floorTop - H * 0.12 });

    rug = [];
    const cx = W * 0.5, cz = 0.55, rx = W * 0.22, rz = 0.3;
    for (let r = Math.floor(groundY(cz - rz) / ch); r <= Math.ceil(groundY(cz + rz) / ch); r++) {
      const z = zAt((r + 0.5) * ch);
      for (let c = Math.floor((cx - rx) / cw); c <= Math.ceil((cx + rx) / cw); c++) {
        const d = Math.hypot(((c + 0.5) * cw - cx) / rx, (z - cz) / rz);
        if (d >= 1) continue;
        const ring = Math.floor(d * 6);
        const edge = ring === 5;
        const rgb = edge ? [150, 96, 108] : ring % 2 ? [92, 120, 140] : [130, 96, 112];
        const g = edge ? (hash2(c, r, 3) < 0.5 ? "~" : "-") : hash2(c, r, 5) < 0.55 ? "" : ring % 2 ? "·" : "-";
        if (!g) continue;
        rug.push([c, r, g, style(rgb[0], rgb[1], rgb[2], edge ? 0.4 : 0.22)]);
      }
    }

    stars = [];
    for (let r = Math.ceil(win.y0 / ch) + 1; r < Math.floor(win.y1 / ch) - 1; r++) {
      for (let c = Math.ceil(win.x0 / cw) + 1; c < Math.floor(win.x1 / cw) - 1; c++) {
        const n = hash2(c, r, 17);
        if (n > 0.95) stars.push({ c, r, g: n > 0.99 ? "*" : n > 0.975 ? "+" : ".", ph: hash2(c, r, 2) * 9 });
      }
    }

    if (!ducks.length) for (let i = 0; i < COUNT; i++) ducks.push(makeDuck(i));
    if (GALLERY) {
      // Back row standing at four angles, front row sitting / bill open.
      const yaws = [PI / 2, 0.7, 0, -PI / 2, 0.4, -0.5, PI / 2, PI];
      ducks.forEach((d, i) => Object.assign(d, { x: W * (0.2 + (i % 4) * 0.2), z: i < 4 ? 0.3 : 0.95, yaw: yaws[i], act: "gallery", pose: i }));
      toys.length = 0;
      return;
    }
    if (!toys.length) for (const kind of ["ball", "sock", "block", "ducky"]) toys.push(makeToy(kind, rand(W * 0.2, W * 0.8), rand(0.2, 0.9), 0));
    for (const o of [...ducks, ...toys]) o.x = clamp(o.x, minX(), maxX());
  }

  function paintBackdrop(g, w, h) {
    updateDaylight();
    paintedDaylight = daylight;
    const wall = g.createLinearGradient(0, 0, 0, floorTop);
    wall.addColorStop(0, mixColor([34, 43, 64], [112, 164, 198], daylight));
    wall.addColorStop(1, mixColor([58, 66, 94], [224, 202, 166], daylight));
    g.fillStyle = wall;
    g.fillRect(0, 0, w, floorTop);

    // A lamp somewhere off to the right warms the wall.
    const lamp = g.createRadialGradient(w * 0.8, floorTop * 0.6, 0, w * 0.8, floorTop * 0.6, w * 0.45);
    lamp.addColorStop(0, `rgba(255,190,120,${lerp(0.18, 0.04, daylight)})`);
    lamp.addColorStop(1, "rgba(255,190,120,0)");
    g.fillStyle = lamp;
    g.fillRect(0, 0, w, h);

    // The window shifts from a starry night to a bright daytime sky.
    const sky = g.createLinearGradient(0, win.y0, 0, win.y1);
    sky.addColorStop(0, mixColor([18, 30, 54], [92, 174, 226], daylight));
    sky.addColorStop(1, mixColor([42, 64, 98], [238, 211, 160], daylight));
    g.fillStyle = sky;
    g.fillRect(win.x0, win.y0, win.x1 - win.x0, win.y1 - win.y0);
    const mx = lerp(win.x0, win.x1, 0.75), my = lerp(win.y0, win.y1, 0.3), mr = (win.y1 - win.y0) * 0.1;
    g.fillStyle = mixColor([232, 236, 246], [255, 220, 112], daylight);
    g.beginPath();
    g.arc(mx, my, mr, 0, PI * 2);
    g.fill();
    if (daylight < 0.8) {
      g.globalAlpha = 1 - daylight;
      for (const s of stars) {
        const x = (s.c + 0.5) * cw, y = (s.r + 0.5) * ch;
        g.fillStyle = "rgba(245,248,255,0.8)";
        g.fillRect(x, y, Math.max(1, cw * 0.12), Math.max(1, ch * 0.12));
      }
      g.globalAlpha = 1;
    }
    g.strokeStyle = mixColor([58, 53, 80], [112, 132, 148], daylight);
    g.lineWidth = Math.max(4, cw * 0.8);
    g.strokeRect(win.x0, win.y0, win.x1 - win.x0, win.y1 - win.y0);
    g.lineWidth = Math.max(2, cw * 0.4);
    g.beginPath();
    g.moveTo((win.x0 + win.x1) / 2, win.y0);
    g.lineTo((win.x0 + win.x1) / 2, win.y1);
    g.moveTo(win.x0, (win.y0 + win.y1) / 2);
    g.lineTo(win.x1, (win.y0 + win.y1) / 2);
    g.stroke();

    // Bunting along the top of the wall, in the ducks' colours.
    const n = Math.max(8, Math.round(w / 90));
    g.strokeStyle = "rgba(200,200,220,0.35)";
    g.lineWidth = 1.5;
    g.beginPath();
    const sag = (x) => h * 0.05 + Math.sin((x / w) * PI) * h * 0.05;
    for (let x = 0; x <= w; x += 8) g.lineTo(x, sag(x));
    g.stroke();
    for (let i = 0; i < n; i++) {
      const x = ((i + 0.5) / n) * w, y = sag(x), s = Math.min(26, w / n * 0.32);
      const [r, gg, b] = LOOKS[i % LOOKS.length].shell;
      g.fillStyle = `rgba(${r},${gg},${b},0.55)`;
      g.beginPath();
      g.moveTo(x - s, y);
      g.lineTo(x + s, y);
      g.lineTo(x, y + s * 1.6);
      g.fill();
    }

    // Skirting board and a wooden floor in perspective.
    g.fillStyle = mixColor([56, 52, 80], [146, 126, 104], daylight);
    g.fillRect(0, floorTop - ch * 0.6, w, ch * 0.6);
    const floor = g.createLinearGradient(0, floorTop, 0, h);
    floor.addColorStop(0, mixColor([56, 43, 50], [138, 104, 72], daylight));
    floor.addColorStop(1, mixColor([82, 62, 52], [194, 151, 103], daylight));
    g.fillStyle = floor;
    g.fillRect(0, floorTop, w, h - floorTop);
    g.strokeStyle = "rgba(0,0,0,0.28)";
    g.lineWidth = 1;
    const vx = w / 2, vy = floorTop - h * 0.9;
    for (let i = -24; i <= 24; i++) {
      const xb = w / 2 + i * w * 0.07;
      const t0 = (floorTop - vy) / (h - vy);
      g.beginPath();
      g.moveTo(lerp(vx, xb, t0), floorTop);
      g.lineTo(xb, h);
      g.stroke();
    }
    for (let k = 1; k < 12; k++) {
      const y = floorTop + (h - floorTop) * (k / 12) ** 1.6;
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y);
      g.stroke();
    }
  }

  function refreshBackdrop() {
    updateDaylight();
    return Math.abs(daylight - paintedDaylight) >= 0.005;
  }

  // ------------------------------------------------------------- things

  function makeDuck(i) {
    return {
      i, look: LOOKS[i % LOOKS.length], rgb: LOOKS[i % LOOKS.length].shell, voice: VOICES[i % VOICES.length], curious: rand(0.5, 1),
      x: rand(W * 0.15, W * 0.85), z: rand(0.15, 0.95), vx: 0, vd: 0,
      yaw: rand(-PI, PI), yawGoal: null, headYaw: 0,
      act: "idle", stage: 0, t: 0, dur: rand(0.5, 2), tx: 0, tz: 0, toy: null, partner: null, resume: null,
      glance: 0, glanceT: 0, next: 0, beat: -1, flag: false, nap: false, spin: false, lane: 0, place: -1, raceSpeed: 1,
      phase: rand(0, 6), gait: 0, tip: 0, tipV: 0, tipDir: 1,
      hip: 1, lean: 0, tilt: 0, pitch: 0, open: 0, lift: 0, kick: 0, skate: 0, happy: 0, eyes: "open",
      blink: rand(1, 4), battery: rand(0.45, 1), bubble: null,
      bbox: null, beak: [0, 0], top: [0, 0],
    };
  }

  function makeToy(kind, x, z, y) {
    return { kind, x, z, y, vx: 0, vd: 0, vy: 0, spin: 0, held: null, claim: null, inBasket: false, hitCd: 0, kicker: null, letter: pick(["A", "B", "C", "D"]) };
  }

  function chirp(d, text) {
    d.bubble = { text: text || pick(d.voice), life: 1.6 };
  }

  function emit(x, y, g, rgb, vx = 0, vy = -20, life = 1.4) {
    particles.push({ x, y, g, rgb, vx, vy, life, max: life });
  }

  // ---------------------------------------------------------- behaviour

  /** Behaviours the cursor's laser dot can interrupt, and ones petting can't. */
  const CALM = new Set(["idle", "wander", "look", "sit", "dance", "chat", "kick"]);
  const NO_PET = new Set(["fall", "race", "boop"]);
  const CHATTY = new Set(["idle", "look", "wander"]);

  function lookYaw(d, x, z) {
    return Math.atan2(x - d.x, (z - d.z) * DEPTH);
  }

  function approachVel(d, vx, vd, dt, rate = 5) {
    const k = Math.min(1, dt * rate);
    d.vx += (vx - d.vx) * k;
    d.vd += (vd - d.vd) * k;
  }

  const stop = (d, dt, rate = 7) => approachVel(d, 0, 0, dt, rate);

  /** Head for (tx, tz) at `speed` px/s, easing in on arrival; returns the distance left. */
  function steer(d, tx, tz, speed, dt, rate = 5) {
    const dx = tx - d.x, dd = (tz - d.z) * DEPTH, dist = Math.hypot(dx, dd);
    const s = dist > 1 ? (speed * Math.min(1, dist / (unit(d) * 0.25))) / dist : 0;
    approachVel(d, dx * s, dd * s, dt, rate);
    return dist;
  }

  /** Drop whatever d is carrying and let go of anything it had its eye on. */
  function release(d) {
    for (const o of toys) {
      if (o.held === d) dropToy(d, o, false);
      if (o.claim === d) o.claim = null;
    }
  }

  function dropToy(d, o, intoBasket) {
    o.held = null;
    o.claim = null;
    o.z = clamp(d.z + (Math.cos(d.yaw) * 0.22 * unit(d)) / DEPTH, 0, 1);
    o.x = clamp(d.beak[0], minX(), maxX());
    o.y = Math.max(0, groundY(o.z) - d.beak[1] - toyH(o, unit(o)) * 0.6);
    o.vx = d.vx * 0.5;
    o.vd = d.vd * 0.5;
    o.vy = 0;
    if (intoBasket) intoTheBasket(o);
  }

  function intoTheBasket(o) {
    o.inBasket = true;
    o.x = basket.x + rand(-0.28, 0.28) * U * scaleAt(basket.z);
    o.z = basket.z;
    o.y = o.vx = o.vd = o.vy = 0;
  }

  function start(d, act, arg) {
    release(d);
    d.act = act;
    d.stage = 0;
    d.t = 0;
    d.toy = null;
    d.partner = null;
    d.glanceT = 0;
    d.flag = false;
    d.beat = -1;
    const W2 = W / 2;
    switch (act) {
      case "idle": d.dur = rand(0.8, 2.5); break;
      case "wander":
        d.tx = rand(minX(), maxX());
        d.tz = rand(0.05, 1);
        d.fast = Math.random() < 0.25;
        d.dur = 15;
        break;
      case "look": d.dur = rand(2.2, 4); chirp(d); break;
      case "sit": d.dur = rand(4, 9); d.nap = Math.random() < 0.45; break;
      case "dance": d.dur = rand(4, 7); break;
      case "skate":
        d.tx = d.x < W2 ? rand(W * 0.62, maxX()) : rand(minX(), W * 0.38);
        d.tz = rand(0.1, 0.95);
        break;
      case "fetch": d.toy = arg; arg.claim = d; break;
      case "kick":
        d.toy = arg;
        d.tx = arg.x < W2 ? rand(W * 0.6, maxX()) : rand(minX(), W * 0.4);
        d.tz = rand(0.1, 0.95);
        break;
      case "chat": d.partner = arg; d.dur = rand(3.5, 6); break;
      case "pet": d.next = 0.5; break;
      case "boop": chirp(d, d.voice[2]); break;
    }
  }

  function think(d) {
    if (d.battery < 0.2) return start(d, "charge");
    const free = toys.filter((o) => !o.held && !o.claim);
    const ball = toys.find((o) => o.kind === "ball" && !o.held && !o.claim && !o.inBasket);
    const mate = ducks.find((o) => o !== d && CHATTY.has(o.act) && Math.abs(o.x - d.x) < W * 0.35);
    const menu = [
      ["wander", 3], ["idle", 1.4], ["look", 1], ["sit", 0.7], ["dance", 0.7], ["skate", 0.6],
      ["fetch", free.length ? 1.8 : 0], ["kick", ball ? 1.4 : 0], ["chat", mate ? 1 : 0],
    ];
    let r = rand(0, menu.reduce((s, [, w]) => s + w, 0));
    const [act] = menu.find(([, w]) => (r -= w) <= 0) || menu[0];
    if (act === "fetch") return start(d, act, pick(free));
    if (act === "kick") return start(d, act, ball);
    if (act === "chat") {
      start(mate, "chat", d);
      return start(d, "chat", mate);
    }
    start(d, act);
  }

  /** Over it goes: forward if it was facing sideways, else to either side. */
  function fall(d, resume) {
    start(d, "fall");
    d.resume = resume || null;
    const s = Math.sin(d.yaw);
    d.tipDir = Math.abs(s) > 0.3 ? Math.sign(s) : Math.random() < 0.5 ? -1 : 1;
    d.tipV = d.tipDir * 2;
    chirp(d, "!?");
    const u = unit(d), G = groundY(d.z);
    for (let k = 0; k < 6; k++) emit(d.x + d.tipDir * u * 0.4 + rand(-1, 1) * u * 0.2, G, pick([".", "'", "`"]), [190, 170, 150], rand(-1, 1) * u * 0.6, -rand(0.2, 0.6) * u, 0.6);
  }

  /** Each behaviour: fn(d, dt, t, u, P) sets pose targets in P and moves d. */
  const ACTS = {
    gallery(d, dt, t, u, P) {
      stop(d, dt);
      d.yawGoal = d.yaw;
      if (d.pose === 4 || d.pose === 5) P.hip = 0.2;
      if (d.pose === 6) P.open = 1;
    },

    idle(d, dt, t, u, P) {
      stop(d, dt);
      lookAround(d, P);
      if (d.t > d.dur) think(d);
    },

    wander(d, dt, t, u, P) {
      const dist = steer(d, d.tx, d.tz, (d.fast ? 1.5 : 0.85) * u, dt);
      P.lean = d.fast ? 0.15 : 0;
      if (Math.random() < dt * 0.012) return fall(d);
      if (dist < u * 0.1 || d.t > d.dur) start(d, "idle");
    },

    look(d, dt, t, u, P) {
      stop(d, dt);
      d.yawGoal = 0;
      P.head = wrapAngle(-d.yaw);
      P.tilt = (Math.floor(d.t / 1.1) % 2 ? 0.35 : -0.25) * Math.min(1, d.t * 2);
      if (d.t > d.dur) think(d);
    },

    sit(d, dt, t, u, P) {
      stop(d, dt);
      P.hip = 0.2;
      P.lean = -0.05;
      if (d.nap && d.t > 2) {
        P.eyes = "closed";
        P.pitch = 0.3 + Math.sin(t * 1.5) * 0.05;
        snore(d, t);
      } else lookAround(d, P);
      if (d.t > d.dur) think(d);
    },

    dance(d, dt, t, u, P) {
      stop(d, dt);
      d.yawGoal = Math.sin(d.t * 1.4) * 0.7;
      P.stepping = 0.7;
      P.lift = Math.abs(Math.sin(d.t * 6)) * 0.04;
      P.tilt = Math.sin(d.t * 3) * 0.3;
      P.pitch = Math.sin(d.t * 6) * 0.15;
      P.eyes = "happy";
      P.happy = 0.6;
      if (d.t > d.next) {
        d.next = d.t + rand(0.5, 0.9);
        emit(d.top[0] + rand(-1, 1) * u * 0.3, d.top[1], pick(["♪", "♫"]), d.rgb, rand(-1, 1) * u * 0.2, -u * 0.4, 1.4);
      }
      if (d.t > d.dur) think(d);
    },

    skate(d, dt, t, u, P) {
      P.skate = 1;
      if (d.stage === 0) {
        // Skates on.
        stop(d, dt);
        P.hip = 0.7;
        P.pitch = 0.5;
        if (d.t > 0.7) {
          d.stage = 1;
          d.t = 0;
          chirp(d, d.voice[1]);
        }
      } else if (d.stage === 1) {
        const dist = steer(d, d.tx, d.tz, 2.6 * u, dt, 2.2);
        P.lean = 0.3;
        P.hip = 0.8;
        if (Math.random() < dt * 0.07) return fall(d);
        if (dist < u * 0.3 || d.t > 8) {
          d.stage = 2;
          d.t = 0;
          d.spin = Math.random() < 0.6;
        }
      } else if (d.stage === 2) {
        // Glide to a stop, sometimes with a pirouette.
        stop(d, dt, 2.5);
        if (d.spin && d.t < 0.8) d.yaw += dt * 15;
        d.yawGoal = d.yaw;
        P.hip = 0.9;
        P.tilt = d.spin ? 0.3 : 0;
        if (d.t > 1.2) {
          d.stage = 3;
          d.t = 0;
          if (d.spin) chirp(d, "✦");
        }
      } else {
        stop(d, dt);
        P.skate = 0;
        P.hip = 0.75;
        P.pitch = 0.5;
        if (d.t > 0.7) think(d);
      }
    },

    fetch(d, dt, t, u, P) {
      const o = d.toy;
      if (!o || (o.held && o.held !== d) || d.t > 25) return think(d);
      const reach = 0.24 * u;
      if (d.stage === 0) {
        // Stand where the beak reaches it (in front of the basket, for one in there).
        let sx, sz;
        if (o.inBasket) [sx, sz] = [o.x, o.z + reach / DEPTH];
        else {
          const dx = o.x - d.x, dd = (o.z - d.z) * DEPTH, l = Math.hypot(dx, dd) || 1;
          [sx, sz] = [o.x - (dx / l) * reach, o.z - (dd / l) * reach / DEPTH];
        }
        const dist = steer(d, sx, sz, u, dt);
        P.head = wrapAngle(lookYaw(d, o.x, o.z) - d.yaw);
        if (dist < u * 0.08) {
          d.stage = 1;
          d.t = 0;
          d.fromBasket = o.inBasket;
        }
      } else if (d.stage === 1) {
        // Bend down, open, close on it.
        stop(d, dt);
        d.yawGoal = lookYaw(d, o.x, o.z);
        Object.assign(P, { hip: 0.3, lean: 0.5, pitch: 1.2, open: d.t < 0.55 ? 1 : 0 });
        if (d.t > 0.55 && !o.held) {
          o.held = d;
          o.inBasket = false;
        }
        if (d.t > 1) {
          d.stage = 2;
          d.t = 0;
          d.toBasket = !d.fromBasket && Math.random() < 0.7;
          if (d.toBasket) [d.tx, d.tz] = [basket.x + rand(-0.2, 0.2) * U * scaleAt(basket.z), basket.z + reach / DEPTH];
          else [d.tx, d.tz] = [rand(minX(), maxX()), rand(0.25, 1)];
        }
      } else if (d.stage === 2) {
        const dist = steer(d, d.tx, d.tz, 0.9 * u, dt);
        P.pitch = 0.15;
        if (dist < u * 0.08) {
          d.stage = 3;
          d.t = 0;
        }
      } else {
        stop(d, dt);
        if (d.toBasket) d.yawGoal = PI;
        Object.assign(P, { lean: 0.3, pitch: 0.6, hip: 0.7, open: d.t > 0.35 ? 1 : 0 });
        if (d.t > 0.35 && o.held === d) {
          dropToy(d, o, d.toBasket);
          chirp(d);
        }
        if (d.t > 0.8) think(d);
      }
    },

    kick(d, dt, t, u, P) {
      const b = d.toy;
      if (!b || b.held || b.inBasket || d.t > 12) return think(d);
      if (d.stage === 0) {
        // Get behind the ball, lined up with where it should go.
        const ax = d.tx - b.x, ad = (d.tz - b.z) * DEPTH, l = Math.hypot(ax, ad) || 1;
        d.ax = ax / l;
        d.ad = ad / l;
        const dist = steer(d, b.x - d.ax * 0.3 * u, b.z - (d.ad * 0.3 * u) / DEPTH, 1.3 * u, dt);
        P.head = wrapAngle(lookYaw(d, b.x, b.z) - d.yaw);
        if (dist < u * 0.1 && Math.hypot(b.vx, b.vd) < u * 0.5) {
          d.stage = 1;
          d.t = 0;
        }
      } else {
        stop(d, dt);
        d.yawGoal = Math.atan2(d.ax, d.ad);
        P.kick = d.t < 0.18 ? -0.6 : 1;
        P.lean = -0.1;
        if (!d.flag && d.t > 0.18) {
          d.flag = true;
          if (Math.hypot(b.x - d.x, (b.z - d.z) * DEPTH) < u * 0.7) {
            const v = U * rand(2.5, 4);
            Object.assign(b, { vx: d.ax * v, vd: d.ad * v, vy: U * rand(0.3, 1), kicker: d });
            chirp(d, "!");
          }
        }
        if (d.t > 0.5) Math.random() < 0.4 ? start(d, "kick", b) : think(d);
      }
    },

    chat(d, dt, t, u, P) {
      const m = d.partner;
      if (!m || m.act !== "chat" || m.partner !== d || d.t > d.dur) return think(d);
      const dx = d.x - m.x, dd = (d.z - m.z) * DEPTH, dist = Math.hypot(dx, dd) || 1;
      if (dist > u * 0.95) {
        steer(d, m.x + (dx / dist) * u * 0.75, m.z + (dd / dist) * u * 0.75 / DEPTH, 0.9 * u, dt);
        return;
      }
      stop(d, dt);
      d.yawGoal = lookYaw(d, m.x, m.z);
      // Take turns.
      const beat = Math.floor(d.t / 0.9);
      if (beat % 2 === (d.i < m.i ? 0 : 1)) {
        P.open = Math.max(0, Math.sin(d.t * 18)) * 0.7;
        P.tilt = 0.15;
        if (beat !== d.beat) {
          d.beat = beat;
          chirp(d);
        }
      } else P.tilt = -0.25;
    },

    charge(d, dt, t, u, P) {
      const tx = dock.x + ((d.i % 2) - 0.5) * 0.6 * U * scaleAt(dock.z), tz = dock.z + 0.05;
      if (d.stage === 0) {
        const dist = steer(d, tx, tz, 0.75 * u, dt);
        P.hip = 0.85;
        P.pitch = 0.25;
        if (dist < u * 0.08 || d.t > 30) {
          d.stage = 1;
          d.t = 0;
        }
      } else if (d.stage === 1) {
        stop(d, dt);
        d.yawGoal = 0;
        P.hip = 0.2;
        P.pitch = 0.35;
        P.eyes = d.t > 0.8 ? "closed" : "open";
        d.battery += dt * 0.05;
        snore(d, t);
        if (Math.random() < dt * 0.8) emit(d.x + rand(-1, 1) * u * 0.2, d.top[1] + u * 0.4, "+", [120, 240, 150], 0, -u * 0.3, 1);
        if (d.battery >= 1) {
          d.battery = 1;
          d.stage = 2;
          d.t = 0;
          chirp(d, d.voice[2]);
        }
      } else {
        // Up and stretch.
        stop(d, dt);
        Object.assign(P, { hip: 1, pitch: -0.5, tilt: Math.sin(d.t * 6) * 0.2, eyes: "happy", lift: d.t < 0.4 ? 0.06 : 0 });
        if (d.t > 1.2) think(d);
      }
    },

    fall(d, dt, t, u, P) {
      stop(d, dt);
      const down = d.stage <= 1;
      d.tipV += (((down ? d.tipDir * 1.45 : 0) - d.tip) * (down ? 80 : 45) - d.tipV * (down ? 9 : 5.5)) * dt;
      d.tip += d.tipV * dt;
      P.eyes = "wide";
      if (d.stage === 0) {
        if (d.t > 0.6) {
          d.stage = 1;
          d.t = 0;
          d.dur = rand(1, 2);
        }
      } else if (d.stage === 1) {
        // Lie there, legs paddling.
        P.paddle = true;
        P.pitch = Math.sin(d.t * 3) * 0.3;
        if (d.t > d.dur) {
          d.stage = 2;
          d.t = 0;
        }
      } else if (d.stage === 2) {
        P.hip = 0.45;
        P.eyes = "open";
        if (d.t > 1.1) {
          d.stage = 3;
          d.t = 0;
          d.tip = d.tipV = 0;
        }
      } else {
        // Shake it off.
        P.tilt = Math.sin(d.t * 28) * 0.35 * Math.max(0, 1 - d.t / 0.7);
        P.eyes = "closed";
        if (d.t > 0.7) {
          chirp(d);
          if (d.resume === "race" && race) {
            d.act = "race";
            d.stage = race.stage === "go" ? 2 : 0;
            d.t = 0;
          } else think(d);
        }
      }
    },

    chase(d, dt, t, u, P) {
      if (!laser.on) {
        // Where did it go?
        stop(d, dt);
        if (d.stage !== 9) {
          d.stage = 9;
          d.t = 0;
          chirp(d, "?");
        }
        P.head = Math.sin(d.t * 4) * 0.8;
        P.tilt = 0.3;
        if (d.t > 1.4) think(d);
        return;
      }
      const tx = clamp(laser.x, minX(), maxX()), tz = laser.floor ? laser.z : 0;
      const reach = (laser.floor ? 0.24 : 0.12) * u;
      const dx = tx - d.x, dd = (tz - d.z) * DEPTH, dist = Math.hypot(dx, dd) || 1;
      if (dist > reach * 1.5) {
        steer(d, tx - (dx / dist) * reach, tz - (dd / dist) * reach / DEPTH, 1.7 * u, dt);
        P.lean = 0.15;
        d.stage = 0;
        return;
      }
      stop(d, dt);
      if (laser.floor) {
        // Peck at it.
        d.yawGoal = Math.atan2(dx, dd);
        const s = Math.sin(d.t * 11);
        Object.assign(P, { hip: 0.6, lean: 0.35, pitch: 0.6 + 0.6 * Math.max(0, s), open: s > 0.6 ? 0.6 : 0 });
      } else {
        // Up on the wall: face it and hop.
        d.yawGoal = PI;
        Object.assign(P, { pitch: -0.6, lift: Math.max(0, Math.sin(d.t * 7)) * 0.14, open: 0.4 });
      }
      if (d.stage === 0) {
        d.stage = 1;
        chirp(d, "!");
      }
    },

    pet(d, dt, t, u, P) {
      stop(d, dt);
      P.eyes = "happy";
      P.happy = 1;
      if (petting !== d) {
        if (d.stage !== 9) {
          d.stage = 9;
          d.t = 0;
          chirp(d, d.voice[2]);
        }
        if (d.t > 0.8) think(d);
        return;
      }
      d.stage = 0;
      d.yawGoal = 0;
      P.head = wrapAngle(-d.yaw);
      // Leans back and nuzzles toward the cursor.
      Object.assign(P, { hip: 0.8, lean: -0.15, pitch: -0.15, tilt: clamp((pointer.x - d.x) / u, -1, 1) * 0.35 + Math.sin(t * 2) * 0.08 });
      if (d.t > d.next) {
        d.next = d.t + rand(0.9, 1.6);
        emit(d.top[0] + rand(-1, 1) * u * 0.2, d.top[1], "♥", [255, 130, 160], rand(-1, 1) * u * 0.15, -u * 0.35, 1.3);
      }
    },

    boop(d, dt, t, u, P) {
      stop(d, dt);
      d.yawGoal = 0;
      // Two little hops.
      P.lift = d.t < 1 ? Math.max(0, Math.sin(d.t * PI * 4)) * 0.16 : 0;
      P.eyes = "happy";
      P.happy = 1;
      P.open = d.t < 0.5 ? 0.6 : 0;
      if (d.t > 1.3) think(d);
    },

    race(d, dt, t, u, P) {
      if (!race || !race.ducks.includes(d)) return think(d);
      if (d.stage === 0) {
        if (steer(d, race.startX, d.lane, 1.2 * u, dt) < u * 0.1) d.stage = 1;
      } else if (d.stage === 1) {
        stop(d, dt);
        d.yawGoal = PI / 2;
        if (race.stage === "count") Object.assign(P, { hip: 0.7, lean: 0.3 });
        if (race.stage === "go") {
          d.stage = 2;
          d.t = 0;
        }
      } else if (d.stage === 2) {
        const dist = steer(d, race.finishX, d.lane, 1.8 * u * d.raceSpeed, dt);
        P.lean = 0.3;
        if (Math.random() < dt * 0.05) return fall(d, "race");
        if (dist < u * 0.15) {
          d.stage = 3;
          d.t = 0;
          d.place = race.order.push(d) - 1;
          chirp(d, d.place === 0 ? "★" : d.voice[0]);
        }
      } else {
        stop(d, dt);
        d.yawGoal = 0;
        if (d.place === 0) Object.assign(P, { lift: Math.max(0, Math.sin(d.t * 9)) * 0.12, eyes: "happy", happy: 1 });
      }
    },
  };

  function lookAround(d, P) {
    if (d.t > d.glanceT) {
      d.glance = Math.random() < 0.3 ? wrapAngle(-d.yaw) : rand(-1, 1);
      d.glanceT = d.t + rand(0.8, 2);
    }
    P.head = d.glance;
    P.tilt = clamp(d.glance, -1, 1) * 0.2;
  }

  function snore(d, t) {
    if (d.t > d.next) {
      d.next = d.t + 1.4;
      const u = unit(d);
      emit(d.top[0] + u * 0.15, d.top[1], "z", [200, 210, 255], u * 0.15, -u * 0.25, 2);
    }
  }

  const POSE = { hip: 7, lean: 6, tilt: 8, pitch: 9, open: 16, lift: 18, kick: 18, happy: 4 };

  function stepDuck(d, dt, t) {
    const u = unit(d);
    const P = { hip: 1, lean: 0, tilt: 0, pitch: 0.08, open: 0, lift: 0, kick: 0, happy: 0, skate: 0, head: 0, stepping: 0, paddle: false, eyes: "open" };
    d.t += dt;
    d.yawGoal = null;
    const busy = d.act === "skate" || d.act === "dance" || d.act === "chase" || d.act === "race" ? 3 : 1;
    if (d.act !== "charge") d.battery = Math.max(0, d.battery - dt * 0.0035 * busy);
    if (laser.on && CALM.has(d.act) && Math.random() < dt * 2.5 * d.curious) start(d, "chase");
    if (petting === d && !GALLERY && !NO_PET.has(d.act) && d.act !== "pet") start(d, "pet");
    ACTS[d.act](d, dt, t, u, P);

    // Speed sets the lean and the gait.
    const sp = Math.hypot(d.vx, d.vd);
    P.lean += 0.12 * Math.min(1, sp / u);
    for (const k in POSE) d[k] += (P[k] - d[k]) * Math.min(1, dt * POSE[k]);
    d.skate += (P.skate - d.skate) * Math.min(1, dt * 4);
    if (d.act !== "fall") {
      d.tip *= Math.max(0, 1 - dt * 8);
      d.tipV = 0;
    }
    const gWant = P.paddle ? 1 : Math.max(P.stepping, clamp(sp / (u * 0.6), 0, 1.2));
    d.gait += (gWant - d.gait) * Math.min(1, dt * 8);
    d.phase += dt * (P.paddle ? 16 : d.skate > 0.5 ? 6 : P.stepping ? 10 : 5 + 10 * Math.min(1.6, sp / u));

    // Blink now and then.
    d.blink -= dt;
    if (d.blink < -0.13) d.blink = rand(2, 5);
    d.eyes = P.eyes === "open" && d.blink < 0 ? "closed" : P.eyes;

    // Move, and face the way it's going unless told otherwise.
    d.x = clamp(d.x + d.vx * dt, minX(), maxX());
    d.z = clamp(d.z + (d.vd / DEPTH) * dt, 0, 1);
    let goal = d.yawGoal;
    if (goal == null && sp > u * 0.15) goal = Math.atan2(d.vx, d.vd);
    if (goal != null) d.yaw += wrapAngle(goal - d.yaw) * Math.min(1, dt * 6);
    d.headYaw += (clamp(P.head, -1.2, 1.2) - d.headYaw) * Math.min(1, dt * 5);

    if (d.bubble && (d.bubble.life -= dt) <= 0) d.bubble = null;
  }

  /** Ducks don't walk through each other. */
  function separate() {
    for (let i = 0; i < ducks.length; i++) {
      for (let j = i + 1; j < ducks.length; j++) {
        const a = ducks[i], b = ducks[j];
        if (Math.abs(a.tip) > 0.3 || Math.abs(b.tip) > 0.3) continue;
        const dx = b.x - a.x, dd = (b.z - a.z) * DEPTH, dist = Math.hypot(dx, dd) || 1;
        const min = (unit(a) + unit(b)) * 0.23;
        if (dist >= min) continue;
        const push = ((min - dist) / dist) * 0.25;
        a.x -= dx * push;
        b.x += dx * push;
        a.z = clamp(a.z - (dd * push) / DEPTH, 0, 1);
        b.z = clamp(b.z + (dd * push) / DEPTH, 0, 1);
      }
    }
  }

  // ------------------------------------------------------------- race

  function stepRace(dt) {
    if (!race) {
      raceTimer -= dt;
      if (raceTimer > 0) return;
      raceTimer = rand(90, 180);
      const field = ducks.filter((d) => !NO_PET.has(d.act) && d.act !== "charge" && d.act !== "pet");
      if (field.length < 2) return;
      field.sort((a, b) => a.z - b.z);
      race = { stage: "gather", t: 0, ducks: field, startX: Math.max(minX(), W * 0.12), finishX: Math.min(maxX(), W * 0.88), order: [] };
      field.forEach((d, k) => {
        start(d, "race");
        d.lane = lerp(0.2, 0.95, field.length > 1 ? k / (field.length - 1) : 0.5);
        d.raceSpeed = rand(0.85, 1.15);
        d.place = -1;
      });
      return;
    }
    race.t += dt;
    const racing = race.ducks.filter((d) => d.act === "race" || (d.act === "fall" && d.resume === "race"));
    if (race.stage === "gather" && (racing.every((d) => d.act !== "race" || d.stage >= 1) || race.t > 8)) {
      race.stage = "count";
      race.t = 0;
    } else if (race.stage === "count" && race.t > 3.4) {
      race.stage = "go";
      race.t = 0;
    } else if (race.stage === "go" && (racing.every((d) => d.act === "race" && d.stage === 3) || race.t > 25)) {
      race.stage = "done";
      race.t = 0;
    } else if (race.stage === "done" && race.t > 3) {
      const field = race.ducks;
      race = null;
      for (const d of field) if (d.act === "race") think(d);
    }
  }

  // -------------------------------------------------------------- toys

  const TOY_KINDS = ["ball", "sock", "block", "ducky"];
  let nextToy = 0;

  function toyH(o, u, hang) {
    return u * (o.kind === "ball" ? 0.22 : o.kind === "sock" ? (hang ? 0.24 : 0.08) : o.kind === "block" ? 0.15 : 0.17);
  }

  function stepToys(dt) {
    for (const o of toys) {
      o.hitCd = Math.max(0, o.hitCd - dt);
      if (o.held || o.inBasket) continue;
      const u = unit(o);
      if (o.y > 0 || o.vy > 0) {
        o.vy -= U * 7 * dt;
        o.y += o.vy * dt;
        if (o.y <= 0) {
          o.y = 0;
          o.vy = o.vy < -U * 0.6 ? -o.vy * 0.45 : 0;
          if (Math.abs(o.x - basket.x) < U * scaleAt(basket.z) * 0.45 && Math.abs(o.z - basket.z) < 0.07) intoTheBasket(o);
        }
      }
      const fr = o.y > 0 ? 0.2 : o.kind === "ball" ? 0.9 : 7;
      o.vx *= Math.exp(-dt * fr);
      o.vd *= Math.exp(-dt * fr);
      o.x += o.vx * dt;
      o.z += (o.vd / DEPTH) * dt;
      if (o.x < minX() || o.x > maxX()) {
        o.x = clamp(o.x, minX(), maxX());
        o.vx *= -0.6;
      }
      if (o.z < 0 || o.z > 1) {
        o.z = clamp(o.z, 0, 1);
        o.vd *= -0.6;
      }
      if (o.kind !== "ball") continue;
      o.spin += (o.vx * dt) / (0.11 * u);
      // A fast ball can bowl a duck over.
      if (o.hitCd > 0 || Math.hypot(o.vx, o.vd) < U * 1.2) continue;
      for (const d of ducks) {
        if (d === o.kicker || NO_PET.has(d.act) || Math.hypot(d.x - o.x, (d.z - o.z) * DEPTH) > unit(d) * 0.25) continue;
        o.hitCd = 0.6;
        o.vx *= -0.4;
        o.vd *= -0.4;
        if (Math.random() < 0.35) fall(d);
        else chirp(d, "!");
        break;
      }
    }
  }

  function drawToy(o, x, yb, u, hang) {
    if (o.kind === "ball") {
      const r = 0.11 * u;
      part(shapes.circle(x, yb - r, r), [228, 84, 72]);
      put(Math.floor((x + Math.cos(o.spin) * r * 0.5) / cw), Math.floor((yb - r + Math.sin(o.spin) * r * 0.4) / ch), "o", style(250, 240, 220, 0.95));
    } else if (o.kind === "sock") {
      const m = [110, 176, 206];
      if (hang) {
        part(shapes.capsule(x, yb - 0.21 * u, x, yb - 0.06 * u, 0.04 * u), m);
        part(shapes.capsule(x, yb - 0.05 * u, x + 0.08 * u, yb - 0.04 * u, 0.04 * u), [236, 236, 236]);
      } else {
        part(shapes.capsule(x - 0.1 * u, yb - 0.04 * u, x + 0.05 * u, yb - 0.04 * u, 0.04 * u), m);
        part(shapes.circle(x + 0.09 * u, yb - 0.045 * u, 0.045 * u), [236, 236, 236]);
      }
    } else if (o.kind === "block") {
      const s = 0.075 * u;
      part(shapes.box(x, yb - s, s, s, s * 0.15), [236, 196, 84]);
      put(Math.floor(x / cw), Math.floor((yb - s) / ch), o.letter, style(180, 50, 60, 1));
    } else {
      const k = hang ? 0.8 : 1;
      part(shapes.ellipse(x, yb - 0.05 * u, 0.09 * u * k, 0.05 * u), [250, 212, 70]);
      part(shapes.circle(x + 0.04 * u, yb - 0.12 * u, 0.045 * u), [250, 212, 70]);
      put(Math.floor((x + 0.1 * u) / cw), Math.floor((yb - 0.115 * u) / ch), ">", style(240, 130, 50, 1));
      put(Math.floor((x + 0.05 * u) / cw), Math.floor((yb - 0.135 * u) / ch), ".", style(30, 30, 30, 1));
    }
  }

  // -------------------------------------------------------------- duck

  const SHADOW = style(0, 0, 0, 0.12);
  const PLASTIC = ".:-=+*#";

  /** A plastic part: a solid fill with ASCII texture on top, softly lit from the top-left. */
  function part(shape, rgb) {
    const fill = style(rgb[0] * 0.5, rgb[1] * 0.5, rgb[2] * 0.5, 0.92);
    shapes.sample(grid, shape, (i, c, r, cover, light) => {
      if (cover < 0.5) return;
      const k = clamp((light - 0.25) / 0.95, 0, 0.999), b = 0.75 + 0.35 * k;
      grid.glyph[i] = PLASTIC[Math.floor(k * PLASTIC.length)];
      grid.color[i] = style(rgb[0] * b, rgb[1] * b, rgb[2] * b, 1);
      grid.bg[i] = cover >= 0.75 ? fill : "";
    });
  }

  /**
   * The robot, from the real one: a wide, flat half-dome head (a coloured shell over the top and
   * back, a grey face plate in front with one camera eye and a little sensor dot), a flat
   * bill whose lower plate drops open, a black servo neck, a small rounded body on a black
   * hip block, coloured thigh plates over black shins, and chunky two-tone feet that stand
   * on end when it sits.
   */
  function drawDuck(d, t) {
    const L = d.look;
    const u = unit(d), G = groundY(d.z);
    const sy = Math.sin(d.yaw), cy = Math.cos(d.yaw), asy = Math.abs(sy), acy = Math.abs(cy);
    const hy = d.yaw + d.headYaw, hs = Math.sin(hy), hc = Math.cos(hy), ahs = Math.abs(hs), ahc = Math.abs(hc);
    const g = Math.min(1.2, d.gait), ph = d.phase;
    // The waddle: rock side to side and bob with each step.
    const sway = Math.sin(ph) * 0.03 * Math.min(1, g);
    const bob = Math.abs(Math.cos(ph)) * 0.025 * Math.min(1, g);
    const roll = Math.sin(ph) * 0.14 * Math.min(1, g) * (1 - d.skate * 0.5);
    const hipH = 0.1 + 0.22 * d.hip + bob;
    const sitK = clamp((0.6 - d.hip) / 0.4, 0, 1);
    const lift = d.lift * u;

    // Shadow.
    for (let r = Math.floor((G - u * 0.05) / ch); r <= Math.floor((G + u * 0.05) / ch); r++) {
      for (let c = Math.floor((d.x - u * 0.3) / cw); c <= Math.floor((d.x + u * 0.3) / cw); c++) {
        if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
        if (Math.hypot(((c + 0.5) * cw - d.x) / (u * 0.3), ((r + 0.5) * ch - G) / (u * 0.05 + ch * 0.3)) < 1) grid.bg[r * cols + c] = SHADOW;
      }
    }

    // Body frame (f forward, s to its left, h up, in duck heights) → screen, then tipped over.
    const ct = Math.cos(d.tip), st = Math.sin(d.tip), pivY = G - 0.24 * u;
    const tipP = (x, y) => [d.x + (x - d.x) * ct - (y - pivY) * st, pivY + (x - d.x) * st + (y - pivY) * ct];
    const P0 = (f, s, h) => [d.x + (f * sy + s * cy) * u, G - h * u - lift, f * cy - s * sy];
    const P = (f, s, h) => {
      const p = P0(f, s, h), q = tipP(p[0], p[1]);
      return [q[0], q[1], p[2]];
    };
    /** A box seen from the duck's heading: half-length f, half-width s, half-height h. */
    const block = (p, f, s, h, round, ang, fa = asy, sa = acy) => shapes.box(p[0], p[1], (f * fa + s * sa) * u, h * u, round * u, ang);
    const shade = (rgb, k) => [rgb[0] * k, rgb[1] * k, rgb[2] * k];
    const ops = [];
    const bodyAng = d.lean * sy + roll * cy + d.tip;

    for (const side of [-1, 1]) {
      const lp = ph + (side < 0 ? PI : 0);
      let ff = Math.sin(lp) * 0.12 * g, fh = Math.max(0, Math.cos(lp)) * 0.07 * g, fs = side * (0.1 + 0.06 * sitK);
      if (d.skate > 0.5) {
        // Skating: push back and out, glide on the other foot.
        const push = Math.max(0, Math.sin(lp));
        ff = -push * 0.14 * g;
        fs += side * push * 0.06 * g;
        fh = Math.max(0, -Math.sin(lp)) * 0.03 * g;
      }
      ff += sitK * 0.12;
      if (side > 0) {
        ff += d.kick * 0.22;
        fh += Math.max(0, d.kick) * 0.1;
      }
      // The foot block lies flat, or stands on end (sole forward) when it sits.
      const fl = lerp(0.085, 0.045, sitK), fhh = lerp(0.04, 0.075, sitK);
      const bottom = fh + d.skate * 0.05, footF = ff + 0.02 + sitK * 0.03, fsx = sway * 0.3 + fs;
      // Two-bone IK in the leg's own plane (forward and up), so the knee only ever bends
      // forward: straight legs from the front, a bent knee from the side.
      const hipS = sway + side * 0.1, ankH = bottom + fhh * 1.6, Lb = 0.15;
      const dF = ff, dH = ankH - hipH, len = Math.hypot(dF, dH) || 1, reach = Math.min(len, 2 * Lb * 0.999);
      const hgt = Math.sqrt(Math.max(0, Lb * Lb - (reach * reach) / 4));
      let nF = -dH / len, nH = dF / len;
      if (nF < 0) [nF, nH] = [-nF, -nH];
      const hip = P0(0, hipS, hipH);
      const A = P(0, hipS, hipH), B = P(ff, fsx, ankH);
      const knee = P(dF / 2 + nF * hgt, (hipS + fsx) / 2, hipH + dH / 2 + nH * hgt);
      const foot = P(footF, fsx, bottom + fhh);
      const sole = P(footF + sitK * (fl - 0.014), fsx, bottom + lerp(0.014, fhh, sitK));
      const horn = P(0, sway + side * 0.14, hipH);
      const wheels = d.skate > 0.3 ? [P(ff - 0.03, fsx, 0.025), P(ff + 0.08, fsx, 0.025)] : [];
      const far = hip[2] < 0 ? 0.72 : 1;
      ops.push([-1 + hip[2], () => {
        part(shapes.capsule(knee[0], knee[1], B[0], B[1], 0.04 * u), shade(JOINT, far));
        part(shapes.capsule(A[0], A[1], knee[0], knee[1], 0.058 * u), shade(L.shell, far));
        part(shapes.circle(knee[0], knee[1], 0.024 * u), shade(SILVER, far));
        part(block(foot, fl, 0.055, fhh, 0.025, d.tip), shade(L.foot, far));
        part(block(sole, lerp(fl, 0.014, sitK), 0.055, lerp(0.014, fhh, sitK), 0.01, d.tip), shade(L.sole, far));
        for (const w of wheels) part(shapes.circle(w[0], w[1], 0.028 * u), shade([60, 60, 70], far));
        if (horn[2] > 0) part(shapes.circle(horn[0], horn[1], 0.026 * u), SILVER);
      }]);
    }

    // Black hip block, and the small rounded body on it.
    const hb = P(0, sway, hipH), bc = P(0, sway, hipH + 0.1);
    ops.push([-0.5, () => part(block(hb, 0.07, 0.12, 0.045, 0.015, bodyAng), JOINT)]);
    ops.push([0, () => {
      part(block(bc, 0.1, 0.11, 0.06, 0.04, bodyAng), L.shell);
      if (d.act === "charge" && d.stage === 1) put(Math.floor(bc[0] / cw), Math.floor(bc[1] / ch), "+", style(120, 240, 150, 0.6 + 0.4 * Math.sin(t * 4)));
    }]);

    // Head: centre, then head-local points (pitched nose-down, turned by the head's yaw, tilted on screen).
    const Hc = P(0.04 + d.lean * 0.1 + d.pitch * 0.06, sway * 1.3, hipH + 0.45 - d.lean * 0.08 - d.pitch * 0.18);
    const pc = Math.cos(d.pitch), ps = Math.sin(d.pitch);
    const ctl = Math.cos(d.tilt + d.tip), stl = Math.sin(d.tilt + d.tip);
    const HP = (f, s, h) => {
      const f2 = f * pc + h * ps, h2 = h * pc - f * ps;
      const x = (f2 * hs + s * hc) * u, y = -h2 * u;
      return [Hc[0] + x * ctl - y * stl, Hc[1] + x * stl + y * ctl, f2 * hc - s * hs];
    };
    const headAng = d.pitch * hs + d.tilt + d.tip;
    const hd = 0.04 * cy + 0.02;

    // Servo neck, up under the back of the head.
    const nb = P(-0.01, sway, hipH + 0.14), nt = HP(-0.05, 0, -0.08);
    ops.push([hd - 0.01, () => {
      part(shapes.capsule(nb[0], nb[1], nt[0], nt[1], 0.045 * u), JOINT);
      part(shapes.circle((nb[0] + nt[0]) / 2, (nb[1] + nt[1]) / 2, 0.02 * u), SILVER);
    }]);

    const open = d.open;
    d.beak = HP(0.2, 0, -0.1 - open * 0.06);
    ops.push([hd, () => {
      // The shell: domed on top, flat underneath.
      part(block(Hc, 0.17, 0.15, 0.09, 0.085, headAng, ahs, ahc), L.shell);
      part(block(HP(0, 0, -0.045), 0.17, 0.15, 0.045, 0.015, headAng, ahs, ahc), L.shell);
      // The grey face, the camera eye and the sensor dot (not from behind).
      if (hc > -0.25) {
        part(block(HP(0.08, 0, -0.02), 0.09, 0.135, 0.065, 0.05, headAng, ahs, ahc), FACE);
        const e = HP(0.1, -0.05, -0.02), er = Math.max(0.055 * u, cw * 1.2);
        part(shapes.circle(e[0], e[1], er), L.ring);
        const ec = Math.floor(e[0] / cw), erow = Math.floor(e[1] / ch);
        const lens = d.eyes === "open" ? "@" : d.eyes === "happy" ? "^" : d.eyes === "wide" ? "O" : "-";
        grid.put(ec, erow, lens, d.eyes === "open" ? style(70, 80, 100, 1) : style(EYE[0], EYE[1], EYE[2], 1), style(EYE[0], EYE[1], EYE[2], 1));
        if (d.eyes === "open" && er > cw * 1.2) put(Math.floor((e[0] - er * 0.4) / cw), Math.floor((e[1] - er * 0.4) / ch), "'", style(255, 255, 255, 0.9));
        const dot = HP(0.02, 0.07, -0.02);
        if (Math.floor(dot[0] / cw) !== ec || Math.floor(dot[1] / ch) !== erow) put(Math.floor(dot[0] / cw), Math.floor(dot[1] / ch), "•", style(30, 32, 40, 1));
        if (d.happy > 0.3 && hc > 0.2) {
          for (const s of [-1, 1]) {
            const k = HP(0.14, s * 0.1, -0.07);
            put(Math.floor(k[0] / cw), Math.floor(k[1] / ch), "~", style(255, 140, 160, d.happy));
          }
        }
      }
      // The bill: a flat plate under the face, and a lower plate hinged at the back that drops open.
      for (let s = -0.14; s <= 0.141; s += 0.07) {
        const a = HP(-0.06, s, -0.11), b = HP(0.19, s, -0.11 - open * 0.13);
        part(shapes.capsule(a[0], a[1], b[0], b[1], 0.02 * u), shade(L.beak, 0.82));
      }
      for (let s = -0.14; s <= 0.141; s += 0.07) {
        const a = HP(-0.04, s, -0.09), b = HP(0.2, s, -0.09);
        part(shapes.capsule(a[0], a[1], b[0], b[1], 0.022 * u), L.beak);
      }
    }]);

    // Whatever it's carrying hangs from the bill.
    const held = toys.find((o) => o.held === d);
    if (held) ops.push([hd + 0.01, () => drawToy(held, d.beak[0], d.beak[1] + toyH(held, u, true) * 0.85, u, true)]);

    ops.sort((a, b) => a[0] - b[0]);
    for (const [, fn] of ops) fn();

    d.top = [Hc[0], Hc[1] - 0.11 * u - ch * 0.5];
    d.bbox = { x0: d.x - u * 0.3, x1: d.x + u * 0.3, y0: Math.min(d.top[1], G - u * 0.3), y1: G + u * 0.04 };
  }

  // ------------------------------------------------------------ scenery

  function drawDock(t) {
    const u = U * scaleAt(dock.z), G = groundY(dock.z);
    const busy = ducks.some((d) => d.act === "charge" && d.stage === 1);
    shapes.paint(grid, shapes.box(dock.x, G - 0.03 * u, 0.62 * u, 0.035 * u, 0.02 * u), { rgb: [96, 100, 118], ramp: "-=#" });
    shapes.paint(grid, shapes.box(dock.x, G - 0.3 * u, 0.09 * u, 0.26 * u, 0.04 * u), { rgb: [110, 114, 132] });
    const a = busy ? 0.6 + 0.4 * Math.sin(t * 3) : 0.35;
    put(Math.floor(dock.x / cw), Math.floor((G - 0.48 * u) / ch), "o", style(120, 240, 150, a));
    put(Math.floor(dock.x / cw), Math.floor((G - 0.3 * u) / ch), "+", style(230, 230, 240, 0.7));
  }

  function drawBasket() {
    const u = U * scaleAt(basket.z), G = groundY(basket.z), bw = 0.45 * u, bh = 0.3 * u;
    shapes.paint(grid, shapes.box(basket.x, G - bh * 0.5 - 0.06 * u, bw, bh * 0.5, 0.03 * u), { rgb: [110, 76, 50], ramp: "xX#" });
    for (const o of toys) if (o.inBasket) drawToy(o, o.x, G - bh + 0.05 * u, u, false);
    shapes.paint(grid, shapes.box(basket.x, G - bh * 0.45, bw * 1.04, bh * 0.45, 0.03 * u), { rgb: [184, 132, 84], ramp: "-x+X#" });
    shapes.paint(grid, shapes.capsule(basket.x - bw, G - bh * 0.9, basket.x + bw, G - bh * 0.9, 0.025 * u), { rgb: [210, 160, 104], ramp: "=" });
  }

  function drawRaceLines(t) {
    if (!race) return;
    for (const [x, finish] of [[race.startX, false], [race.finishX, true]]) {
      const c = Math.floor(x / cw);
      for (let r = Math.floor(groundY(0.1) / ch); r <= Math.floor(groundY(1) / ch); r++) {
        if (finish) put(c, r, (r % 2) ? "#" : ":", style(240, 240, 240, 0.7));
        else put(c, r, ":", style(240, 220, 120, 0.6));
      }
      if (finish) grid.text(c - 3, Math.floor(groundY(0.1) / ch) - 1, "FINISH", style(240, 240, 240, 0.8));
    }
    let msg = "";
    if (race.stage === "count") msg = race.t < 3 ? `[ ${3 - Math.floor(race.t)} ]` : "[ GO! ]";
    else if (race.stage === "go" && race.t < 1) msg = "[ GO! ]";
    else if (race.stage === "done" && race.order.length) msg = `★ ${race.order[0].voice[1]} ★`;
    if (msg) grid.text(Math.round(W / cw / 2 - msg.length / 2), Math.floor(floorTop / ch) - 3, msg, style(255, 236, 160, 0.95));
  }

  function drawBubble(d) {
    const b = d.bubble;
    if (!b) return;
    const a = Math.min(1, b.life * 2), [r, g, bl] = d.rgb;
    const c0 = Math.round(d.top[0] / cw - b.text.length / 2), row = Math.floor(d.top[1] / ch) - 1 - Math.round((1.6 - b.life) * 0.6);
    grid.text(c0, row, b.text, style(lerp(r, 255, 0.4), lerp(g, 255, 0.4), lerp(bl, 255, 0.4), a));
  }

  function drawLaser(t) {
    if (!laser.on) return;
    const c = Math.floor(pointer.x / cw), r = Math.floor(pointer.y / ch);
    put(c, r, "@", style(255, 60, 60, 1));
    const a = 0.35 + 0.15 * Math.sin(t * 20);
    for (const [dc, dr] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) put(c + dc, r + dr, "·", style(255, 80, 80, a));
  }

  // ------------------------------------------------------------- frame

  function step(dt, t) {
    const now = performance.now();
    hovered = null;
    if (pointer.active) {
      for (const d of ducks) {
        const b = d.bbox;
        if (b && pointer.x >= b.x0 && pointer.x <= b.x1 && pointer.y >= b.y0 && pointer.y <= b.y1 && (!hovered || d.z > hovered.z)) hovered = d;
      }
    }
    petting = pointer.active && now - pointer.moved > 450 ? hovered : null;
    laser.on = !GALLERY && pointer.active && now - pointer.moved < 1500 && !hovered;
    laser.x = pointer.x;
    laser.floor = pointer.y >= groundY(0) - U * 0.05;
    laser.z = zAt(pointer.y);

    if (!GALLERY) stepRace(dt);
    for (const d of ducks) stepDuck(d, dt, t);
    separate();
    stepToys(dt);
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      if ((p.life -= dt) <= 0) {
        particles.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  function draw(t) {
    for (const s of stars) put(s.c, s.r, s.g, style(220, 225, 255, (0.4 + 0.35 * Math.sin(t * 1.3 + s.ph)) * (1 - daylight)));
    for (const [c, r, g, st] of rug) put(c, r, g, st);
    drawRaceLines(t);

    const scene = [
      { z: dock.z, draw: () => drawDock(t) },
      { z: basket.z, draw: drawBasket },
      ...ducks.map((d) => ({ z: d.z, draw: () => drawDuck(d, t) })),
      ...toys.filter((o) => !o.held && !o.inBasket).map((o) => ({ z: o.z, draw: () => drawToy(o, o.x, groundY(o.z) - o.y, unit(o), false) })),
    ];
    scene.sort((a, b) => a.z - b.z);
    for (const s of scene) s.draw();

    for (const d of ducks) drawBubble(d);
    for (const p of particles) {
      const [r, g, b] = p.rgb;
      put(Math.floor(p.x / cw), Math.floor(p.y / ch), p.g, style(r, g, b, Math.min(1, (p.life / p.max) * 1.5)));
    }
    drawLaser(t);
  }

  function click(x, y) {
    let hit = null;
    for (const d of ducks) {
      const b = d.bbox;
      if (b && x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1 && (!hit || d.z > hit.z)) hit = d;
    }
    if (GALLERY) return;
    if (hit) {
      if (hit.act === "fall") return;
      if (Math.random() < 0.25) fall(hit);
      else start(hit, "boop");
      return;
    }
    // Drop a toy from where you clicked.
    const z = y >= groundY(0) ? zAt(y) : rand(0.3, 0.9);
    const o = makeToy(TOY_KINDS[nextToy++ % TOY_KINDS.length], clamp(x, minX(), maxX()), z, Math.max(U * 0.6, groundY(z) - y));
    toys.push(o);
    if (toys.length > 10) {
      const old = toys.findIndex((k) => !k.held && !k.claim);
      if (old >= 0) toys.splice(old, 1);
    }
  }

  setTheme("dark");

  /** Finer cells than most scenes, so a duck gets enough rows for its face. */
  const cellWidth = (w) => clamp(Math.round(w / 250), 6, 10);

  return { cellWidth, resize, paintBackdrop, refreshBackdrop, step, draw, click, chat: false };
});
