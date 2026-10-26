/**
 * Boots a scene: loads scenes/<name>.js (?scene=, default koi), then runs the frame loop
 * and feeds it pointer input.
 *
 * A scene file registers itself with
 *
 *   Wallpaper.scene("name", (api) => ({
 *     cellWidth(W, H),         // optional: cell width in px (default ~W/190)
 *     resize(),                // grid was resized; read grid.W/H/cw/ch/cols/rows
 *     paintBackdrop(ctx, W, H),// optional: the background behind the glyphs
 *     step(dt, t),             // optional: advance the simulation
 *     draw(t, dt),             // fill grid.glyph / grid.color for this frame
 *     pointerMove(x, y, moved),// optional
 *     click(x, y),             // optional
 *     chat: false,             // optional: this scene has no chat box
 *   }));
 *
 * where api = { grid, params, intParam, floatParam, pointer, stats, setTheme }. setTheme("light" |
 * "dark") tells the chat box which way to style itself; stats.data holds the latest system
 * readings (CPU, memory, GPU) when a host sends them.
 *
 * Common URL params: scene, fps, chat (full | glass | off). A host that sits behind other
 * windows can relay the pointer through window.wallpaperInput(x, y, active, clicked), and
 * system readings through window.wallpaperStats(data) (see wallpaper.py's Stats).
 */
(() => {
  "use strict";

  const { clamp } = Wallpaper.math;

  const params = new URLSearchParams(location.search);
  const intParam = (name, fallback) => {
    const v = parseInt(params.get(name), 10);
    return Number.isFinite(v) && v >= 0 ? v : fallback;
  };
  const floatParam = (name, fallback) => {
    const v = parseFloat(params.get(name));
    return Number.isFinite(v) ? v : fallback;
  };
  const FPS = intParam("fps", 60) || 60;
  const requested = params.get("scene") || "koi";
  const sceneName = /^[a-z0-9-]+$/.test(requested) ? requested : "koi";
  const chatLayer = params.get("chat") || "full";

  const setTheme = (theme) => {
    document.documentElement.dataset.theme = theme;
  };
  setTheme("dark");

  Wallpaper.scene = (name, factory) => {
    if (name === sceneName) boot(factory);
  };

  function boot(factory) {
    const canvas = document.querySelector("canvas");
    const grid = new Wallpaper.Grid(canvas);
    const pointer = { x: 0, y: 0, active: false, moved: 0 };
    const stats = { data: null };
    const scene = factory({ grid, params, intParam, floatParam, pointer, stats, setTheme });
    window.wallpaperStats = (data) => {
      stats.data = data;
    };

    if (scene.chat === false) document.documentElement.dataset.chat = "off";
    else if (chatLayer === "full" || chatLayer === "glass") grid.setGlass(document.getElementById("chat"));

    function resize() {
      const W = window.innerWidth, H = window.innerHeight;
      grid.resize(scene.cellWidth ? scene.cellWidth(W, H) : clamp(Math.round(W / 190), 7, 12));
      if (scene.resize) scene.resize();
      grid.setBackdrop(scene.paintBackdrop ? (g, w, h) => scene.paintBackdrop(g, w, h) : null);
    }

    let lastTime = 0, lastDraw = 0, raf = 0;
    function frame(now) {
      raf = requestAnimationFrame(frame);
      if (now - lastDraw < 1000 / FPS - 2) return;
      lastDraw = now;
      const dt = Math.min(0.05, (now - lastTime) / 1000 || 0);
      lastTime = now;
      const t = now / 1000;
      if (scene.step) scene.step(dt, t);
      grid.clear();
      scene.draw(t, dt);
      grid.flush();
    }

    function movePointer(x, y) {
      const moved = Math.hypot(x - pointer.x, y - pointer.y);
      if (moved < 0.5 && pointer.active) return;
      pointer.x = x;
      pointer.y = y;
      pointer.active = true;
      pointer.moved = performance.now();
      if (scene.pointerMove) scene.pointerMove(x, y, moved);
    }

    function click(x, y) {
      if (scene.click) scene.click(x, y);
    }

    // Once a host relays input, it is the only source (so clicks aren't counted twice).
    let relayed = false;
    window.addEventListener("pointermove", (e) => relayed || movePointer(e.clientX, e.clientY), { passive: true });
    document.documentElement.addEventListener("pointerleave", () => relayed || (pointer.active = false));
    window.addEventListener("pointerdown", (e) => relayed || click(e.clientX, e.clientY));

    window.wallpaperInput = (x, y, active, clicked) => {
      relayed = true;
      if (!active) {
        pointer.active = false;
        return;
      }
      movePointer(x, y);
      if (clicked) click(x, y);
    };

    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", () => {
      cancelAnimationFrame(raf);
      if (!document.hidden) {
        lastTime = 0;
        raf = requestAnimationFrame(frame);
      }
    });

    resize();
    raf = requestAnimationFrame(frame);
  }

  const script = document.createElement("script");
  script.src = `scenes/${sceneName}.js`;
  script.onerror = () => console.error(`ascii wallpaper: no scene "${sceneName}" (scenes/${sceneName}.js)`);
  document.body.appendChild(script);
})();
