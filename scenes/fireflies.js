/**
 * Fireflies — a summer night over a meadow and a still pond.
 *
 * Each firefly is a pulse-coupled oscillator: its charge creeps up, it flashes when full,
 * and a neighbour who sees the flash charges a little faster. Over a minute or so the
 * meadow goes from scattered blinks to waves of light rolling across it and, finally, to
 * the whole field flashing together, the way synchronous fireflies do. Then a few drift
 * out of step and it starts over.
 *
 * A firefly climbs a little as it flashes (the "J" of a real one), drifts between
 * flashes as a faint dot, and shows up again, wobbling, in the pond below. Stars twinkle,
 * the moon lays a broken path on the water and the grass sways in passing gusts.
 *
 * A resting cursor draws a few curious fireflies; a fast one scatters them. Click to
 * flash a lantern: nearby fireflies answer, in a ring that spreads outward.
 *
 * URL params: flies=150, sync=60 (seconds until the meadow is in step).
 */
Wallpaper.scene("fireflies", (api) => {
  "use strict";

  const { grid, intParam, floatParam, pointer, setTheme } = api;
  const { clamp, lerp, smoothstep, rand, hash2, noise2 } = Wallpaper.math;
  const style = Wallpaper.style;

  const FLIES = clamp(intParam("flies", 150), 10, 400);
  const SYNC = clamp(floatParam("sync", 60), 5, 600);

  let W = 0, H = 0, cw = 10, ch = 15, cols = 0, rows = 0;
  /** Rows of the treeline's foot (where the meadow starts) and of the pond's edge. */
  let meadowRow = 0, pondRow = 0, meadowY = 0, pondY = 0;
  const put = (c, r, g, st) => grid.put(c, r, g, st);

  let stars = [];
  let blades = [];
  const moon = { x: 0, y: 0, r: 0 };

  // ------------------------------------------------------------ layout

  function resize() {
    ({ W, H, cw, ch, cols, rows } = grid);
    meadowRow = Math.round(rows * 0.5);
    pondRow = Math.round(rows * 0.8);
    meadowY = meadowRow * ch;
    pondY = pondRow * ch;
    moon.x = W * 0.78;
    moon.y = H * 0.16;
    moon.r = Math.min(W, H) * 0.045;

    stars = [];
    for (let r = 0; r < meadowRow; r++) {
      for (let c = 0; c < cols; c++) {
        const n = hash2(c, r, 71);
        if (n > 0.985 && (r + 1) * ch < treeTop(c * cw)) {
          stars.push({ c, r, g: n > 0.997 ? "+" : n > 0.992 ? "*" : ".", ph: hash2(c, r, 5) * 10, k: 0.4 + hash2(c, r, 9) * 0.6 });
        }
      }
    }

    blades = [];
    for (let c = 0; c < cols; c++) {
      for (let k = 0; k < 2; k++) {
        const h = Math.round((0.1 + hash2(c, k, 31) ** 2 * 0.9) * (pondRow - meadowRow) * (k ? 0.6 : 0.35));
        if (hash2(c, k, 37) < 0.32) blades.push({ c, base: pondRow - 1, h: Math.max(2, h), ph: hash2(c, k, 41) * 6, k: hash2(c, k, 43) });
      }
    }

    if (!flies.length) for (let i = 0; i < FLIES; i++) flies.push(spawnFly());
  }

  /** Height of the treeline at x (px from the top). */
  function treeTop(x) {
    const n = noise2(x * 0.004, 0.5, 3) * 0.6 + noise2(x * 0.02, 1.5, 4) * 0.3 + noise2(x * 0.08, 2.5, 5) * 0.1;
    return meadowY - (0.08 + 0.22 * n) * H;
  }

  function paintBackdrop(g, w, h) {
    const sky = g.createLinearGradient(0, 0, 0, meadowY);
    sky.addColorStop(0, "#04060f");
    sky.addColorStop(0.7, "#0b1430");
    sky.addColorStop(1, "#182348");
    g.fillStyle = sky;
    g.fillRect(0, 0, w, h);

    // The moon and its halo.
    const halo = g.createRadialGradient(moon.x, moon.y, moon.r, moon.x, moon.y, moon.r * 9);
    halo.addColorStop(0, "rgba(200,215,255,0.18)");
    halo.addColorStop(1, "rgba(200,215,255,0)");
    g.fillStyle = halo;
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#e6ebf5";
    g.beginPath();
    g.arc(moon.x, moon.y, moon.r, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "rgba(160,170,190,0.25)";
    for (const [dx, dy, r] of [[-0.3, -0.2, 0.22], [0.25, 0.3, 0.16], [0.1, -0.4, 0.1]]) {
      g.beginPath();
      g.arc(moon.x + dx * moon.r, moon.y + dy * moon.r, r * moon.r, 0, Math.PI * 2);
      g.fill();
    }

    // The treeline, a hill line in front of it, and the meadow.
    g.fillStyle = "#03050a";
    g.beginPath();
    g.moveTo(0, meadowY + ch);
    for (let x = 0; x <= w; x += 4) g.lineTo(x, treeTop(x));
    g.lineTo(w, meadowY + ch);
    g.fill();
    const meadow = g.createLinearGradient(0, meadowY, 0, pondY);
    meadow.addColorStop(0, "#060a0c");
    meadow.addColorStop(1, "#0a140f");
    g.fillStyle = meadow;
    g.fillRect(0, meadowY, w, pondY - meadowY);

    // The pond, a darker mirror of the sky.
    const pond = g.createLinearGradient(0, pondY, 0, h);
    pond.addColorStop(0, "#0e1530");
    pond.addColorStop(1, "#03050c");
    g.fillStyle = pond;
    g.fillRect(0, pondY, w, h - pondY);
  }

  // ---------------------------------------------------------- fireflies

  const flies = [];
  const PERIOD = 1.1;
  /** How strongly a flash pulls neighbours; ramps up, then a reset scatters them again. */
  let coupling = 0, epoch = 0;

  function spawnFly() {
    return {
      x: rand(0, W), y: rand(meadowY - H * 0.08, pondY - ch * 2),
      vx: 0, vy: 0, seed: rand(0, 1000),
      phase: rand(0, 1), rate: 1 / (PERIOD * rand(0.85, 1.2)),
      glow: 0, climb: 0, nudge: 0, lag: -1, home: rand(0, 1),
    };
  }

  function stepFlies(dt, t) {
    epoch += dt;
    // Couple more and more until SYNC; a while after, shuffle most out of step again.
    coupling = smoothstep(SYNC * 0.08, SYNC, epoch) * 0.09;
    if (epoch > SYNC + 40) {
      epoch = 0;
      for (const f of flies) if (rand() < 0.7) f.phase = rand(0, 1);
    }

    const now = performance.now();
    const resting = pointer.active && now - pointer.moved > 800;
    const fast = pointer.active && now - pointer.moved < 150;
    const R = Math.min(W, H) * 0.22;

    const fired = [];
    for (const f of flies) {
      // Lantern answers: fire once the ring of the click reaches you.
      if (f.lag >= 0 && (f.lag -= dt) < 0) f.phase = 1;
      f.phase += f.rate * dt + f.nudge;
      f.nudge = 0;
      if (f.phase >= 1) {
        f.phase -= Math.floor(f.phase);
        f.glow = 1;
        f.climb = 1;
        fired.push(f);
      }
      f.glow = Math.max(0, f.glow - dt * 3);
      f.climb = Math.max(0, f.climb - dt * 2.2);

      // Drift: a slow wander, a preferred height band, and a lift during the flash.
      const wx = noise2(f.seed, t * 0.12, 7) - 0.5, wy = noise2(f.seed + 50, t * 0.12, 8) - 0.5;
      let ax = wx * 60, ay = wy * 40 - f.climb * 35;
      const top = meadowY - H * 0.1, bottom = pondY - ch * 2;
      // Each has a favourite height, from just over the treeline's foot down into the grass.
      ay += (lerp(top, bottom, f.home ** 0.8) - f.y) * 0.25;
      if (f.y < top) ay += (top - f.y) * 2;
      if (f.y > bottom) ay -= (f.y - bottom) * 2;
      if (f.x < 0) f.x += W;
      if (f.x > W) f.x -= W;

      if (pointer.active) {
        const dx = pointer.x - f.x, dy = pointer.y - f.y, d = Math.hypot(dx, dy) || 1;
        if (fast && d < R * 0.6) {
          ax -= (dx / d) * 400;
          ay -= (dy / d) * 400;
        } else if (resting && d < R && (f.seed | 0) % 3 === 0) {
          // Circle the cursor rather than land on it.
          const want = R * 0.25;
          ax += (dx / d) * (d - want) * 0.4 - (dy / d) * 25;
          ay += (dy / d) * (d - want) * 0.4 + (dx / d) * 25;
        }
      }
      f.vx = (f.vx + ax * dt) * Math.exp(-dt * 1.2);
      f.vy = (f.vy + ay * dt) * Math.exp(-dt * 1.2);
      f.x += f.vx * dt;
      f.y += f.vy * dt;
    }

    // Seen flashes advance neighbours (closer ones more), so the meadow pulls into step.
    if (coupling > 0 && fired.length) {
      for (const f of flies) {
        if (f.glow > 0.9) continue;
        let pull = 0;
        for (const s of fired) {
          const d = Math.hypot(s.x - f.x, s.y - f.y);
          if (d < R) pull += 1 - d / R;
        }
        f.nudge += coupling * Math.min(pull, 2) * (0.3 + f.phase);
      }
    }
  }

  const FLASH = [210, 255, 110];
  /** Halo cells around a flash: [dc, dr, strength], an ellipse since cells are tall. */
  const HALO = [];
  for (let dr = -2; dr <= 2; dr++) {
    for (let dc = -4; dc <= 4; dc++) {
      const d = Math.hypot(dc / 2, dr);
      if ((dc || dr) && d <= 2.1 && (d < 1.2 || hash2(dc, dr, 3) < 0.5)) HALO.push([dc, dr, (1 - d / 2.4) ** 1.5]);
    }
  }

  function drawFly(f) {
    const c = Math.floor(f.x / cw), r = Math.floor(f.y / ch);
    const g = f.glow;
    if (g < 0.05) {
      put(c, r, ".", style(150, 190, 80, 0.4));
      return;
    }
    put(c, r, g > 0.75 ? "@" : g > 0.45 ? "*" : g > 0.2 ? "+" : ".", style(FLASH[0], FLASH[1], FLASH[2], 0.45 + 0.55 * g));
    // Halo, wider than tall since cells are tall.
    if (g > 0.25) {
      const a = g * 0.75;
      for (const [dc, dr, k] of HALO) put(c + dc, r + dr, k > 0.6 ? "+" : k > 0.35 ? "·" : ".", style(FLASH[0], FLASH[1], FLASH[2], a * k));
    }
    // Reflection in the pond: mirrored about the waterline, dimmer and wobbling.
    if (g > 0.2) {
      const ry = 2 * pondY - f.y + (pondY - f.y) * 0.2;
      const rr = Math.floor(ry / ch);
      if (rr > pondRow && rr < rows) {
        const wob = Math.round(Math.sin(f.y * 0.05 + performance.now() * 0.004) * 1.2);
        put(c + wob, rr, g > 0.6 ? "*" : "-", style(FLASH[0], FLASH[1], FLASH[2], g * 0.35));
      }
    }
  }

  // ------------------------------------------------------------ scenery

  function drawStars(t) {
    for (const s of stars) {
      const tw = 0.55 + 0.45 * Math.sin(t * (0.8 + s.k) + s.ph);
      put(s.c, s.r, s.g, style(220, 225, 255, s.k * tw * 0.8));
    }
  }

  /** The moon's path on the pond: broken dashes that shimmer. */
  function drawPond(t) {
    const mc = moon.x / cw;
    for (let r = pondRow; r < rows; r++) {
      const k = (r - pondRow) / Math.max(1, rows - pondRow);
      const half = 1.5 + k * 6;
      for (let c = Math.floor(mc - half); c <= Math.ceil(mc + half); c++) {
        const n = noise2(c * 0.6, r * 0.9 - t * 0.6, 11);
        if (n > 0.55) put(c, r, n > 0.7 ? "=" : "-", style(210, 220, 255, (n - 0.5) * (1 - Math.abs(c - mc) / (half + 1)) * 0.9));
      }
      // Faint ripples everywhere else.
      if (r === pondRow) {
        for (let c = 0; c < cols; c++) {
          const n = Math.sin(c * 0.4 + t * 0.8) + Math.sin(c * 0.13 - t * 0.5);
          put(c, r, n > 0.8 ? "~" : "-", style(130, 150, 200, 0.18 + 0.1 * n));
        }
      }
    }
  }

  /** Grass in front of the meadow, bending in gusts that travel across. */
  function drawGrass(t) {
    for (const b of blades) {
      const gust = Math.max(0, Math.sin(b.c * 0.05 - t * 0.9)) ** 3;
      for (let j = 0; j < b.h; j++) {
        const k = j / b.h;
        const bend = (Math.sin(t * 1.3 + b.ph) * 0.4 + gust * 2) * k * k;
        const c = b.c + Math.round(bend), r = b.base - j;
        const lean = bend + (b.k - 0.5) * 2 * k;
        const g = j === b.h - 1 ? (b.k > 0.85 ? "*" : lean > 0.3 ? "," : "'") : lean > 0.6 ? "/" : lean < -0.6 ? "\\" : j === 0 ? "|" : b.k > 0.5 ? "|" : "!";
        // Lit faintly by the fireflies' summed glow nearby.
        const lit = glowAt(c, r);
        const base = (30 + 36 * (1 - k * 0.5)) * (0.6 + 0.6 * b.k);
        put(c + Math.round((b.k - 0.5) * 2 * k * k), r, g, style(base * 0.6 + lit * 150, base * 1.1 + lit * 180, base * 0.6 + lit * 60, 0.85));
      }
    }
  }

  /** A coarse map of firefly light, for lighting the grass. */
  let glowMap = new Float32Array(1), glowCols = 1, glowRows = 1;
  const CELL = 4;

  function buildGlow() {
    glowCols = Math.ceil(cols / CELL);
    glowRows = Math.ceil(rows / CELL);
    if (glowMap.length !== glowCols * glowRows) glowMap = new Float32Array(glowCols * glowRows);
    else glowMap.fill(0);
    for (const f of flies) {
      if (f.glow < 0.2) continue;
      const gc = Math.floor(f.x / cw / CELL), gr = Math.floor(f.y / ch / CELL);
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const c = gc + dc, r = gr + dr;
          if (c < 0 || r < 0 || c >= glowCols || r >= glowRows) continue;
          glowMap[r * glowCols + c] += f.glow * (dc || dr ? 0.06 : 0.15);
        }
      }
    }
  }

  function glowAt(c, r) {
    const gc = Math.floor(c / CELL), gr = Math.floor(r / CELL);
    if (gc < 0 || gr < 0 || gc >= glowCols || gr >= glowRows) return 0;
    return Math.min(0.5, glowMap[gr * glowCols + gc]);
  }

  // ------------------------------------------------------------- lantern

  const lanterns = [];

  function click(x, y) {
    lanterns.push({ x, y, life: 1 });
    const speed = Math.min(W, H) * 0.6;
    for (const f of flies) {
      const d = Math.hypot(f.x - x, f.y - y);
      if (d < Math.min(W, H) * 0.5) f.lag = 0.15 + d / speed;
    }
  }

  function drawLanterns(dt) {
    for (let i = lanterns.length - 1; i >= 0; i--) {
      const l = lanterns[i];
      if ((l.life -= dt * 1.5) <= 0) {
        lanterns.splice(i, 1);
        continue;
      }
      const c = Math.floor(l.x / cw), r = Math.floor(l.y / ch);
      put(c, r, "@", style(255, 230, 160, l.life));
      const rad = (1 - l.life) * 6 + 1;
      for (let a = 0; a < Math.PI * 2; a += 0.35) {
        put(Math.round(c + Math.cos(a) * rad * 1.5), Math.round(r + Math.sin(a) * rad), "·", style(255, 230, 160, l.life * 0.5));
      }
    }
  }

  // --------------------------------------------------------------- scene

  function step(dt, t) {
    stepFlies(dt, t);
  }

  function draw(t, dt) {
    drawStars(t);
    drawPond(t);
    buildGlow();
    for (const f of flies) drawFly(f);
    drawGrass(t);
    drawLanterns(dt);
  }

  setTheme("dark");

  return { resize, paintBackdrop, step, draw, click, chat: false };
});
