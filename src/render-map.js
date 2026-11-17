'use strict';
// Static map art: pre-rendered ground layer, decals stamped into it, obstacle drawing, thumbnails.

function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

function buildArt(m) {
  const ground = renderGround(m);
  const art = { ground, gctx: ground.getContext('2d'), thumb: null };
  art.gctx.setTransform(GS, 0, 0, GS, 0, 0);
  art.thumb = renderThumb(m, ground);
  return art;
}

function renderGround(m) {
  const B = BIOMES[m.biome];
  const c = makeCanvas(W * GS, H * GS), g = c.getContext('2d');
  g.setTransform(GS, 0, 0, GS, 0, 0);
  const R = mulberry32((m.seed ^ 0x9e3779b9) >>> 0);
  const rr = (a, b) => a + R() * (b - a);

  g.fillStyle = B.ground; g.fillRect(0, 0, W, H);
  // large soft blotches
  for (let i = 0; i < 900; i++) {
    const x = R() * W, y = R() * H, r = rr(60, 280);
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    const col = B.blot[i % B.blot.length];
    grad.addColorStop(0, col); grad.addColorStop(1, col + '00');
    g.globalAlpha = rr(0.35, 0.7); g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  g.globalAlpha = 1;
  // speckle
  for (let i = 0; i < 26000; i++) {
    g.fillStyle = B.speck[i % B.speck.length]; g.globalAlpha = rr(0.15, 0.45);
    const s = rr(2, 5); g.fillRect(R() * W, R() * H, s, s);
  }
  g.globalAlpha = 1;

  g.drawImage(renderRelief(m), 0, 0, W, H);

  // biome ground detail
  g.lineCap = 'round';
  if (m.biome === 'forest' || m.biome === 'swamp') {
    for (let i = 0; i < 9000; i++) {
      const x = R() * W, y = R() * H, l = rr(4, 10);
      g.strokeStyle = R() < 0.5 ? B.speck[0] : B.speck[1]; g.globalAlpha = rr(0.25, 0.6); g.lineWidth = 1.6;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x - 3, y - l); g.moveTo(x, y); g.lineTo(x + 3, y - l * 0.8); g.stroke();
    }
    if (m.biome === 'forest') for (let i = 0; i < 500; i++) { g.fillStyle = pickR(R, ['#d8c75a', '#e6e2d0', '#b86a9c']); g.globalAlpha = 0.7; g.beginPath(); g.arc(R() * W, R() * H, 2.2, 0, TAU); g.fill(); }
  } else if (m.biome === 'desert') {
    for (let i = 0; i < 2600; i++) {
      const x = R() * W, y = R() * H, l = rr(30, 90);
      g.strokeStyle = R() < 0.6 ? '#e3cb98' : '#a88a52'; g.globalAlpha = rr(0.2, 0.45); g.lineWidth = rr(1.5, 3);
      g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + l / 2, y - rr(4, 10), x + l, y); g.stroke();
    }
  } else if (m.biome === 'urban') {
    // slab seams and cracks
    g.strokeStyle = '#4d4d48'; g.globalAlpha = 0.35; g.lineWidth = 2;
    for (let x = 0; x < W; x += 120) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
    for (let y = 0; y < H; y += 120) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    for (let i = 0; i < 900; i++) {
      let x = R() * W, y = R() * H; g.strokeStyle = '#3a3a37'; g.globalAlpha = rr(0.3, 0.6); g.lineWidth = rr(1, 2.5);
      g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < 5; k++) { x += rr(-25, 25); y += rr(-25, 25); g.lineTo(x, y); }
      g.stroke();
    }
    for (let i = 0; i < 60; i++) craterAt(g, R() * W, R() * H, rr(25, 60), R);
  } else if (m.biome === 'snow') {
    for (let i = 0; i < 700; i++) {
      const x = R() * W, y = R() * H, r = rr(30, 90);
      g.fillStyle = '#aebfcc'; g.globalAlpha = 0.18; g.beginPath(); g.ellipse(x + r * 0.15, y + r * 0.1, r, r * 0.45, 0, 0, TAU); g.fill();
      g.fillStyle = '#ffffff'; g.globalAlpha = 0.5; g.beginPath(); g.ellipse(x, y, r, r * 0.42, 0, 0, TAU); g.fill();
    }
  }
  g.globalAlpha = 1;
  if (m.biome === 'desert') for (let i = 0; i < 25; i++) craterAt(g, R() * W, R() * H, rr(25, 55), R);

  // swamp pools
  for (const p of m.pools) {
    const pr = mulberry32((p.seed * 1e9) >>> 0);
    g.fillStyle = B.bank; g.globalAlpha = 0.9;
    blob(g, p.x, p.y, p.r + 12, pr); g.fill();
    g.fillStyle = B.pool; g.globalAlpha = 1;
    blob(g, p.x, p.y, p.r, pr); g.fill();
    g.strokeStyle = B.waterHi; g.globalAlpha = 0.25; g.lineWidth = 2;
    for (let k = 0; k < 6; k++) { const a = pr() * TAU, d = pr() * p.r * 0.7; g.beginPath(); g.ellipse(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, 18, 6, 0, 0, TAU); g.stroke(); }
    g.globalAlpha = 1;
    for (let k = 0; k < 10; k++) { const a = pr() * TAU, d = pr() * p.r * 0.8; g.fillStyle = '#4d6b33'; g.beginPath(); g.arc(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, 7, 0.4, TAU - 0.2); g.fill(); }
    // reeds around the rim
    g.strokeStyle = '#6b7a3e'; g.lineWidth = 2;
    for (let k = 0; k < 40; k++) { const a = pr() * TAU, d = p.r + pr() * 24 - 6; const x = p.x + Math.cos(a) * d, y = p.y + Math.sin(a) * d; g.beginPath(); g.moveTo(x, y); g.lineTo(x + pr() * 6 - 3, y - 12 - pr() * 8); g.stroke(); }
  }

  // supply roads
  for (let t = 0; t < 2; t++) {
    const lane = m.truckLanes[t];
    const x0 = Math.min(lane.from, lane.to) - 20, x1 = Math.max(lane.from, lane.to) + 90;
    g.fillStyle = B.road; g.globalAlpha = 0.85;
    g.fillRect(t === 0 ? -10 : x0 - 60, lane.y - 34, t === 0 ? x1 + 10 : W - x0 + 70, 68);
    g.globalAlpha = 0.3; g.strokeStyle = '#000'; g.setLineDash([24, 18]); g.lineWidth = 2;
    g.beginPath(); g.moveTo(t === 0 ? 0 : x0 - 60, lane.y); g.lineTo(t === 0 ? x1 : W, lane.y); g.stroke(); g.setLineDash([]);
    g.globalAlpha = 1;
  }

  // rivers
  for (const r of m.rivers) {
    g.fillStyle = B.bank; g.fillRect(r.x - 12, r.y - (r.y > 0 ? 0 : 0), r.w + 24, r.h);
  }
  for (const b of m.bridges) { g.fillStyle = B.bank; g.fillRect(b.gap.x - 12, b.gap.y, b.gap.w + 24, b.gap.h); }
  for (const r of m.rivers.concat(m.bridges.map(b => b.gap))) {
    g.fillStyle = B.water; g.fillRect(r.x, r.y, r.w, r.h);
    g.strokeStyle = B.waterHi; g.globalAlpha = 0.35; g.lineWidth = 2;
    for (let y = r.y + 10; y < r.y + r.h; y += 34) { const off = (y * 7) % 40; g.beginPath(); g.moveTo(r.x + 10 + off * 0.5, y); g.quadraticCurveTo(r.x + r.w / 2, y + 8, r.x + r.w - 10, y); g.stroke(); }
    g.globalAlpha = 1;
  }

  // base zones
  for (let t = 0; t < 2; t++) {
    const x0 = t === 0 ? 0 : W - CFG.BASE_W;
    g.fillStyle = TEAMS[t].color; g.globalAlpha = 0.06; g.fillRect(x0, 0, CFG.BASE_W, H);
    g.globalAlpha = 0.5; g.strokeStyle = TEAMS[t].color; g.lineWidth = 4; g.setLineDash([30, 22]);
    const lx = t === 0 ? CFG.BASE_W : W - CFG.BASE_W;
    g.beginPath(); g.moveTo(lx, 0); g.lineTo(lx, H); g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
    // spawn pads
    m.spawns[t].forEach(s => {
      g.strokeStyle = TEAMS[t].color; g.globalAlpha = 0.55; g.lineWidth = 4;
      g.beginPath(); g.arc(s.x, s.y, 48, 0, TAU); g.stroke();
      g.globalAlpha = 0.18; g.fillStyle = TEAMS[t].color; g.fill();
      g.globalAlpha = 0.8; g.fillStyle = '#fff'; g.font = '600 18px "Chakra Petch", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(s.name.toUpperCase(), s.x, s.y + 66);
      g.globalAlpha = 1;
    });
    // depot pad
    const d = m.depots[t];
    g.fillStyle = '#6f6c64'; g.fillRect(d.x - 80, d.y - 60, 160, 120);
    g.strokeStyle = '#e6ad45'; g.lineWidth = 6; g.setLineDash([16, 12]); g.strokeRect(d.x - 80, d.y - 60, 160, 120); g.setLineDash([]);
    g.fillStyle = 'rgba(255,255,255,0.75)'; g.font = '700 20px "Chakra Petch", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('SUPPLY DEPOT', d.x, d.y - 40);
  }

  // building floors
  for (const f of m.floors) {
    g.fillStyle = FLOOR_COLORS[f.kind] || '#555'; g.fillRect(f.x, f.y, f.w, f.h);
    g.strokeStyle = 'rgba(0,0,0,0.18)'; g.lineWidth = 2;
    if (f.kind === 'concrete' || f.kind === 'adobe') { for (let x = f.x + 30; x < f.x + f.w; x += 30) { g.beginPath(); g.moveTo(x, f.y); g.lineTo(x, f.y + f.h); g.stroke(); } for (let y = f.y + 30; y < f.y + f.h; y += 30) { g.beginPath(); g.moveTo(f.x, y); g.lineTo(f.x + f.w, y); g.stroke(); } }
    else for (let y = f.y + 14; y < f.y + f.h; y += 14) { g.beginPath(); g.moveTo(f.x, y); g.lineTo(f.x + f.w, y); g.stroke(); }
  }

  // decorative bushes / shrubs (walkable)
  const bushN = { forest: 700, swamp: 400, snow: 250, desert: 160, urban: 90 }[m.biome];
  for (let i = 0; i < bushN; i++) {
    const x = R() * W, y = R() * H;
    if (m.move[((y / CELL) | 0) * GW + ((x / CELL) | 0)]) continue;
    const r = rr(10, 22);
    const col = m.biome === 'desert' ? '#8c8a4a' : m.biome === 'snow' ? '#5f7563' : m.biome === 'urban' ? '#57623f' : B.treeMid;
    g.fillStyle = 'rgba(0,0,0,0.2)'; g.beginPath(); g.arc(x + 5, y + 6, r, 0, TAU); g.fill();
    g.fillStyle = col; for (let k = 0; k < 4; k++) { g.beginPath(); g.arc(x + rr(-r, r) * 0.5, y + rr(-r, r) * 0.5, r * rr(0.5, 0.8), 0, TAU); g.fill(); }
    if (m.biome === 'snow') { g.fillStyle = 'rgba(255,255,255,0.7)'; g.beginPath(); g.arc(x - r * 0.25, y - r * 0.25, r * 0.4, 0, TAU); g.fill(); }
  }

  // obstacle shadows
  g.fillStyle = 'rgba(0,0,0,0.28)';
  for (const o of m.solids) {
    const off = o.kind === 'tree' || o.kind === 'pine' ? 14 : 8;
    g.beginPath();
    if (o.t === 'c') g.arc(o.x + off, o.y + off * 1.2, o.r * (o.kind === 'tree' || o.kind === 'pine' ? 1.05 : 0.95), 0, TAU);
    else g.rect(o.x + off, o.y + off, o.w, o.h);
    g.fill();
  }
  return c;
}
function pickR(R, arr) { return arr[Math.floor(R() * arr.length)]; }
function blob(g, x, y, r, R) {
  g.beginPath();
  const n = 14;
  for (let i = 0; i <= n; i++) {
    const a = i / n * TAU, rr = r * (0.85 + R() * 0.2);
    if (i === 0) g.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); else g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath();
}
function craterAt(g, x, y, r, R) {
  const grad = g.createRadialGradient(x, y, r * 0.2, x, y, r);
  grad.addColorStop(0, 'rgba(20,18,14,0.55)'); grad.addColorStop(0.7, 'rgba(30,26,20,0.25)'); grad.addColorStop(1, 'rgba(30,26,20,0)');
  g.fillStyle = grad; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
}

