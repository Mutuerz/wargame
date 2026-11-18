'use strict';
// Procedural map generator.
// Layout: west base (x < 600) | neutral zone (80%) | east base (x > 5400).
// The west half is generated, then copied with a 180-degree rotation around the map center,
// so both teams get an identical (point-symmetric) battlefield.

function generateMap(biomeKey, seed) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const density = attempt < 6 ? 1 : 0.7;
    const m = tryGenerate(biomeKey, (seed + attempt * 7919) >>> 0, density);
    buildGrids(m);
    if (checkConnectivity(m)) { m.seed = seed; finishMap(m); return m; }
  }
  const m = tryGenerate(biomeKey, seed >>> 0, 0.4);
  m.seed = seed;
  finishMap(m);
  return m;
}

function rotShape(o) {
  const r = Object.assign({}, o);
  if (o.t === 'c') { r.x = W - o.x; r.y = H - o.y; }
  else { r.x = W - o.x - o.w; r.y = H - o.y - o.h; }
  r.bb = shapeBB(r);
  return r;
}
const rotPt = p => Object.assign({}, p, { x: W - p.x, y: H - p.y });
function rotFloor(f) {
  const r = Object.assign({}, f, { x: W - f.x - f.w, y: H - f.y - f.h });
  if (f.stair) r.stair = { x0: W - f.stair.x0, y0: H - f.stair.y0, x1: W - f.stair.x1, y1: H - f.stair.y1, w: f.stair.w };
  return r;
}

