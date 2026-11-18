'use strict';
// Per-frame rendering: world, effects, weather, HUD, minimap.

const cv = document.getElementById('game');
const ctx = cv.getContext('2d');
let VW = 0, VH = 0, DPR = 1, vignette = null;
const weather = [];

function resize() {
  DPR = Math.min(2, window.devicePixelRatio || 1);
  VW = window.innerWidth; VH = window.innerHeight;
  cv.width = Math.round(VW * DPR); cv.height = Math.round(VH * DPR);
  vignette = makeCanvas(Math.max(1, Math.round(VW / 2)), Math.max(1, Math.round(VH / 2)));
  const g = vignette.getContext('2d'), w = vignette.width, h = vignette.height;
  const grad = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
  grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(1, 'rgba(0,0,0,0.55)');
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
}
window.addEventListener('resize', resize);
resize();


// Top-down helpers used by the minimap and the full map (M).
function seen(x, y) { return isVisible(G.player.team, x, y); }
function bigMapRect() { const w = Math.min(VW - 80, (VH - 120) * W / H), h = w * H / W; return { x: (VW - w) / 2, y: (VH - h) / 2, w, h }; }
function mapToWorld(sx, sy) {
  const r = bigMapRect();
  if (sx < r.x || sy < r.y || sx > r.x + r.w || sy > r.y + r.h) return null;
  return { x: (sx - r.x) / r.w * W, y: (sy - r.y) / r.h * H };
}
function strikeAt(x, y) {
  return { x: clamp(x, CFG.STRIKE_W / 2, W - CFG.STRIKE_W / 2) - CFG.STRIKE_W / 2, y: clamp(y, CFG.STRIKE_H / 2, H - CFG.STRIKE_H / 2) - CFG.STRIKE_H / 2, w: CFG.STRIKE_W, h: CFG.STRIKE_H };
}
// Pixels on screen per radian at the screen center (for the crosshair spread).
function pxPerRad() { return (VH / 2) / Math.tan(R3.fov * Math.PI / 360); }

