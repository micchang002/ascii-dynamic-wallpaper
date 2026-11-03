/**
 * Cats — big, lifelike ASCII cats living on your desktop.
 *
 * Each cat is a small rig, rasterised cell by cell like the koi: a torso (an uneven capsule
 * from hips to shoulders), neck, head, muzzle and ears blended into one body; four legs
 * solved with two-bone IK (the far pair shaded darker, behind the body); and a tail chain
 * that waves and curls. A pose is just numbers (joint positions in body lengths), so poses
 * blend smoothly into each other and a turn-around swings the cat through a front view.
 *
 * Poses: stand, walk, run, sit, look (at you), groom (licks a paw), wash (face), lickBack,
 * yawn, bat, loaf (sphinx), side (lying on its side), sleep (curled up), sleepSide,
 * groomLeg, stretch, crouch (stalking), leap, eat, belly (rolled over), knead, petted.
 *
 * Places (?env=room | roof | garden, keys 1/2/3 or the HUD): a living room with a cat tree,
 * window, sofa, wall shelf and bookshelf; two rooftops with a chimney, water tank and phone
 * wire; a garden with an engawa, stone lantern, fence and tree branch. Ledges come from
 * the same layout the scenery is drawn from, so paws land on what is drawn.
 *
 * Play: flick the cursor and the cats stalk and pounce on it like a laser dot; rest the
 * cursor on a cat to pet it (it purrs, rubs, kneads or rolls over); click to drop a toy
 * (T cycles yarn / wind-up mouse / fish). +/- changes the number of cats, H hides the HUD.
 *
 * URL params: cats=3, env=room, hud=0, hour=13.5, cycle=120, pose=<name> (pin every cat
 * to one pose), pose=all (a gallery of every pose).
 */