function tryGenerate(bk, seed, density) {
  const R = mulberry32(seed);
  const rnd = (a, b) => a + R() * (b - a);
  const ri = (a, b) => Math.floor(rnd(a, b + 1));
  const S = [], pools = [], floors = [], clear = [];

  // --- Fixed features: river, bridge, depot, spawns, capture points
  const by = Math.round(rnd(0.36, 0.64) * H);
  const bridge = { x: 40, y: by - 46, w: 150, h: 92, cx: 115, cy: by, gap: { t: 'r', x: 60, y: by - 46, w: 110, h: 92, kind: 'gap', water: true } };
  const rivers = [
    { t: 'r', x: 60, y: 0, w: 110, h: by - 46, kind: 'river', water: true },
    { t: 'r', x: 60, y: by + 46, w: 110, h: H - (by + 46), kind: 'river', water: true },
  ];
  const depot = { x: 440, y: by };
  const spawns = [0.1, 0.3, 0.5, 0.7, 0.9].map((f, i) => {
    let x = Math.round(rnd(300, 530)), y = Math.round(clamp(f * H + rnd(-80, 80), 130, H - 130));
    if (Math.abs(y - by) < 180) x = 270;
    return { x, y, name: SPOT_NAMES[i], idx: i };
  });
  // A (and its mirror E) sits close to each base
  const p0 = { x: Math.round(rnd(0.17, 0.2) * W), y: Math.round(rnd(0.2, 0.3) * H) };
  if (R() < 0.5) p0.y = H - p0.y;
  const p1 = { x: Math.round(rnd(0.4, 0.44) * W), y: Math.round((p0.y < H / 2 ? rnd(0.64, 0.78) : rnd(0.22, 0.36)) * H) };
  const points = [
    { x: p0.x, y: p0.y, name: 'A' },
    { x: p1.x, y: p1.y, name: 'B' },
    { x: W / 2, y: H / 2, name: 'C' },
    { x: W - p1.x, y: H - p1.y, name: 'D' },
    { x: W - p0.x, y: H - p0.y, name: 'E' },
  ];

  clear.push({ x: p0.x, y: p0.y, r: CFG.CAP_R + 50 }, { x: p1.x, y: p1.y, r: CFG.CAP_R + 50 }, { x: W / 2, y: H / 2, r: CFG.CAP_R + 60 });
  spawns.forEach(s => clear.push({ x: s.x, y: s.y, r: 100 }));
  clear.push({ x: depot.x, y: depot.y, r: 140 });
  clear.push({ rect: true, x0: 150, y0: by - 75, x1: depot.x + 40, y1: by + 75 });

  let X0 = 640, X1 = W / 2 - 24;
  let uid = 0;

  function clearOK(b) {
    for (const c of clear) {
      if (c.rect) { if (b[2] > c.x0 && b[0] < c.x1 && b[3] > c.y0 && b[1] < c.y1) return false; }
      else {
        const cx = clamp(c.x, b[0], b[2]), cy = clamp(c.y, b[1], b[3]);
        if (dist2(cx, cy, c.x, c.y) < c.r * c.r) return false;
      }
    }
    return true;
  }
  function free(b, margin) {
    if (b[0] < X0 || b[2] > X1 || b[1] < 40 || b[3] > H - 40) return false;
    if (!clearOK(b)) return false;
    for (const s of S) {
      const q = s.bb;
      if (b[2] + margin > q[0] && b[0] - margin < q[2] && b[3] + margin > q[1] && b[1] - margin < q[3]) return false;
    }
    return true;
  }
  function add(o) { o.bb = shapeBB(o); o.id = uid++; o.seed = R(); S.push(o); return o; }
  function tryGroup(list, margin = 34) {
    const g = [Infinity, Infinity, -Infinity, -Infinity];
    for (const o of list) {
      const b = shapeBB(o);
      g[0] = Math.min(g[0], b[0]); g[1] = Math.min(g[1], b[1]); g[2] = Math.max(g[2], b[2]); g[3] = Math.max(g[3], b[3]);
    }
    if (!free(g, margin)) return false;
    list.forEach(add);
    if (list.floor) floors.push(list.floor);
    return true;
  }
  const circ = (x, y, r, kind) => ({ t: 'c', x, y, r, kind });
  const rect = (x, y, w, h, kind) => ({ t: 'r', x, y, w, h, kind });
  const rpos = () => [rnd(X0, X1), rnd(40, H - 40)];
  function scatter(n, maker, margin = 34) {
    const count = Math.round(n * density);
    for (let i = 0; i < count; i++) {
      for (let k = 0; k < 30; k++) { const [x, y] = rpos(); if (tryGroup(maker(x, y), margin)) break; }
    }
  }
  function cluster(n, k0, k1, spread, maker, margin = 30) {
    const count = Math.round(n * density);
    for (let i = 0; i < count; i++) {
      const [cx, cy] = rpos(); const k = ri(k0, k1);
      for (let j = 0; j < k; j++) {
        for (let t = 0; t < 8; t++) {
          const a = rnd(0, TAU), d = rnd(0, spread);
          if (tryGroup([maker(cx + Math.cos(a) * d, cy + Math.sin(a) * d)], margin)) break;
        }
      }
    }
  }
  function building(x, y, w, h, kind, th = 14) {
    const parts = [], door = 66;
    const doors = new Set([ri(0, 3)]);
    if (R() < 0.75) doors.add(ri(0, 3));
    for (const sd of [0, 1, 2, 3]) {
      const horiz = sd === 0 || sd === 2;
      const len = horiz ? w : h;
      const sx = sd === 1 ? x + w - th : x, sy = sd === 2 ? y + h - th : y;
      if (doors.has(sd) && len > door + 60) {
        const g = rnd(30, len - door - 30);
        if (horiz) { parts.push(rect(sx, sy, g, th, kind)); parts.push(rect(sx + g + door, sy, len - g - door, th, kind)); }
        else { parts.push(rect(sx, sy, th, g, kind)); parts.push(rect(sx, sy + g + door, th, len - g - door, kind)); }
      } else parts.push(horiz ? rect(sx, sy, len, th, kind) : rect(sx, sy, th, len, kind));
    }
    if (w > 150 && h > 140 && R() < 0.6) parts.push(rect(x + w / 2 - 17 + rnd(-30, 30), y + h / 2 - 17 + rnd(-25, 25), 34, 34, 'crate'));
    parts.floor = { x, y, w, h, kind };
    return parts;
  }
  const bagLine = (x, y, n, horiz) => {
    const out = [];
    for (let i = 0; i < n; i++) out.push(circ(horiz ? x + i * 22 : x, horiz ? y : y + i * 22, 13, 'bag'));
    return out;
  };
  const log = (x, y) => R() < 0.5 ? [rect(x, y, rnd(80, 140), 22, 'log')] : [rect(x, y, 22, rnd(80, 140), 'log')];

  // --- Capture point fortifications (the "specific spots")
  function ring(cx, cy, rad, arcs) {
    for (const [a0, len] of arcs) {
      const step = 22 / rad;
      for (let a = a0; a <= a0 + len + 1e-6; a += step) add(circ(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad, 13, 'bag'));
    }
  }
  for (const p of [p0, p1]) {
    const s0 = rnd(0, TAU);
    ring(p.x, p.y, 118, [[s0, 1.1], [s0 + 2.1, 1.1], [s0 + 4.2, 1.1]]);
    add(rect(p.x - 17 + Math.cos(s0 + 1.6) * 50, p.y - 17 + Math.sin(s0 + 1.6) * 50, 34, 34, 'crate'));
  }
  // the center point C is a two-storey house (added after the mirror step, since it sits on the center)

  // --- Houses: stone walls with windows you can shoot through; grenades and C4 break them.
  // Up to two storeys: two-storey houses get a staircase along one inside wall and windows all round upstairs.
  function house(x, y, w, h, opts = {}) {
    const parts = [], th = 14, seg = 40, door = 66, FH = CFG.FLOOR_H;
    const doors = opts.doors ? new Set(opts.doors) : new Set([ri(0, 3)]); if (!opts.doors && R() < 0.6) doors.add(ri(0, 3));
    const stories = opts.stories || (R() < CFG.TWO_STOREY ? 2 : 1);
    function walls(storey) {
      for (const sd of [0, 1, 2, 3]) {
        const horiz = sd === 0 || sd === 2, len = horiz ? w : h;
        const sx = sd === 1 ? x + w - th : x, sy = sd === 2 ? y + h - th : y;
        const gap = storey === 0 && doors.has(sd) ? rnd(seg, len - door - seg) : -1e9;
        let k = 0;
        for (let p = 0; p < len - 1; ) {
          if (p >= gap && p < gap + door) { p = gap + door; continue; }
          let l = Math.min(seg, len - p);
          if (p < gap && p + l > gap) l = gap - p;
          if (l < 6) { p += l; continue; }
          const win = k % (storey ? 2 : 3) === 1 && p > th && p + l < len - th;
          const r = horiz ? rect(sx + p, sy, l, th, win ? 'window' : 'hwall') : rect(sx, sy + p, th, l, win ? 'window' : 'hwall');
          r.breakable = true; if (win) r.window = true;
          r.z0 = storey * FH; r.z1 = r.z0 + FH;
          if (storey) r.up = true;
          parts.push(r); p += l; k++;
        }
      }
    }
    walls(0);
    let stair = null;
    if (stories === 2) {
      walls(1);
      // staircase along an inside wall without a door, climbing toward the middle of that wall
      const L = CFG.STAIR_LEN, SW = CFG.STAIR_W;
      const sides = [0, 1, 2, 3].filter(sd => ((sd === 0 || sd === 2) ? w : h) - 2 * th >= L + 95);
      const free = sides.filter(sd => !doors.has(sd));
      const sd = (free.length ? free : sides)[ri(0, (free.length ? free : sides).length - 1)];
      if (sd !== undefined) {
        const horiz = sd === 0 || sd === 2, len = horiz ? w : h;
        const a = th + 50 + rnd(0, Math.max(0, len - 2 * th - L - 95));   // offset of the bottom step along the wall
        const dir = R() < 0.5 ? 1 : -1;
        let x0, y0, x1, y1;
        if (horiz) {
          const yy = sd === 0 ? y + th + SW / 2 : y + h - th - SW / 2;
          const s0 = dir > 0 ? x + a : x + w - a;
          x0 = s0; x1 = s0 + dir * L; y0 = y1 = yy;
        } else {
          const xx = sd === 3 ? x + th + SW / 2 : x + w - th - SW / 2;
          const s0 = dir > 0 ? y + a : y + h - a;
          y0 = s0; y1 = s0 + dir * L; x0 = x1 = xx;
        }
        stair = { x0, y0, x1, y1, w: SW };
      }
    }
    parts.floor = { x, y, w, h, kind: 'house', stories: stair ? 2 : 1, stair };
    if (!stair) for (let i = parts.length - 1; i >= 0; i--) if (parts[i].up) parts.splice(i, 1);
    return parts;
  }
  scatter(3, (x, y) => house(x, y, ri(6, 8) * 40, ri(5, 6) * 40), 50);

  // --- Pools first (swamp), then biome features
  if (bk === 'swamp') {
    for (let i = 0; i < Math.round(16 * density); i++) {
      for (let k = 0; k < 20; k++) {
        const [x, y] = rpos(); const r = rnd(90, 210);
        const b = [x - r, y - r, x + r, y + r];
        if (b[0] < X0 || b[2] > X1 || !clearOK(b)) continue;
        if (pools.some(p => dist(p.x, p.y, x, y) < p.r + r - 40)) continue;
        pools.push({ t: 'c', x, y, r, seed: R() });
        break;
      }
    }
  }

  switch (bk) {
    case 'forest':
      cluster(26, 5, 12, 220, (x, y) => circ(x, y, rnd(17, 30), 'tree'), 28);
      scatter(40, (x, y) => [circ(x, y, rnd(18, 42), 'rock')]);
      scatter(14, log);
      scatter(4, (x, y) => building(x, y, rnd(140, 200), rnd(120, 170), 'timber', 12), 40);
      scatter(6, (x, y) => bagLine(x, y, ri(4, 6), R() < 0.5));
      break;
    case 'desert':
      cluster(30, 2, 5, 90, (x, y) => circ(x, y, rnd(24, 58), 'rock'), 34);
      scatter(70, (x, y) => [circ(x, y, rnd(10, 13), 'cactus')]);
      scatter(14, (x, y) => bagLine(x, y, ri(4, 7), R() < 0.5));
      scatter(9, (x, y) => building(x, y, rnd(140, 230), rnd(130, 200), 'adobe', 16), 40);
      break;
    case 'urban':
      scatter(28, (x, y) => building(x, y, rnd(170, 340), rnd(150, 300), 'concrete', 16), 44);
      scatter(30, (x, y) => [circ(x, y, rnd(14, 32), 'rubble')]);
      scatter(20, (x, y) => R() < 0.5 ? [rect(x, y, 72, 36, 'car')] : [rect(x, y, 36, 72, 'car')]);
      scatter(24, (x, y) => R() < 0.5 ? [rect(x, y, 64, 16, 'barrier')] : [rect(x, y, 16, 64, 'barrier')]);
      break;
    case 'snow':
      cluster(28, 5, 10, 200, (x, y) => circ(x, y, rnd(17, 28), 'pine'), 28);
      scatter(32, (x, y) => [circ(x, y, rnd(20, 50), 'ice')]);
      scatter(8, (x, y) => building(x, y, rnd(150, 220), rnd(130, 180), 'cabin', 12), 40);
      scatter(12, (x, y) => R() < 0.5 ? [rect(x, y, 110, 26, 'snowwall')] : [rect(x, y, 26, 110, 'snowwall')]);
      break;
    case 'swamp':
      cluster(30, 2, 5, 140, (x, y) => circ(x, y, rnd(12, 20), 'deadtree'), 30);
      scatter(9, (x, y) => building(x, y, rnd(120, 170), rnd(110, 160), 'hut', 10), 40);
      scatter(18, log);
      scatter(20, (x, y) => [circ(x, y, rnd(16, 30), 'rock')]);
      break;
  }

  // --- Props: the things you would find out there (vehicles, containers, camps, farms, streets)
  const along = (x, y, L, S, kind) => R() < 0.5 ? rect(x, y, L, S, kind) : rect(x, y, S, L, kind);
  const barrels = (x, y) => { const n = ri(3, 5), out = []; for (let i = 0; i < n; i++) out.push(circ(x + (i % 3) * 20, y + Math.floor(i / 3) * 20, 9, 'barrel')); return out; };
  const fence = (x, y) => [along(x, y, ri(3, 6) * 30, 6, 'fence')];
  const camp = (x, y) => [rect(x, y, 76, 56, 'tent'), ...barrels(x + 90, y + 10)];
  const P = {
    truck: (x, y) => [along(x, y, 120, 44, 'truck')], tank: (x, y) => [along(x, y, 104, 58, 'tank')],
    container: (x, y) => R() < 0.3 ? [along(x, y, 150, 42, 'container'), along(x, y + 46, 150, 42, 'container')].slice(0, 1) : [along(x, y, 150, 42, 'container')],
    hay: (x, y) => [circ(x, y, 15, 'hay'), circ(x + 32, y + rnd(-6, 6), 15, 'hay')], well: (x, y) => [circ(x, y, 18, 'well')],
    bus: (x, y) => [along(x, y, 160, 42, 'bus')], dumpster: (x, y) => [along(x, y, 54, 30, 'dumpster')], boat: (x, y) => [along(x, y, 74, 24, 'boat')],
    pole: (x, y) => [circ(x, y, 4, 'pole')], bunker: (x, y) => [along(x, y, 90, 64, 'bunker')],
  };
  const props = {
    forest: [[5, P.truck], [3, P.tank], [9, P.hay], [10, fence], [4, barrels], [8, P.pole], [3, camp], [3, P.bunker]],
    desert: [[5, P.tank], [5, P.truck], [7, P.container], [6, camp], [5, P.well], [5, barrels], [3, P.bunker]],
    urban: [[5, P.bus], [8, P.container], [10, P.dumpster], [6, barrels], [12, P.pole], [3, P.tank], [3, P.truck]],
    snow: [[5, P.truck], [3, P.tank], [6, camp], [9, fence], [4, barrels], [8, P.pole], [3, P.bunker]],
    swamp: [[8, P.boat], [4, P.truck], [8, fence], [4, barrels], [6, P.pole], [3, camp]],
  }[bk] || [];
  for (const [n, f] of props) scatter(n, f, 30);

  // --- Light cover inside the base
  X0 = 210; X1 = 600;
  scatter(5, (x, y) => R() < 0.5 ? [rect(x, y, 34, 34, 'crate'), rect(x + 36, y, 34, 34, 'crate')] : bagLine(x, y, ri(3, 5), R() < 0.5), 40);

  // --- Mirror (180-degree rotation)
  const solids = S.concat(S.map(rotShape));
  // center house over point C: doors facing both bases (west and east), stairs inside
  const ch = house(W / 2 - 160, H / 2 - 120, 320, 240, { doors: [1, 3], stories: 2 });
  for (const o of ch) { o.bb = shapeBB(o); o.seed = R(); solids.push(o); }
  // trees and cacti block only where the trunk is: the drawn trunk is about a third of the footprint the
  // placement used (vr keeps that size for drawing), so you no longer bump into thin air around them
  const TRUNK = { tree: 0.32, pine: 0.28, deadtree: 0.45, cactus: 0.75 };
  for (const o of solids) if (TRUNK[o.kind] && o.t === 'c') { o.vr = o.r; o.r = Math.max(4, o.r * TRUNK[o.kind]); o.bb = shapeBB(o); }
  solids.forEach((o, i) => { o.id = i; });
  const b1 = rotShape(bridge); b1.cx = W - bridge.cx; b1.cy = H - bridge.cy; b1.gap = rotShape(bridge.gap);
  return {
    biome: bk, seed,
    solids,
    rivers: rivers.concat(rivers.map(rotShape)),
    pools: pools.concat(pools.map(rotShape)),
    floors: floors.concat(floors.map(rotFloor), [ch.floor]),
    bridges: [Object.assign({}, bridge, { team: 0, destroyed: false }), Object.assign(b1, { team: 1, destroyed: false })],
    depots: [depot, rotPt(depot)],
    spawns: [spawns, spawns.map(rotPt)],
    points: points.map(p => Object.assign(p, { owner: -1, prog: 0, c0: 0, c1: 0 })),
    height: buildHeight(R),
    truckLanes: [{ y: by, from: -110, to: depot.x - 70, dir: 1 }, { y: H - by, from: W + 110, to: W - depot.x + 70, dir: -1 }],
  };
}