function render(dt) {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0, 0, VW, VH);
  if (!G) { ctx.fillStyle = '#0b0d0c'; ctx.fillRect(0, 0, VW, VH); return; }
  if (!R3.ok) {
    ctx.fillStyle = '#0b0d0c'; ctx.fillRect(0, 0, VW, VH);
    txt('This browser could not start WebGL, which the 3D view needs.', VW / 2, VH / 2, '600 18px "Chakra Petch", sans-serif', '#ff8a6e', 'center');
    return;
  }
  kcBegin();   // kill cam: pose the world as recorded for this frame only
  try { render3d(dt); } finally { kcEnd(); }
  const B = BIOMES[G.m.biome], P = G.player;
  ctx.fillStyle = B.tint; ctx.fillRect(0, 0, VW, VH);
  if (P.scoped && R3.zoom > 1.5) drawScope();
  else ctx.drawImage(vignette, 0, 0, VW, VH);
  if (KC.on) { kcOverlay(); return; }
  if (G.hurtT > 0) {
    ctx.globalAlpha = G.hurtT * 1.4;
    const g = ctx.createRadialGradient(VW / 2, VH / 2, Math.min(VW, VH) * 0.3, VW / 2, VH / 2, Math.max(VW, VH) * 0.7);
    g.addColorStop(0, 'rgba(160,0,0,0)'); g.addColorStop(1, 'rgba(160,0,0,0.6)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, VW, VH); ctx.globalAlpha = 1;
    // which way the hit came from
    if (G.hurtFrom !== undefined && P.alive) {
      const rel = angDiff(R3.look.yaw, G.hurtFrom), r = Math.min(VW, VH) * 0.22;
      ctx.globalAlpha = Math.min(1, G.hurtT * 2.2); ctx.strokeStyle = '#ff3b2f'; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.arc(VW / 2, VH / 2, r, rel - Math.PI / 2 - 0.35, rel - Math.PI / 2 + 0.35); ctx.stroke(); ctx.globalAlpha = 1;
    }
  }
  if (!P.alive && R3.death && R3.lastCam && R3.lastCam.dead) {
    const t = R3.death.t, a = Math.min(1, t * 1.5) * (t > 1.7 ? Math.max(0, (2.2 - t) / 0.5) : 1);
    const g = ctx.createRadialGradient(VW / 2, VH / 2, Math.min(VW, VH) * 0.15, VW / 2, VH / 2, Math.max(VW, VH) * 0.7);
    g.addColorStop(0, `rgba(60,0,0,${0.25 * a})`); g.addColorStop(1, `rgba(20,0,0,${0.85 * a})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, VW, VH);
    ctx.globalAlpha = a;
    txt('YOU WERE KILLED', VW / 2, VH * 0.42, '800 34px "Chakra Petch", sans-serif', '#ff5a4e', 'center', 'middle');
    const k = P.lastHitBy;
    if (k && k.team !== P.team) txt(`by ${k.name}${k.cls ? ' · ' + k.cls.name : ''}`, VW / 2, VH * 0.42 + 34, '500 16px "IBM Plex Mono", monospace', '#e3e7df', 'center', 'middle');
    ctx.globalAlpha = 1;
  }
  drawHUD();
}
function drawScope() {
  const r = Math.min(VW, VH) * 0.46, cx = VW / 2, cy = VH / 2;
  ctx.fillStyle = '#000';
  ctx.beginPath(); ctx.rect(0, 0, VW, VH); ctx.arc(cx, cy, r, 0, TAU, true); ctx.fill();
  const g = ctx.createRadialGradient(cx, cy, r * 0.8, cx, cy, r);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.75)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.9)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(cx - r, cy); ctx.lineTo(cx - 6, cy); ctx.moveTo(cx + 6, cy); ctx.lineTo(cx + r, cy);
  ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy - 6); ctx.moveTo(cx, cy + 6); ctx.lineTo(cx, cy + r); ctx.stroke();
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(cx - r, cy); ctx.lineTo(cx - r * 0.45, cy); ctx.moveTo(cx + r * 0.45, cy); ctx.lineTo(cx + r, cy); ctx.moveTo(cx, cy + r * 0.45); ctx.lineTo(cx, cy + r); ctx.stroke();
  ctx.fillStyle = '#ff3b2f'; ctx.beginPath(); ctx.arc(cx, cy, 1.8, 0, TAU); ctx.fill();
}

function spectateTarget() {
  const P = G.player;
  if (P.alive) return null;
  if (P.riding) return P.riding;
  const allies = G.soldiers.filter(s => s.alive && s.team === P.team);
  if (!allies.length) return null;
  G.specIdx = ((G.specIdx % allies.length) + allies.length) % allies.length;
  return allies[G.specIdx];
}


function panel(x, y, w, h) { ctx.fillStyle = 'rgba(12,16,14,0.72)'; ctx.fillRect(x, y, w, h); ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1); }
function txt(s, x, y, font, color, align = 'left', base = 'alphabetic') { ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = base; ctx.fillText(s, x, y); }

function drawHUD() {
  const P = G.player, m = G.m;
  const D = '"Chakra Petch", sans-serif', M = '"IBM Plex Mono", monospace';
  const small = VW < 760;

  // capture badges
  const NPT = m.points.length, bw = 50, gap = 8, total = NPT * bw + (NPT - 1) * gap, x0 = VW / 2 - total / 2, y0 = 12;
  panel(x0 - 128, y0, total + 256, bw);
  m.points.forEach((p, i) => {
    const x = x0 + i * (bw + gap), cxp = x + bw / 2, cyp = y0 + bw / 2;
    panel(x, y0, bw, bw);
    const col = p.owner >= 0 ? TEAMS[p.owner].color : '#77807a';
    ctx.globalAlpha = 0.25; ctx.fillStyle = col; circle(ctx, cxp, cyp, 19); ctx.globalAlpha = 1;
    if (Math.abs(p.prog) > 0.5) {
      ctx.strokeStyle = p.prog > 0 ? TEAMS[0].color : TEAMS[1].color; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(cxp, cyp, 21, -Math.PI / 2, -Math.PI / 2 + TAU * Math.abs(p.prog) / 100); ctx.stroke();
    }
    const contested = p.c0 > 0 && p.c1 > 0;
    txt(p.name, cxp, cyp + 1, `700 22px ${D}`, contested && Math.sin(G.time * 10) > 0 ? '#e6ad45' : '#fff', 'center', 'middle');
  });
  const held0 = m.points.filter(p => p.owner === 0).length, held1 = m.points.filter(p => p.owner === 1).length;
  txt(`BLUE  ${G.teams[0].points} pts`, x0 - 14, y0 + 24, `600 15px ${D}`, TEAMS[0].color, 'right');
  txt(`holds ${held0}/${NPT}`, x0 - 14, y0 + 44, `400 12px ${M}`, '#b4d8ff', 'right');
  txt(`${G.teams[1].points} pts  RED`, x0 + total + 14, y0 + 24, `600 15px ${D}`, TEAMS[1].color, 'left');
  txt(`holds ${held1}/${NPT}`, x0 + total + 14, y0 + 44, `400 12px ${M}`, '#ffc1b9', 'left');

  if (G.lock.team >= 0) {
    const left = CFG.WIN_HOLD - G.lock.t;
    txt(`${TEAMS[G.lock.team].name.toUpperCase()} WINS IN ${left.toFixed(1)} s`, VW / 2, y0 + bw + 26, `700 18px ${D}`, TEAMS[G.lock.team].color, 'center');
  }
  // top-left info
  if (!small) {
    panel(12, 12, 230, 112);
    txt(fmtTime(G.time), 24, 40, `700 22px ${D}`, '#fff');
    txt(`limit ${fmtTime(CFG.TIME_LIMIT)}`, 230, 40, `400 11px ${M}`, '#8e9b92', 'right');
    const myBridge = m.bridges[P.team];
    const sup = `Parachutes in ${Math.ceil(G.teams[P.team].paraT || 0)} s` + (myBridge.destroyed ? ' · no trucks' : ` · truck ${fmtTime(G.teams[P.team].supplyT)}`);
    txt(sup, 24, 64, `500 13px ${M}`, myBridge.destroyed ? '#ff5a4e' : '#e3e7df');
    const eb = m.bridges[1 - P.team];
    txt(eb.destroyed ? 'Enemy bridge: destroyed' : 'Enemy bridge: standing', 24, 86, `400 12px ${M}`, eb.destroyed ? '#7fd18b' : '#8e9b92');
    // the sector you are standing in and who controls it
    const sx = P.alive ? P.x : G.cam.x, sy = P.alive ? P.y : G.cam.y, sk = sectorAt(m, sx, sy);
    if (sk >= 0) {
      const o = m.points[sk].owner, oc = o >= 0 ? TEAMS[o].color : '#a8b0aa';
      txt(`Sector ${m.points[sk].name} · ${o < 0 ? 'neutral' : o === P.team ? 'ours' : 'enemy'}`, 24, 110, `600 13px ${D}`, oc);
    } else txt(sx < W / 2 ? 'Blue base' : 'Red base', 24, 110, `600 13px ${D}`, sx < W / 2 ? TEAMS[0].color : TEAMS[1].color);
  }

  // kill feed
  G.feed.forEach((f, i) => {
    ctx.globalAlpha = Math.min(1, f.t);
    txt(f.text, VW - 16, 28 + i * 20, `500 13px ${M}`, f.color, 'right');
  });
  ctx.globalAlpha = 1;

  // bottom-left: health, ammo, gear
  const by = VH - 108;
  panel(12, by, 300, 96);
  const hpF = P.alive ? P.hp / maxHp(P) : 0;
  txt('HEALTH', 24, by + 22, `600 11px ${D}`, '#8e9b92');
  ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(24, by + 28, 160, 10);
  ctx.fillStyle = hpF > 0.5 ? '#7fd18b' : hpF > 0.25 ? '#e6ad45' : '#ff5a4e'; ctx.fillRect(24, by + 28, 160 * hpF, 10);
  txt(String(Math.ceil(P.hp)), 192, by + 38, `600 14px ${M}`, '#fff');
  txt(String(P.mag), 24, by + 82, `700 40px ${D}`, P.mag === 0 ? '#ff5a4e' : '#fff');
  txt(`/ ${P.cls.mag}`, 78, by + 82, `500 14px ${M}`, '#8e9b92');
  // magazines
  for (let i = 0; i < Math.max(P.cls.mags, P.mags.length); i++) {
    const mx = 128 + i * 18, my = by + 52;
    ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1; ctx.strokeRect(mx + 0.5, my + 0.5, 12, 30);
    const r = P.mags[i] || 0;
    if (r > 0) { ctx.fillStyle = '#e6ad45'; const hh = 28 * r / P.cls.mag; ctx.fillRect(mx + 2, my + 2 + 28 - hh, 9, hh); }
  }
  txt('MAGS', 128, by + 48, `600 10px ${D}`, '#8e9b92');
  if (P.reloading) {
    txt('RELOADING', 196, by + 64, `600 11px ${D}`, '#e6ad45');
    ctx.fillStyle = 'rgba(255,255,255,0.1)'; ctx.fillRect(196, by + 70, 100, 6);
    ctx.fillStyle = '#e6ad45'; ctx.fillRect(196, by + 70, 100 * (1 - P.reloadT / P.reloadMax), 6);
  } else if (P.mag === 0 && !P.mags.length) txt('OUT OF AMMO', 196, by + 70, `600 11px ${D}`, '#ff5a4e');
  else if (P.mag < 8 && P.mags.length) txt('R  RELOAD', 196, by + 70, `600 11px ${D}`, '#e6ad45');
  txt(`C4 ×${P.c4}`, 196, by + 90, `600 12px ${M}`, P.c4 ? '#e6ad45' : '#5d665f');
  txt(`G ×${P.nades}`, 250, by + 90, `600 12px ${M}`, P.nades ? '#e6ad45' : '#5d665f');
  txt(`${P.slot ? 2 : 1} · ` + P.cls.name.toUpperCase() + (P.scoped ? '  · SCOPED' : P.ads ? '  · AIMING' : '') + (P.crouch ? '  · CROUCHED' : '') + (P.para > 0 ? `  · PARACHUTE ${Math.ceil(P.para / 20)} m` : ''), 24, by - 8, `700 12px ${D}`, P.scoped ? '#e6ad45' : '#cfd5cc');
  if (P.alive) {
    const sf = slopeFactor(P);
    if (sf < 1) txt('▼ DOWNHILL  aim +10%', 312, by - 8, `600 12px ${D}`, '#7fd18b', 'right');
    else if (sf > 1) txt('▲ UPHILL  aim −20%', 312, by - 8, `600 12px ${D}`, '#ff8a6e', 'right');
  }
  txt(`${P.points} pts`, 296, by + 22, `500 12px ${M}`, '#e6ad45', 'right');

  // minimap
  const mmW = small ? 180 : 288, mmH = mmW * H / W, mx = VW - mmW - 12, my = VH - mmH - 12;
  drawMap(ctx, mx, my, mmW, mmH, false);

  // interaction prompt
  if (P.alive && !G.auto) {
    const a = availableAction(P);
    let prompt = null;
    if (a && a.type === 'plant') prompt = 'Hold F to plant C4 on the bridge';
    else if (a && a.type === 'defuse') prompt = 'Hold F to defuse the C4';
    else if (P.c4 > 0) { const eb = m.bridges[1 - P.team]; if (!eb.destroyed && dist(P.x, P.y, eb.cx, eb.cy) < 400) prompt = 'Stand on the marked bridge section to plant C4'; }
    if (prompt) {
      txt(prompt, VW / 2, VH - 150, `600 16px ${D}`, '#e6ad45', 'center');
      if (P.act) { ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(VW / 2 - 100, VH - 140, 200, 8); ctx.fillStyle = '#e6ad45'; ctx.fillRect(VW / 2 - 100, VH - 140, 200 * P.actT / CFG.C4_PLANT, 8); }
    }
  }
  drawCaptureProgress(D, M);
  drawKillFx(D);
  drawKillList(D);
  // message
  if (G.msg) {
    ctx.globalAlpha = Math.min(1, G.msg.t * 1.5);
    txt(G.msg.text, VW / 2, G.capPanel ? Math.max(VH * 0.24, 196) : VH * 0.24, `700 ${small ? 18 : 26}px ${D}`, G.msg.color, 'center');
    ctx.globalAlpha = 1;
  }
  // crosshair
  if (P.alive && !G.auto && !G.paused && !(P.scoped && R3.zoom > 1.5)) {
    const moving = Math.hypot(P.vx, P.vy) > 20, mx = VW / 2, my = VH / 2;
    const sp = currentSpread(P, moving);
    const gapPx = 4 + sp * pxPerRad();
    const noX = !!P.cls.hipSpread && !P.scoped;   // sniper from the hip: no crosshair at all, you guess
    if (!noX) {
    ctx.strokeStyle = G.hitT > 0 ? '#ff5a4e' : 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2;
    ctx.globalAlpha = P.ads ? 0.25 : 1;   // the sights do the aiming
    ctx.beginPath();
    ctx.moveTo(mx - gapPx - 8, my); ctx.lineTo(mx - gapPx, my);
    ctx.moveTo(mx + gapPx, my); ctx.lineTo(mx + gapPx + 8, my);
    ctx.moveTo(mx, my - gapPx - 8); ctx.lineTo(mx, my - gapPx);
    ctx.moveTo(mx, my + gapPx); ctx.lineTo(mx, my + gapPx + 8);
    ctx.stroke(); ctx.globalAlpha = 1;
    ctx.fillStyle = P.ads ? '#ff5a4e' : 'rgba(255,255,255,0.9)'; ctx.fillRect(mx - 1, my - 1, 2, 2);
    if (P.steady) {   // the next shot goes exactly where the dot is
      ctx.strokeStyle = 'rgba(127,209,139,0.95)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(mx, my, 3.5, 0, TAU); ctx.stroke();
    }
    }
    if (G.hitT > 0) {   // hit marker (bigger for headshots)
      const k = (G.headT || 0) > 0 ? 13 : 9;
      ctx.strokeStyle = (G.headT || 0) > 0 ? '#ffd27a' : '#ffffff'; ctx.lineWidth = 2; ctx.beginPath();
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { ctx.moveTo(mx + sx * 4, my + sy * 4); ctx.lineTo(mx + sx * k, my + sy * k); }
      ctx.stroke();
    }
    // shotgun: a small mark where each pellet struck (yellow on the head), popping in and fading out
    if (G.pelHits && G.pelHits.length && R3.ok) {
      const v3 = new THREE.Vector3();
      ctx.lineWidth = 2;
      for (const h of G.pelHits) {
        v3.set(h.x, h.z, h.y).project(cam3);
        if (v3.z > 1 || Math.abs(v3.x) > 1.1 || Math.abs(v3.y) > 1.1) continue;
        const sx = (v3.x + 1) / 2 * VW, sy = (1 - v3.y) / 2 * VH, a = Math.min(1, h.t / 0.25), k = 3 + (0.5 - h.t) * 6;
        ctx.globalAlpha = a; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(sx - k, sy - k); ctx.lineTo(sx + k, sy + k); ctx.moveTo(sx + k, sy - k); ctx.lineTo(sx - k, sy + k); ctx.stroke();
        ctx.strokeStyle = h.head ? '#ffd27a' : '#ffffff'; ctx.lineWidth = 2; ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    if (P.reloading) { ctx.strokeStyle = '#e6ad45'; ctx.beginPath(); ctx.arc(mx, my, gapPx + 14, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - P.reloadT / P.reloadMax)); ctx.stroke(); }
    if (P.z > 2) txt(P.z >= CFG.FLOOR_H - 1 ? 'UPPER FLOOR' : 'STAIRS', 312, VH - 116 - 20, `600 11px ${D}`, '#b4d8ff', 'right');
  }
  if (G.headT > 0) G.headT -= 1 / 60;
  if (!G.over && !G.paused && !G.auto && !document.pointerLockElement && !lockFailed && !G.showMap && $('perks').hidden && (P.alive || P.riding))
    txt('Click to aim with the mouse', VW / 2, VH / 2 + 60, `700 18px ${D}`, '#e6ad45', 'center');
  // air strike status
  const myT = G.teams[P.team];
  if (G.targeting) txt(`AIR STRIKE: click to mark the target${G.showMap ? '' : ' (M to aim on the map)'} · Esc cancels`, VW / 2, VH - 180, `700 16px ${D}`, '#e6ad45', 'center');
  else if (!G.auto && canStrike(P.team)) txt('B  AIR STRIKE READY', 24, by - 28, `700 12px ${D}`, '#e6ad45');
  else if (!G.auto && !G.strikes.some(s => s.team === P.team)) txt(`Air strike at ${CFG.STRIKE_COST} pts`, 24, by - 28, `500 11px ${M}`, '#5d665f');
  if (G.showMap) {
    const r = bigMapRect();
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0, 0, VW, VH);
    drawMap(ctx, r.x, r.y, r.w, r.h, true);
    if (G.targeting) {
      const w = mapToWorld(mouse.x, mouse.y);
      if (w) { const sr = strikeAt(w.x, w.y), s = r.w / W; ctx.strokeStyle = '#e6ad45'; ctx.lineWidth = 2; ctx.strokeRect(r.x + sr.x * s, r.y + sr.y * s, sr.w * s, sr.h * s); }
    }
  }
  if (G.showScores) drawScores();
}

// Fixed panel while you stand on a capture point: who is there and how far the capture has gone.
function drawCaptureProgress(D, M) {
  const P = G.player, m = G.m;
  G.capPanel = false;
  if (!P.alive) return;
  const sk = P.para > 0 ? -1 : sectorAt(m, P.x, P.y), p = sk >= 0 ? m.points[sk] : null;
  if (!p) return;
  G.capPanel = true;
  const mine = P.team, us = mine === 0 ? p.c0 : p.c1, them = mine === 0 ? p.c1 : p.c0;
  const prog = mine === 0 ? p.prog : -p.prog;      // +100 = ours, -100 = theirs
  let label, col;
  const edge = us - them, spd = capSpeed(Math.abs(edge));
  if (us && us === them) { label = `SECTOR ${p.name} · CONTESTED`; col = '#e6ad45'; }
  else if (edge < 0) { label = `SECTOR ${p.name} · ENEMY ${prog > -99.9 ? 'TAKING IT' : 'HOLDS IT'}  ${spd.toFixed(1)}×`; col = TEAMS[1 - mine].color; }
  else if (p.owner === mine && prog >= 99.9) { label = `SECTOR ${p.name} · HOLDING`; col = TEAMS[mine].color; }
  else if (p.owner === 1 - mine) { label = `SECTOR ${p.name} · NEUTRALIZING  ${spd.toFixed(1)}×`; col = '#e3e7df'; }
  else { label = `SECTOR ${p.name} · CAPTURING  ${spd.toFixed(1)}×`; col = TEAMS[mine].color; }
  const w = Math.min(420, VW - 40), h = 62, x = VW / 2 - w / 2, y = 96;
  panel(x, y, w, h);
  txt(label, x + 14, y + 22, `700 15px ${D}`, col);
  txt(`${us} ours · ${them} enemy`, x + w - 14, y + 22, `500 12px ${M}`, '#cfd5cc', 'right');
  // bar: left half fills toward the enemy, right half toward us, from the neutral middle
  const bx = x + 14, bw = w - 28, by2 = y + 34, bh = 14, mid = bx + bw / 2;
  ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(bx, by2, bw, bh);
  const f = clamp(prog / 100, -1, 1);
  ctx.fillStyle = f >= 0 ? TEAMS[mine].color : TEAMS[1 - mine].color;
  if (f >= 0) ctx.fillRect(mid, by2, bw / 2 * f, bh); else ctx.fillRect(mid + bw / 2 * f, by2, -bw / 2 * f, bh);
  ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillRect(mid - 1, by2 - 3, 2, bh + 6);
  txt(`${Math.round(Math.abs(prog))}%`, mid, by2 + bh + 12, `600 11px ${M}`, '#fff', 'center');
}
// Kill list, bottom centre: who you killed and from how far. Each line shows for 4 s; a multi-kill stacks its
// lines (newest at the bottom, with its chain number), the older ones slide up and fade first.
function drawKillList(D) {
  const L = G.killList;
  if (!L || !L.length) return;
  const now = performance.now() / 1000;
  while (L.length && now - L[0].at > 4) L.shift();
  ctx.save(); ctx.textBaseline = 'middle';
  for (let i = 0; i < L.length; i++) {
    const k = L[i], age = now - k.at, a = Math.min(1, age * 6, (4 - age) * 2), slot = L.length - 1 - i;
    const y = VH - 44 - slot * 26 + Math.max(0, 0.15 - age) * 60;
    const main = `${k.name}   ${k.dist} m`, tag = k.head ? 'HEADSHOT' : '', chain = k.n > 1 ? `×${k.n}` : '';
    ctx.font = `700 16px ${D}`; const wm = ctx.measureText(main).width;
    ctx.font = `800 13px ${D}`; const wt = tag ? ctx.measureText(tag).width + 12 : 0, wc = chain ? ctx.measureText(chain).width + 12 : 0;
    const w = 34 + wm + wt + wc, x0 = VW / 2 - w / 2;
    ctx.globalAlpha = a * 0.55; ctx.fillStyle = '#000'; ctx.fillRect(x0 - 8, y - 12, w + 16, 24);
    ctx.globalAlpha = a;
    ctx.fillStyle = '#ff5a4e'; ctx.font = `800 15px ${D}`; ctx.textAlign = 'left'; ctx.fillText('✕', x0, y + 1);
    ctx.fillStyle = '#ffffff'; ctx.font = `700 16px ${D}`; ctx.fillText(main, x0 + 24, y + 1);
    let x = x0 + 24 + wm + 12;
    if (tag) { ctx.fillStyle = '#ffd27a'; ctx.font = `800 13px ${D}`; ctx.fillText(tag, x, y + 1); x += wt; }
    if (chain) { ctx.fillStyle = '#ffad45'; ctx.font = `800 13px ${D}`; ctx.fillText(chain, x, y + 1); }
  }
  ctx.restore();
}
// Big kill callout in the middle of the screen.
function drawKillFx(D) {
  const k = G.killFx;
  if (!k) return;
  const now = performance.now() / 1000;
  if (k.at === undefined) k.at = now;
  k.t = k.max - (now - k.at);
  if (k.t <= 0) { G.killFx = null; return; }
  const age = k.max - k.t, pop = 1 + Math.max(0, 0.35 - age) * 1.6, a = Math.min(1, k.t * 2.5);
  const big = k.n > 1, size = (big ? 34 + k.n * 4 : 22) * pop;
  const cols = ['#ffffff', '#ffffff', '#ffd27a', '#ffad45', '#ff7a45', '#ff3b2f'];
  ctx.save();
  ctx.globalAlpha = a;
  ctx.shadowColor = 'rgba(0,0,0,0.85)'; ctx.shadowBlur = 10;
  txt(k.text, VW / 2, VH * 0.36, `800 ${Math.round(size)}px ${D}`, cols[k.n], 'center', 'middle');
  if (big) {
    ctx.shadowBlur = 0;
    for (let i = 0; i < k.n; i++) {   // one skull pip per kill in the chain
      const px = VW / 2 + (i - (k.n - 1) / 2) * 22, py = VH * 0.36 + size * 0.7;
      ctx.fillStyle = cols[k.n]; ctx.beginPath(); ctx.arc(px, py, 6, 0, TAU); ctx.fill();
    }
  }
  ctx.restore();
}
// Sector ownership overlay (cached until an owner changes).
function sectorLayer() {
  const m = G.m, key = m.points.map(p => p.owner).join(',');
  if (G.secKey === key && G.secCv) return G.secCv;
  const c = G.secCv || (G.secCv = makeCanvas(NW, NH)), g = c.getContext('2d'), img = g.createImageData(NW, NH);
  const rgb = TEAMS.map(t => [parseInt(t.color.slice(1, 3), 16), parseInt(t.color.slice(3, 5), 16), parseInt(t.color.slice(5, 7), 16)]);
  for (let j = 0; j < NH; j++) for (let i = 0; i < NW; i++) {
    const v = m.sector[j * NW + i], o = v === 255 ? -1 : m.points[v].owner, q = (j * NW + i) * 4;
    // borders between sectors are drawn as thin light lines
    const edge = v !== 255 && ((i + 1 < NW && m.sector[j * NW + i + 1] !== v) || (j + 1 < NH && m.sector[(j + 1) * NW + i] !== v));
    if (edge) { img.data[q] = img.data[q + 1] = img.data[q + 2] = 235; img.data[q + 3] = 110; continue; }
    if (o < 0) continue;
    img.data[q] = rgb[o][0]; img.data[q + 1] = rgb[o][1]; img.data[q + 2] = rgb[o][2]; img.data[q + 3] = 60;
  }
  g.putImageData(img, 0, 0);
  G.secKey = key;
  return c;
}

// Map view used by minimap and the M overlay
function drawMap(c, x, y, w, h, big) {
  const m = G.m, s = w / W, P = G.player;
  c.save();
  c.fillStyle = '#000'; c.fillRect(x - 2, y - 2, w + 4, h + 4);
  c.drawImage(G.art.thumb, x, y, w, h);
  c.beginPath(); c.rect(x, y, w, h); c.clip();
  if (m.sector) { c.imageSmoothingEnabled = false; c.drawImage(sectorLayer(), x, y, w, h); c.imageSmoothingEnabled = true; }
  // bridges / depots
  for (const b of m.bridges) {
    c.fillStyle = b.destroyed ? '#ff5a4e' : '#c9a36b';
    c.fillRect(x + b.x * s, y + b.y * s, Math.max(3, b.w * s), Math.max(3, b.h * s));
  }
  for (const p of m.points) {
    const col = p.owner >= 0 ? TEAMS[p.owner].color : '#d8d4c4';
    c.fillStyle = 'rgba(0,0,0,0.55)'; c.beginPath(); c.arc(x + p.x * s, y + p.y * s, big ? 16 : 8, 0, TAU); c.fill();
    c.strokeStyle = col; c.lineWidth = big ? 2.5 : 1.5; c.stroke();
    c.font = `700 ${big ? 18 : 10}px "Chakra Petch", sans-serif`; c.fillStyle = col; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(p.name, x + p.x * s, y + p.y * s);
  }
  for (const d of G.drops) { c.fillStyle = '#7fd18b'; c.fillRect(x + d.x * s - 3, y + d.y * s - 3, 6, 6); }
  for (const t of G.trucks) { if (t.team !== P.team && !seen(t.x, t.y)) continue; c.fillStyle = TEAMS[t.team].light; c.fillRect(x + t.x * s - 4, y + t.y * s - 3, 8, 6); }
  for (const k of G.carts) { if (k.team !== P.team && !seen(k.x, k.y)) continue; c.fillStyle = TEAMS[k.team].light; c.fillRect(x + k.x * s - 4, y + k.y * s - 4, 8, 8); c.strokeStyle = '#000'; c.strokeRect(x + k.x * s - 4, y + k.y * s - 4, 8, 8); }
  for (const st of G.strikes) {
    const r = strikeRect(st); c.globalAlpha = 0.35 + 0.35 * Math.sin(G.time * 8); c.fillStyle = st.team === P.team ? TEAMS[st.team].color : '#ff3b2f';
    c.fillRect(x + r.x * s, y + r.y * s, Math.max(4, r.w * s), Math.max(3, r.h * s)); c.globalAlpha = 1;
  }
  for (const k of G.c4s) { if (Math.sin(G.time * 12) > 0) { c.fillStyle = '#ff3b2f'; circle(c, x + k.x * s, y + k.y * s, 5); } }
  for (const so of G.soldiers) {
    if (!so.alive) continue;
    const friendly = so.team === P.team;
    if (!friendly && G.time - so.spotted[P.team] > 1.5) continue;
    c.fillStyle = so.isPlayer ? '#ffffff' : TEAMS[so.team].color;
    circle(c, x + so.x * s, y + so.y * s, so.isPlayer ? (big ? 6 : 4) : (big ? 4 : 2.5));
  }
  // where you are looking
  const lv = R3.lastCam;
  if (lv) {
    const a = lv.yaw, half = R3.fov * Math.PI / 360 * VW / Math.max(1, VH), r = big ? 70 : 34, px = x + lv.x * s, py = y + lv.y * s;
    c.fillStyle = 'rgba(255,255,255,0.18)'; c.beginPath(); c.moveTo(px, py); c.arc(px, py, r, a - half, a + half); c.closePath(); c.fill();
  }
  c.restore();
  c.strokeStyle = 'rgba(255,255,255,0.2)'; c.lineWidth = 1; c.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);
}

function drawScores() {
  const D = '"Chakra Petch", sans-serif', M = '"IBM Plex Mono", monospace';
  const w = Math.min(760, VW - 32), h = 340, x = (VW - w) / 2, y = (VH - h) / 2;
  panel(x, y, w, h);
  for (let t = 0; t < 2; t++) {
    const cx = x + 20 + t * (w / 2);
    txt(`${TEAMS[t].name.toUpperCase()}  ·  ${G.teams[t].points} pts`, cx, y + 32, `700 16px ${D}`, TEAMS[t].color);
    txt('K', cx + w / 2 - 130, y + 56, `500 11px ${M}`, '#8e9b92', 'right');
    txt('D', cx + w / 2 - 90, y + 56, `500 11px ${M}`, '#8e9b92', 'right');
    txt('PTS', cx + w / 2 - 44, y + 56, `500 11px ${M}`, '#8e9b92', 'right');
    G.soldiers.filter(s => s.team === t && !s.off).sort((a, b) => b.kills - a.kills).forEach((s, i) => {
      const yy = y + 80 + i * 24;
      txt(s.name + (s.alive ? '' : '  †'), cx, yy, `${s.isPlayer ? 700 : 400} 13px ${M}`, s.isPlayer ? '#fff' : '#cfd5cc');
      txt(String(s.kills), cx + w / 2 - 130, yy, `500 13px ${M}`, '#fff', 'right');
      txt(String(s.deaths), cx + w / 2 - 90, yy, `500 13px ${M}`, '#fff', 'right');
      txt(String(s.points), cx + w / 2 - 44, yy, `500 13px ${M}`, '#e6ad45', 'right');
    });
  }
}
