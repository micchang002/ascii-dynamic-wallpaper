/**
 * The ASCII cell grid every scene draws into.
 *
 * A scene fills `glyph` / `color` (one character and one rgba() style per cell) each
 * frame, plus an optional `bg` cell colour (a highlighted cell, like a terminal's); flush()
 * repaints only the cells that changed since the last frame, by blitting the backdrop under
 * the cell and then a cached glyph sprite. That keeps a full-screen
 * wallpaper cheap even on WebKitGTK's software canvas.
 *
 * It also frosts the chat panel: CSS backdrop-filter isn't applied over a software
 * canvas, so the cells under the panel are repainted sharp every frame, then shrunk and
 * stretched back (a cheap, smooth blur) and clipped to the panel's rounded shape.
 */
(() => {
  "use strict";

  const { clamp } = Wallpaper.math;

  const styleCache = new Map();
  /** Quantised rgba() string, cached so repeated colours share one fillStyle and sprite. */
  function style(r, g, b, a) {
    r = clamp(Math.round(r / 10) * 10, 0, 255);
    g = clamp(Math.round(g / 10) * 10, 0, 255);
    b = clamp(Math.round(b / 10) * 10, 0, 255);
    a = clamp(Math.round(a * 20) / 20, 0, 1);
    const key = ((r * 256 + g) * 256 + b) * 32 + a * 20;
    let s = styleCache.get(key);
    if (!s) {
      s = `rgba(${r},${g},${b},${a})`;
      styleCache.set(key, s);
    }
    return s;
  }

  const FROST_MARGIN = 24;
  const SPRITE_LIMIT = 6000;

  class Grid {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d", { alpha: false });
      this.fontFamily = getComputedStyle(canvas).fontFamily || "monospace";
      this.backdrop = document.createElement("canvas");
      this.painter = null;
      this.sprites = new Map();
      this.glassEl = null;
      this.glass = null;
      this.frostA = document.createElement("canvas");
      this.frostB = document.createElement("canvas");

      this.W = 0;
      this.H = 0;
      this.dpr = 1;
      this.cw = 10;
      this.ch = 15;
      this.cols = 0;
      this.rows = 0;
      this.glyph = [];
      this.color = [];
      this.bg = [];
      /** What each cell showed last frame; only cells that differ get repainted. */
      this.shownGlyph = [];
      this.shownColor = [];
      this.shownBg = [];
    }

    /** Size the grid to the window; cells are `cellWidth` px wide and 1.5× as tall. */
    resize(cellWidth) {
      this.W = window.innerWidth;
      this.H = window.innerHeight;
      this.dpr = window.devicePixelRatio || 1;
      this.cw = cellWidth;
      this.ch = Math.round(cellWidth * 1.5);
      this.cols = Math.ceil(this.W / this.cw);
      this.rows = Math.ceil(this.H / this.ch);
      this.canvas.width = Math.round(this.W * this.dpr);
      this.canvas.height = Math.round(this.H * this.dpr);
      this.backdrop.width = this.canvas.width;
      this.backdrop.height = this.canvas.height;

      const n = this.cols * this.rows;
      this.glyph = new Array(n).fill("");
      this.color = new Array(n).fill("");
      this.bg = new Array(n).fill("");
      this.shownGlyph = new Array(n).fill(null);
      this.shownColor = new Array(n).fill(null);
      this.shownBg = new Array(n).fill(null);
      this.sprites.clear();
      this.measureGlass();
    }

    /** `painter(ctx, W, H)` draws the backdrop in CSS pixels; it is repainted on demand. */
    setBackdrop(painter) {
      this.painter = painter;
      this.repaintBackdrop();
    }

    repaintBackdrop() {
      const g = this.backdrop.getContext("2d");
      g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      if (this.painter) {
        this.painter(g, this.W, this.H);
      } else {
        g.fillStyle = "#000";
        g.fillRect(0, 0, this.W, this.H);
      }
      this.shownGlyph.fill(null);
    }

    clear() {
      this.glyph.fill("");
      this.bg.fill("");
    }

    /** Set a cell; `bg` (optional) fills the cell behind the glyph. */
    put(c, r, g, st, bg = "") {
      if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return;
      const i = r * this.cols + c;
      this.glyph[i] = g;
      this.color[i] = st;
      this.bg[i] = bg;
    }

    /** put() at a pixel position. */
    putAt(x, y, g, st) {
      this.put(Math.floor(x / this.cw), Math.floor(y / this.ch), g, st);
    }

    /** A line of text from cell (c, r); spaces are left transparent. */
    text(c, r, str, st) {
      for (let k = 0; k < str.length; k++) {
        if (str[k] !== " ") this.put(c + k, r, str[k], st);
      }
    }

    // ------------------------------------------------------------ painting

    /** Least recently used sprites are dropped first (a Map keeps insertion order). */
    sprite(st, g, bg) {
      const key = bg + "|" + st + g;
      const { sprites } = this;
      let img = sprites.get(key);
      if (img) {
        sprites.delete(key);
        sprites.set(key, img);
        return img;
      }
      if (sprites.size >= SPRITE_LIMIT) sprites.delete(sprites.keys().next().value);
      img = document.createElement("canvas");
      img.width = Math.ceil(this.cw * this.dpr);
      img.height = Math.ceil(this.ch * this.dpr);
      const sctx = img.getContext("2d");
      if (bg) {
        sctx.fillStyle = bg;
        sctx.fillRect(0, 0, img.width, img.height);
      }
      sctx.font = `600 ${Math.round(this.ch * 0.82 * this.dpr)}px ${this.fontFamily}`;
      sctx.textAlign = "center";
      sctx.textBaseline = "middle";
      sctx.fillStyle = st;
      sctx.fillText(g, img.width / 2, img.height / 2);
      this.sprites.set(key, img);
      return img;
    }

    flush() {
      const { ctx, cols, rows, cw, ch, dpr, glyph, color, bg, shownGlyph, shownColor, shownBg, backdrop } = this;
      const frosting = this.glass && this.glassChanged();
      if (frosting) this.dirtyUnderGlass();
      for (let r = 0; r < rows; r++) {
        const y = Math.round(r * ch * dpr), h = Math.round((r + 1) * ch * dpr) - y;
        for (let c = 0; c < cols; c++) {
          const i = r * cols + c;
          const g = glyph[i], b = bg[i];
          if (g === shownGlyph[i] && b === shownBg[i] && (!g || color[i] === shownColor[i])) continue;
          shownGlyph[i] = g;
          shownColor[i] = color[i];
          shownBg[i] = b;
          const x = Math.round(c * cw * dpr), w = Math.round((c + 1) * cw * dpr) - x;
          ctx.drawImage(backdrop, x, y, w, h, x, y, w, h);
          if (g || b) ctx.drawImage(this.sprite(color[i], g, b), x, y);
        }
      }
      if (frosting) this.frost();
    }

    // ------------------------------------------------------- frosted glass

    setGlass(el) {
      this.glassEl = el;
      this.measureGlass();
    }

    measureGlass() {
      if (!this.glassEl) return;
      const r = this.glassEl.getBoundingClientRect();
      const radius = parseFloat(getComputedStyle(this.glassEl).borderTopLeftRadius) || 0;
      this.glass = { x: r.left, y: r.top, w: r.width, h: r.height, radius };
      const sw = (r.width + FROST_MARGIN * 2) * this.dpr, sh = (r.height + FROST_MARGIN * 2) * this.dpr;
      this.frostA.width = Math.max(1, Math.round(sw / 4));
      this.frostA.height = Math.max(1, Math.round(sh / 4));
      this.frostB.width = Math.max(1, Math.round(sw / 6));
      this.frostB.height = Math.max(1, Math.round(sh / 6));
    }

    /** Cells c0..c1, r0..r1 under the panel, widened by `margin` px. */
    glassCells(margin) {
      const { glass, cw, ch, cols, rows } = this;
      return [
        Math.max(0, Math.floor((glass.x - margin) / cw)), Math.min(cols - 1, Math.floor((glass.x + glass.w + margin) / cw)),
        Math.max(0, Math.floor((glass.y - margin) / ch)), Math.min(rows - 1, Math.floor((glass.y + glass.h + margin) / ch)),
      ];
    }

    /**
     * Whether any cell the blur samples (the panel plus its margin) changed this frame. If
     * none did, last frame's frosted pixels are still right and the panel is left alone.
     */
    glassChanged() {
      const { cols, glyph, color, bg, shownGlyph, shownColor, shownBg } = this;
      const [c0, c1, r0, r1] = this.glassCells(FROST_MARGIN);
      for (let r = r0; r <= r1; r++) {
        for (let i = r * cols + c0, end = r * cols + c1; i <= end; i++) {
          const g = glyph[i];
          if (g !== shownGlyph[i] || bg[i] !== shownBg[i] || (g && color[i] !== shownColor[i])) return true;
        }
      }
      return false;
    }

    /** Cells under the panel are repainted sharp, then frosted over. */
    dirtyUnderGlass() {
      const { cols, shownGlyph } = this;
      const [c0, c1, r0, r1] = this.glassCells(0);
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) shownGlyph[r * cols + c] = null;
      }
    }

    frost() {
      const { glass, dpr, ctx, canvas, frostA, frostB } = this;
      const sx = Math.round((glass.x - FROST_MARGIN) * dpr), sy = Math.round((glass.y - FROST_MARGIN) * dpr);
      const sw = Math.round((glass.w + FROST_MARGIN * 2) * dpr), sh = Math.round((glass.h + FROST_MARGIN * 2) * dpr);
      frostA.getContext("2d").drawImage(canvas, sx, sy, sw, sh, 0, 0, frostA.width, frostA.height);
      frostB.getContext("2d").drawImage(frostA, 0, 0, frostA.width, frostA.height, 0, 0, frostB.width, frostB.height);

      const x = glass.x * dpr, y = glass.y * dpr, w = glass.w * dpr, h = glass.h * dpr;
      const rad = Math.min(glass.radius * dpr, w / 2, h / 2);
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x + rad, y);
      ctx.arcTo(x + w, y, x + w, y + h, rad);
      ctx.arcTo(x + w, y + h, x, y + h, rad);
      ctx.arcTo(x, y + h, x, y, rad);
      ctx.arcTo(x, y, x + w, y, rad);
      ctx.closePath();
      ctx.clip();
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(frostB, 0, 0, frostB.width, frostB.height, sx, sy, sw, sh);
      ctx.restore();
    }
  }

  Wallpaper.style = style;
  Wallpaper.Grid = Grid;
})();