// Heights: flatten the ground under every building, then give each obstacle its vertical extent.
function finishMap(m) {
  const hm = m.height;
  for (const f of m.floors) {
    const pad = 30;
    const i0 = Math.max(0, Math.floor((f.x - pad) / CELL)), i1 = Math.min(GW - 1, Math.floor((f.x + f.w + pad) / CELL));
    const j0 = Math.max(0, Math.floor((f.y - pad) / CELL)), j1 = Math.min(GH - 1, Math.floor((f.y + f.h + pad) / CELL));
    let sum = 0, n = 0;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { sum += hm[j * GW + i]; n++; }
    const v = n ? sum / n : 0;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) hm[j * GW + i] = v;
    f.base = v * CFG.LEVEL_H;
    if (f.stair) {
      const st = f.stair, hw = st.w / 2;
      st.rx = Math.min(st.x0, st.x1) - (st.x0 === st.x1 ? hw : 0); st.ry = Math.min(st.y0, st.y1) - (st.y0 === st.y1 ? hw : 0);
      st.rw = Math.abs(st.x1 - st.x0) || st.w; st.rh = Math.abs(st.y1 - st.y0) || st.w;
    }
  }
  m.houses = m.floors.filter(f => f.kind === 'house');
  // sectors: the neutral zone is split between the five points (each cell belongs to its nearest point);
  // whoever holds a point controls its whole sector
  m.sector = new Uint8Array(NW * NH).fill(255);
  for (let j = 0; j < NH; j++) for (let i = 0; i < NW; i++) {
    const x = i * NC + NC / 2, y = j * NC + NC / 2;
    if (x < CFG.BASE_W || x > W - CFG.BASE_W) continue;
    let best = 0, bd = Infinity;
    m.points.forEach((p, k) => { const d = dist2(x, y, p.x, p.y); if (d < bd) { bd = d; best = k; } });
    m.sector[j * NW + i] = best;
  }
  m.solids.forEach((o, i) => {
    o.sid = i;
    if (o.z0 === undefined) o.z0 = 0;
    if (o.z1 === undefined) o.z1 = o.z0 + obstHeight(o);
    const c = o.t === 'c' ? [o.x, o.y] : [o.x + o.w / 2, o.y + o.h / 2];
    o.gz = elevAt(m, c[0], c[1]);
  });
  buildGrids(m);
}
// Index of the sector (point) at (x, y), or -1 inside the bases.
function sectorAt(m, x, y) {
  const i = clamp((x / NC) | 0, 0, NW - 1), j = clamp((y / NC) | 0, 0, NH - 1), v = m.sector[j * NW + i];
  return v === 255 ? -1 : v;
}
function sectorOwner(m, x, y) { const k = sectorAt(m, x, y); return k < 0 ? (x < W / 2 ? 0 : 1) : m.points[k].owner; }
function elevAt(m, x, y) { return heightAt(m, x, y) * CFG.LEVEL_H; }
// The house whose footprint contains (x, y), if any.
function houseAt(m, x, y) {
  for (const f of m.houses) if (x > f.x && x < f.x + f.w && y > f.y && y < f.y + f.h) return f;
  return null;
}
function inStair(st, x, y) { return x >= st.rx && x <= st.rx + st.rw && y >= st.ry && y <= st.ry + st.rh; }
// 0 at the bottom step, 1 at the top.
function stairT(st, x, y) {
  const dx = st.x1 - st.x0, dy = st.y1 - st.y0, l2 = dx * dx + dy * dy;
  return clamp(((x - st.x0) * dx + (y - st.y0) * dy) / l2, 0, 1);
}