function renderThumb(m, ground) {
  const TW = 960, TH = 576, s = TW / W;
  const c = makeCanvas(TW, TH), g = c.getContext('2d');
  g.drawImage(ground, 0, 0, TW, TH);
  g.fillStyle = 'rgba(15,18,16,0.75)';
  for (const o of m.solids) {
    g.beginPath();
    if (o.t === 'c') g.arc(o.x * s, o.y * s, Math.max(1.2, o.r * s), 0, TAU); else g.rect(o.x * s, o.y * s, Math.max(1.5, o.w * s), Math.max(1.5, o.h * s));
    g.fill();
  }
  return c;
}

// ---- decals (stamped into the ground layer, persist for the match)
function stampBlood(art, x, y, r) {
  const g = art.gctx; g.fillStyle = 'rgba(110,10,10,0.55)';
  g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
}
function stampCasing(art, x, y) {
  const g = art.gctx; g.fillStyle = 'rgba(200,160,60,0.8)'; g.fillRect(x, y, 3, 1.6);
}
function stampBody(art, s) {
  const g = art.gctx;
  g.save(); g.translate(s.x, s.y); g.rotate(s.angle + Math.PI);
  g.fillStyle = 'rgba(100,8,8,0.6)'; g.beginPath(); g.ellipse(4, 2, 22, 16, 0.3, 0, TAU); g.fill();
  g.fillStyle = TEAMS[s.team].dark; g.globalAlpha = 0.85; g.beginPath(); g.ellipse(0, 0, 10, 13, 0, 0, TAU); g.fill();
  g.fillStyle = TEAMS[s.team].helmet; g.beginPath(); g.arc(-12, 0, 7, 0, TAU); g.fill();
  g.fillStyle = '#1b1d1c'; g.fillRect(6, 8, 24, 5);
  g.restore(); g.globalAlpha = 1;
}
function stampScorch(art, x, y, r) { craterAt(art.gctx, x, y, r, Math.random); }

