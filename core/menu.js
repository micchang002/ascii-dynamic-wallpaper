/**
 * The scene menu: a small button in the bottom-right corner that opens a list of scenes,
 * with the current scene's options (ocean's view and animals, the cats' room) underneath.
 *
 * Picking one reloads the page with the new ?scene= (other params kept). Inside
 * wallpaper.py the page also posts the choice to the host (so it can remember it and
 * show or hide the native chat box). The host relays clicks rather than delivering them,
 * so app.js asks Wallpaper.menu.click(x, y) first; it returns true when the menu took it.
 * ?menu=0 leaves it out.
 */
(() => {
  "use strict";

  /** Every scene the menu offers. A new scene shows up here once it's listed. */
  const SCENES = [
    { name: "koi", label: "Koi pond" },
    { name: "shore", label: "Koi & cats on the bank" },
    { name: "cats", label: "Cats at play", options: { env: ["room", "roof", "garden"] } },
    { name: "ocean", label: "Mantas & whales", options: { view: ["top", "side"], species: ["mix", "manta", "whale"] } },
    { name: "tank", label: "Goldfish tank" },
    { name: "fireflies", label: "Fireflies" },
    { name: "microduck", label: "Microducks" },
    { name: "delta", label: "DRIC robotics lab" },
  ];

  const params = new URLSearchParams(location.search);
  if (params.get("menu") === "0") return;
  const current = params.get("scene") || "koi";

  const root = document.createElement("div");
  root.id = "menu";
  root.innerHTML = `<div class="panel" role="menu"></div><button type="button" class="toggle" aria-haspopup="true" aria-expanded="false"></button>`;
  const panel = root.querySelector(".panel");
  const toggle = root.querySelector(".toggle");
  const here = SCENES.find((s) => s.name === current);
  toggle.textContent = `≡ ${here ? here.label : current}`;

  function go(changes) {
    const next = new URLSearchParams(location.search);
    for (const [k, v] of Object.entries(changes)) next.set(k, v);
    const host = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.wallpaper;
    if (host) host.postMessage(JSON.stringify(Object.fromEntries(next)));
    location.search = next.toString();
  }

  for (const s of SCENES) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "scene" + (s.name === current ? " on" : "");
    row.innerHTML = `<span class="mark">${s.name === current ? "●" : "○"}</span>${s.label}<span class="name">${s.name}</span>`;
    row.addEventListener("click", () => (s.name === current ? setOpen(false) : go({ scene: s.name })));
    panel.appendChild(row);
    if (s.name !== current || !s.options) continue;
    for (const [key, values] of Object.entries(s.options)) {
      const chips = document.createElement("div");
      chips.className = "options";
      const on = values.includes(params.get(key)) ? params.get(key) : values[0];
      for (const v of values) {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "chip" + (v === on ? " on" : "");
        chip.textContent = v;
        chip.addEventListener("click", () => (v === on ? setOpen(false) : go({ [key]: v })));
        chips.appendChild(chip);
      }
      panel.appendChild(chips);
    }
  }

  let open = false;
  function setOpen(value) {
    open = value;
    root.classList.toggle("open", open);
    toggle.setAttribute("aria-expanded", String(open));
  }
  toggle.addEventListener("click", () => setOpen(!open));
  window.addEventListener("keydown", (e) => e.key === "Escape" && setOpen(false));
  // A real click outside closes it (app.js skips clicks that land on the menu itself).
  window.addEventListener("pointerdown", (e) => open && !root.contains(e.target) && setOpen(false));

  document.body.appendChild(root);

  Wallpaper.menu = {
    /** A relayed click at (x, y): true if the menu handled it, so the scene shouldn't. */
    click(x, y) {
      const el = document.elementFromPoint(x, y);
      if (el && root.contains(el)) {
        const button = el.closest("button");
        if (button) button.click();
        return true;
      }
      if (open) {
        setOpen(false);
        return true;
      }
      return false;
    },
    /** A relayed pointer at (x, y), or gone (null): light up what it's over, like :hover. */
    hover(x, y) {
      const el = x == null ? null : document.elementFromPoint(x, y);
      const over = el && root.contains(el) ? el.closest("button") : null;
      for (const b of root.querySelectorAll(".hover")) if (b !== over) b.classList.remove("hover");
      if (over) over.classList.add("hover");
      root.classList.toggle("near", !!over);
    },
  };
})();