function rasterShape(grid, o) {
  const b = shapeBB(o), pad = 3;
  const i0 = Math.max(0, Math.floor((b[0] - pad) / CELL)), i1 = Math.min(GW - 1, Math.floor((b[2] + pad) / CELL));
  const j0 = Math.max(0, Math.floor((b[1] - pad) / CELL)), j1 = Math.min(GH - 1, Math.floor((b[3] + pad) / CELL));
  let any = false;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const cx = i * CELL + CELL / 2, cy = j * CELL + CELL / 2;
    const inside = o.t === 'c' ? dist2(cx, cy, o.x, o.y) <= (o.r + pad) * (o.r + pad)
      : (cx >= o.x - pad && cx <= o.x + o.w + pad && cy >= o.y - pad && cy <= o.y + o.h + pad);
    if (inside) { grid[j * GW + i] = 1; any = true; }
  }
  if (!any) {
    const cx = o.t === 'c' ? o.x : o.x + o.w / 2, cy = o.t === 'c' ? o.y : o.y + o.h / 2;
    const i = clamp(Math.floor(cx / CELL), 0, GW - 1), j = clamp(Math.floor(cy / CELL), 0, GH - 1);
    grid[j * GW + i] = 1;
  }
}

// Builds collision/LOS/nav grids and the obstacle spatial hash. Call again when a bridge is destroyed.
function buildGrids(m) {
  m.move = new Uint8Array(GW * GH);
  m.shot = new Uint8Array(GW * GH);     // blocks sight at standing eye height on the ground
  m.shotHi = new Uint8Array(GW * GH);   // blocks sight at upper-floor eye height
  m.shotAny = new Uint8Array(GW * GH);  // anything a bullet could hit (quick reject)
  m.slow = new Uint8Array(GW * GH);
  m.blockers = m.solids.concat(m.rivers, m.bridges.filter(b => b.destroyed).map(b => b.gap));
  const eyeLo = CFG.EYE, eyeHi = CFG.FLOOR_H + CFG.EYE;
  for (const o of m.solids) {
    if (!o.up) rasterShape(m.move, o);
    rasterShape(m.shotAny, o);
    if (o.window) continue;
    if (!o.up && o.z1 >= eyeLo) rasterShape(m.shot, o);
    if (o.z0 <= eyeHi && o.z1 >= eyeHi) rasterShape(m.shotHi, o);
  }
  for (const o of m.rivers) rasterShape(m.move, o);
  for (const b of m.bridges) if (b.destroyed) rasterShape(m.move, b.gap);
  for (const p of m.pools) rasterShape(m.slow, { t: 'c', x: p.x, y: p.y, r: p.r - 12 });
  // dilated walk grid (used to keep smoothed paths away from walls)
  m.walk = new Uint8Array(GW * GH);
  for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
    if (!m.move[j * GW + i]) continue;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = i + di, jj = j + dj;
      if (ii >= 0 && jj >= 0 && ii < GW && jj < GH) m.walk[jj * GW + ii] = 1;
    }
  }
  // coarse nav grid: blocked if any of its 4 fine cells is blocked
  m.nav = new Uint8Array(NW * NH);
  for (let j = 0; j < NH; j++) for (let i = 0; i < NW; i++) {
    const fi = i * 2, fj = j * 2;
    m.nav[j * NW + i] = (m.move[fj * GW + fi] | m.move[fj * GW + fi + 1] | m.move[(fj + 1) * GW + fi] | m.move[(fj + 1) * GW + fi + 1]);
  }
  // spatial hash
  m.hash = Array.from({ length: HW * HH }, () => []);
  for (const o of m.blockers) {
    const b = shapeBB(o);
    const i0 = Math.max(0, Math.floor(b[0] / HC)), i1 = Math.min(HW - 1, Math.floor(b[2] / HC));
    const j0 = Math.max(0, Math.floor(b[1] / HC)), j1 = Math.min(HH - 1, Math.floor(b[3] / HC));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) m.hash[j * HW + i].push(o);
  }
}

