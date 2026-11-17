'use strict';
// Path finding (A* on the coarse grid), line of sight and collision.

function nearestNav(m, x, y) {
  const ci = clamp(Math.floor(x / NC), 0, NW - 1), cj = clamp(Math.floor(y / NC), 0, NH - 1);
  if (!m.nav[cj * NW + ci]) return cj * NW + ci;
  for (let r = 1; r < 8; r++) {
    let best = -1, bd = Infinity;
    for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) {
      if (i < 0 || j < 0 || i >= NW || j >= NH) continue;
      if (Math.abs(i - ci) !== r && Math.abs(j - cj) !== r) continue;
      if (m.nav[j * NW + i]) continue;
      const d = dist2(i * NC + NC / 2, j * NC + NC / 2, x, y);
      if (d < bd) { bd = d; best = j * NW + i; }
    }
    if (best >= 0) return best;
  }
  return -1;
}

const AS = { cur: 0 };
function astar(m, s, g) {
  const N = NW * NH;
  if (!AS.g) {
    AS.g = new Float32Array(N); AS.par = new Int32Array(N); AS.stamp = new Uint32Array(N); AS.closed = new Uint32Array(N);
    AS.heap = new Int32Array(N * 8); AS.hf = new Float32Array(N * 8);
  }
  const st = ++AS.cur, gArr = AS.g, par = AS.par, stamp = AS.stamp, closed = AS.closed, heap = AS.heap, hf = AS.hf;
  const gx = g % NW, gy = (g / NW) | 0;
  const h = i => { const dx = Math.abs(i % NW - gx), dy = Math.abs(((i / NW) | 0) - gy); return dx + dy - 0.5858 * Math.min(dx, dy); };
  let hs = 0;
  const push = (n, f) => {
    if (hs >= heap.length) return;
    let i = hs++;
    while (i > 0) { const p = (i - 1) >> 1; if (hf[p] <= f) break; heap[i] = heap[p]; hf[i] = hf[p]; i = p; }
    heap[i] = n; hf[i] = f;
  };
  const pop = () => {
    const top = heap[0]; const ln = heap[--hs], lf = hf[hs];
    let i = 0;
    while (true) {
      let c = 2 * i + 1; if (c >= hs) break;
      if (c + 1 < hs && hf[c + 1] < hf[c]) c++;
      if (hf[c] >= lf) break;
      heap[i] = heap[c]; hf[i] = hf[c]; i = c;
    }
    heap[i] = ln; hf[i] = lf;
    return top;
  };
  gArr[s] = 0; stamp[s] = st; par[s] = -1; push(s, h(s));
  let iter = 0, found = false;
  const nav = m.nav;
  while (hs > 0) {
    const c = pop();
    if (closed[c] === st) continue;
    closed[c] = st;
    if (c === g) { found = true; break; }
    if (++iter > 14000) break;
    const cx = c % NW, cy = (c / NW) | 0, gc = gArr[c];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= NW || ny >= NH) continue;
      const n = ny * NW + nx;
      if (nav[n] || closed[n] === st) continue;
      if (dx && dy && (nav[cy * NW + nx] || nav[ny * NW + cx])) continue;
      const ng = gc + (dx && dy ? 1.4142 : 1);
      if (stamp[n] !== st || ng < gArr[n]) { stamp[n] = st; gArr[n] = ng; par[n] = c; push(n, ng + h(n) * 1.05); }
    }
  }
  if (!found) return null;
  const cells = [];
  for (let c = g; c !== -1; c = par[c]) cells.push(c);
  cells.reverse();
  return cells;
}

function fineBlocked(grid, x, y) {
  if (x < 0 || y < 0 || x >= W || y >= H) return true;
  return grid[((y / CELL) | 0) * GW + ((x / CELL) | 0)] === 1;
}
// Clear for walking (uses dilated grid); ignores the first few pixels so a soldier hugging a wall can still plan.
function walkLine(m, x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy);
  const n = Math.ceil(len / 10);
  for (let k = 1; k <= n; k++) {
    const t = k / n;
    if (t * len < 18) continue;
    if (fineBlocked(m.walk, x0 + dx * t, y0 + dy * t)) return false;
  }
  return true;
}
function losClear(m, x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy);
  const n = Math.ceil(len / 12);
  for (let k = 1; k < n; k++) {
    const x = x0 + dx * k / n, y = y0 + dy * k / n;
    if (m.shot[((y / CELL) | 0) * GW + ((x / CELL) | 0)]) return false;
  }
  return true;
}

