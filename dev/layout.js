/**
 * wallpaper.py's doors() and Layout in JS, for dev/screens.html (keep the two in step).
 *
 * A screen is { x, y, w, h, pxmm, page }, where page is what the host can do to the page in it:
 * links(doors, share), arrive(side, x, y, data) and populate(n). The page's own news goes to
 * hear(i, values), a koi leaving through a door to handOff(i, handoff), and reconcile() runs
 * about once a second.
 */
(function (root) {
  "use strict";

  const EDGE_SLACK = 2;
  const OPPOSITE = { l: "r", r: "l", t: "b", b: "t" };

  /** Where screens touch: for each, [{ side, j, from, to }] along that edge in its own px. */
  function doors(rects) {
    return rects.map((a, i) => {
      const found = [];
      rects.forEach((b, j) => {
        if (i === j) return;
        const across = [Math.max(a.y, b.y), Math.min(a.y + a.h, b.y + b.h)];
        const down = [Math.max(a.x, b.x), Math.min(a.x + a.w, b.x + b.w)];
        for (const [side, touches, [lo, hi], origin] of [
          ["r", Math.abs(a.x + a.w - b.x) <= EDGE_SLACK, across, a.y],
          ["l", Math.abs(b.x + b.w - a.x) <= EDGE_SLACK, across, a.y],
          ["b", Math.abs(a.y + a.h - b.y) <= EDGE_SLACK, down, a.x],
          ["t", Math.abs(b.y + b.h - a.y) <= EDGE_SLACK, down, a.x],
        ]) {
          if (touches && hi > lo) found.push({ side, j, from: lo - origin, to: hi - origin });
        }
      });
      return found;
    });
  }

  class Layout {
    constructor(screens) {
      this.screens = screens;
      this.doors = doors(screens);
      screens.forEach((s, i) => this.reset(i));
    }

    /** The page in screen i is gone (reloading): no doors, no count until the new one is up. */
    reset(i) {
      Object.assign(this.screens[i], { scene: null, linkable: false, key: "", population: 0, count: null, sent: null });
      this.update();
    }

    hear(i, values) {
      const s = this.screens[i];
      if ("ready" in values) {
        s.scene = values.ready;
        s.linkable = !!values.links;
        s.population = Number.isInteger(values.population) && values.population > 0 ? values.population : 0;
      }
      if ("key" in values) s.key = String(values.key);
      if (Number.isInteger(values.count)) s.count = values.count;
      this.update();
    }

    linked(i, j) {
      const a = this.screens[i], b = this.screens[j];
      return a.linkable && b.linkable && a.scene === b.scene && a.key === b.key;
    }

    groups() {
      const seen = new Set(), found = [];
      this.screens.forEach((_, start) => {
        if (seen.has(start)) return;
        const group = [], todo = [start];
        seen.add(start);
        while (todo.length) {
          const i = todo.pop();
          group.push(i);
          for (const d of this.doors[i]) {
            if (!seen.has(d.j) && this.linked(i, d.j)) {
              seen.add(d.j);
              todo.push(d.j);
            }
          }
        }
        found.push(group);
      });
      return found;
    }

    shares() {
      const shares = new Map();
      for (const group of this.groups()) {
        const members = group.map((i) => this.screens[i]);
        if (!members.every((s) => s.population)) continue;
        const known = members.every((s) => s.pxmm);
        const areas = members.map((s) => (s.w * s.h) / (known ? s.pxmm * s.pxmm : 1));
        const total = members.reduce((n, s) => n + s.population, 0), sum = areas.reduce((a, b) => a + b, 0);
        group.forEach((i, n) => shares.set(i, (total * areas[n]) / sum));
      }
      return shares;
    }

    update() {
      const shares = this.shares();
      const surplus = (j) => {
        const c = this.screens[j].count;
        return c === null || !shares.has(j) ? null : Math.round((c - shares.get(j)) * 1000) / 1000;
      };
      this.screens.forEach((s, i) => {
        const open = this.doors[i].filter((d) => this.linked(i, d.j)).map((d) => ({ side: d.side, from: d.from, to: d.to, surplus: surplus(d.j) }));
        const share = shares.has(i) ? Math.round(shares.get(i) * 1000) / 1000 : null;
        const msg = JSON.stringify([open, share]);
        if (msg === s.sent) return;
        s.sent = msg;
        s.page.links(open, share);
      });
    }

    reconcile() {
      const shares = this.shares();
      for (const group of this.groups()) {
        if (group.some((i) => !shares.has(i) || this.screens[i].count === null)) continue;
        const total = group.reduce((n, i) => n + this.screens[i].population, 0);
        const have = group.reduce((n, i) => n + this.screens[i].count, 0);
        if (have === total) continue;
        const gap = (i) => this.screens[i].count - shares.get(i);
        const pick = group.reduce((a, b) => ((have > total ? gap(b) > gap(a) : gap(b) < gap(a)) ? b : a));
        const step = have > total ? -1 : 1;
        this.screens[pick].page.populate(step);
        this.screens[pick].count += step;
      }
      this.update();
    }

    handOff(i, { side, x, y, data }) {
      const s = this.screens[i];
      const along = side === "l" || side === "r" ? y : x;
      for (const d of this.doors[i]) {
        if (d.side === side && along >= d.from && along <= d.to && this.linked(i, d.j)) {
          const t = this.screens[d.j];
          t.page.arrive(OPPOSITE[side], s.x + x - t.x, s.y + y - t.y, data);
          if (s.count !== null) s.count--;
          if (t.count !== null) t.count++;
          this.update();
          return;
        }
      }
      s.page.arrive(side, x, y, data);
    }
  }

  root.ScreensLayout = { doors, Layout, OPPOSITE };
  if (typeof module !== "undefined") module.exports = root.ScreensLayout;
})(typeof window !== "undefined" ? window : globalThis);