function checkConnectivity(m) {
  const start = nearestNav(m, m.spawns[0][0].x, m.spawns[0][0].y);
  if (start < 0) return false;
  const seen = new Uint8Array(NW * NH);
  const q = [start]; seen[start] = 1;
  while (q.length) {
    const c = q.pop(); const cx = c % NW, cy = (c / NW) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= NW || ny >= NH) continue;
      const n = ny * NW + nx;
      if (seen[n] || m.nav[n]) continue;
      seen[n] = 1; q.push(n);
    }
  }
  const targets = [...m.spawns[0], ...m.spawns[1], ...m.points, ...m.depots,
    { x: m.bridges[0].cx, y: m.bridges[0].cy }, { x: m.bridges[1].cx, y: m.bridges[1].cy }];
  return targets.every(t => { const n = nearestNav(m, t.x, t.y); return n >= 0 && seen[n]; });
}

// Terrain height (0..HEIGHT_MAX levels) on the fine grid, point-symmetric like the rest of the map.
function buildHeight(R) {
  const hills = [];
  const n = 9 + Math.floor(R() * 5);
  for (let i = 0; i < n; i++) {
    const ridge = R() < 0.35;
    hills.push({ x: 700 + R() * (W / 2 - 700), y: R() * H, r: 260 + R() * 520, h: 0.8 + R() * 1.6, sx: ridge ? 2.2 : 1, a: R() * Math.PI });
  }
  const all = hills.concat(hills.map(h => Object.assign({}, h, { x: W - h.x, y: H - h.y })));
  const hm = new Float32Array(GW * GH);
  for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
    const x = i * CELL + CELL / 2, y = j * CELL + CELL / 2;
    let v = 0;
    for (const h of all) {
      const dx = x - h.x, dy = y - h.y, c = Math.cos(h.a), s = Math.sin(h.a);
      const u = (dx * c + dy * s) / (h.r * h.sx), w = (-dx * s + dy * c) / h.r;
      v += h.h * Math.exp(-(u * u + w * w) * 1.6);
    }
    hm[j * GW + i] = Math.min(CFG.HEIGHT_MAX, v);
  }
  return hm;
}
function heightAt(m, x, y) {
  const fx = clamp(x / CELL - 0.5, 0, GW - 1.001), fy = clamp(y / CELL - 0.5, 0, GH - 1.001);
  const i = fx | 0, j = fy | 0, tx = fx - i, ty = fy - j, hm = m.height;
  const a = hm[j * GW + i], b = hm[j * GW + i + 1], c = hm[(j + 1) * GW + i], d = hm[(j + 1) * GW + i + 1];
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}