Wallpaper.scene("cats", (api) => {
  "use strict";

  const { grid, params, intParam, floatParam, pointer, stats, setTheme } = api;
  const { clamp, lerp, smoothstep, wrapAngle, rand, hash2, noise2 } = Wallpaper.math;
  const style = Wallpaper.style;
  const shapes = Wallpaper.shapes;

  const ENVS = ["room", "roof", "garden"];
  const MAX_CATS = 8;
  let catCount = clamp(intParam("cats", 3), 1, MAX_CATS);
  let env = ENVS.includes(params.get("env")) ? params.get("env") : "room";
  let hudVisible = params.get("hud") !== "0";
  const PIN_POSE = params.get("pose");
  const GALLERY = PIN_POSE === "all";
  const PIN_HOUR = floatParam("hour", NaN);
  const CYCLE = floatParam("cycle", 0);
  const startTime = performance.now();

  // ------------------------------------------------------------------ sky

  /** [hour, sky top, sky at the horizon, daylight 0..1] */
  const SKY = [
    [0, [8, 12, 26], [22, 30, 52], 0],
    [5, [12, 16, 34], [36, 32, 56], 0],
    [6.5, [70, 52, 90], [214, 130, 104], 0.35],
    [8, [108, 158, 214], [226, 222, 214], 0.9],
    [12, [116, 174, 232], [230, 238, 242], 1],
    [16, [124, 170, 222], [238, 230, 212], 0.95],
    [17.8, [176, 96, 74], [244, 168, 98], 0.6],
    [19.2, [56, 38, 78], [130, 68, 92], 0.25],
    [21, [10, 14, 30], [24, 30, 54], 0],
    [24, [8, 12, 26], [22, 30, 52], 0],
  ];
  const sky = { hour: -1, top: [0, 0, 0], low: [0, 0, 0], day: 1 };
  let paintedHour = -99;

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
      sky.low[k] = lerp(a[2][k], b[2][k], t);
    }
    sky.day = lerp(a[3], b[3], t);
    sky.hour = hour;
    setTheme(hour >= 8.5 && hour < 18 ? "light" : "dark");
  }

  /** Repaint the backdrop when the sky has drifted (every ~6 minutes of clock time). */
  function followSky(hour) {
    setSky(hour);
    let dh = Math.abs(hour - paintedHour);
    dh = Math.min(dh, 24 - dh);
    if (dh > 0.1) {
      paintedHour = hour;
      grid.repaintBackdrop();
    }
  }

  const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  const rgb = (c, a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;
  const lum = (c) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
  const night = () => sky.day < 0.3;

  // ------------------------------------------------------------ grid & ink

  let W = 0, H = 0, cw = 10, ch = 15, cols = 0, rows = 0;
  /** A cat's body length (nose to rump) in px; everything is sized from it. */
  let U = 200;
  const X = (c) => c * cw;
  const Y = (r) => r * ch;
  const colsOf = (k) => Math.max(1, Math.round((k * U) / cw));
  const rowsOf = (k) => Math.max(1, Math.round((k * U) / ch));

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

  /**
   * A colour for cell (c, r) that stays readable over the backdrop there: if it is within
   * `need` brightness of the backdrop it is darkened (light backdrop) or lifted (dark one).
   */
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

  const put = (c, r, g, c3, a = 1) => grid.put(c, r, g, style(c3[0], c3[1], c3[2], a));
  /** A line of text; spaces stay transparent. */
  function text(c, r, str, c3, a = 1) {
    for (let k = 0; k < str.length; k++) if (str[k] !== " ") put(c + k, r, str[k], c3, a);
  }
  /** Text that keeps its contrast over the backdrop. */
  function inkText(c, r, str, c3, a = 1, need = 90) {
    for (let k = 0; k < str.length; k++) if (str[k] !== " ") grid.put(c + k, r, str[k], ink(c3, c + k, r, a, need));
  }

  /** A box over whole cells c0..c1 × r0..r1, painted as shaded ASCII. */
  function block(c0, r0, c1, r1, m, round = 0) {
    const shape = shapes.box(X(c0 + c1 + 1) / 2, Y(r0 + r1 + 1) / 2, X(c1 - c0 + 1) / 2, Y(r1 - r0 + 1) / 2, round);
    shapes.paint(grid, shape, m);
  }

  // --------------------------------------------------------------- layout

  let L = {};
  /** Ledges: a cat's feet rest on the top edge of `row`, anywhere from column c0 to c1. */
  let platforms = [];
  const ledge = (id, c0, c1, row, ground = false) =>
    ({ id, c0: Math.max(0, Math.round(c0)), c1: Math.min(cols - 1, Math.round(c1)), row: Math.round(row), ground });
  const has = (id) => platforms.some((p) => p.id === id);

  function layout() {
    const floor = rows - Math.max(3, Math.round(rows * 0.07));
    platforms = [];

    if (env === "room") {
      const tree = { c: Math.max(colsOf(0.6), Math.round(cols * 0.09)), hw: colsOf(0.55), o2: colsOf(0.38) };
      tree.t1 = floor - rowsOf(0.8);
      tree.t2 = tree.t1 - rowsOf(1.15);
      tree.t3 = tree.t2 - rowsOf(1.15);
      const win = { c0: Math.round(cols * 0.26) };
      win.c1 = win.c0 + Math.max(colsOf(1.3), Math.round(cols * 0.17));
      win.sill = floor - rowsOf(1.25);
      win.top = Math.max(3, win.sill - rowsOf(1.8));
      win.mid = Math.round((win.c0 + win.c1) / 2);
      const sofa = { c0: win.c1 + colsOf(0.45), armW: colsOf(0.2) };
      sofa.c1 = sofa.c0 + colsOf(2.0);
      sofa.seat = floor - rowsOf(0.5);
      sofa.back = floor - rowsOf(1.0);
      sofa.arm = floor - rowsOf(0.7);
      const shelf = { c0: sofa.c1 + colsOf(0.35) };
      shelf.c1 = Math.min(cols - 2, shelf.c0 + colsOf(1.0));
      shelf.top = floor - rowsOf(2.1);
      shelf.ok = shelf.c1 - shelf.c0 >= colsOf(0.85);
      const wall = { c0: sofa.c0 + colsOf(0.1), c1: sofa.c0 + colsOf(1.25), row: sofa.back - rowsOf(1.05) };
      const lamp = { c: sofa.c1 - colsOf(0.45), row: Math.max(4, sofa.back - rowsOf(1.1)) };
      L = { floor, tree, win, sofa, shelf, wall, lamp };

      platforms.push(ledge("floor", 0, cols - 1, floor, true));
      platforms.push(ledge("tree1", tree.c - tree.hw, tree.c + tree.hw, tree.t1));
      if (tree.t2 > 2) platforms.push(ledge("tree2", tree.c + tree.o2 - tree.hw * 0.85, tree.c + tree.o2 + tree.hw * 0.85, tree.t2));
      if (tree.t3 > 2) platforms.push(ledge("tree3", tree.c - tree.o2 * 0.6 - tree.hw * 0.75, tree.c - tree.o2 * 0.6 + tree.hw * 0.75, tree.t3));
      platforms.push(ledge("sill", win.c0 - colsOf(0.1), win.c1 + colsOf(0.1), win.sill));
      platforms.push(ledge("seat", sofa.c0 + sofa.armW, sofa.c1 - sofa.armW, sofa.seat));
      platforms.push(ledge("sofa", sofa.c0 + sofa.armW, sofa.c1 - sofa.armW, sofa.back));
      if (wall.row > 2) platforms.push(ledge("wall shelf", wall.c0, wall.c1, wall.row));
      if (shelf.ok && shelf.top > 2) platforms.push(ledge("shelf", shelf.c0, shelf.c1, shelf.top));
    } else if (env === "roof") {
      const floorR = rows - 3;
      const left = { c1: Math.round(cols * 0.34) };
      left.top = floorR - rowsOf(1.6);
      const chim = { c0: colsOf(0.4) };
      chim.c1 = chim.c0 + colsOf(0.75);
      chim.top = Math.max(3, left.top - rowsOf(0.75));
      const right = { c0: Math.round(cols * 0.52) };
      right.top = floorR - rowsOf(0.95);
      const wire = { row: left.top + rowsOf(0.3), c0: left.c1 + 1, pole: right.c0 + 2 };
      const tank = { c: Math.round(right.c0 + (cols - right.c0) * 0.62), hw: colsOf(0.55) };
      tank.ok = cols - right.c0 > colsOf(2.2);
      tank.bottom = right.top - rowsOf(0.45);
      tank.top = Math.max(3, tank.bottom - rowsOf(0.75));
      L = { floor: floorR, left, chim, right, wire, tank };

      platforms.push(ledge("roof left", 0, left.c1, left.top));
      platforms.push(ledge("chimney", chim.c0, chim.c1, chim.top));
      platforms.push(ledge("roof right", right.c0, cols - 1, right.top));
      if (wire.pole - wire.c0 > colsOf(0.9)) platforms.push(ledge("wire", wire.c0, wire.pole - 1, wire.row));
      if (right.c0 - left.c1 > colsOf(1.2)) platforms.push(ledge("street", left.c1 + 1, right.c0 - 1, floorR, true));
      if (tank.ok) platforms.push(ledge("tank", tank.c - tank.hw, tank.c + tank.hw, tank.top));
    } else {
      const house = { c1: Math.round(cols * 0.28) };
      house.deck = floor - rowsOf(0.4);
      house.eave = Math.max(3, house.deck - rowsOf(1.9));
      const lantern = { c: house.c1 + colsOf(1.1), hw: colsOf(0.42), top: floor - rowsOf(1.0) };
      const fence = { c0: Math.round(cols * 0.5), c1: Math.round(cols * 0.78) };
      fence.rail = floor - rowsOf(0.85);
      const tree = { c: Math.round(cols * 0.91), c0: Math.round(cols * 0.72) };
      tree.row = Math.max(4, floor - rowsOf(1.95));
      const horizon = floor - rowsOf(0.9);
      L = { floor, house, lantern, fence, tree, horizon };

      platforms.push(ledge("lawn", 0, cols - 1, floor, true));
      platforms.push(ledge("deck", 0, house.c1 + colsOf(0.2), house.deck));
      platforms.push(ledge("eaves", 0, house.c1 + colsOf(0.3), house.eave));
      platforms.push(ledge("lantern", lantern.c - lantern.hw, lantern.c + lantern.hw, lantern.top));
      platforms.push(ledge("fence", fence.c0, fence.c1, fence.rail));
      platforms.push(ledge("branch", tree.c0, tree.c + 3, tree.row));
    }
  }

  // ------------------------------------------------------------- backdrop

  function skyGradient(g, y0, y1) {
    const grad = g.createLinearGradient(0, y0, 0, y1);
    grad.addColorStop(0, rgb(sky.top));
    grad.addColorStop(1, rgb(sky.low));
    return grad;
  }

  /** Sun by day (moving with the hour), crescent moon by night, inside the given box. */
  function paintSkyBodies(g, x0, y0, w, h) {
    if (sky.day > 0.3) {
      const p = clamp((sky.hour - 6) / 12, 0, 1);
      const x = x0 + w * (0.1 + 0.8 * p), y = y0 + h * (0.8 - 0.6 * Math.sin(Math.PI * p));
      const r = Math.max(10, Math.min(w, h) * 0.07);
      const glow = g.createRadialGradient(x, y, 0, x, y, r * 3);
      glow.addColorStop(0, "rgba(255,244,200,0.55)");
      glow.addColorStop(1, "rgba(255,244,200,0)");
      g.fillStyle = glow;
      g.fillRect(x - r * 3, y - r * 3, r * 6, r * 6);
      g.fillStyle = "rgba(255,246,214,0.95)";
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    } else {
      const x = x0 + w * 0.78, y = y0 + h * 0.25, r = Math.max(9, Math.min(w, h) * 0.05);
      g.fillStyle = "rgba(255,246,200,0.95)";
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = rgb(mix(sky.top, sky.low, clamp((y - y0) / h, 0, 1)));
      g.beginPath();
      g.arc(x - r * 0.45, y - r * 0.25, r * 0.92, 0, Math.PI * 2);
      g.fill();
    }
  }

  /** A row of distant buildings along `base`, with lit windows at night. */
  function paintSkyline(g, x0, x1, base, maxH, colour, seed) {
    let x = x0, k = 0;
    while (x < x1) {
      const bw = cw * (4 + Math.floor(hash2(k, 1, seed) * 6));
      const bh = maxH * (0.35 + 0.65 * hash2(k, 2, seed));
      g.fillStyle = colour;
      g.fillRect(x, base - bh, Math.min(bw, x1 - x), bh);
      if (night()) {
        g.fillStyle = "rgba(255,214,120,0.75)";
        for (let wy = base - bh + 6; wy < base - 4; wy += 9) {
          for (let wx = x + 4; wx < Math.min(x + bw, x1) - 4; wx += 7) {
            if (hash2(Math.round(wx), Math.round(wy), seed + 7) > 0.72) g.fillRect(wx, wy, 3, 4);
          }
        }
      }
      x += bw + cw * Math.floor(hash2(k, 3, seed) * 2);
      k++;
    }
  }

  const wallColour = () => mix([44, 38, 56], [226, 214, 196], sky.day);

  function paintRoom(g, w, h) {
    const D = sky.day, { floor, win, shelf, lamp } = L;
    g.fillStyle = rgb(wallColour());
    g.fillRect(0, 0, w, Y(floor + 1));
    g.fillStyle = D > 0.5 ? "rgba(140,100,70,0.06)" : "rgba(255,255,255,0.025)";
    for (let c = 0; c < cols; c += 6) g.fillRect(X(c), 0, cw, Y(floor));
    g.fillStyle = rgb(mix([46, 32, 26], [146, 100, 68], D));
    g.fillRect(0, Y(floor + 1), w, h - Y(floor + 1));
    g.fillStyle = "rgba(0,0,0,0.12)";
    for (let r = floor + 2; r < rows; r++) g.fillRect(0, Y(r), w, 1);

    const x0 = X(win.c0 + 1), y0 = Y(win.top + 1), x1 = X(win.c1), y1 = Y(win.sill);
    g.save();
    g.beginPath();
    g.rect(x0, y0, x1 - x0, y1 - y0);
    g.clip();
    g.fillStyle = skyGradient(g, y0, y1);
    g.fillRect(x0, y0, x1 - x0, y1 - y0);
    paintSkyBodies(g, x0, y0, x1 - x0, y1 - y0);
    paintSkyline(g, x0, x1, y1, (y1 - y0) * 0.35, rgb(mix([18, 20, 34], [150, 160, 176], D)), 11);
    g.restore();

    if (D > 0.3) {
      g.fillStyle = `rgba(255,240,190,${0.14 * D})`;
      g.beginPath();
      g.moveTo(x0, y1);
      g.lineTo(x1, y1);
      g.lineTo(x1 + (x1 - x0) * 0.5, Y(floor + 1));
      g.lineTo(x0 + (x1 - x0) * 0.1, Y(floor + 1));
      g.closePath();
      g.fill();
    }
    if (D < 0.7) {
      const lx = X(lamp.c + 0.5), ly = Y(lamp.row + 1), R = U * 1.6;
      const glow = g.createRadialGradient(lx, ly, 0, lx, ly, R);
      glow.addColorStop(0, `rgba(255,190,110,${0.4 * (1 - D)})`);
      glow.addColorStop(1, "rgba(255,190,110,0)");
      g.fillStyle = glow;
      g.fillRect(lx - R, ly - R, R * 2, R * 2);
    }
    if (shelf.ok) {
      g.fillStyle = rgb(mix([30, 22, 20], [96, 66, 46], D));
      g.fillRect(X(shelf.c0), Y(shelf.top), X(shelf.c1 - shelf.c0 + 1), Y(floor - shelf.top));
    }
  }

  function paintRoof(g, w, h) {
    const D = sky.day, { floor, left, right } = L;
    g.fillStyle = skyGradient(g, 0, Y(floor));
    g.fillRect(0, 0, w, Y(floor));
    paintSkyBodies(g, 0, 0, w, Y(left.top));
    paintSkyline(g, 0, w, Y(floor), Y(floor - right.top + 6), rgb(mix([20, 24, 40], [150, 164, 186], D)), 3);
    g.fillStyle = rgb(mix([22, 22, 28], [96, 98, 104], D));
    g.fillRect(0, Y(floor), w, h - Y(floor));
    g.fillStyle = rgb(mix([28, 24, 34], [128, 86, 72], D));
    g.fillRect(0, Y(left.top), X(left.c1 + 1), h - Y(left.top));
    g.fillStyle = rgb(mix([24, 26, 38], [104, 92, 96], D));
    g.fillRect(X(right.c0), Y(right.top), w - X(right.c0), h - Y(right.top));
  }

  function paintGarden(g, w, h) {
    const D = sky.day, { floor, house, lantern, horizon } = L;
    g.fillStyle = skyGradient(g, 0, Y(horizon));
    g.fillRect(0, 0, w, Y(horizon));
    paintSkyBodies(g, X(house.c1), 0, w - X(house.c1), Y(horizon));
    g.fillStyle = rgb(mix(mix(sky.low, [30, 40, 60], 0.6), mix(sky.low, [110, 140, 150], 0.45), D));
    g.beginPath();
    g.moveTo(0, Y(horizon));
    for (let x = 0; x <= w; x += cw * 2) {
      const n = Math.sin(x / (w * 0.13)) * 0.5 + Math.sin(x / (w * 0.05) + 1.3) * 0.2;
      g.lineTo(x, Y(horizon) - U * 0.25 - n * U * 0.25);
    }
    g.lineTo(w, Y(horizon));
    g.closePath();
    g.fill();
    const lawn = g.createLinearGradient(0, Y(horizon), 0, h);
    lawn.addColorStop(0, rgb(mix([24, 44, 34], [104, 168, 92], D)));
    lawn.addColorStop(1, rgb(mix([14, 30, 22], [66, 128, 60], D)));
    g.fillStyle = lawn;
    g.fillRect(0, Y(horizon), w, h - Y(horizon));
    g.fillStyle = rgb(mix([70, 62, 54], [240, 232, 214], D));
    g.fillRect(0, Y(house.eave + 2), X(house.c1 + 1), Y(house.deck - house.eave - 2));
    g.fillStyle = rgb(mix([18, 14, 12], [70, 50, 38], D));
    g.fillRect(0, Y(house.deck + 1), X(house.c1 + colsOf(0.2) + 1), Y(floor - house.deck - 1));
    if (night()) {
      const lx = X(lantern.c + 0.5), ly = Y(lantern.top + rowsOf(0.25)), R = U * 0.9;
      const glow = g.createRadialGradient(lx, ly, 0, lx, ly, R);
      glow.addColorStop(0, "rgba(255,190,110,0.3)");
      glow.addColorStop(1, "rgba(255,190,110,0)");
      g.fillStyle = glow;
      g.fillRect(lx - R, ly - R, R * 2, R * 2);
    }
  }

  function paintBackdrop(g, w, h) {
    if (sky.hour < 0) setSky(currentHour(performance.now()));
    if (GALLERY) {
      const grad = g.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, rgb(wallColour()));
      grad.addColorStop(1, rgb(mix(wallColour(), [0, 0, 0], 0.15)));
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
    } else if (env === "room") paintRoom(g, w, h);
    else if (env === "roof") paintRoof(g, w, h);
    else paintGarden(g, w, h);
    sampleBackdrop(g);
    sceneryDirty = true;
  }

  // -------------------------------------------------------------- scenery

  // Static scenery is rasterised once per backdrop paint and copied in every frame.
  let sceneryDirty = true;
  let still = { idx: [], glyph: [], color: [] };
  /** Scenery is drawn faint, so the cats are the only bold, saturated things on screen. */
  const SCENERY_ALPHA = 0.5;

  function recede(st) {
    const m = /^rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/.exec(st);
    return m ? style(+m[1], +m[2], +m[3], +m[4] * SCENERY_ALPHA) : st;
  }

  function bakeScenery() {
    if (GALLERY) { /* plain wall */ } else if (env === "room") roomScenery();
    else if (env === "roof") roofScenery();
    else gardenScenery();
    const idx = [], gl = [], co = [];
    for (let i = 0; i < grid.glyph.length; i++) {
      if (grid.glyph[i]) {
        idx.push(i);
        gl.push(grid.glyph[i]);
        co.push(recede(grid.color[i]));
      }
    }
    still = { idx, glyph: gl, color: co };
    sceneryDirty = false;
  }

  function drawStill() {
    if (sceneryDirty) {
      bakeScenery();
      return;
    }
    const { idx, glyph: gl, color: co } = still;
    for (let k = 0; k < idx.length; k++) {
      grid.glyph[idx[k]] = gl[k];
      grid.color[idx[k]] = co[k];
    }
  }

  const BOOKS = [[214, 86, 80], [86, 140, 214], [232, 182, 70], [96, 186, 120], [170, 110, 200], [230, 140, 90]];

  function roomScenery() {
    const D = sky.day, { floor, tree, win, sofa, shelf, wall, lamp } = L;
    const wood = mix([118, 88, 66], [176, 126, 86], D);
    const dark = mix([80, 60, 48], [112, 76, 52], D);
    const carpet = mix([120, 114, 136], [196, 184, 168], D);
    const rope = mix([130, 112, 86], [206, 180, 136], D);
    const frame = mix([120, 116, 128], [250, 246, 238], D);
    const thick = Math.max(2, rowsOf(0.1));

    for (let c = 0; c < cols; c++) put(c, floor, "=", dark);

    // Cat tree: sisal post, a condo on the floor, three staggered carpeted tiers.
    const topTier = has("tree3") ? tree.t3 : has("tree2") ? tree.t2 : tree.t1;
    const pw = Math.max(1, colsOf(0.06));
    for (let r = topTier + thick; r < floor; r++) for (let k = -pw; k <= pw; k++) put(tree.c + k, r, (r + k) % 2 ? "/" : "\\", rope);
    const condoW = Math.round(tree.hw * 0.85);
    shapes.paint(grid, shapes.cut(
      shapes.box(X(tree.c + 0.5), Y((tree.t1 + thick + floor) / 2), X(condoW + 0.5), Y((floor - tree.t1 - thick) / 2), cw * 0.6),
      shapes.ellipse(X(tree.c + 0.5), Y(floor - rowsOf(0.2)), U * 0.14, U * 0.14),
    ), { rgb: carpet });
    block(tree.c - tree.hw, tree.t1, tree.c + tree.hw, tree.t1 + thick - 1, { rgb: carpet }, ch * 0.5);
    if (has("tree2")) {
      const c2 = tree.c + tree.o2, hw = Math.round(tree.hw * 0.85);
      block(c2 - hw, tree.t2, c2 + hw, tree.t2 + thick - 1, { rgb: carpet }, ch * 0.5);
    }
    if (has("tree3")) {
      const c3 = Math.round(tree.c - tree.o2 * 0.6), hw = Math.round(tree.hw * 0.75);
      block(Math.max(0, c3 - hw), tree.t3, c3 + hw, tree.t3 + thick - 1, { rgb: carpet }, ch * 0.5);
    }

    // Food and water bowls.
    const bowl = (c, c3, food) => {
      shapes.paint(grid, shapes.box(X(c), Y(floor) - U * 0.05, U * 0.13, U * 0.05, U * 0.03), { rgb: c3, ramp: "-=#%" });
      text(c - 2, Math.round((Y(floor) - U * 0.1) / ch) - 1, food, food === "~~~~" ? [120, 180, 240] : [190, 130, 80]);
    };
    bowl(tree.c + tree.hw + colsOf(0.4), [214, 86, 86], "oOoo");
    bowl(tree.c + tree.hw + colsOf(0.8), [86, 150, 220], "~~~~");

    // Window: white frame and bars, curtains on a rod, a deep sill.
    const transom = Math.round((win.top + win.sill) / 2);
    for (let c = win.c0; c <= win.c1; c++) {
      put(c, win.top, "-", frame);
      put(c, transom, "-", frame, 0.8);
    }
    for (let r = win.top; r < win.sill; r++) {
      put(win.c0, r, "|", frame);
      put(win.c1, r, "|", frame);
      put(win.mid, r, "|", frame, 0.8);
    }
    for (const c of [win.c0, win.c1, win.mid]) put(c, win.top, "+", frame);
    const curtain = mix([110, 70, 84], [196, 96, 98], D);
    const cwid = colsOf(0.18);
    for (let r = win.top; r < win.sill - 1; r++) {
      const tie = r > win.sill - rowsOf(0.4) ? 1 : 0;
      for (let k = 0; k < cwid - tie; k++) {
        put(win.c0 - cwid + k + tie, r, k % 2 ? ")" : "(", curtain);
        put(win.c1 + 1 + k, r, k % 2 ? ")" : "(", curtain);
      }
    }
    text(win.c0 - cwid - 1, win.top - 1, "o" + "=".repeat(win.c1 - win.c0 + cwid * 2 + 1) + "o", dark);
    block(win.c0 - colsOf(0.1), win.sill, win.c1 + colsOf(0.1), win.sill + thick - 1, { rgb: wood }, ch * 0.3);

    // Rug under the window.
    const rugA = mix([90, 70, 110], [180, 92, 80], D), rugB = mix([140, 120, 90], [232, 196, 130], D);
    for (let r = floor + 1; r < Math.min(rows, floor + 3); r++) {
      for (let c = win.c0 + 2; c <= win.c1 - 2; c++) {
        const edge = c === win.c0 + 2 || c === win.c1 - 2;
        put(c, r, edge ? "#" : (c + r) % 4 < 2 ? "<" : ">", (c + r) % 2 ? rugA : rugB, 0.9);
      }
    }

    // Sofa: backrest, arms, seat cushions, legs.
    const fabric = mix([76, 98, 136], [86, 136, 168], D);
    const cushion = mix([100, 122, 160], [136, 180, 200], D);
    block(sofa.c0 + sofa.armW, sofa.back, sofa.c1 - sofa.armW, sofa.seat - 1, { rgb: fabric }, ch * 1.2);
    block(sofa.c0 + sofa.armW, sofa.seat, sofa.c1 - sofa.armW, floor - 2, { rgb: cushion }, ch * 0.5);
    block(sofa.c0, sofa.arm, sofa.c0 + sofa.armW, floor - 2, { rgb: fabric }, ch * 1.2);
    block(sofa.c1 - sofa.armW, sofa.arm, sofa.c1, floor - 2, { rgb: fabric }, ch * 1.2);
    const midSeat = Math.round((sofa.c0 + sofa.c1) / 2);
    for (let r = sofa.seat; r < floor - 1; r++) put(midSeat, r, "|", fabric);
    for (const c of [sofa.c0 + 1, sofa.c1 - 1]) put(c, floor - 1, "|", dark);

    // Floating cat shelf with brackets.
    if (has("wall shelf")) {
      block(wall.c0, wall.row, wall.c1, wall.row + thick - 1, { rgb: wood }, ch * 0.3);
      for (const c of [wall.c0 + 2, wall.c1 - 2]) for (let k = 0; k < 3; k++) put(c + (c < wall.c1 - 2 ? k : -k), wall.row + thick + k, c < wall.c1 - 2 ? "\\" : "/", dark);
    }

    // Pendant lamp.
    const shade = night() ? [255, 214, 140] : mix([200, 170, 120], [236, 214, 170], D);
    for (let r = 0; r < lamp.row - rowsOf(0.15); r++) put(lamp.c, r, "|", dark, 0.8);
    shapes.paint(grid, shapes.triangle(X(lamp.c + 0.5), Y(lamp.row) - U * 0.17, X(lamp.c + 0.5) - U * 0.16, Y(lamp.row + 1), X(lamp.c + 0.5) + U * 0.16, Y(lamp.row + 1)), { rgb: shade, ramp: "-=+*#" });

    // Bookshelf.
    if (shelf.ok) {
      block(shelf.c0, shelf.top, shelf.c1, shelf.top + thick - 1, { rgb: wood });
      for (let r = shelf.top + thick; r < floor; r++) {
        put(shelf.c0, r, "|", wood);
        put(shelf.c1, r, "|", wood);
      }
      const gap = Math.max(4, rowsOf(0.45));
      for (let board = shelf.top + thick + gap; board <= floor; board += gap) {
        if (board < floor) for (let c = shelf.c0 + 1; c < shelf.c1; c++) put(c, board, "=", wood);
        for (let c = shelf.c0 + 1; c < shelf.c1; c++) {
          const n = hash2(c, board, 5);
          if (n < 0.15) continue;
          const tall = Math.min(gap - 1, 2 + Math.floor(n * (gap - 2)));
          const book = BOOKS[Math.floor(hash2(c, board, 9) * BOOKS.length)];
          for (let k = 1; k <= tall; k++) put(c, board - k, k === tall ? "_" : "|", mix(mix(book, [0, 0, 0], 0.55), book, D));
        }
      }
    }
  }

  function roofScenery() {
    const D = sky.day, { floor, left, chim, right, wire, tank } = L;
    const concrete = mix([70, 72, 84], [176, 170, 160], D);
    const brick = mix([96, 54, 50], [176, 92, 72], D);
    const metal = mix([96, 104, 118], [170, 178, 190], D);
    const lit = [255, 214, 120], glass = mix([40, 46, 62], [176, 210, 230], D);
    const thick = Math.max(2, rowsOf(0.1));

    const windows = (c0, c1, r0) => {
      const ww = Math.max(3, colsOf(0.22)), step = colsOf(0.5), rstep = Math.max(4, rowsOf(0.45));
      for (let r = r0 + thick + 2; r + 1 < floor - 1; r += rstep) {
        for (let c = c0 + 3; c + ww <= c1 - 2; c += step) {
          const on = night() && hash2(c, r, 21) > 0.45;
          for (let k = 0; k < 2; k++) {
            put(c, r + k, "[", concrete, 0.8);
            put(c + ww - 1, r + k, "]", concrete, 0.8);
            for (let j = 1; j < ww - 1; j++) put(c + j, r + k, on ? "#" : "=", on ? lit : glass, on ? 0.9 : 0.6);
          }
        }
      }
    };
    windows(0, left.c1, left.top);
    windows(right.c0, cols - 1, right.top);

    block(0, left.top, left.c1, left.top + thick - 1, { rgb: concrete });
    block(right.c0, right.top, cols - 1, right.top + thick - 1, { rgb: concrete });
    block(chim.c0, chim.top + 1, chim.c1, left.top - 1, { rgb: brick, ramp: "-=#%" });
    block(chim.c0 - 1, chim.top, chim.c1 + 1, chim.top, { rgb: concrete });

    if (has("wire")) {
      for (let c = wire.c0; c < wire.pole; c++) put(c, wire.row, "-", metal, 0.9);
      const pole = mix([70, 50, 40], [130, 96, 70], D);
      for (let r = wire.row; r < right.top; r++) put(wire.pole, r, "|", pole);
      put(wire.pole, wire.row - 1, "T", pole);
    }

    if (tank.ok) {
      block(tank.c - tank.hw, tank.top, tank.c + tank.hw, tank.bottom - 1, { rgb: mix([80, 62, 54], [150, 112, 84], D), ramp: "-=#%" }, cw);
      for (let r = tank.bottom; r < right.top; r++) {
        const k = Math.round(((r - tank.bottom) / Math.max(1, right.top - tank.bottom)) * colsOf(0.15));
        put(tank.c - tank.hw + 2 + k, r, "\\", metal);
        put(tank.c + tank.hw - 2 - k, r, "/", metal);
      }
    }

    for (let c = 0; c < cols; c++) put(c, floor, "_", concrete, 0.8);
    for (let c = 0; c < cols; c += 6) text(c, Math.min(rows - 1, floor + 2), "--", [220, 210, 140], 0.5);
  }

  function gardenScenery() {
    const D = sky.day, { floor, house, lantern, fence, tree } = L;
    const wood = mix([90, 66, 48], [170, 124, 86], D);
    const dark = mix([50, 38, 30], [110, 76, 54], D);
    const tile = mix([50, 56, 70], [92, 98, 116], D);
    const paper = mix([120, 110, 96], [196, 184, 160], D);
    const grass = mix([44, 92, 60], [74, 150, 70], D);
    const leaf = mix([34, 76, 50], [80, 150, 72], D);
    const stone = mix([90, 96, 104], [176, 180, 184], D);

    // Shoji lattice, tiled eaves, engawa deck and posts.
    const sc = Math.max(3, colsOf(0.2)), sr = Math.max(2, rowsOf(0.22));
    for (let r = house.eave + 2; r < house.deck; r++) {
      for (let c = 0; c <= house.c1; c++) {
        const v = c % sc === 0, hz = (r - house.eave) % sr === 0;
        if (v || hz) put(c, r, v && hz ? "+" : v ? "|" : "-", paper, 0.8);
      }
      put(house.c1, r, "#", dark);
    }
    block(0, house.eave, house.c1 + colsOf(0.3), house.eave + Math.max(2, rowsOf(0.12)) - 1, { rgb: tile, ramp: "-=^#%" }, ch * 0.3);
    block(0, house.deck, house.c1 + colsOf(0.2), house.deck, { rgb: wood, glyph: "=" });
    for (let c = 3; c <= house.c1 + colsOf(0.2) - 2; c += Math.max(5, colsOf(0.4))) for (let r = house.deck + 1; r < floor; r++) put(c, r, "|", dark);

    // Stone lantern: base, pillar, fire box, roof (the ledge).
    const lc = lantern.c, hw = lantern.hw, roofH = Math.max(2, rowsOf(0.12)), boxH = Math.max(2, rowsOf(0.25));
    block(lc - hw, lantern.top, lc + hw, lantern.top + roofH - 1, { rgb: stone }, ch * 0.6);
    const boxTop = lantern.top + roofH, boxW = Math.round(hw * 0.6);
    block(lc - boxW, boxTop, lc + boxW, boxTop + boxH - 1, { rgb: stone });
    for (let r = boxTop + 1; r < boxTop + boxH - 1; r++) for (let c = lc - Math.round(boxW / 2); c <= lc + Math.round(boxW / 2); c++) {
      put(c, r, night() ? "#" : ":", night() ? [255, 200, 110] : mix(stone, [0, 0, 0], 0.4));
    }
    const pillarW = Math.max(1, Math.round(hw * 0.25));
    block(lc - pillarW, boxTop + boxH, lc + pillarW, floor - 2, { rgb: stone });
    block(lc - Math.round(hw * 0.7), floor - 1, lc + Math.round(hw * 0.7), floor - 1, { rgb: stone });

    // Fence, flowers in front.
    block(fence.c0, fence.rail, fence.c1, fence.rail, { rgb: wood, glyph: "=" });
    const pk = Math.max(2, colsOf(0.1));
    for (let c = fence.c0 + 1; c < fence.c1; c++) {
      if ((c - fence.c0) % pk === 0) for (let r = fence.rail + 1; r < floor; r++) put(c, r, "|", wood);
      else put(c, Math.round((fence.rail + floor) / 2), "-", wood);
    }
    const blooms = [[244, 96, 116], [255, 214, 70], [190, 120, 240], [255, 160, 200]];
    for (let c = fence.c0 + 2; c < fence.c1 - 1; c += 3) {
      if (hash2(c, 4, 3) < 0.35) continue;
      put(c, floor - 1, "|", grass);
      put(c, floor - 2, hash2(c, 5, 3) > 0.5 ? "@" : "*", blooms[Math.floor(hash2(c, 6, 3) * blooms.length)]);
    }

    // Tree: canopy, trunk, the branch cats sit on.
    const cx = X(tree.c + 0.5), cy = Y(tree.row) - U * 0.6;
    for (let k = 0; k < 6; k++) {
      const ox = (hash2(k, 1, 77) - 0.5) * U * 1.6, oy = (hash2(k, 2, 77) - 0.5) * U * 0.6;
      const r = U * (0.45 + hash2(k, 3, 77) * 0.35);
      shapes.paint(grid, shapes.ellipse(cx + ox, cy + oy, r, r * 0.6), { rgb: leaf, ramp: ".,:;*&%@" });
    }
    shapes.paint(grid, shapes.capsule(cx, Y(floor), cx, Y(tree.row) - U * 0.3, U * 0.09), { rgb: mix([70, 50, 40], [120, 84, 60], D), ramp: "|!|#" });
    block(tree.c0, tree.row, tree.c + 3, tree.row + Math.max(1, rowsOf(0.08)), { rgb: mix([80, 58, 44], [140, 98, 68], D), ramp: "-=~#" }, ch * 0.5);

    for (let c = 0; c < cols; c++) put(c, floor, hash2(c, 0, 8) > 0.5 ? "\"" : "'", grass, 0.9);
    for (let k = 0; k < 4; k++) text(house.c1 + colsOf(0.4) + k * colsOf(0.3), Math.min(rows - 1, floor + 1 + (k % 2)), "(___)", stone);
  }

  /** Scenery that moves: drawn every frame on top of the baked layer. */
  function liveScenery(t) {
    if (GALLERY) return;
    if (env === "room") {
      const { tree, win } = L;
      if (has("tree2")) {
        const c = tree.c + tree.o2 + Math.round(tree.hw * 0.7), r0 = tree.t2 + Math.max(2, rowsOf(0.1));
        const len = rowsOf(0.3), swing = Math.round(Math.sin(t * 2.2) * 2);
        for (let k = 0; k < len; k++) put(c + Math.round((swing * k) / len), r0 + k, "|", [200, 200, 200], 0.7);
        text(c + swing - 1, r0 + len, "(@)", [245, 105, 145]);
      }
      const d = new Date();
      const clock = `( ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")} )`;
      inkText(win.mid - (clock.length >> 1), win.top - 3, clock, [150, 110, 80], 0.9, 60);
    } else if (env === "roof") {
      const { chim, tank } = L;
      const mid = Math.round((chim.c0 + chim.c1) / 2);
      for (let i = 1; i <= 8; i++) {
        const c = mid + Math.round(Math.sin(t * 1.4 - i * 0.7) * i * 0.6) + Math.floor(i / 2);
        put(c, chim.top - i, i % 2 ? "~" : "(", [220, 224, 232], Math.max(0, 0.7 - i * 0.08));
      }
      if (tank.ok && night() && Math.sin(t * 3) > 0) put(tank.c, tank.top - 1, "*", [255, 70, 60]);
      stars(t, L.left.top - 2);
      clouds(t);
    } else {
      const { house } = L;
      const c = house.c1 + colsOf(0.15), r = house.eave + Math.max(2, rowsOf(0.12));
      const sw = Math.round(Math.sin(t * 1.7));
      put(c, r, "|", [200, 200, 200], 0.7);
      put(c + sw, r + 1, "o", [255, 230, 150]);
      put(c + sw, r + 2, "~", [255, 110, 140]);
      stars(t, L.horizon - 4);
      clouds(t);
      critters(t);
    }
  }

  function stars(t, maxRow) {
    if (!night()) return;
    const n = Math.round(cols * 0.15);
    for (let i = 0; i < n; i++) {
      const c = Math.floor(hash2(i, 1, 101) * cols), r = 2 + Math.floor(hash2(i, 2, 101) * Math.max(1, maxRow - 2));
      const tw = Math.sin(t * (1 + hash2(i, 3, 101) * 2) + i);
      put(c, r, tw > 0.6 ? "*" : ".", [235, 240, 255], 0.5 + 0.3 * tw);
    }
  }

  function clouds(t) {
    if (sky.day < 0.4) return;
    for (let i = 0; i < 3; i++) {
      const span = cols + 24;
      const c = Math.round(((t * (0.6 + i * 0.25) + hash2(i, 1, 55) * span) % span) - 12);
      const r = 4 + i * 4;
      text(c + 2, r, ".--.", [255, 255, 255], 0.75 * sky.day);
      text(c, r + 1, "(____)__", [255, 255, 255], 0.75 * sky.day);
    }
  }

  function critters(t) {
    if (!night()) {
      for (let i = 0; i < 3; i++) {
        const c = Math.round(cols * (0.5 + 0.25 * Math.sin(t * 0.21 + i * 2.1)) + Math.sin(t * 1.3 + i) * 4);
        const r = Math.round(L.floor - rowsOf(1.2) - 4 * Math.sin(t * 0.37 + i * 1.7) - Math.abs(Math.sin(t * 2.5 + i)) * 2);
        text(c, r, Math.sin(t * 14 + i) > 0 ? "}{" : "><", [[255, 214, 70], [255, 150, 200], [170, 220, 255]][i]);
      }
    } else {
      for (let i = 0; i < 9; i++) {
        const c = Math.round(cols * (0.45 + 0.4 * Math.sin(t * 0.13 + i * 1.9)));
        const r = Math.round(L.floor - rowsOf(0.3) - rowsOf(1.2) * (0.5 + 0.5 * Math.sin(t * 0.21 + i * 1.3)));
        const pulse = 0.5 + 0.5 * Math.sin(t * 2.5 + i * 1.7);
        if (pulse > 0.2) put(c, r, pulse > 0.75 ? "*" : ".", [210, 255, 120], pulse);
      }
    }
  }

  // ------------------------------------------------------------ cat rig

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
   * Poses, in body lengths, facing right, y up from the ledge. h = hips, s = shoulders
   * (and their radii rh, rs), n = head centre (radius hr, muzzle angle tilt, hf = head
   * facing: 1 forward, 0 at the viewer, -1 backward), paws lf / rf (near / far front) and
   * lh / rh (hind), tail base angle ta + curl tc per segment, wave tw, length tl, tf = tail
   * drawn in front of the body. eyes 1 open..0 shut, happy = ^ eyes, mouth 1 tongue 2 yawn,
   * belly 1 = belly up, ear = ears flicked back.
   */
  const BASE = {
    hx: -0.28, hy: 0.43, sx: 0.2, sy: 0.45, rh: 0.165, rs: 0.145,
    nx: 0.43, ny: 0.64, hr: 0.14, tilt: -0.1, hf: 1,
    lfx: 0.23, lfy: 0.03, rfx: 0.16, rfy: 0.03, lhx: -0.32, lhy: 0.03, rhx: -0.25, rhy: 0.03,
    ta: 2.75, tc: -0.13, tw: 0.12, tl: 0.72, tf: 0, eyes: 1, happy: 0, mouth: 0, belly: 0, ear: 0,
  };
  const SIT = {
    hx: -0.17, hy: 0.2, rh: 0.2, sx: 0.07, sy: 0.5, rs: 0.14, nx: 0.15, ny: 0.82, tilt: -0.05,
    lfx: 0.15, lfy: 0.03, rfx: 0.1, rfy: 0.03, lhx: 0.04, lhy: 0.03, rhx: -0.01, rhy: 0.03,
    ta: -2.5, tc: 0.3, tw: 0.04, tl: 0.62, tf: 1,
  };
  const SIDE = {
    hx: -0.3, hy: 0.14, rh: 0.14, sx: 0.14, sy: 0.14, rs: 0.13, nx: 0.43, ny: 0.15, hr: 0.12, tilt: 0.35,
    lfx: 0.55, lfy: 0.05, rfx: 0.49, rfy: 0.1, lhx: 0.1, lhy: 0.05, rhx: 0.04, rhy: 0.1,
    ta: 3.1, tc: 0.02, tw: 0.03, tl: 0.7, tf: 0, belly: 0.5,
  };
  const LOAF = {
    hx: -0.2, hy: 0.17, rh: 0.17, sx: 0.17, sy: 0.17, rs: 0.155, nx: 0.38, ny: 0.4, tilt: -0.05,
    lfx: 0.42, lfy: 0.035, rfx: 0.36, rfy: 0.035, lhx: -0.02, lhy: 0.035, rhx: -0.08, rhy: 0.035,
    ta: -2.95, tc: 0.18, tw: 0.03, tl: 0.6, tf: 1,
  };
  const pose = (...parts) => Object.assign({}, BASE, ...parts);
  const POSES = {
    stand: pose({ ta: 3.75, tc: -0.12 }),
    walk: pose({ ta: 2.5, tc: -0.11 }),
    run: pose({ hy: 0.4, sy: 0.42, ta: 2.9, tc: 0, tw: 0.08, tilt: 0 }),
    sit: pose(SIT),
    look: pose(SIT, { hf: 0.1, tilt: 0 }),
    groom: pose(SIT, { lfx: 0.24, lfy: 0.66, nx: 0.17, ny: 0.74, tilt: -0.55, mouth: 1, eyes: 0.4 }),
    wash: pose(SIT, { lfx: 0.2, lfy: 0.86, nx: 0.14, ny: 0.76, tilt: -0.35, eyes: 0 }),
    lickBack: pose(SIT, { nx: -0.04, ny: 0.62, hf: -1, tilt: -0.6, mouth: 1, eyes: 0 }),
    yawn: pose(SIT, { tilt: 0.35, mouth: 2, eyes: 0 }),
    bat: pose(SIT, { lfx: 0.4, lfy: 0.42, ny: 0.8, tilt: 0.05 }),
    petted: pose(SIT, { happy: 1, hf: 0.45, tilt: 0.25, eyes: 0 }),
    loaf: pose(LOAF),
    side: pose(SIDE),
    sleepSide: pose(SIDE, { eyes: 0, tw: 0.01 }),
    groomLeg: pose(SIDE, { lhx: 0.0, lhy: 0.6, rhy: 0.2, nx: 0.04, ny: 0.34, hf: -1, tilt: -0.4, mouth: 1, eyes: 0, belly: 0.7 }),
    sleep: pose({
      hx: -0.1, hy: 0.17, rh: 0.18, sx: 0.12, sy: 0.18, rs: 0.17, nx: 0.25, ny: 0.15, hr: 0.12, tilt: -0.9, eyes: 0,
      lfx: 0.22, lfy: 0.06, rfx: 0.17, rfy: 0.06, lhx: 0.04, lhy: 0.05, rhx: -0.01, rhy: 0.05,
      ta: -2.7, tc: 0.42, tw: 0.02, tl: 0.62, tf: 1,
    }),
    stretch: pose({
      hx: -0.25, hy: 0.5, rh: 0.14, sx: 0.17, sy: 0.24, rs: 0.13, nx: 0.4, ny: 0.27, tilt: 0.15,
      lfx: 0.6, lfy: 0.03, rfx: 0.54, rfy: 0.03, lhx: -0.3, lhy: 0.03, rhx: -0.24, rhy: 0.03, ta: 2.3, tc: -0.06, eyes: 0,
    }),
    crouch: pose({
      hx: -0.24, hy: 0.25, sx: 0.16, sy: 0.2, nx: 0.4, ny: 0.3, tilt: 0,
      lfx: 0.25, rfx: 0.2, lhx: -0.1, rhx: -0.15, ta: 3.0, tc: 0, tw: 0.15,
    }),
    leap: pose({
      hx: -0.3, hy: 0.45, sx: 0.22, sy: 0.5, nx: 0.46, ny: 0.6, tilt: 0.05,
      lfx: 0.6, lfy: 0.36, rfx: 0.55, rfy: 0.31, lhx: -0.62, lhy: 0.32, rhx: -0.57, rhy: 0.27, ta: 3.0, tc: 0.02, tw: 0.04,
    }),
    fall: pose({
      hx: -0.3, hy: 0.5, sx: 0.2, sy: 0.42, nx: 0.45, ny: 0.55, tilt: -0.3,
      lfx: 0.4, lfy: 0.0, rfx: 0.34, rfy: 0.04, lhx: -0.26, lhy: 0.2, rhx: -0.2, rhy: 0.17, ta: 2.9, tc: -0.05, tw: 0.05,
    }),
    eat: pose({ ta: 3.6, tc: -0.1, sx: 0.18, sy: 0.36, nx: 0.42, ny: 0.15, tilt: -1.0, lfx: 0.25, rfx: 0.17, mouth: 1, eyes: 0.5 }),
    belly: pose({
      hx: -0.25, hy: 0.15, rh: 0.15, sx: 0.15, sy: 0.15, rs: 0.14, nx: 0.42, ny: 0.13, tilt: 0.7, hf: 0.45, happy: 1, eyes: 0,
      lfx: 0.25, lfy: 0.44, rfx: 0.18, rfy: 0.4, lhx: -0.18, lhy: 0.42, rhx: -0.26, rhy: 0.38, ta: 3.1, tc: 0.03, tw: 0.08, belly: 1,
    }),
    knead: pose({ hy: 0.38, sy: 0.36, tilt: -0.2, happy: 1, eyes: 0, ta: 2.3, tc: -0.13 }),
  };
  const POSE_KEYS = Object.keys(BASE);
  const ANGLES = { ta: 1, tilt: 1 };
  const X_KEYS = ["hx", "sx", "nx", "lfx", "rfx", "lhx", "rhx"];
  const LYING = new Set(["loaf", "side", "sleepSide", "sleep", "groomLeg", "belly"]);
  const ASLEEP = new Set(["sleep", "sleepSide"]);

  const UPRIGHT = new Set(["sit", "stand", "look", "petted"]);
  /** Per-key easing: the head leads, the body follows, the tail trails behind. */
  const LAG = { nx: 0.7, ny: 0.7, tilt: 0.7, hf: 0.8, ear: 0.3, ta: 1.6, tc: 1.6, tw: 1.4, tl: 1.4 };
  const MIRROR_V = [...X_KEYS, "hf", "ta", "tc"];
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

  /** The same pose seen from the other side: used to swing a cat round when it turns. */
  function mirrorPose(p) {
    const m = { ...p };
    for (const k of X_KEYS) m[k] = -p[k];
    m.hf = -p.hf;
    m.ta = Math.PI - p.ta;
    m.tc = -p.tc;
    return m;
  }

  /** Two-bone IK in pose space: the joint bends backward unless that would sink below the ledge. */
  function ik(ax, ay, px, py, l1, l2) {
    let dx = px - ax, dy = py - ay, d = Math.hypot(dx, dy) || 1e-6;
    const max = (l1 + l2) * 0.999;
    if (d > max) {
      px = ax + (dx / d) * max;
      py = ay + (dy / d) * max;
      dx = px - ax;
      dy = py - ay;
      d = max;
    }
    d = Math.max(d, Math.abs(l1 - l2) + 1e-4);
    const a = Math.acos(clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1));
    const base = Math.atan2(dy, dx);
    let jx = ax + Math.cos(base - a) * l1, jy = ay + Math.sin(base - a) * l1;
    const kx = ax + Math.cos(base + a) * l1, ky = ay + Math.sin(base + a) * l1;
    if ((kx < jx && ky > 0.02) || jy < 0.02) {
      jx = kx;
      jy = ky;
    }
    return [jx, jy, px, py];
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

  /**
   * Build the cat's parts in screen px, front-most first, plus the head geometry the face
   * features hang off.
   */
  function buildRig(cat, P) {
    const S = U * cat.scale, f = cat.facing, ox = cat.x, oy = cat.y;
    const px = (lx) => ox + f * lx * S, py = (ly) => oy - ly * S;

    // Body: torso, neck, head, muzzle, blended; ears added sharp.
    const torso = roundCone(px(P.hx), py(P.hy), px(P.sx), py(P.sy), P.rh * S, P.rs * S);
    const dirX = P.hf * Math.cos(P.tilt), dirY = Math.sin(P.tilt);
    const neckX = P.nx - dirX * P.hr * 0.5, neckY = P.ny - 0.4 * P.hr;
    const neck = roundCone(px(P.sx + 0.03), py(P.sy + 0.02), px(neckX), py(neckY), P.rs * 0.72 * S, P.hr * 0.7 * S);
    const head = shapes.circle(px(P.nx), py(P.ny), P.hr * S);
    const mx = P.nx + dirX * P.hr * 0.72, my = P.ny + dirY * P.hr * 0.72 - P.hr * 0.22;
    const muzzle = shapes.circle(px(mx), py(my), P.hr * 0.5 * S);
    const spread = 0.12 + 0.48 * (1 - Math.abs(P.hf)), back = -0.22 * P.hf;
    const earTilt = (P.tilt * 0.6 + P.ear) * Math.sign(P.hf || 1);
    const ears = [-1, 1].map((side) => {
      const bx = back + side * spread, by = 0.62;
      const rot = (x, y) => [P.nx + (x * Math.cos(earTilt) - y * Math.sin(earTilt)) * P.hr, P.ny + (x * Math.sin(earTilt) + y * Math.cos(earTilt)) * P.hr];
      const [ax, ay] = rot(bx - 0.36, by - 0.1), [bx2, by2] = rot(bx + 0.36, by - 0.1), [tx, ty] = rot(bx + side * 0.12, by + 0.62);
      return shapes.triangle(px(ax), py(ay), px(bx2), py(by2), px(tx), py(ty));
    });
    const body = union([torso, neck, head, muzzle], 0.05 * S, ears);
    body.mat = "body";

    // Legs.
    const leg = (pawX, pawY, front, far) => {
      const ax = (front ? P.sx + 0.02 : P.hx + 0.03) + (far ? 0.03 : 0);
      const ay = front ? P.sy - P.rs * 0.35 : P.hy - P.rh * 0.25;
      const l1 = front ? 0.2 : 0.21, l2 = front ? 0.2 : 0.23;
      const [jx, jy, ex, ey] = ik(ax, ay, pawX, pawY, l1, l2);
      const r1 = (front ? 0.06 : 0.09) * S, r2 = 0.045 * S;
      const parts = [
        roundCone(px(ax), py(ay), px(jx), py(jy), r1, r2),
        roundCone(px(jx), py(jy), px(ex), py(ey), r2, r2 * 0.9),
        shapes.ellipse(px(ex + 0.02), py(ey + 0.01), 0.058 * S, 0.04 * S),
      ];
      const u = union(parts, 0.015 * S);
      u.mat = "leg";
      u.far = far;
      return u;
    };

    // Tail: a chain of tapering segments that rests on the ledge rather than sinking.
    const tailPts = [];
    let tx = P.hx - P.rh * 0.85, ty = P.hy + P.rh * 0.1;
    tailPts.push([tx, ty]);
    const N = 10, seg = P.tl / N;
    for (let i = 1; i <= N; i++) {
      const a = P.ta + P.tc * i + P.tw * Math.sin(cat.tailPhase - i * 0.55) * (i / N) * 3;
      tx += Math.cos(a) * seg;
      ty = Math.max(0.045, ty + Math.sin(a) * seg);
      tailPts.push([tx, ty]);
    }
    const segs = [];
    for (let i = 0; i < N; i++) {
      const r0 = lerp(0.06, 0.042, i / N) * S, r1 = lerp(0.06, 0.042, (i + 1) / N) * S;
      segs.push(roundCone(px(tailPts[i][0]), py(tailPts[i][1]), px(tailPts[i + 1][0]), py(tailPts[i + 1][1]), r0, r1));
    }
    const tail = union(segs, 0.01 * S);
    tail.mat = "tail";

    const parts = [];
    if (P.tf > 0.5) parts.push(tail);
    parts.push(leg(P.lfx, P.lfy, true, false), leg(P.lhx, P.lhy, false, false), body);
    if (P.tf <= 0.5) parts.push(tail);
    parts.push(leg(P.rfx, P.rfy, true, true), leg(P.rhx, P.rhy, false, true));
    return { parts, S, px, py, dirX, dirY, mx, my };
  }

  /** Fur colour at local point (lx, ly) on part `mat`. */
  function furColour(cat, mat, lx, ly, P) {
    const br = cat.breed;
    let c = br.fur;
    const inHead = mat === "body" && Math.hypot(lx - P.nx, ly - P.ny) < P.hr * 1.15;
    // Torso cross-section: v = -1 at the belly side, 1 at the back.
    const t = clamp((lx - P.hx) / ((P.sx - P.hx) || 1e-6), 0, 1);
    let v = (ly - lerp(P.hy, P.sy, t)) / lerp(P.rh, P.rs, t);
    if (P.belly > 0.5) v = -v;
    const bellySide = mat === "body" && !inHead && v < -0.35;

    switch (br.pattern) {
      case "tabby": {
        // Broad stripes, a few cells wide, so they survive the cell grid.
        const s = mat === "leg" ? Math.sin(ly * 30) : Math.sin(lx * 22 + noise2(lx * 4, ly * 4, 3) * 2.5 + (mat === "tail" ? ly * 14 : 0));
        if (s > 0.2 && !bellySide) c = br.p1;
        if (inHead && Math.sin((ly - P.ny) * 45) > 0.5 && ly > P.ny) c = br.p1;
        break;
      }
      case "calico": {
        // Big patches, like a koi's: two or three per cat.
        const n = noise2(lx * 2.6 + 10, ly * 2.6, 7);
        if (n > 0.58) c = br.p1;
        else if (n < 0.3) c = br.p2;
        break;
      }
      case "tux": {
        const muzzle = mat === "body" && Math.hypot(lx - P.nx - P.hf * P.hr * 0.6, ly - P.ny + P.hr * 0.3) < P.hr * 0.55;
        if ((mat === "leg" && ly < 0.12) || muzzle || (bellySide && lx > (P.hx + P.sx) / 2 - 0.05)) return br.p1;
        break;
      }
      case "points": {
        const d = mat === "tail" ? 1 : mat === "leg" ? clamp(1 - ly / 0.25, 0, 1) : inHead ? clamp(1 - Math.hypot(lx - P.nx - P.hf * P.hr * 0.5, ly - P.ny) / P.hr + 0.3, 0, 1) : 0;
        c = mix(br.fur, br.p1, smoothstep(0.1, 0.8, d));
        break;
      }
    }
    if (bellySide) c = mix(c, br.belly, smoothstep(-0.35, -0.7, v));
    return c;
  }

  function rasterCat(cat) {
    const P = cat.P;
    const rig = buildRig(cat, P);
    const { parts, S } = rig;
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
          const sx = (c + SUB[j]) * cw, sy = (r + SUB[j + 1]) * ch;
          for (let k = 0; k < parts.length; k++) {
            const p = parts[k];
            if (sx < p.x0 || sx > p.x1 || sy < p.y0 || sy > p.y1) continue;
            if (p.d(sx, sy) < 0) {
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
        const inside = clamp(-d / bevel, 0, 1);
        const light = clamp(0.66 + 0.42 * ((nx * LX + ny * LY) / nl) * (1 - inside) + 0.08 * inside, 0.25, 1.2);
        const lx = (x - cat.x) / (cat.facing * S), ly = (cat.y - y) / S;
        const base = furColour(cat, part.mat, lx, ly, P);
        const k = light * dim * (part.far ? 0.68 : 1);
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
    drawFace(cat, rig);
  }

  /** Eyes, nose, mouth and whiskers on top of the rasterised head. */
  function drawFace(cat, rig) {
    const P = cat.P, { px, py } = rig;
    const br = cat.breed, hr = P.hr;
    const cell = (lx, ly) => [Math.floor(px(lx) / cw), Math.floor(py(ly) / ch)];
    const profile = Math.abs(P.hf) >= 0.5;
    const ct = Math.cos(P.tilt), st = Math.sin(P.tilt);
    // A point on the head, (fx forward, fy up) in head radii, turned with the head.
    const onHead = (fx, fy) => [P.nx + (fx * ct - fy * st) * hr * P.hf, P.ny + (fx * st + fy * ct) * hr];
    const eyes = profile ? [onHead(0.45, 0.2)] : [-1, 1].map((s) => [P.nx + (s * 0.38 + P.hf * 0.3) * hr, P.ny + (0.12 + st * 0.3) * hr]);
    const lid = mix(br.fur, [0, 0, 0], 0.55);
    for (const [ex, ey] of eyes) {
      const [c, r] = cell(ex, ey);
      if (P.eyes < 0.3 || P.happy > 0.5 && P.eyes < 0.7) grid.put(c, r, P.happy > 0.5 ? "^" : "-", ink(lid, c, r, 1, 50));
      else if (P.eyes < 0.7) grid.put(c, r, "=", ink(lid, c, r, 1, 50));
      else {
        const eye = night() ? mix(br.eyes, [255, 255, 255], 0.2) : br.eyes;
        grid.put(c, r, night() ? "●" : "|", style(10, 12, 16, 1), style(eye[0], eye[1], eye[2], 1));
      }
    }
    const [nx, ny] = profile ? onHead(1.05, -0.12) : [P.nx + P.hf * 0.3 * hr, P.ny - 0.3 * hr + st * 0.2 * hr];
    const [nc, nr] = cell(nx, ny);
    grid.put(nc, nr, "v", style(br.nose[0], br.nose[1], br.nose[2], 1));
    if (P.mouth > 1.5) {
      grid.put(nc, nr + 1, "O", style(250, 200, 200, 1), style(120, 30, 40, 1));
    } else if (P.mouth > 0.5) {
      grid.put(nc, nr + 1, "~", style(240, 110, 130, 1));
    }
    const wh = (c, r, g) => grid.put(c, r, g, ink([235, 235, 240], c, r, 0.7, 70));
    const dir = cat.facing * Math.sign(P.hf || 1);
    if (profile) {
      wh(nc + dir, nr, "-");
      wh(nc + dir * 2, nr, "-");
      wh(nc + dir, nr + 1, "_");
    } else {
      for (const s of [-1, 1]) {
        wh(nc + s * 2, nr, "=");
        wh(nc + s * 3, nr, "-");
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
  const toys = [];
  const prints = [];
  const particles = [];

  const START = ["sit", "loaf", "sleep", "sleepSide", "groom", "stand", "look", "side", "wash"];

  function createCat(i) {
    const first = START[Math.floor(rand(0, START.length))];
    const cat = {
      breed: BREEDS[i % BREEDS.length], scale: i === 0 ? 1 : rand(0.82, 1.05),
      x: 0, y: 0, facing: rand() > 0.5 ? 1 : -1,
      plat: null, state: "idle", pose: first, timer: rand(3, 10),
      P: { ...POSES[first] }, base: { ...POSES[first] }, V: zeroV(), ease: 0.2, prevPose: first, layerW: 1, poseT: 0,
      vx: 0, amp: 0, pitch: 0, seed: rand(0, 1000), glance: null, twitch: 0, flick: 0,
      gait: 0, tailPhase: rand(0, 6.28), blink: rand(2, 6), blinking: false,
      hover: 0, react: 0, goal: null, jump: null, say: null, box: null,
    };
    placeCat(cat);
    return cat;
  }

  /** Put a cat on a ledge (the one with the same id after a resize, else a free random one). */
  function placeCat(cat, id) {
    if (!platforms.length) return;
    const pool = platforms.slice().sort(() => rand() - 0.5);
    const same = id && platforms.find((p) => p.id === id);
    let plat = same || pool[0], x = null;
    for (const p of same ? [same, ...pool] : pool) {
      x = freeSpot(p, cat);
      if (x !== null) {
        plat = p;
        break;
      }
    }
    if (x === null) x = rand(bounds(plat).lo, bounds(plat).hi);
    cat.plat = plat;
    cat.x = x;
    cat.y = Y(plat.row);
    cat.jump = null;
    cat.goal = null;
    if (cat.state !== "idle") {
      cat.state = "idle";
      setPose(cat, "sit", 0);
    }
  }

  function syncCatCount() {
    if (GALLERY) return;
    while (cats.length < catCount) cats.push(createCat(cats.length));
    cats.length = catCount;
  }

  /** The x range (px) a cat's centre can take on a ledge without hanging off it. */
  function bounds(p) {
    const m = U * 0.45;
    const lo = X(p.c0) + m, hi = X(p.c1 + 1) - m;
    if (lo <= hi) return { lo, hi };
    const mid = X((p.c0 + p.c1 + 1) / 2);
    return { lo: mid, hi: mid };
  }

  /** An x on ledge p clear of the other cats there (or heading there), or null if it's full. */
  function freeSpot(p, self) {
    const b = bounds(p);
    let best = null, bestGap = -1;
    for (let k = 0; k < 6; k++) {
      const x = rand(b.lo, b.hi);
      let gap = Infinity;
      for (const o of cats) {
        if (o === self) continue;
        const there = o.jump ? o.jump.to === p : o.plat === p;
        if (there) gap = Math.min(gap, Math.abs((o.jump ? o.jump.tx : o.x) - x));
      }
      if (gap > bestGap) {
        best = x;
        bestGap = gap;
      }
    }
    return bestGap >= U * 0.95 ? best : null;
  }

  function canReach(cat, p) {
    if (!cat.plat || p === cat.plat) return false;
    if (Y(cat.plat.row - p.row) > U * 1.35) return false;
    const gap = cat.x < X(p.c0) ? X(p.c0) - cat.x : cat.x > X(p.c1 + 1) ? cat.x - X(p.c1 + 1) : 0;
    return gap <= U * 2.4;
  }

  /** The ledge whose standing area holds (x, y), if any. */
  function ledgeAt(x, y) {
    let best = null;
    for (const p of platforms) {
      if (x < X(p.c0) || x > X(p.c1 + 1)) continue;
      if (y > Y(p.row + 1) || y < Y(p.row) - U * 1.1) continue;
      if (!best || p.row < best.row) best = p;
    }
    return best;
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

  /** Face `dir`, swinging the cat round through a front view. */
  function turn(cat, dir) {
    if (!dir || dir === cat.facing) return;
    // The mirrored pose looks identical from the new side, so nothing jumps; the springs
    // then carry the body and head round.
    cat.base = mirrorPose(cat.base);
    for (const k of MIRROR_V) cat.V[k] = -cat.V[k];
    cat.facing = dir;
    cat.ease = Math.min(cat.ease, 0.16);
  }

  function idle(cat, name, time) {
    cat.state = "idle";
    cat.vx = 0;
    cat.timer = time;
    setPose(cat, name, LYING.has(name) || LYING.has(cat.pose) ? 0.7 : 0.4);
  }

  function jumpTo(cat, p, x, hop = false) {
    const b = bounds(p);
    const tx = clamp(x, b.lo, b.hi), ty = Y(p.row);
    const rise = Math.max(0, cat.y - ty);
    const dist = Math.hypot(tx - cat.x, ty - cat.y);
    cat.jump = {
      sx: cat.x, sy: cat.y, tx, ty, t: 0, to: p, hop,
      dur: hop ? 0.35 : clamp(0.35 + dist / (U * 3.2), 0.45, 1.1),
      h: hop ? U * 0.15 : rise * 0.5 + U * 0.3,
    };
    turn(cat, Math.sign(tx - cat.x));
    cat.goal = null;
    cat.vx = 0;
    cat.state = "prejump";
    cat.timer = hop ? 0.08 : 0.35;
    setPose(cat, "crouch", 0.25);
  }

  function say(cat, text, time = 1.8) {
    cat.say = { text, t: time };
  }

  function puff(x, y, text, c3, vx = 0, vy = -30, life = 1.4) {
    if (particles.length > 160) particles.shift();
    particles.push({ x, y, vx, vy, text, c3, life, max: life });
  }

  const headTop = (cat) => (cat.box ? cat.box.y0 : cat.y - U);

  function pet(cat, strong) {
    if (cat.state !== "idle" && cat.state !== "petted") return;
    const heart = () => puff(cat.x + rand(-0.2, 0.2) * U, headTop(cat), "♥", [255, 110, 150], rand(-15, 15), -30);
    if (ASLEEP.has(cat.pose)) {
      if (rand() < 0.04) puff(cat.x, headTop(cat), "~", [255, 150, 180]);
      return;
    }
    if (cat.state !== "petted" || strong) {
      say(cat, strong ? "purr~ nya!" : rand() > 0.5 ? "purr~" : "prrr...");
      heart();
      const ground = cat.plat && cat.plat.ground;
      const roll = rand();
      cat.state = "petted";
      if (LYING.has(cat.pose)) setPose(cat, ground && roll < 0.5 ? "belly" : cat.pose === "loaf" ? "loaf" : "side", 0.7);
      else setPose(cat, roll < 0.25 ? "knead" : "petted", 0.4);
    } else if (rand() < 0.05) heart();
    cat.timer = strong ? 3 : 1.5;
    cat.goal = null;
  }

  // Laser: the cursor counts as a laser dot while it is moving fast.
  const laser = { speed: 0, last: 0, until: 0, on: false };

  function pointerMove(x, y, moved) {
    const now = performance.now();
    const dt = Math.max(1, now - laser.last) / 1000;
    laser.last = now;
    laser.speed = lerp(laser.speed, moved / dt, 0.5);
    if (laser.speed > 900) laser.until = now + 600;
  }

  /** What a cat does next when it has nothing to chase. */
  function pickAction(cat) {
    const b = cat.breed, was = cat.pose;
    const hot = stats.data && stats.data.cpu && stats.data.cpu.total > 70;
    const nap = b.nap * (hot ? 2 : 1) * (night() ? 1.5 : 1);
    // Waking up comes with a stretch and a yawn.
    if (ASLEEP.has(was) && rand() < 0.7) return idle(cat, rand() < 0.6 ? "stretch" : "yawn", rand(2, 3));
    if (was === "stretch" && rand() < 0.5) return idle(cat, "yawn", rand(1.5, 2.5));
    const lying = LYING.has(was);
    const options = [
      ["jump", 0.2 * b.jump], ["walk", lying ? 0.1 : 0.26], ["sit", 0.14], ["stand", 0.05], ["look", 0.06],
      ["groom", 0.07], ["wash", 0.04], ["lickBack", 0.04], ["loaf", 0.09 * nap], ["side", 0.05 * nap],
      ["groomLeg", lying ? 0.06 : 0.02], ["sleep", 0.05 * nap], ["sleepSide", 0.04 * nap], ["stretch", 0.04],
    ];
    let roll = rand(0, options.reduce((s, o) => s + o[1], 0));
    let pick = "sit";
    for (const [name, w] of options) {
      if ((roll -= w) <= 0) {
        pick = name;
        break;
      }
    }
    if (pick === "jump") {
      const choices = platforms.filter((p) => canReach(cat, p)).sort(() => rand() - 0.5);
      for (const p of choices) {
        const x = freeSpot(p, cat);
        if (x !== null) return jumpTo(cat, p, x);
      }
      pick = "walk";
    }
    if (pick === "walk") {
      const bb = bounds(cat.plat);
      if (bb.hi - bb.lo < U * 0.3) return idle(cat, "sit", rand(3, 6));
      cat.state = "walk";
      cat.goal = { kind: "walk", x: rand(bb.lo, bb.hi) };
      cat.timer = 20;
      setPose(cat, "walk", 0.4);
      return;
    }
    const time = { sleep: rand(15, 35), sleepSide: rand(12, 30), loaf: rand(8, 16), side: rand(8, 16), groomLeg: rand(4, 7), look: rand(3, 6) }[pick] || rand(3, 7);
    idle(cat, pick, time);
    if (hot && pick === "sit" && b.name === "Tora" && rand() < 0.3) say(cat, "warm CPU~", 2.5);
  }

  function toyFor(cat) {
    let best = null, bestD = Infinity;
    for (const toy of toys) {
      if (!toy.plat || toy.life < 2) continue;
      if (toy.plat !== cat.plat && !canReach(cat, toy.plat)) continue;
      const d = Math.abs(toy.x - cat.x) + Math.abs(Y(toy.plat.row) - cat.y) * 2;
      if (d < bestD && d < U * 5) {
        best = toy;
        bestD = d;
      }
    }
    return best;
  }

  /** Run to x on the current ledge, or jump to another ledge that holds it. */
  function chase(cat, plat, x, kind, toy) {
    if (plat === cat.plat) {
      const b = bounds(plat);
      cat.goal = { kind, x: clamp(x, b.lo, b.hi), toy };
      if (cat.state !== "run") {
        cat.state = "run";
        setPose(cat, "run", 0.25);
      }
      cat.timer = 3;
    } else if (canReach(cat, plat) && cat.react <= 0) {
      jumpTo(cat, plat, x);
      cat.react = rand(0.6, 1.4);
    }
  }

  const TAIL_SPEED = { run: 9, leap: 6, crouch: 12, walk: 3, petted: 4, knead: 4, sleep: 0.4, sleepSide: 0.4, loaf: 0.8, side: 0.8 };

  function updateCat(cat, dt, t) {
    cat.tailPhase += dt * (TAIL_SPEED[cat.pose] || 1.6) * (cat.flick > 0 ? 2.5 : 1);
    cat.poseT += dt;
    cat.react -= dt;
    cat.blink -= dt;
    if (cat.blink <= 0) {
      cat.blinking = !cat.blinking;
      cat.blink = cat.blinking ? 0.14 : rand(2.5, 6);
    }
    if (cat.say && (cat.say.t -= dt) <= 0) cat.say = null;
    if (!GALLERY && !PIN_POSE) behave(cat, dt);
    else cat.amp = 1;
    fidget(cat, dt);

    // The pose eases in on springs...
    const goal = target(cat, t), B = cat.base, V = cat.V;
    for (const k of POSE_KEYS) {
      const g = ANGLES[k] ? B[k] + wrapAngle(goal[k] - B[k]) : goal[k];
      damp(B, V, k, g, cat.ease * (LAG[k] || 1), dt);
    }
    // ...and the looping motion of the new pose fades in over the old one's.
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
    if (!cat.glance && cat.state === "idle" && (UPRIGHT.has(cat.pose) || cat.pose === "loaf") && rand() < dt * 0.12) {
      const back = cat.pose !== "stand" && rand() < 0.3;
      cat.glance = { hf: back ? -0.7 : rand() < 0.6 ? 0.15 : 1, tilt: rand(-0.15, 0.3), t: rand(1, 2.5) };
    }
  }

  /** The pose a cat is easing toward: its pose plus drifting gaze, fidgets and in-air pitch. */
  function target(cat, t) {
    const P = { ...POSES[cat.pose] };
    const n = (k) => noise2(t * 0.35, k, cat.seed) - 0.5;
    const upright = UPRIGHT.has(cat.pose);
    if (upright || cat.pose === "loaf") {
      P.tilt += 0.3 * n(1);
      P.hf -= Math.max(0, n(2)) * 0.5;
    }
    if (upright || cat.pose === "stand") {
      P.hx += 0.015 * n(3);
      P.sx += 0.015 * n(3);
    }
    P.ta += 0.2 * n(5);
    P.tc += 0.05 * n(4);
    if (cat.flick > 0) P.tw += 0.12;
    if (cat.twitch > 0) P.ear = 0.45;
    if (cat.glance) {
      P.hf = cat.glance.hf;
      P.tilt += cat.glance.tilt;
    }
    // Upright idle cats follow a nearby cursor with their head.
    const near = pointer.active && Math.abs(pointer.x - cat.x) < U * 2.5 && Math.abs(pointer.y - cat.y) < U * 2;
    if (near && cat.state === "idle" && (upright || cat.pose === "loaf")) {
      P.hf = Math.sign(pointer.x - cat.x) === cat.facing ? 0.75 : 0.1;
      P.tilt = clamp((cat.y - U * 0.7 - pointer.y) / U, -0.5, 0.5);
    }
    // In the air the body pitches with the arc: nose up on the way up, down on the way down.
    if (cat.pitch) {
      P.sy += 0.1 * cat.pitch;
      P.ny += 0.12 * cat.pitch;
      P.hy -= 0.08 * cat.pitch;
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

  function behave(cat, dt) {
    if (cat.state === "prejump") {
      if ((cat.timer -= dt) <= 0) {
        cat.state = "jump";
        setPose(cat, "leap", 0.15);
      }
      return;
    }
    if (cat.state === "jump") {
      const j = cat.jump;
      j.t += dt;
      const p = clamp(j.t / j.dur, 0, 1), y0 = cat.y;
      cat.x = lerp(j.sx, j.tx, p);
      cat.y = lerp(j.sy, j.ty, p) - 4 * j.h * p * (1 - p);
      cat.pitch = j.hop ? 0 : clamp((y0 - cat.y) / Math.max(dt, 1e-3) / (U * 4), -1, 1);
      if (!j.hop && p > 0.5) setPose(cat, "fall", 0.3);
      if (p >= 1) {
        cat.y = j.ty;
        cat.pitch = 0;
        cat.plat = j.to;
        cat.jump = null;
        for (const s of [-1, 1]) puff(cat.x + s * U * 0.3, cat.y - 4, "'", [200, 200, 200], s * 25, -10, 0.5);
        if (j.hop) {
          cat.state = "bat";
          cat.timer = 0.7;
          setPose(cat, "bat", 0.2);
        } else {
          cat.state = "land";
          cat.timer = 0.22;
          setPose(cat, "crouch", 0.1);
        }
      }
      return;
    }
    if (cat.state === "land") {
      if ((cat.timer -= dt) <= 0) idle(cat, rand() < 0.5 ? "sit" : "stand", rand(1.5, 4));
      return;
    }

    // Petting: rest the cursor on a cat.
    const fast = performance.now() < laser.until;
    if (pointer.active && !fast && hits(cat, pointer.x, pointer.y)) {
      cat.hover += dt;
      if (cat.hover > 0.3) pet(cat, false);
    } else {
      cat.hover = 0;
    }

    // Laser: chase a fast-moving cursor (sleepers ignore it); otherwise toys.
    const busy = cat.state === "petted" || cat.state === "eat" || ASLEEP.has(cat.pose) && cat.state === "idle";
    if (fast && pointer.active && !busy && cat.state !== "stalk" && cat.state !== "bat") {
      if (!laser.on) cat.react = rand(0.1, 0.8);
      const p = ledgeAt(pointer.x, pointer.y);
      if (p) chase(cat, p, pointer.x - cat.facing * U * 0.4, "laser");
    } else if (!busy && (cat.state === "idle" || cat.state === "walk") && toys.length && rand() < dt * 2) {
      const toy = toyFor(cat);
      if (toy) chase(cat, toy.plat, toy.x, "toy", toy);
    }
    if (cat.goal && cat.goal.kind === "toy") {
      const toy = cat.goal.toy;
      if (!toys.includes(toy) || toy.plat !== cat.plat) cat.goal = null;
      else {
        const b = bounds(cat.plat);
        cat.goal.x = clamp(toy.x - Math.sign(toy.x - cat.x || 1) * U * 0.42, b.lo, b.hi);
      }
    }

    cat.timer -= dt;
    switch (cat.state) {
      case "walk":
      case "run": {
        const run = cat.state === "run";
        if (!cat.goal) {
          if (run) idle(cat, "sit", rand(1, 3));
          else pickAction(cat);
          break;
        }
        // Accelerate, brake to arrive, and stop before turning round.
        const dx = cat.goal.x - cat.x, dir = Math.sign(dx);
        const max = run ? U * 1.5 : U * 0.32, acc = run ? U * 4 : U * 1.2;
        let want = dir * Math.min(max, Math.sqrt(2 * acc * Math.abs(dx)));
        if (dir && dir !== cat.facing && Math.abs(dx) > U * 0.05) {
          want = 0;
          if (Math.abs(cat.vx) < U * 0.05) turn(cat, dir);
        }
        cat.vx += clamp(want - cat.vx, -acc * dt, acc * dt);
        let step = cat.vx * dt;
        if (Math.sign(step) === dir && Math.abs(step) > Math.abs(dx)) step = dx;
        cat.x += step;
        cat.amp = clamp(Math.abs(cat.vx) / (run ? U * 0.9 : U * 0.22), 0, 1);
        const before = cat.gait;
        cat.gait += (Math.abs(step) / (run ? U * 0.9 : U * 0.5)) * TAU;
        if (cat.plat.ground && Math.floor(before / Math.PI) !== Math.floor(cat.gait / Math.PI)) addPrint(cat);
        if (Math.abs(dx) < 3 && Math.abs(cat.vx) < U * 0.15) {
          cat.vx = 0;
          arrive(cat);
        } else if (cat.timer <= 0) pickAction(cat);
        break;
      }
      case "stalk":
        if (cat.timer <= 0) {
          const b = bounds(cat.plat);
          jumpTo(cat, cat.plat, clamp(cat.x + cat.facing * U * 0.45, b.lo, b.hi), true);
        }
        break;
      case "bat":
        if (cat.timer <= 0) idle(cat, "sit", rand(1.5, 3));
        break;
      case "eat":
        if (rand() < dt * 3) puff(cat.x + cat.facing * U * 0.45, cat.y - U * 0.1, ".", [230, 190, 120], rand(-20, 20), -25, 0.6);
        if (cat.timer <= 0) {
          idle(cat, "groom", rand(3, 5));
          say(cat, "yummy~");
        }
        break;
      case "petted":
        if (rand() < dt * 0.6) puff(cat.x, headTop(cat), "♥", [255, 120, 170], rand(-15, 15), -30);
        if (cat.timer <= 0) idle(cat, LYING.has(cat.pose) ? (cat.pose === "belly" ? "side" : cat.pose) : "sit", rand(2, 5));
        break;
      default: // idle
        if (ASLEEP.has(cat.pose) && rand() < dt * 0.8) {
          puff(cat.x + cat.facing * U * 0.3, headTop(cat), rand() > 0.5 ? "z" : "Z", [180, 196, 224], 8 * cat.facing, -14, 2.4);
        }
        if (cat.timer <= 0) pickAction(cat);
    }
  }

  function arrive(cat) {
    const goal = cat.goal;
    cat.goal = null;
    if (goal.kind === "walk") {
      pickAction(cat);
    } else if (goal.kind === "laser") {
      cat.state = "stalk";
      cat.timer = rand(0.5, 0.9);
      setPose(cat, "crouch", 0.2);
      if (rand() < 0.3) say(cat, "!", 0.8);
    } else if (goal.toy && toys.includes(goal.toy)) {
      const toy = goal.toy;
      turn(cat, Math.sign(toy.x - cat.x));
      if (toy.kind === "fish") {
        toys.splice(toys.indexOf(toy), 1);
        cat.state = "eat";
        cat.timer = 3;
        setPose(cat, "eat", 0.3);
        say(cat, "*crunch*", 1.5);
      } else {
        cat.state = "bat";
        cat.timer = 0.7;
        setPose(cat, "bat", 0.2);
        toy.vx = cat.facing * U * rand(0.8, 1.4);
        toy.vy = -U * rand(0.8, 1.4);
        toy.plat = null;
        if (rand() < 0.5) say(cat, "nya!", 1);
      }
    } else {
      idle(cat, "sit", rand(1, 3));
    }
  }

  /**
   * The looping motion of pose `name`, applied to P: gait, licking, kneading, wiggling.
   * Walking paws are planted: during the stance they slide back exactly as fast as the
   * body moves forward (the gait phase is driven by distance), then swing forward in an arc.
   */
  function animate(cat, name, P, t) {
    const ph = cat.gait;
    switch (name) {
      case "walk":
      case "run": {
        const run = name === "run", a = cat.amp;
        const beta = run ? 0.38 : 0.62, stride = run ? 0.9 : 0.5;
        const A = (beta * stride) / (2 * cat.scale), lift = run ? 0.13 : 0.07;
        const legs = run ? [["lf", 0], ["rf", 0.08], ["lh", 0.5], ["rh", 0.58]] : [["lh", 0], ["lf", 0.25], ["rh", 0.5], ["rf", 0.75]];
        for (const [k, o] of legs) {
          const u = (((ph / TAU + o) % 1) + 1) % 1;
          let fx = A * (1 - (2 * u) / beta), fy = 0;
          if (u >= beta) {
            const s = (u - beta) / (1 - beta);
            fx = A * (-1 + 2 * s * s * (3 - 2 * s));
            fy = lift * Math.sin(Math.PI * s);
          }
          P[k + "x"] += fx * a;
          P[k + "y"] += fy * a;
        }
        if (run) {
          // Spine gathers and extends with the stride.
          const s = Math.sin(ph);
          P.hx -= 0.06 * s * a;
          P.sx += 0.05 * s * a;
          P.hy += 0.035 * Math.max(0, s) * a;
          P.sy += 0.035 * Math.max(0, -s) * a;
          P.ny += 0.02 * Math.max(0, -s) * a;
        } else {
          // Hips and shoulders rise over each planted leg; the head stays steadier.
          P.hy += 0.012 * Math.cos(ph * 2) * a;
          P.sy += 0.01 * Math.cos(ph * 2 + Math.PI / 2) * a;
          P.ny += 0.005 * Math.cos(ph * 2 + Math.PI / 2) * a;
          P.ta += 0.12 * Math.sin(ph) * a;
        }
        break;
      }
      case "crouch": {
        // A stalking cat treads its back feet and wiggles before it pounces.
        const a = cat.state === "stalk" ? smoothstep(0.15, 0.6, cat.poseT) : 0;
        P.hy += 0.02 * Math.sin(t * 14) * a;
        P.lhy += Math.max(0, Math.sin(t * 14)) * 0.025 * a;
        P.rhy += Math.max(0, -Math.sin(t * 14)) * 0.025 * a;
        P.tw += 0.1 * a;
        break;
      }
      case "groom": {
        const s = Math.sin(t * 5);
        P.lfy += 0.035 * s;
        P.ny += 0.015 * s;
        P.tilt += 0.08 * s;
        P.mouth = s > 0 ? 1 : 0;
        break;
      }
      case "wash":
        P.lfx += 0.05 * Math.cos(t * 3);
        P.lfy += 0.05 * Math.sin(t * 3);
        P.tilt += 0.1 * Math.sin(t * 3);
        break;
      case "lickBack":
      case "groomLeg":
        P.ny += 0.02 * Math.sin(t * 6);
        P.tilt += 0.06 * Math.sin(t * 6);
        P.mouth = Math.sin(t * 6) > 0 ? 1 : 0;
        break;
      case "knead": {
        const s = Math.sin(t * 5);
        P.lfy += Math.max(0, s) * 0.06;
        P.rfy += Math.max(0, -s) * 0.06;
        P.sy += 0.012 * Math.abs(s);
        break;
      }
      case "bat":
        P.lfx += 0.08 * Math.sin(t * 14);
        P.lfy += 0.04 * Math.cos(t * 14);
        break;
      case "eat":
        P.ny += 0.015 * Math.sin(t * 8);
        break;
      case "petted":
        // Leaning into the hand.
        P.tilt += 0.12 * Math.sin(t * 2.5);
        P.nx += 0.015 * Math.sin(t * 2.5);
        P.sx += 0.01 * Math.sin(t * 2.5);
        break;
      case "stretch":
        P.hy += 0.02 * Math.sin(t * 1.5);
        P.lfx += 0.02 * Math.sin(t * 1.5);
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

  // ------------------------------------------------- toys, prints, puffs

  const TOYS = [
    { kind: "yarn", name: "Yarn ball", icon: "@", c3: [235, 80, 120] },
    { kind: "mouse", name: "Wind-up mouse", icon: "<o~", c3: [170, 174, 190] },
    { kind: "fish", name: "Fish treat", icon: "><>", c3: [240, 176, 52] },
  ];
  let toyIndex = 0;

  function dropToy(x, y) {
    if (toys.length >= 8) toys.shift();
    toys.push({ kind: TOYS[toyIndex].kind, x, y, vx: rand(-40, 40), vy: -60, plat: null, life: 30, trail: [], dir: rand() > 0.5 ? 1 : -1 });
    puff(x, y, "*", [255, 230, 100], rand(-20, 20), -20, 0.6);
  }

  function stepToys(dt) {
    for (let i = toys.length - 1; i >= 0; i--) {
      const toy = toys[i];
      toy.life -= dt;
      if (toy.life <= 0 || toy.y > H + 40) {
        toys.splice(i, 1);
        continue;
      }
      if (toy.plat) {
        if (toy.kind === "mouse" && toy.life > 10) toy.vx = toy.dir * U * 0.4;
        else toy.vx *= Math.max(0, 1 - dt * 2.5);
        toy.x += toy.vx * dt;
        const p = toy.plat;
        if (toy.kind === "mouse" && (toy.x < X(p.c0 + 1) || toy.x > X(p.c1))) {
          toy.dir *= -1;
          toy.x = clamp(toy.x, X(p.c0 + 1), X(p.c1));
        } else if (toy.x < X(p.c0) || toy.x > X(p.c1 + 1)) {
          toy.plat = null;
        }
      } else {
        const prevY = toy.y;
        toy.vy += 900 * dt;
        toy.x += toy.vx * dt;
        toy.y += toy.vy * dt;
        if (toy.x < cw || toy.x > W - cw) {
          toy.vx = -toy.vx * 0.6;
          toy.x = clamp(toy.x, cw, W - cw);
        }
        for (const p of platforms) {
          const top = Y(p.row);
          if (prevY <= top && toy.y >= top && toy.x >= X(p.c0) && toy.x <= X(p.c1 + 1)) {
            toy.y = top;
            if (toy.vy > 160) toy.vy = -toy.vy * 0.35;
            else {
              toy.vy = 0;
              toy.plat = p;
            }
            break;
          }
        }
      }
      if (toy.kind === "yarn" && Math.abs(toy.vx) > 20) {
        const c = Math.round(toy.x / cw), r = Math.ceil(toy.y / ch) - 1;
        const last = toy.trail[toy.trail.length - 1];
        if (!last || last.c !== c || last.r !== r) {
          toy.trail.push({ c, r });
          if (toy.trail.length > 14) toy.trail.shift();
        }
      }
    }
  }

  function drawToys() {
    for (const toy of toys) {
      const def = TOYS.find((d) => d.kind === toy.kind);
      const a = clamp(toy.life / 3, 0, 1);
      for (const p of toy.trail) grid.put(p.c, p.r, "~", ink([235, 80, 120], p.c, p.r, 0.5 * a, 60));
      const dir = (toy.plat ? toy.dir : Math.sign(toy.vx)) || 1;
      if (toy.kind === "yarn") {
        const r = U * 0.065;
        shapes.paint(grid, shapes.circle(toy.x, toy.y - r, r), { rgb: def.c3, ramp: "-~=@%", alpha: a });
      } else if (toy.kind === "mouse") {
        const r = U * 0.06;
        shapes.paint(grid, shapes.ellipse(toy.x, toy.y - r * 0.6, r, r * 0.6), { rgb: def.c3, alpha: a });
        const c = Math.round((toy.x - dir * r * 1.3) / cw), rr = Math.ceil(toy.y / ch) - 1;
        grid.put(c, rr, "~", ink([230, 150, 170], c, rr, a, 60));
        grid.put(c - dir, rr, "~", ink([230, 150, 170], c - dir, rr, a, 60));
      } else {
        const r = U * 0.08;
        shapes.paint(grid, shapes.ellipse(toy.x, toy.y - r * 0.45, r, r * 0.42), { rgb: def.c3, alpha: a });
        shapes.paint(grid, shapes.triangle(toy.x - dir * r * 0.8, toy.y - r * 0.45, toy.x - dir * r * 1.5, toy.y - r, toy.x - dir * r * 1.5, toy.y), { rgb: def.c3, alpha: a });
      }
    }
  }

  function addPrint(cat) {
    if (prints.length > 60) prints.shift();
    prints.push({ c: Math.round((cat.x - cat.facing * U * 0.15) / cw), r: cat.plat.row + 1, life: 6 });
  }

  function stepPrints(dt) {
    for (let i = prints.length - 1; i >= 0; i--) if ((prints[i].life -= dt) <= 0) prints.splice(i, 1);
  }

  function drawPrints() {
    for (const p of prints) grid.put(p.c, p.r, ":", ink([230, 224, 236], p.c, p.r, 0.6 * clamp(p.life / 6, 0, 1), 60));
  }

  function stepParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        particles.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  function drawParticles() {
    for (const p of particles) {
      const c = Math.round(p.x / cw), r = Math.round(p.y / ch);
      grid.put(c, r, p.text, ink(p.c3, c, r, clamp(p.life / p.max, 0, 1), 60));
    }
  }

  // A cat that now and then peeks up from the bottom edge, looking at you.
  const peek = { wait: rand(25, 45), t: -1, cat: null };

  function stepPeek(dt, t) {
    if (GALLERY) return;
    if (peek.t < 0) {
      if ((peek.wait -= dt) <= 0) {
        peek.t = 0;
        const cat = {
          breed: BREEDS[Math.floor(rand(0, BREEDS.length))], scale: 1, facing: rand() > 0.5 ? 1 : -1,
          x: rand(U, W - U), y: H, pose: "look", P: null, tailPhase: 0, gait: 0, look: 0, blinking: false,
        };
        peek.cat = cat;
      }
      return;
    }
    if ((peek.t += dt / 4) >= 1) {
      peek.t = -1;
      peek.wait = rand(30, 60);
      return;
    }
    const cat = peek.cat;
    const up = Math.min(1, Math.sin(peek.t * Math.PI) * 1.6);
    cat.y = H + U * 0.62 - up * U * 0.3;
    cat.blinking = Math.sin(t * 3) > 0.97;
    cat.P = { ...POSES.look, hf: 0, tilt: 0, eyes: cat.blinking ? 0 : 1 };
  }

  function drawLaser() {
    const a = clamp((laser.until - performance.now()) / 600, 0, 1);
    if (!pointer.active || a <= 0) return;
    const c = Math.floor(pointer.x / cw), r = Math.floor(pointer.y / ch);
    put(c, r, "*", [255, 60, 60], a);
    put(c - 1, r, ".", [255, 100, 100], 0.4 * a);
    put(c + 1, r, ".", [255, 100, 100], 0.4 * a);
  }

  // ------------------------------------------------------------------ HUD

  const HUD_ROW = 1;
  let hud = []; // { c0, c1, act } of what was drawn last frame, for clicks

  function drawHUD() {
    hud = [];
    if (!hudVisible || GALLERY) return;
    const lit = pointer.active && pointer.y < Y(HUD_ROW + 3);
    const a = lit ? 0.95 : 0.55;
    let c = 2;
    const item = (str, c3, act) => {
      inkText(c, HUD_ROW, str, c3, a, 110);
      if (act) hud.push({ c0: c, c1: c + str.length - 1, act });
      c += str.length + 2;
    };
    for (let i = 0; i < ENVS.length; i++) {
      const name = ENVS[i];
      item(`[${i + 1} ${name[0].toUpperCase() + name.slice(1)}]`, env === name ? [255, 200, 80] : [170, 180, 196], () => setEnv(name));
    }
    item("cats", [120, 210, 255]);
    c -= 1;
    item("[-]", [120, 210, 255], () => setCats(catCount - 1));
    c -= 1;
    item(String(catCount), [120, 210, 255]);
    c -= 1;
    item("[+]", [120, 210, 255], () => setCats(catCount + 1));
    const def = TOYS[toyIndex];
    item(`[T toy: ${def.name} ${def.icon}]`, def.c3, () => (toyIndex = (toyIndex + 1) % TOYS.length));
    if (lit) item("[H hide]", [150, 160, 176], () => (hudVisible = false));
  }

  function setCats(n) {
    catCount = clamp(n, 1, MAX_CATS);
    syncCatCount();
  }

  function setEnv(name) {
    if (name === env || GALLERY) return;
    env = name;
    layout();
    for (const cat of cats) placeCat(cat);
    toys.length = 0;
    prints.length = 0;
    grid.repaintBackdrop();
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
    if (GALLERY) return;
    for (const cat of cats) {
      if (hits(cat, x, y)) {
        pet(cat, true);
        return;
      }
    }
    dropToy(x, y);
  }

  window.addEventListener("keydown", (e) => {
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
    const i = ["1", "2", "3"].indexOf(e.key);
    if (i >= 0) setEnv(ENVS[i]);
    else if (e.key === "+" || e.key === "=") setCats(catCount + 1);
    else if (e.key === "-" || e.key === "_") setCats(catCount - 1);
    else if (e.key === "t" || e.key === "T") toyIndex = (toyIndex + 1) % TOYS.length;
    else if (e.key === "h" || e.key === "H") hudVisible = !hudVisible;
    else if (e.key === " " && pointer.active) dropToy(pointer.x, pointer.y);
  });

  // -------------------------------------------------------------- gallery

  const GALLERY_POSES = [
    "stand", "walk", "run", "crouch", "leap", "sit", "look", "groom", "wash", "lickBack", "yawn",
    "bat", "petted", "knead", "eat", "stretch", "loaf", "side", "groomLeg", "belly", "sleep", "sleepSide",
  ];

  /** Every pose on a plain wall, one cat each, labelled: ?pose=all. */
  function layoutGallery() {
    const n = GALLERY_POSES.length, per = Math.ceil(Math.sqrt(n * (W / H) * 0.75));
    const lines = Math.ceil(n / per), cellW = W / per, cellH = (H - Y(3)) / lines;
    U = Math.min(cellW * 0.62, cellH * 0.85);
    cats.length = 0;
    GALLERY_POSES.forEach((name, i) => {
      const cat = createCat(i);
      cat.scale = 1;
      cat.facing = 1;
      cat.x = (i % per + 0.5) * cellW;
      cat.y = Y(3) + (Math.floor(i / per) + 1) * cellH - Y(2.5);
      cat.pose = name;
      cat.prevPose = name;
      cat.base = { ...POSES[name] };
      cat.P = { ...cat.base };
      cat.label = name;
      cats.push(cat);
    });
  }

  // ------------------------------------------------------------- lifecycle

  function resize() {
    ({ W, H, cw, ch, cols, rows } = grid);
    U = clamp(Math.min(W, H) * 0.24, 110, 420);
    if (GALLERY) {
      layoutGallery();
      return;
    }
    const ids = cats.map((cat) => (cat.jump ? cat.jump.to.id : cat.plat && cat.plat.id));
    layout();
    cats.forEach((cat, i) => placeCat(cat, ids[i]));
    syncCatCount();
    if (PIN_POSE && POSES[PIN_POSE]) for (const cat of cats) setPose(cat, PIN_POSE, 0);
    toys.length = 0;
    prints.length = 0;
  }

  function step(dt, t) {
    followSky(currentHour(performance.now()));
    if (GALLERY || PIN_POSE) {
      for (const cat of cats) {
        if (cat.pose === "walk") cat.gait += dt * 5;
        if (cat.pose === "run") cat.gait += dt * 9;
      }
    }
    const fast = performance.now() < laser.until;
    for (const cat of cats) updateCat(cat, dt, t);
    laser.on = fast;
    stepToys(dt);
    stepPrints(dt);
    stepParticles(dt);
    stepPeek(dt, t);
  }

  function draw(t) {
    drawStill();
    liveScenery(t);
    drawPrints();
    drawToys();
    const order = cats.slice().sort((a, b) => a.y - b.y);
    for (const cat of order) rasterCat(cat);
    for (const cat of order) {
      drawLabel(cat);
      if (cat.label) inkText(Math.round(cat.x / cw) - (cat.label.length >> 1), Math.round(cat.y / ch) + 1, cat.label, [120, 110, 100], 0.9, 80);
    }
    if (peek.t >= 0 && peek.cat.P) rasterCat(peek.cat);
    drawParticles();
    drawLaser();
    drawHUD();
  }

  return { resize, paintBackdrop, step, draw, pointerMove, click, chat: false };
});
