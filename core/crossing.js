/**
 * A scene's half of animals swimming from one monitor to the next (core/app.js has the
 * protocol, wallpaper.py's Layout the host's half). It knows the doors, which side may send
 * (the fuller one, against each pond's share), which animal goes when this pond is over its
 * share, and the hand-off itself. While an animal crosses there is a copy on each side: the
 * one leaving swims on until it is out of sight, the one arriving until it is all in. Both
 * swim straight across: the scene leaves its own steering out and turns the animal toward
 * heading(a) at the same rate on both sides, so the two halves line up.
 *
 *   const cross = Wallpaper.crossing(api, {
 *     animals(),           // every animal the scene has
 *     kindOf(a),           // optional: what it counts as (default "all")
 *     counted(a),          // whether it counts toward this pond (say, not on its way out)
 *     settled(a),          // free to go through a door or be sent (not busy, rising, ...)
 *     head(a),             // [x, y] on screen
 *     dir(a),              // [dx, dy] on screen, the way it is going (it crosses only outward)
 *     outline(a),          // [[x, y], ...] on screen along the body, and
 *     reach(a),            //   how far past those its fins and wings stick out (px)
 *     pack(a),             // what the neighbour needs to carry on, in body lengths
 *     unpack(data, side, x, y, mirrored), // add what comes in by `side`, head at (x, y);
 *                          //   returns it (or a list, companions after it); mirrored: the
 *                          //   door shut on the way and it came back, so it is facing out
 *                          //   and should be flipped in the edge
 *     companions(a),       // optional: animals that go along (a calf), packed in pack(a)
 *   });
 *
 * Each step: cross.begin(); while steering each animal, cross.edge(a, side, along, margin)
 * says what an edge is to it ("open", "shut" or null for no door), cross.pull(a) where the
 * pond is sending it, cross.heading(a) the way to turn while crossing; after moving it,
 * cross.update(a, dt) (true: a leaving copy is out of sight, drop it); then cross.end().
 * The scene returns cross.arrive as its arrive().
 */