function findPath(m, sx, sy, tx, ty) {
  const s = nearestNav(m, sx, sy), g = nearestNav(m, tx, ty);
  if (s < 0 || g < 0) return null;
  if (s === g) return [{ x: tx, y: ty }];
  const cells = astar(m, s, g);
  if (!cells) return null;
  const pts = cells.map(c => ({ x: (c % NW) * NC + NC / 2, y: ((c / NW) | 0) * NC + NC / 2 }));
  if (!fineBlocked(m.move, tx, ty)) pts[pts.length - 1] = { x: tx, y: ty };
  // string pulling
  const out = [];
  let cur = { x: sx, y: sy }, i = 0;
  while (i < pts.length) {
    let j = Math.min(pts.length - 1, i + 24);
    while (j > i && !walkLine(m, cur.x, cur.y, pts[j].x, pts[j].y)) j--;
    out.push(pts[j]); cur = pts[j]; i = j + 1;
  }
  return out;
}

let qStamp = 1;
function forBlockersNear(m, x0, y0, x1, y1, fn) {
  qStamp++;
  const i0 = Math.max(0, Math.floor(x0 / HC)), i1 = Math.min(HW - 1, Math.floor(x1 / HC));
  const j0 = Math.max(0, Math.floor(y0 / HC)), j1 = Math.min(HH - 1, Math.floor(y1 / HC));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const list = m.hash[j * HW + i];
    for (let k = 0; k < list.length; k++) {
      const o = list[k];
      if (o._q === qStamp) continue;
      o._q = qStamp;
      fn(o);
    }
  }
}
function solidAt(m, x, y) {
  const i = Math.floor(x / HC), j = Math.floor(y / HC);
  if (i < 0 || j < 0 || i >= HW || j >= HH) return null;
  const list = m.hash[j * HW + i];
  for (let k = 0; k < list.length; k++) { const o = list[k]; if (!o.water && !o.window && pointInShape(o, x, y)) return o; }
  return null;
}

function collideCircle(m, s, R) {
  forBlockersNear(m, s.x - R, s.y - R, s.x + R, s.y + R, o => {
    if (o.t === 'c') {
      const dx = s.x - o.x, dy = s.y - o.y, d = Math.hypot(dx, dy), min = o.r + R;
      if (d < min) {
        if (d < 0.01) { s.x += min; return; }
        s.x = o.x + dx / d * min; s.y = o.y + dy / d * min;
      }
    } else {
      const cx = clamp(s.x, o.x, o.x + o.w), cy = clamp(s.y, o.y, o.y + o.h);
      const dx = s.x - cx, dy = s.y - cy, d2 = dx * dx + dy * dy;
      if (d2 < R * R) {
        if (d2 > 1e-4) { const d = Math.sqrt(d2); s.x = cx + dx / d * R; s.y = cy + dy / d * R; }
        else {
          const l = s.x - o.x, r = o.x + o.w - s.x, t = s.y - o.y, b = o.y + o.h - s.y, mn = Math.min(l, r, t, b);
          if (mn === l) s.x = o.x - R; else if (mn === r) s.x = o.x + o.w + R; else if (mn === t) s.y = o.y - R; else s.y = o.y + o.h + R;
        }
      }
    }
  });
  s.x = clamp(s.x, R, W - R); s.y = clamp(s.y, R, H - R);
}

function randomFreeNear(m, x, y, r, tries = 14) {
  for (let i = 0; i < tries; i++) {
    const a = Math.random() * TAU, d = Math.random() * r;
    const px = x + Math.cos(a) * d, py = y + Math.sin(a) * d;
    if (!fineBlocked(m.walk, px, py)) return { x: px, y: py };
  }
  return { x, y };
}