// ---- obstacles (drawn every frame at full resolution)
function polyOf(o) {
  if (o.poly) return o.poly;
  const r = mulberry32((o.seed * 1e9) >>> 0);
  const n = 7 + Math.floor(r() * 4), p = [];
  for (let i = 0; i < n; i++) { const a = i / n * TAU + r() * 0.4, rr = o.r * (0.85 + r() * 0.22); p.push(Math.cos(a) * rr, Math.sin(a) * rr); }
  o.poly = p; return p;
}
function pathPoly(c, x, y, p, s = 1) {
  c.beginPath(); c.moveTo(x + p[0] * s, y + p[1] * s);
  for (let i = 2; i < p.length; i += 2) c.lineTo(x + p[i] * s, y + p[i + 1] * s);
  c.closePath();
}
function circle(c, x, y, r) { c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill(); }

function drawSolid(c, o, B) {
  const k = o.kind;
  if (k === 'tree') {
    const r = o.r;
    c.fillStyle = B.tree; circle(c, o.x, o.y, r);
    c.fillStyle = B.treeMid; circle(c, o.x - r * 0.15, o.y - r * 0.18, r * 0.74);
    c.fillStyle = B.treeHi; circle(c, o.x - r * 0.32, o.y - r * 0.34, r * 0.36);
  } else if (k === 'pine') {
    const r = o.r, n = 9;
    c.fillStyle = B.tree; c.beginPath();
    for (let i = 0; i < n * 2; i++) { const a = i / (n * 2) * TAU + o.seed * 3, rr = i % 2 ? r * 0.62 : r; c.lineTo(o.x + Math.cos(a) * rr, o.y + Math.sin(a) * rr); }
    c.closePath(); c.fill();
    c.fillStyle = B.treeMid; circle(c, o.x, o.y, r * 0.55);
    c.fillStyle = B.treeHi; c.globalAlpha = 0.85; circle(c, o.x - r * 0.25, o.y - r * 0.28, r * 0.42); c.globalAlpha = 1;
  } else if (k === 'rock' || k === 'ice' || k === 'rubble') {
    const p = polyOf(o);
    const base = k === 'ice' ? '#9fb3c2' : k === 'rubble' ? '#7d7a72' : B.rock;
    const hi = k === 'ice' ? '#d8e6ef' : k === 'rubble' ? '#9c988e' : B.rockHi;
    c.fillStyle = base; pathPoly(c, o.x, o.y, p); c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.3)'; c.lineWidth = 2; c.stroke();
    c.fillStyle = hi; pathPoly(c, o.x - o.r * 0.18, o.y - o.r * 0.2, p, 0.55); c.fill();
    if (k === 'rubble') { c.fillStyle = '#5f5c55'; circle(c, o.x + o.r * 0.3, o.y + o.r * 0.2, o.r * 0.25); }
  } else if (k === 'bag') {
    c.fillStyle = '#8c7a52'; c.beginPath(); c.ellipse(o.x, o.y, o.r + 1, o.r - 2, o.seed * 3, 0, TAU); c.fill();
    c.strokeStyle = 'rgba(40,30,15,0.5)'; c.lineWidth = 1.5; c.stroke();
    c.fillStyle = '#a8946a'; c.beginPath(); c.ellipse(o.x - 2, o.y - 3, o.r * 0.6, o.r * 0.4, o.seed * 3, 0, TAU); c.fill();
  } else if (k === 'crate') {
    c.fillStyle = '#7c5d35'; c.fillRect(o.x, o.y, o.w, o.h);
    c.strokeStyle = '#4a3820'; c.lineWidth = 3; c.strokeRect(o.x + 1.5, o.y + 1.5, o.w - 3, o.h - 3);
    c.beginPath(); c.moveTo(o.x + 3, o.y + 3); c.lineTo(o.x + o.w - 3, o.y + o.h - 3); c.moveTo(o.x + o.w - 3, o.y + 3); c.lineTo(o.x + 3, o.y + o.h - 3); c.stroke();
  } else if (WALL_COLORS[k]) {
    const [dk, lt] = WALL_COLORS[k];
    c.fillStyle = dk; c.fillRect(o.x, o.y, o.w, o.h);
    c.fillStyle = lt; c.fillRect(o.x + 2, o.y + 2, o.w - 4, o.h - 4);
    if (k === 'timber' || k === 'cabin' || k === 'hut') {
      c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = 1.5; c.beginPath();
      if (o.w > o.h) for (let x = o.x + 18; x < o.x + o.w; x += 18) { c.moveTo(x, o.y); c.lineTo(x, o.y + o.h); }
      else for (let y = o.y + 18; y < o.y + o.h; y += 18) { c.moveTo(o.x, y); c.lineTo(o.x + o.w, y); }
      c.stroke();
    }
    if (k === 'cabin' && B.weather === 'snow') { c.fillStyle = 'rgba(255,255,255,0.6)'; c.fillRect(o.x + 2, o.y + 2, o.w - 4, (o.h - 4) * 0.45); }
  } else if (k === 'log') {
    c.fillStyle = '#5a4128'; c.fillRect(o.x, o.y, o.w, o.h);
    c.fillStyle = '#6f5233'; if (o.w > o.h) c.fillRect(o.x, o.y + 3, o.w, o.h * 0.35); else c.fillRect(o.x + 3, o.y, o.w * 0.35, o.h);
    c.fillStyle = '#a98a5c';
    if (o.w > o.h) { c.beginPath(); c.ellipse(o.x, o.y + o.h / 2, 4, o.h / 2, 0, 0, TAU); c.ellipse(o.x + o.w, o.y + o.h / 2, 4, o.h / 2, 0, 0, TAU); c.fill(); }
    else { c.beginPath(); c.ellipse(o.x + o.w / 2, o.y, o.w / 2, 4, 0, 0, TAU); c.ellipse(o.x + o.w / 2, o.y + o.h, o.w / 2, 4, 0, 0, TAU); c.fill(); }
  } else if (k === 'car') {
    const hues = ['#6b2f25', '#3f4a57', '#5b5a3a', '#4b3b2f', '#2f3f35'];
    const col = hues[Math.floor(o.seed * hues.length)];
    c.fillStyle = '#1e1e1c'; c.fillRect(o.x - 2, o.y - 2, o.w + 4, o.h + 4);
    c.fillStyle = col; c.fillRect(o.x, o.y, o.w, o.h);
    c.fillStyle = 'rgba(30,40,45,0.9)';
    if (o.w > o.h) { c.fillRect(o.x + o.w * 0.25, o.y + 4, o.w * 0.18, o.h - 8); c.fillRect(o.x + o.w * 0.62, o.y + 4, o.w * 0.12, o.h - 8); }
    else { c.fillRect(o.x + 4, o.y + o.h * 0.25, o.w - 8, o.h * 0.18); c.fillRect(o.x + 4, o.y + o.h * 0.62, o.w - 8, o.h * 0.12); }
    c.fillStyle = 'rgba(0,0,0,0.35)'; circle(c, o.x + o.w * 0.5, o.y + o.h * 0.5, 6);
  } else if (k === 'barrier') {
    c.fillStyle = '#a7a296'; c.fillRect(o.x, o.y, o.w, o.h);
    c.fillStyle = '#c9c3b5'; c.fillRect(o.x + 2, o.y + 2, o.w - 4, o.h - 4);
    c.fillStyle = '#c0392b';
    if (o.w > o.h) for (let x = o.x + 6; x < o.x + o.w - 6; x += 16) c.fillRect(x, o.y + 3, 6, o.h - 6);
    else for (let y = o.y + 6; y < o.y + o.h - 6; y += 16) c.fillRect(o.x + 3, y, o.w - 6, 6);
  } else if (k === 'cactus') {
    c.fillStyle = '#4c6b2c'; circle(c, o.x, o.y, o.r);
    c.fillStyle = '#6f9145'; circle(c, o.x - 2, o.y - 2, o.r * 0.6);
    c.strokeStyle = '#e9e2bf'; c.lineWidth = 1; c.beginPath();
    for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; c.moveTo(o.x + Math.cos(a) * o.r, o.y + Math.sin(a) * o.r); c.lineTo(o.x + Math.cos(a) * (o.r + 4), o.y + Math.sin(a) * (o.r + 4)); }
    c.stroke();
  } else if (k === 'deadtree') {
    c.strokeStyle = '#3b3122'; c.lineWidth = 4; c.lineCap = 'round'; c.beginPath();
    for (let i = 0; i < 5; i++) { const a = o.seed * 7 + i * 1.3, l = o.r * 1.9; c.moveTo(o.x, o.y); c.lineTo(o.x + Math.cos(a) * l, o.y + Math.sin(a) * l); }
    c.stroke();
    c.fillStyle = '#4a3d2a'; circle(c, o.x, o.y, o.r);
    c.fillStyle = '#5e4f37'; circle(c, o.x - 2, o.y - 2, o.r * 0.55);
  } else if (k === 'snowwall') {
    c.fillStyle = '#b5c6d3'; c.fillRect(o.x, o.y, o.w, o.h);
    c.fillStyle = '#f4f8fa'; c.fillRect(o.x + 2, o.y + 2, o.w - 4, o.h - 6);
  } else {
    c.fillStyle = '#555'; if (o.t === 'c') circle(c, o.x, o.y, o.r); else c.fillRect(o.x, o.y, o.w, o.h);
  }
}