(() => {
  "use strict";

  const OPPOSITE = { l: "r", r: "l", t: "b", b: "t" };
  /** Straight out through each side, on screen. */
  const OUT = { l: [-1, 0], r: [1, 0], t: [0, -1], b: [0, 1] };
  /** A crossing that hasn't finished by now is let go (it turned back, or got stuck). */
  const GIVE_UP_S = 40;

  Wallpaper.crossing = (api, o) => {
    const { grid, links } = api;
    const kindOf = o.kindOf || (() => "all");
    let counts = {};
    /** By kind, while this pond is over its share: { animal, door } on its way out. */
    const migrants = {};

    const past = (side, x, y) => (side === "l" ? -x : side === "r" ? x - grid.W : side === "t" ? -y : y - grid.H);
    const alongOf = (side, x, y) => (side === "l" || side === "r" ? y : x);
    const finite = (v) => (Number.isFinite(v) ? v : null);
    const shareOf = (kind) => finite(links.share && links.share[kind]);
    const surplusOf = (d, kind) => finite(d.surplus && d.surplus[kind]);

    /** Only from the fuller pond of the two, so neither drifts far from its share. */
    function mayLeave(d, kind) {
      const mine = shareOf(kind), theirs = surplusOf(d, kind);
      if (mine === null || theirs === null) return true;
      return (counts[kind] || 0) - mine >= theirs;
    }

    function doorAt(side, along) {
      for (const d of links.doors) if (d.side === side && along >= d.from && along <= d.to) return d;
      return null;
    }

    /**
     * What the edge on `side` is to `a` at `along`: "open" if it may go through (at least
     * `margin` from the door's ends), "shut" if there is a door it can't use now, null if
     * there is no door.
     */
    function edge(a, side, along, margin = 0) {
      const d = doorAt(side, along);
      if (!d) return null;
      const roomy = along > d.from + margin && along < d.to - margin;
      return roomy && !a.crossing && o.settled(a) && mayLeave(d, kindOf(a)) ? "open" : "shut";
    }

    /** Where `a` is being sent, on screen (just past the middle of the door), or null. */
    function pull(a) {
      const m = migrants[kindOf(a)];
      if (!m || m.animal !== a) return null;
      return doorTarget(m.door);
    }

    function doorTarget(d) {
      const mid = (d.from + d.to) / 2, out = Math.min(grid.W, grid.H) * 0.25;
      return { l: [-out, mid], r: [grid.W + out, mid], t: [mid, -out], b: [mid, grid.H + out] }[d.side];
    }

    /** The way to turn while crossing (on screen), or null. */
    const heading = (a) => (a.crossing ? OUT[a.crossing.out ? a.crossing.side : OPPOSITE[a.crossing.side]] : null);

    /** While over its share, send one animal of each kind at a time to the emptiest neighbour. */
    function begin() {
      const all = o.animals();
      for (const kind of new Set([...Object.keys(counts), ...Object.keys(migrants)])) {
        const mine = shareOf(kind);
        let door = null, most = 1;
        if (mine !== null) {
          for (const d of links.doors) {
            const theirs = surplusOf(d, kind);
            const gap = theirs === null ? -Infinity : (counts[kind] || 0) - mine - theirs;
            if (gap > most) {
              most = gap;
              door = d;
            }
          }
        }
        if (!door) {
          delete migrants[kind];
          continue;
        }
        const was = migrants[kind] && migrants[kind].animal;
        const free = (a) => kindOf(a) === kind && !a.crossing && o.settled(a) && all.includes(a);
        let animal = was && free(was) ? was : null;
        if (!animal) {
          const [tx, ty] = doorTarget(door);
          let best = Infinity;
          for (const a of all) {
            if (!free(a)) continue;
            const [x, y] = o.head(a), d = Math.hypot(x - tx, y - ty);
            if (d < best) {
              best = d;
              animal = a;
            }
          }
        }
        if (animal) migrants[kind] = { animal, door };
        else delete migrants[kind];
      }
    }

    /** Whether all of `a` is past the edge on `side` (out), or clear inside it. */
    function whole(a, side, out) {
      const m = o.reach(a) + grid.cw;
      for (const [x, y] of o.outline(a)) {
        const d = past(side, x, y);
        if (out ? d < m : d > -m) return false;
      }
      return true;
    }

    /** After `a` has moved: finish a crossing, or start one through an open door. */
    function update(a, dt) {
      const c = a.crossing;
      if (c) {
        c.t += dt;
        if (c.out) return whole(a, c.side, true) || c.t > GIVE_UP_S;
        if (whole(a, c.side, false) || c.t > GIVE_UP_S) a.crossing = null;
        return false;
      }
      const [x, y] = o.head(a);
      const side = x < 0 ? "l" : x > grid.W ? "r" : y < 0 ? "t" : y > grid.H ? "b" : null;
      if (!side || edge(a, side, alongOf(side, x, y)) !== "open") return false;
      // Only on its way out: from above, perspective alone can carry a rising head past the edge.
      const [dx, dy] = o.dir(a);
      if (dx * OUT[side][0] + dy * OUT[side][1] > 0) handOff(a, side, x, y);
      return false;
    }

    function handOff(a, side, x, y) {
      const data = o.pack(a);
      data.kind = kindOf(a);
      data.side = side;
      links.send(side, x, y, data);
      for (const b of [a, ...(o.companions ? o.companions(a) : [])]) {
        if (o.counted(b)) counts[kindOf(b)] = (counts[kindOf(b)] || 0) - 1;
        b.crossing = { side, out: true, t: 0 };
      }
    }

    /** Something swims in by `side`, head at (x, y) in this monitor's px. */
    function arrive(side, x, y, data) {
      if (!data || !OUT[side] || !Number.isFinite(x) || !Number.isFinite(y)) return;
      // Back in by the side it left by: the door shut on the way.
      const got = o.unpack(data, side, x, y, data.side === side);
      if (!got) return;
      for (const b of [].concat(got)) b.crossing = { side, out: false, t: 0 };
      end();
    }

    /** Count by kind (a leaving copy doesn't count) and tell the host. */
    function end() {
      counts = {};
      for (const a of o.animals()) {
        if (!o.counted(a) || (a.crossing && a.crossing.out)) continue;
        const kind = kindOf(a);
        counts[kind] = (counts[kind] || 0) + 1;
      }
      links.count(counts);
    }

    return { begin, end, update, edge, pull, heading, arrive, past, OUT, OPPOSITE };
  };
})();
