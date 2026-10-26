/**
 * Chat box: type a prompt, press Enter, and it opens in Claude or ChatGPT on the web.
 * ChatGPT takes the prompt in the link. Claude warns about any prefilled link (a guard
 * against malicious links), so for Claude the prompt is copied and you paste it in.
 *
 * ?chat=full|glass|off picks which part this page draws (see chat.css); the scene picks
 * the light or dark look. ?ai=claude|chatgpt
 * sets the default; the last choice is remembered. In the wallpaper the controls are native
 * GTK widgets in wallpaper.py, which mirror this behaviour.
 */
(() => {
  "use strict";

  const SITES = {
    claude: { url: () => "https://claude.ai/new", paste: true },
    chatgpt: { url: (q) => `https://chatgpt.com/?q=${encodeURIComponent(q)}`, paste: false },
  };

  const params = new URLSearchParams(location.search);
  const layer = params.get("chat") || "full";
  document.documentElement.dataset.chat = layer;

  // The light/dark theme is set by the scene (Wallpaper setTheme), not here.

  if (layer === "off" || layer === "glass") return;

  const box = document.getElementById("chat");
  const input = box.querySelector("textarea");
  const send = box.querySelector(".send");
  const picks = [...box.querySelectorAll(".pick button")];

  const load = () => {
    try {
      return localStorage.getItem("koi-ai");
    } catch {
      return null;
    }
  };
  let ai = load() || params.get("ai") || "claude";
  if (!SITES[ai]) ai = "claude";

  function choose(name) {
    ai = name;
    for (const b of picks) b.setAttribute("aria-pressed", String(b.dataset.ai === ai));
    try {
      localStorage.setItem("koi-ai", ai);
    } catch {}
  }
  choose(ai);

  const update = () => (send.disabled = !input.value.trim());
  update();

  const placeholder = input.placeholder;
  let hintTimer = 0;
  function hint(text) {
    input.placeholder = text;
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => (input.placeholder = placeholder), 5000);
  }

  /** Clipboard API first; it's unavailable on file:// pages, so fall back to execCommand. */
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {}
    const scratch = document.createElement("textarea");
    scratch.value = text;
    scratch.style.position = "fixed";
    scratch.style.opacity = "0";
    document.body.appendChild(scratch);
    scratch.select();
    try {
      document.execCommand("copy");
    } catch {}
    scratch.remove();
    input.focus();
  }

  async function submit() {
    const q = input.value.trim();
    if (!q) return;
    const site = SITES[ai];
    const url = site.url(q);
    if (site.paste) await copyText(q);
    window.open(url, "_blank", "noopener");
    input.value = "";
    update();
    if (site.paste) hint("Copied. Paste it into Claude with Ctrl+V");
  }

  for (const b of picks) b.addEventListener("click", () => choose(b.dataset.ai));
  send.addEventListener("click", submit);
  input.addEventListener("input", update);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      submit();
    }
  });
  // Clicks in the box shouldn't drop koi food on the pond below.
  box.addEventListener("pointerdown", (e) => e.stopPropagation());
})();