// Hill shading and contour lines from the height map (one pixel = 5 world px).
function renderRelief(m) {
  const S = 5, w = W / S, h = H / S;
  const c = makeCanvas(w, h), g = c.getContext('2d');
  const img = g.createImageData(w, h), d = img.data;
  const hs = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) hs[j * w + i] = heightAt(m, i * S + S / 2, j * S + S / 2);
  // box blur (3 passes) so bilinear facets don't show up as stair steps in the shading
  const tmp = new Float32Array(w * h), R = 3;
  for (let pass = 0; pass < 3; pass++) {
    for (let j = 0; j < h; j++) { let acc = 0; for (let i = -R; i <= R; i++) acc += hs[j * w + clamp(i, 0, w - 1)];
      for (let i = 0; i < w; i++) { tmp[j * w + i] = acc / (2 * R + 1); acc += hs[j * w + Math.min(w - 1, i + R + 1)] - hs[j * w + Math.max(0, i - R)]; } }
    for (let i = 0; i < w; i++) { let acc = 0; for (let j = -R; j <= R; j++) acc += tmp[clamp(j, 0, h - 1) * w + i];
      for (let j = 0; j < h; j++) { hs[j * w + i] = acc / (2 * R + 1); acc += tmp[Math.min(h - 1, j + R + 1) * w + i] - tmp[Math.max(0, j - R) * w + i]; } }
  }
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const k = j * w + i, v = hs[k];
    const l = hs[j * w + Math.max(0, i - 1)], r = hs[j * w + Math.min(w - 1, i + 1)];
    const u = hs[Math.max(0, j - 1) * w + i], dn = hs[Math.min(h - 1, j + 1) * w + i];
    const shade = ((l - r) + (u - dn)) * 14;          // light from the north-west
    let R = 0, Gc = 0, B = 0, A = 0;
    if (shade > 0) { R = Gc = B = 255; A = Math.min(0.32, shade * 0.5); }
    else { A = Math.min(0.4, -shade * 0.6); }
    const lvl = Math.floor(v * 2), lr = Math.floor(r * 2), ld = Math.floor(dn * 2);
    if (lvl !== lr || lvl !== ld) { R = Gc = B = 20; A = 0.28; }
    d[k * 4] = R; d[k * 4 + 1] = Gc; d[k * 4 + 2] = B; d[k * 4 + 3] = Math.round(A * 255);
  }
  g.putImageData(img, 0, 0);
  return c;
}
