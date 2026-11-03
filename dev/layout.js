/**
 * wallpaper.py's doors() and Layout in JS, for dev/screens.html (keep the two in step).
 *
 * A screen is { x, y, w, h, pxmm, page }, where page is what the host can do to the page in it:
 * links(doors, share), arrive(side, x, y, data) and populate(n, kind). The page's own news goes
 * to hear(i, values), an animal leaving through a door to handOff(i, handoff), and reconcile()
 * runs about once a second. eyes(screens) is where each page's viewer stands (?eye=).
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

  /** The screens joined by the given doors, as lists of indices. */
  function components(found) {
    const seen = new Set(), groups = [];
    found.forEach((_, start) => {
      if (seen.has(start)) return;
      const group = [], todo = [start];
      seen.add(start);
      while (todo.length) {
        const i = todo.pop();
        group.push(i);
        for (const d of found[i]) {
          if (!seen.has(d.j)) {
            seen.add(d.j);
            todo.push(d.j);
          }
        }
      }
      groups.push(group);
    });
    return groups;
  }

  /**
   * Where each screen of a touching group stands on the desk, in mm (its top left): the first as
   * laid out, the rest butted against a placed neighbour, lined up at the middle of the edge
   * they share. null if a size is unknown.
   */
  function placement(rects, group) {
    if (!group.every((i) => rects[i].pxmm)) return null;
    const found = doors(rects), first = group[0];
    const at = new Map([[first, [rects[first].x / rects[first].pxmm, rects[first].y / rects[first].pxmm]]]);
    for (const todo = [first]; todo.length; ) {
      const i = todo.shift(), a = rects[i], [ux, uy] = at.get(i), p = a.pxmm;
      for (const d of found[i]) {
        if (at.has(d.j)) continue;
        const b = rects[d.j], q = b.pxmm, mid = (d.from + d.to) / 2;
        if (d.side === "l" || d.side === "r") {
          at.set(d.j, [d.side === "r" ? ux + a.w / p : ux - b.w / q, uy + mid / p - (a.y + mid - b.y) / q]);
        } else {
          at.set(d.j, [ux + mid / p - (a.x + mid - b.x) / q, d.side === "b" ? uy + a.h / p : uy - b.h / q]);
        }
        todo.push(d.j);
      }
    }
    return at;
  }

  /** For each screen, [x, y, dist] in its own px, or null when it touches no other. */
  function eyes(rects) {
    const found = rects.map(() => null);
    for (const group of components(doors(rects))) {
      if (group.length < 2) continue;
      const at = placement(rects, group);
      const box = (i) => {
        const r = rects[i];
        if (!at) return [r.x, r.y, r.x + r.w, r.y + r.h, 1];
        const [x, y] = at.get(i);
        return [x, y, x + r.w / r.pxmm, y + r.h / r.pxmm, r.pxmm];
      };
      const boxes = group.map(box);
      const x0 = Math.min(...boxes.map((b) => b[0])), y0 = Math.min(...boxes.map((b) => b[1]));
      const x1 = Math.max(...boxes.map((b) => b[2])), y1 = Math.max(...boxes.map((b) => b[3]));
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, span = Math.max(x1 - x0, y1 - y0);
      group.forEach((i, n) => {
        const [bx, by, , , k] = boxes[n];
        found[i] = [(cx - bx) * k, (cy - by) * k, 2.5 * span * k];
      });
    }
    return found;
  }

  /** (x, y) past screen a's `side` in b's px, the two butted at the middle of the door. */
  function through(side, x, y, a, b, here, there) {
    const k = a.pxmm && b.pxmm ? b.pxmm / a.pxmm : 1;
    const past = { l: -x, r: x - a.w, t: -y, b: y - a.h }[side] * k;
    const along = (there.from + there.to) / 2 + ((side === "l" || side === "r" ? y : x) - (here.from + here.to) / 2) * k;
    return { l: [b.w - past, along], r: [past, along], t: [along, b.h - past], b: [along, past] }[side];
  }

  /** { kind: n } from a page, keeping whole numbers of at least `least`. */
  function kinds(value, least) {
    const out = {};
    if (value && typeof value === "object") for (const [k, n] of Object.entries(value)) if (Number.isInteger(n) && n >= least) out[k] = n;
    return out;
  }

  const round3 = (v) => Math.round(v * 1000) / 1000;

  class Layout {
    constructor(screens) {
      this.screens = screens;
      this.doors = doors(screens);
      screens.forEach((s, i) => this.forget(i));
      this.update();
    }

    /** The page in screen i is gone (reloading): no doors, no count until the new one is up. */
    reset(i) {
      this.forget(i);
      this.update();
    }

    forget(i) {
      Object.assign(this.screens[i], { scene: null, linkable: false, key: "", sides: "", population: {}, count: null, sent: null });
    }

    hear(i, values) {
      const s = this.screens[i];
      if ("ready" in values) {
        s.scene = values.ready;
        s.linkable = !!values.links;
      }
      if ("key" in values) s.key = String(values.key);
      if ("sides" in values) s.sides = [...String(values.sides)].filter((c) => c in OPPOSITE).join("");
      if ("population" in values) s.population = kinds(values.population, 1);
      if (values.count && typeof values.count === "object") s.count = kinds(values.count, 0);
      this.update();
    }

    linked(i, j) {
      const a = this.screens[i], b = this.screens[j];
      return a.linkable && b.linkable && a.scene === b.scene && a.key === b.key;
    }

    openDoors(i) {
      return this.doors[i].filter((d) => this.linked(i, d.j) && this.screens[i].sides.includes(d.side) && this.screens[d.j].sides.includes(OPPOSITE[d.side]));
    }

    groups() {
      return components(this.screens.map((_, i) => this.openDoors(i)));
    }

    shares() {
      const shares = new Map();
      for (const group of this.groups()) {
        const members = group.map((i) => this.screens[i]);
        if (!members.every((s) => Object.keys(s.population).length)) continue;
        const known = members.every((s) => s.pxmm);
        const areas = members.map((s) => (s.w * s.h) / (known ? s.pxmm * s.pxmm : 1));
        const sum = areas.reduce((a, b) => a + b, 0);
        const totals = {};
        for (const s of members) for (const [k, n] of Object.entries(s.population)) totals[k] = (totals[k] || 0) + n;
        group.forEach((i, n) => {
          const share = {};
          for (const [k, t] of Object.entries(totals)) share[k] = (t * areas[n]) / sum;
          shares.set(i, share);
        });
      }
      return shares;
    }

    update() {
      const shares = this.shares();
      const surplus = (j) => {
        const c = this.screens[j].count;
        if (c === null || !shares.has(j)) return null;
        const out = {};
        for (const [k, share] of Object.entries(shares.get(j))) out[k] = round3((c[k] || 0) - share);
        return out;
      };
      this.screens.forEach((s, i) => {
        const open = this.openDoors(i).map((d) => ({ side: d.side, from: d.from, to: d.to, surplus: surplus(d.j) }));
        let share = null;
        if (shares.has(i)) {
          share = {};
          for (const [k, v] of Object.entries(shares.get(i))) share[k] = round3(v);
        }
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
        for (const kind of Object.keys(shares.get(group[0]))) {
          const count = (i) => this.screens[i].count[kind] || 0;
          const total = group.reduce((n, i) => n + (this.screens[i].population[kind] || 0), 0);
          const have = group.reduce((n, i) => n + count(i), 0);
          const step = have > total ? -1 : 1;
          const gap = (i) => count(i) - shares.get(i)[kind];
          for (let n = Math.abs(have - total); n > 0; n--) {
            const pick = group.reduce((a, b) => ((step < 0 ? gap(b) > gap(a) : gap(b) < gap(a)) ? b : a));
            this.screens[pick].page.populate(step, kind);
            this.screens[pick].count[kind] = count(pick) + step;
          }
        }
      }
      this.update();
    }

    handOff(i, { side, x, y, data }) {
      const s = this.screens[i];
      const along = side === "l" || side === "r" ? y : x;
      for (const d of this.openDoors(i)) {
        if (d.side === side && along >= d.from && along <= d.to) {
          const t = this.screens[d.j];
          const back = this.doors[d.j].find((e) => e.side === OPPOSITE[side] && e.j === i);
          t.page.arrive(OPPOSITE[side], ...through(side, x, y, s, t, d, back), data);
          const kind = data && typeof data === "object" && data.kind !== undefined ? String(data.kind) : "all";
          for (const [scr, step] of [[s, -1], [t, 1]]) if (scr.count !== null) scr.count[kind] = (scr.count[kind] || 0) + step;
          this.update();
          return;
        }
      }
      s.page.arrive(side, x, y, data);
    }
  }

  root.ScreensLayout = { doors, eyes, Layout, OPPOSITE };
  if (typeof module !== "undefined") module.exports = root.ScreensLayout;
})(typeof window !== "undefined" ? window : globalThis);
