/**
 * DRIC — Delta Robotics Innovation Center, in a coder's style.
 *
 *   - a plain black backdrop and a dim ground line with a linear rail on it
 *   - the Delta mark (triangle, orbit, nucleus) and a "DRIC" wordmark in Delta's blocky
 *     letterforms, written in sparse, slowly scrolling code in a drifting colour gradient
 *     that follows the time of day; a light sweep, the cursor scrambles it, a click glitches it
 *   - a UR5 arm on the rail that rearranges the wordmark: every so often it picks a letter
 *     up, parks it, moves another into its place and drops the first into the gap (and
 *     later swaps them back). Click a letter to have it swapped; click elsewhere and it
 *     reaches there when its hands are free.
 *   - a sysmon terminal with live CPU, memory and GPU readings (sent by wallpaper.py; a
 *     browser page can't read them, so in a plain browser it just waits)
 *
 * URL params: hour=13.5 (pin the time of day), cycle=120 (a whole day in this many seconds).
 * No chat box on this scene.
 */
Wallpaper.scene("delta", (api) => {
  "use strict";

  const { grid, pointer, setTheme, floatParam } = api;
  const { clamp, lerp, rand, wrapAngle } = Wallpaper.math;
  const S = Wallpaper.shapes;
  const style = Wallpaper.style;

  setTheme("dark");

  // -------------------------------------------------------------- palette

  const BLUE = [0, 112, 200];
  const CYAN = [90, 210, 255];
  const STEEL = [200, 208, 220];
  const GRAPHITE = [74, 80, 96];
  const DARK = [38, 42, 54];
  const UR_BLUE = [90, 172, 230];
  const WHITE = [236, 244, 255];
  const GREY = [110, 120, 136];
  const GREEN = [90, 220, 130];
  const AMBER = [240, 180, 70];
  const RED = [240, 90, 80];

  const M = {
    steel: { rgb: STEEL, ramp: "-=+*#%@@" },
    graphite: { rgb: GRAPHITE, ramp: ".:=+*#%@" },
    dark: { rgb: DARK, ramp: ".:-=+*#" },
    urBlue: { rgb: UR_BLUE, ramp: "=+*#%@" },
    urBand: { rgb: UR_BLUE, flat: true, glyph: "=" },
    glow: { rgb: CYAN, flat: true, glyph: "@" },
    // The shadow just blanks out the ground line under the robot.
    shadow: { rgb: [4, 8, 16], flat: true, glyph: ":" },
  };

  // Code that fills the logo (no spaces, so there are no holes).
  const CODE =
    "dric::lab{ur5.move_to(tcp);traj.step(dt);ik.solve(goal)->joints;}" +
    "if(safety.clear()){gripper.close();}0x1F2E;for(j:joints)j.servo();" +
    "vision.detect(frame)->boxes;planner.plan(12);publish(/joint_states);";
  const SCRAMBLE = "01<>/\\|+*#%$&{}[]";

  // ------------------------------------------------------ logo colours by hour

  // Three colours per time of day; the logo is a gradient through them that slowly drifts.
  const DAY = [
    [0, [70, 90, 255], [150, 80, 255], [0, 170, 255]], // night: indigo, violet, blue
    [5, [70, 90, 255], [150, 80, 255], [0, 170, 255]],
    [6.5, [255, 110, 150], [255, 170, 90], [130, 130, 255]], // dawn: pink, peach, lavender
    [9, [0, 170, 255], [0, 220, 200], [120, 230, 120]], // morning: sky, teal, green
    [12, [0, 136, 221], [0, 210, 255], [90, 240, 200]], // noon: Delta blue, cyan, aqua
    [16, [255, 200, 70], [0, 170, 240], [90, 230, 160]], // afternoon: gold, blue, mint
    [18.5, [255, 90, 60], [255, 165, 50], [210, 70, 190]], // sunset: red, orange, magenta
    [20.5, [120, 80, 255], [255, 80, 160], [0, 140, 255]], // dusk: violet, rose, blue
    [24, [70, 90, 255], [150, 80, 255], [0, 170, 255]],
  ];
  const PIN_HOUR = floatParam("hour", NaN);
  const CYCLE = floatParam("cycle", 0);
  const startTime = performance.now();
  const palette = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];

  function currentHour() {
    const d = new Date();
    const clock = Number.isFinite(PIN_HOUR) ? PIN_HOUR : d.getHours() + d.getMinutes() / 60;
    return CYCLE > 0 ? (clock + ((performance.now() - startTime) / 1000 / CYCLE) * 24) % 24 : clock;
  }

  function updatePalette() {
    const hour = currentHour();
    let i = 0;
    while (DAY[i + 1][0] <= hour && i < DAY.length - 2) i++;
    const a = DAY[i], b = DAY[i + 1];
    const t = clamp((hour - a[0]) / (b[0] - a[0]), 0, 1), e = t * t * (3 - 2 * t);
    for (let k = 0; k < 3; k++) {
      for (let j = 0; j < 3; j++) palette[k][j] = lerp(a[k + 1][j], b[k + 1][j], e);
    }
  }

  /** Colour at f along a looping gradient through the three palette colours. */
  function gradient(f) {
    const x = (((f % 1) + 1) % 1) * 3, k = Math.floor(x), t = x - k;
    const a = palette[k], b = palette[(k + 1) % 3];
    return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  }

  // ----------------------------------------------------------------- state

  let W = 0, H = 0, cw = 10, ch = 15, cols = 0, rows = 0, G = 0, groundRow = 0;
  let glyph = [], color = [];
  // Static background layer: the ground line.
  let floorGlyph = [], floorColor = [];

  const sparks = [];

  const L1 = 42.5, L2 = 39.2; // UR5 upper arm and forearm, in arm units (≈ cm)
  const arm = {
    u: 1, bx: 0, railMin: 0, railMax: 0, railHome: 0, railTarget: 0, S: { x: 0, y: 0 },
    j1: -1.2, j2: 0.2, side: -1,
    goal: { x: 0, y: 0 }, pose: null,
    mode: "task", open: 1, tap: null, tapped: false, wait: 0,
    held: null, // the letter in the gripper
  };
  let started = false;

  // ---------------------------------------------------------------- layout

  const cellWidth = (w) => clamp(Math.round(w / 230), 6, 11);

  function resize() {
    ({ W, H, cw, ch, cols, rows, glyph, color } = grid);
    groundRow = Math.round((H * 0.86) / ch);
    G = groundRow * ch;

    arm.u = H * 0.0072;
    arm.railMin = W * 0.08;
    arm.railMax = W - 14 * arm.u;
    arm.railHome = W * 0.86;
    if (!started) arm.bx = arm.railHome;
    arm.bx = clamp(arm.bx, arm.railMin, arm.railMax);
    arm.railTarget = arm.bx;
    arm.S = { x: arm.bx, y: G - 26 * arm.u };

    buildFloor();
    layoutLogo();
    layoutSysmon();

    // A resize lands every letter back in place and restarts the arm's routine.
    job = null;
    arm.held = null;
    arm.mode = "task";
    if (!started) {
      started = true;
      arm.goal = restGoal();
      const ik = solveIK(arm.goal);
      arm.j1 = ik.j1;
      arm.j2 = ik.j2;
    }
    arm.pose = pose();
  }

  function paintBackdrop(g, w, h) {
    const grad = g.createRadialGradient(w * 0.5, h * 0.35, 0, w * 0.5, h * 0.35, Math.hypot(w, h) * 0.6);
    grad.addColorStop(0, "rgb(7, 11, 18)");
    grad.addColorStop(1, "rgb(0, 0, 0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  }

  /** The ground line, with the arm's rail along it. */
  function buildFloor() {
    const n = cols * rows;
    floorGlyph = new Array(n).fill("");
    floorColor = new Array(n).fill("");
    const line = style(BLUE[0], BLUE[1], BLUE[2], 0.35), rail = style(GRAPHITE[0], GRAPHITE[1], GRAPHITE[2], 0.9);
    const c0 = Math.floor((arm.railMin - 14 * arm.u) / cw), c1 = Math.ceil((arm.railMax + 14 * arm.u) / cw);
    for (let c = 0; c < cols; c++) {
      const i = groundRow * cols + c, onRail = c >= c0 && c <= c1;
      floorGlyph[i] = onRail ? (c % 6 === 0 ? "#" : "=") : "_";
      floorColor[i] = onRail ? rail : line;
    }
  }

  // ------------------------------------------------------------------ logo

  // The logo, traced from Delta's artwork in its own pixel space (1145 × 393): the
  // triangle with the orbit and nucleus cut out, then D R I C in the wordmark's letterforms.
  const LOGO_W = 1145, LOGO_H = 393;
  const ORBIT = { x: 218, y: 264, a: 133, b: 62, angle: -0.72, half: 10 };
  const NUCLEUS = { x: 285, y: 292, r: 56, gap: 12 };
  const TRIANGLE = S.triangle(240, 0, 478, 393, 0, 393);

  const block = (x0, y0, x1, y1, round = 4) => S.box((x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, (y1 - y0) / 2, round);
  // Letters in logo units: left/right edge and parts. The wordmark is re-flowed from WORD_X
  // with an even gap, so letters of any width can trade places.
  const LETTER_TOP = 208, WORD_X = 533, LETTER_GAP = 34;
  const LETTER_SHAPES = [
    // D, drawn like Delta's Δ-shaped D: rounded stem top, a diagonal down to a round foot.
    { x0: 533, x1: 699, parts: [block(533, 236, 587, 393), S.circle(560, 236, 27), S.capsule(584, 236, 668, 362, 27), S.circle(669, 364, 30), block(603, 355, 669, 393)] },
    { x0: 710, x1: 865, parts: [block(710, 210, 764, 393, 6), block(710, 210, 865, 248), block(827, 210, 865, 315), block(764, 277, 865, 315), S.box(834, 352, 20, 43, 4, -0.5)] },
    { x0: 882, x1: 934, parts: [block(882, 210, 934, 393, 6)] },
    { x0: 987, x1: 1145, parts: [block(987, 210, 1041, 393, 6), block(987, 210, 1145, 248), block(987, 355, 1145, 393)] },
  ];

  function ellipseSd(x, y, a, b) {
    const k0 = Math.hypot(x / a, y / b), k1 = Math.hypot(x / (a * a), y / (b * b));
    return k1 ? (k0 * (k0 - 1)) / k1 : -Math.min(a, b);
  }

  /** The triangle mark with the white parts of the artwork (orbit, gap round the nucleus) cut out. */
  function markSd(x, y) {
    const c = Math.cos(ORBIT.angle), s = Math.sin(ORBIT.angle);
    const dx = x - ORBIT.x, dy = y - ORBIT.y;
    const orbit = Math.abs(ellipseSd(dx * c + dy * s, -dx * s + dy * c, ORBIT.a, ORBIT.b)) - ORBIT.half;
    const dn = Math.hypot(x - NUCLEUS.x, y - NUCLEUS.y) - NUCLEUS.r;
    const gap = Math.abs(dn - NUCLEUS.gap / 2) - NUCLEUS.gap / 2;
    const holes = Math.max(Math.min(orbit, gap), -dn);
    return Math.max(TRIANGLE.d(x, y), -holes);
  }

  // Logo placement (px) and its pieces: the mark's cells, and per letter its cells measured
  // at its home spot plus where it is now.
  const logo = { s: 1, ox: 0, oy: 0, box: null, glitch: 0, mark: [], letters: [], order: [0, 1, 2, 3] };

  /** Left edge (logo units) of each letter when the word reads in `order` (slot → letter). */
  function flow(order) {
    const left = [];
    let x = WORD_X;
    for (const k of order) {
      left[k] = x;
      x += LETTER_SHAPES[k].x1 - LETTER_SHAPES[k].x0 + LETTER_GAP;
    }
    return left;
  }

  function layoutLogo() {
    const w = Math.min(W * 0.48, ((H * 0.34) * LOGO_W) / LOGO_H), s = w / LOGO_W;
    const ox = (W - w) / 2, oy = H * 0.31 - (LOGO_H * s) / 2;
    Object.assign(logo, { s, ox, oy, order: [0, 1, 2, 3] });
    logo.box = { x0: ox - 24, y0: oy - 24, x1: ox + w + 24, y1: oy + LOGO_H * s + 24 };
    const collect = (out) => (i, c, r, cover, light) => out.push({ c, r, cover, light });

    logo.mark = [];
    S.sample(grid, { d: (x, y) => markSd((x - ox) / s, (y - oy) / s) * s, x0: ox, y0: oy, x1: ox + 478 * s, y1: oy + LOGO_H * s }, collect(logo.mark), cw * 1.5);

    const home = flow(logo.order);
    logo.letters = LETTER_SHAPES.map((shape, k) => {
      const shift = home[k] - shape.x0;
      const d = (x, y) => {
        const lx = (x - ox) / s - shift, ly = (y - oy) / s;
        let best = Infinity;
        for (const part of shape.parts) best = Math.min(best, part.d(lx, ly));
        return best * s;
      };
      const homeX = ox + home[k] * s, homeY = oy + LETTER_TOP * s;
      const wpx = (shape.x1 - shape.x0) * s, hpx = (LOGO_H - LETTER_TOP) * s;
      const cells = [];
      S.sample(grid, { d, x0: homeX - 4, y0: homeY - 4, x1: homeX + wpx + 4, y1: homeY + hpx + 4 }, collect(cells), cw * 1.5);
      return { k, cells, homeX, homeY, w: wpx, h: hpx, x: homeX, y: homeY, tx: homeX, ty: homeY };
    });
  }

  /** Light sweep, cursor scramble and click glitch over a set of logo cells, offset by (dc, dr). */
  function drawLogoCells(cells, dc, dr, t) {
    const box = logo.box;
    const shift = Math.floor(t * 4);
    const sweep = ((t * 0.14) % 1.7) - 0.35;
    const reach = Math.min(W, H) * 0.08;
    const drift = t * 0.03;
    for (const cell of cells) {
      const c = cell.c + dc, r = cell.r + dr;
      if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
      const i = r * cols + c, x = (c + 0.5) * cw, y = (r + 0.5) * ch;
      const b = 0.85 + 0.3 * (cell.light - 0.66);
      const f = (x - box.x0) / (box.x1 - box.x0) + ((y - box.y0) / (box.y1 - box.y0)) * 0.3;
      let [R, Gr, B] = gradient(f * 0.9 - drift);
      let a = 0.55 + 0.45 * cell.cover;
      let g = cell.cover < 0.5 ? "." : CODE[(c + r * 7 + shift) % CODE.length];
      if (Math.abs(f - sweep) < 0.03) [R, Gr, B] = WHITE;
      else if ((pointer.active && Math.hypot(x - pointer.x, y - pointer.y) < reach) || (logo.glitch > 0 && Math.random() < 0.2)) {
        // Scrambled cells flash a brighter version of their colour.
        g = SCRAMBLE[(Math.random() * SCRAMBLE.length) | 0];
        [R, Gr, B] = [lerp(R, 255, 0.5), lerp(Gr, 255, 0.5), lerp(B, 255, 0.5)];
        a = 1;
      } else {
        R *= b;
        Gr *= b;
        B *= b;
      }
      glyph[i] = g;
      color[i] = style(R, Gr, B, a);
    }
  }

  function drawLogo(t) {
    drawLogoCells(logo.mark, 0, 0, t);
    for (const L of logo.letters) {
      drawLogoCells(L.cells, Math.round((L.x - L.homeX) / cw), Math.round((L.y - L.homeY) / ch), t);
    }
  }

  function letterAt(x, y) {
    return logo.letters.find((L) => x >= L.x && x <= L.x + L.w && y >= L.y && y <= L.y + L.h);
  }

  // -------------------------------------------------------- letter swaps

  // A swap of letters a and b: park a below the word, move b into a's new spot, then a into b's.
  let job = null, idle = 6;

  function startSwap(a, b) {
    const order = logo.order.slice();
    const ia = order.indexOf(a.k), ib = order.indexOf(b.k);
    order[ia] = b.k;
    order[ib] = a.k;
    const left = flow(order);
    const target = (L) => logo.ox + left[L.k] * logo.s;
    // Letters not being carried slide over to their new places on their own.
    for (const L of logo.letters) {
      if (L !== a && L !== b) L.tx = target(L);
    }
    job = { a, b, order, targetA: target(a), targetB: target(b), step: 0 };
  }

  /** Next swap: put a letter back if the word is scrambled, otherwise scramble a random pair. */
  function nextSwap() {
    const slot = logo.order.findIndex((k, i) => k !== i);
    if (slot >= 0) {
      startSwap(logo.letters[slot], logo.letters[logo.order[slot]]);
    } else {
      const a = (Math.random() * 4) | 0;
      const b = (a + 1 + ((Math.random() * 3) | 0)) % 4;
      startSwap(logo.letters[a], logo.letters[b]);
    }
  }

  const grabPoint = (L) => ({ x: L.x + L.w / 2, y: L.y });

  /** Gripper goals for the current job; returns true when the job is finished. */
  function runJob(dt) {
    const { a, b } = job;
    const parkY = a.homeY + a.h + Math.max(24, a.h * 0.25);
    const grip = (L, next) => {
      arm.open = Math.max(0, arm.open - dt / 0.3);
      if (arm.open === 0) {
        arm.held = L;
        job.step = next;
      }
    };
    const drop = (L, x, y, next) => {
      arm.open = Math.min(1, arm.open + dt / 0.3);
      if (arm.open === 1) {
        arm.held = null;
        L.x = L.tx = x;
        L.y = L.ty = y;
        burst(x + L.w / 2, y, 6);
        job.step = next;
      }
    };
    switch (job.step) {
      case 0: arm.goal = grabPoint(a); if (reached()) job.step = 1; break;
      case 1: grip(a, 2); break;
      case 2: arm.goal = { x: a.x + a.w / 2, y: parkY }; if (reached()) job.step = 3; break;
      case 3: drop(a, a.x, parkY, 4); break;
      case 4: arm.goal = grabPoint(b); if (reached()) job.step = 5; break;
      case 5: grip(b, 6); break;
      case 6: arm.goal = { x: job.targetB + b.w / 2, y: b.homeY }; if (reached()) job.step = 7; break;
      case 7: drop(b, job.targetB, b.homeY, 8); break;
      case 8: arm.goal = grabPoint(a); if (reached()) job.step = 9; break;
      case 9: grip(a, 10); break;
      case 10: arm.goal = { x: job.targetA + a.w / 2, y: a.homeY }; if (reached()) job.step = 11; break;
      case 11: drop(a, job.targetA, a.homeY, 12); break;
      case 12:
        logo.order = job.order;
        return true;
    }
    return false;
  }

  // ------------------------------------------------------------- UR5 arm

  const reach = () => (L1 + L2) * arm.u;
  const restGoal = () => ({ x: arm.bx - 18 * arm.u, y: G - 46 * arm.u });

  /** Joint angles putting the wrist where the gripper reaches `goal` (elbow up). */
  function solveIK(goal) {
    const u = arm.u, S0 = arm.S;
    const side = goal.x >= S0.x ? 1 : -1;
    const px = goal.x - arm.side * 7 * u, py = goal.y - 14.9 * u;
    const dx = px - S0.x, dy = py - S0.y, d = Math.hypot(dx, dy) || 1;
    const dc = clamp(d, Math.abs(L1 - L2) * u + 1, (L1 + L2) * u - 1);
    const phi = Math.atan2(dy, dx);
    const a = Math.acos(clamp(((L1 * u) ** 2 + dc * dc - (L2 * u) ** 2) / (2 * L1 * u * dc), -1, 1));
    const t1 = phi - a, t2 = phi + a;
    const j1 = Math.sin(t1) < Math.sin(t2) ? t1 : t2;
    const ex = S0.x + Math.cos(j1) * L1 * u, ey = S0.y + Math.sin(j1) * L1 * u;
    const j2 = Math.atan2(S0.y + (dy / d) * dc - ey, S0.x + (dx / d) * dc - ex);
    return { j1, j2, side };
  }

  function pose() {
    const u = arm.u, S0 = arm.S;
    const E = { x: S0.x + Math.cos(arm.j1) * L1 * u, y: S0.y + Math.sin(arm.j1) * L1 * u };
    const P = { x: E.x + Math.cos(arm.j2) * L2 * u, y: E.y + Math.sin(arm.j2) * L2 * u };
    const Q = { x: P.x + arm.side * 7 * u, y: P.y };
    const F = { x: Q.x, y: Q.y + 6 * u };
    return { S: S0, E, P, Q, F, T: { x: F.x, y: F.y + 8.9 * u } };
  }

  /** The gripper is at the goal and the carriage has stopped. */
  const reached = () =>
    Math.hypot(arm.pose.T.x - arm.goal.x, arm.pose.T.y - arm.goal.y) < 1.4 * arm.u && Math.abs(arm.bx - arm.railTarget) < 2;

  function stepArm(dt) {
    const u = arm.u;
    let ride = true; // whether the carriage drives under the goal
    if (arm.mode === "tap") {
      arm.goal = arm.tap;
      if (!arm.tapped && reached()) {
        arm.tapped = true;
        arm.wait = 0.6;
        burst(arm.goal.x, arm.goal.y, 18);
      }
      if (arm.tapped && (arm.wait -= dt) <= 0) arm.mode = "task";
    } else {
      arm.mode = "task";
      if (job) {
        if (runJob(dt)) {
          job = null;
          idle = rand(6, 11);
        }
      } else {
        arm.goal = restGoal();
        arm.railTarget = arm.railHome;
        ride = false;
        if ((idle -= dt) <= 0) nextSwap();
      }
    }

    // The carriage drives so the arm reaches up and over to the goal from its right side.
    if (ride) arm.railTarget = clamp(arm.goal.x + reach() * 0.25, arm.railMin, arm.railMax);
    const railStep = clamp((arm.railTarget - arm.bx) * 2.5 * dt, -W * 0.22 * dt, W * 0.22 * dt);
    arm.bx += Math.abs(arm.railTarget - arm.bx) < 0.5 ? arm.railTarget - arm.bx : railStep;
    arm.S = { x: arm.bx, y: G - 26 * u };

    // Joints turn toward the IK solution at a capped speed, so moves look motor-driven
    // (and an elbow flip swings over instead of snapping).
    const ik = solveIK(arm.goal);
    arm.side += (ik.side - arm.side) * Math.min(1, dt * 4);
    for (const [key, target] of [["j1", ik.j1], ["j2", ik.j2]]) {
      const diff = wrapAngle(target - arm[key]);
      arm[key] += clamp(diff * 7 * dt, -2.4 * dt, 2.4 * dt);
    }
    arm.pose = pose();

    // A held letter hangs from the gripper by its top edge; the rest glide to their spots.
    for (const L of logo.letters) {
      if (L === arm.held) {
        L.x = arm.pose.T.x - L.w / 2;
        L.y = arm.pose.T.y;
      } else {
        const k = Math.min(1, dt * 3);
        L.x += (L.tx - L.x) * k;
        L.y += (L.ty - L.y) * k;
      }
    }
  }

  function drawArm() {
    const u = arm.u, bx = arm.bx;
    const { S: sh, E, P, Q, F } = arm.pose;
    S.paint(grid, S.ellipse(bx, G + 0.8 * u, 15 * u, 2 * u), M.shadow);

    S.paint(grid, S.box(bx, G - 1.4 * u, 13 * u, 1.6 * u, 0.6 * u), M.dark); // rail carriage
    S.paint(grid, S.box(bx, G - 6.5 * u, 11 * u, 4.4 * u, 1.2 * u), M.graphite);
    S.paint(grid, S.box(bx, G - 11.4 * u, 8 * u, 1.1 * u, 0.5 * u), M.dark);
    S.paint(grid, S.box(bx, G - 16.8 * u, 6.4 * u, 4.8 * u, 2.2 * u), M.steel);
    S.paint(grid, S.box(bx, G - 19.6 * u, 6.5 * u, 0.9 * u, 0.5 * u), M.urBand);
    S.paint(grid, S.capsule(bx, G - 20 * u, sh.x, sh.y, 5 * u), M.steel);

    S.paint(grid, S.capsule(sh.x, sh.y, E.x, E.y, 4.3 * u), M.steel);
    S.paint(grid, S.capsule(E.x, E.y, P.x, P.y, 3.4 * u), M.steel);
    S.paint(grid, S.capsule(P.x, P.y, Q.x, Q.y, 2.9 * u), M.steel);
    S.paint(grid, S.capsule(Q.x, Q.y, F.x, F.y, 2.6 * u), M.steel);

    for (const [j, r] of [[sh, 6.6], [E, 5.4], [P, 3.9], [Q, 3.7]]) {
      S.paint(grid, S.circle(j.x, j.y, r * u), M.steel);
      S.paint(grid, S.circle(j.x, j.y, r * 0.62 * u), M.urBlue);
    }
    S.paint(grid, S.circle(sh.x, sh.y, 1.5 * u), M.dark);

    S.paint(grid, S.box(F.x, F.y, 3.2 * u, 1 * u, 0.4 * u), M.graphite);
    S.paint(grid, S.box(F.x, F.y + 2.6 * u, 8 * u, 1.7 * u, 0.8 * u), M.dark);
    const gap = lerp(5.6, 7.6, arm.open) * u;
    for (const s of [-1, 1]) S.paint(grid, S.box(F.x + s * gap, F.y + 6.3 * u, 0.95 * u, 2.6 * u, 0.4 * u), M.graphite);
    S.paint(grid, S.circle(F.x, F.y + 2.6 * u, 0.8 * u), M.glow);
  }

  // ---------------------------------------------------------------- sysmon

  // Live CPU / memory / GPU readings, pushed by wallpaper.py about once a second.
  const HIST = 40;
  const BAR_CHARS = "._-:=+*#%@";
  const mon = { w: 0, h: 10, c0: 0, r0: 0, cpu: [], gpu: [], seen: null };

  function layoutSysmon() {
    mon.w = clamp(Math.floor(cols * 0.24), 46, 60);
    mon.c0 = cols - mon.w - 3;
    mon.r0 = 2;
  }

  function stepSysmon() {
    const s = api.stats.data;
    if (!s || s === mon.seen) return;
    mon.seen = s;
    const push = (list, v) => {
      list.push(v);
      if (list.length > HIST) list.shift();
    };
    push(mon.cpu, s.cpu.total);
    if (s.gpu) push(mon.gpu, s.gpu.util);
  }

  const level = (p) => (p < 60 ? GREEN : p < 85 ? AMBER : RED);
  const pct = (p) => `${Math.round(p)}%`.padStart(5);
  const temp = (c) => (c === null || c === undefined ? "" : `  ${Math.round(c)}C`);
  const gib = (used, total) => ` ${used.toFixed(1)}/${total.toFixed(1)}G`;

  /** A [|||||.....] bar as segments, filled by percent and coloured by load. */
  function bar(p, width) {
    const n = Math.round((clamp(p, 0, 100) / 100) * width);
    return [[GREY, "["], [level(p), "|".repeat(n)], [[50, 60, 76], ".".repeat(width - n)], [GREY, "]"]];
  }

  /** History as one character per sample, taller glyphs for higher values. */
  const spark = (list) => list.map((v) => [level(v), BAR_CHARS[Math.min(9, Math.floor((v / 100) * 10))]]);

  function drawSegments(c, r, segments, maxCols) {
    let n = 0;
    for (const [rgb, text] of segments) {
      const shown = text.slice(0, Math.max(0, maxCols - n));
      grid.text(c + n, r, shown, style(rgb[0], rgb[1], rgb[2], 0.95));
      n += text.length;
      if (n >= maxCols) break;
    }
    return n;
  }

  function drawSysmon(t) {
    const { c0, r0, w, h } = mon;
    if (r0 < 1) return;
    const frame = style(BLUE[0], BLUE[1], BLUE[2], 0.55);
    grid.text(c0, r0, "+" + "-".repeat(w - 2) + "+", frame);
    grid.text(c0 + 3, r0, " dric@lab: ~$ sysmon --watch ", style(STEEL[0], STEEL[1], STEEL[2], 0.9));
    grid.text(c0, r0 + h + 1, "+" + "-".repeat(w - 2) + "+", frame);
    for (let r = r0 + 1; r <= r0 + h; r++) {
      grid.put(c0, r, "|", frame);
      grid.put(c0 + w - 1, r, "|", frame);
    }

    const inner = w - 4, B = inner - 5 - 2 - 14;
    const label = (text) => [STEEL, text.padEnd(5)];
    const s = api.stats.data;
    const lines = [];
    if (!s) {
      lines.push([[GREY, "waiting for stats from wallpaper.py ..."]]);
    } else {
      lines.push([label("CPU"), ...bar(s.cpu.total, B), [CYAN, pct(s.cpu.total) + temp(s.cpu.temp)]]);
      lines.push([label("CORE"), ...s.cpu.cores.slice(0, inner - 5).map((v) => [level(v), BAR_CHARS[Math.min(9, Math.floor((v / 100) * 10))]])]);
      lines.push([label("HIST"), ...spark(mon.cpu)]);
      lines.push([label("MEM"), ...bar((s.mem.used / s.mem.total) * 100, B), [CYAN, gib(s.mem.used, s.mem.total)]]);
      if (s.gpu) {
        lines.push([label("GPU"), [WHITE, s.gpu.name.replace(/^NVIDIA /, "")]]);
        lines.push([label("UTIL"), ...bar(s.gpu.util, B), [CYAN, pct(s.gpu.util) + temp(s.gpu.temp)]]);
        lines.push([label("VRAM"), ...bar((s.gpu.memUsed / s.gpu.memTotal) * 100, B), [CYAN, gib(s.gpu.memUsed, s.gpu.memTotal)]]);
        lines.push([label("HIST"), ...spark(mon.gpu), [CYAN, s.gpu.power ? `  ${Math.round(s.gpu.power)}W` : ""]]);
      } else {
        lines.push([label("GPU"), [GREY, "no NVIDIA GPU found"]]);
      }
      const up = Math.floor(s.uptime / 3600) + "h " + String(Math.floor((s.uptime % 3600) / 60)).padStart(2, "0") + "m";
      lines.push([label("LOAD"), [CYAN, s.load.map((l) => l.toFixed(2)).join(" ")], [STEEL, "   UP "], [CYAN, up]]);
    }
    lines.slice(0, h - 1).forEach((segments, k) => drawSegments(c0 + 2, r0 + 1 + k, segments, inner));
    const r = r0 + Math.min(lines.length, h - 1) + 1;
    const n = drawSegments(c0 + 2, r, [[GREEN, "dric@lab"], [GREY, ":~$ "]], inner);
    if (Math.floor(t * 2) % 2) grid.put(c0 + 2 + n, r, "_", style(WHITE[0], WHITE[1], WHITE[2], 1));
  }

  // ---------------------------------------------------- sparks and labels

  function burst(x, y, n) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2), v = rand(60, 260);
      sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 80, life: rand(0.35, 0.9), max: 0.9 });
    }
  }

  function drawSparks() {
    for (const p of sparks) {
      const f = p.life / p.max;
      const rgb = f > 0.5 ? [lerp(CYAN[0], WHITE[0], (f - 0.5) * 2), lerp(CYAN[1], WHITE[1], (f - 0.5) * 2), lerp(CYAN[2], WHITE[2], (f - 0.5) * 2)] : CYAN;
      grid.putAt(p.x, p.y, f > 0.66 ? "*" : f > 0.33 ? "+" : ".", style(rgb[0], rgb[1], rgb[2], clamp(f * 1.4, 0, 1)));
    }
  }

  const deg = (a) => {
    const d = (a * 180) / Math.PI;
    return (d < 0 ? "-" : "+") + Math.abs(d).toFixed(1).padStart(5, "0");
  };
  const metres = (px) => {
    const m = px / (arm.u * 100);
    return (m < 0 ? "-" : "+") + Math.abs(m).toFixed(3);
  };

  function drawLabels() {
    const label = style(STEEL[0], STEEL[1], STEEL[2], 0.85);
    const value = style(CYAN[0], CYAN[1], CYAN[2], 0.95);
    const r0 = groundRow + 2;
    if (r0 + 2 >= rows) return;

    const { T } = arm.pose;
    const task = job ? `SWAP ${"DRIC"[job.a.k]}<>${"DRIC"[job.b.k]}` : arm.mode.toUpperCase();
    const lines = [
      "UR5 // COLLABORATIVE ARM ON RAIL",
      `RAIL ${metres(arm.bx - arm.railMin)}  J2 ${deg(arm.j1)}  J3 ${deg(wrapAngle(arm.j2 - arm.j1))}`,
      `TCP X ${metres(T.x - arm.S.x)}  Z ${metres(G - T.y)}  ${task}`,
    ];
    const width = Math.max(...lines.map((l) => l.length));
    const c0 = clamp(Math.floor(arm.bx / cw - width / 2), 1, cols - width - 1);
    grid.text(c0, r0, lines[0], label);
    grid.text(c0, r0 + 1, lines[1], value);
    if (r0 + 2 < rows) grid.text(c0, r0 + 2, lines[2], value);
  }

  // ------------------------------------------------------------ the scene

  let paletteTimer = 0;

  function step(dt) {
    if ((paletteTimer -= dt) <= 0) {
      updatePalette();
      paletteTimer = CYCLE > 0 ? 0.1 : 20;
    }
    stepArm(dt);
    for (let i = sparks.length - 1; i >= 0; i--) {
      const p = sparks[i];
      p.vy += 420 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if ((p.life -= dt) <= 0) sparks.splice(i, 1);
    }
    logo.glitch = Math.max(0, logo.glitch - dt);
    stepSysmon();
  }

  function draw(t) {
    for (let i = 0; i < glyph.length; i++) {
      glyph[i] = floorGlyph[i];
      color[i] = floorColor[i];
    }
    drawSysmon(t);
    drawLogo(t);
    drawArm();
    drawSparks();
    drawLabels();
  }

  function click(x, y) {
    const box = logo.box;
    const letter = letterAt(x, y);
    if (letter && !job) {
      // Swap the clicked letter with a random other one.
      const others = logo.letters.filter((L) => L !== letter);
      startSwap(letter, others[(Math.random() * others.length) | 0]);
      arm.mode = "task";
    } else if (x > box.x0 && x < box.x1 && y > box.y0 && y < box.y1) {
      logo.glitch = 0.6;
    } else if (!arm.held && y < G && Math.abs(x - arm.bx) < W * 0.5) {
      arm.mode = "tap";
      arm.tap = { x, y: Math.min(y, G - 1.5 * arm.u) };
      arm.tapped = false;
    } else {
      burst(x, y, 10);
    }
  }

  return { cellWidth, resize, paintBackdrop, step, draw, click, chat: false };
});
