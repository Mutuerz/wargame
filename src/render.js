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

let zoomScope = 1;
function zoom() { return Math.max(0.3, Math.min(VH / CFG.VIEW_H, VW / 1450)) * zoomScope; }
let fogCanvas = null, fogSoft = null, fogStamp = -1;
function fogLayer() {
  if (!fogCanvas) fogCanvas = makeCanvas(GW, GH);
  if (fogStamp !== G.visN) {
    fogStamp = G.visN;
    const g = fogCanvas.getContext('2d'), img = g.createImageData(GW, GH), vis = G.teams[G.player.team].vis;
    for (let i = 0; i < vis.length; i++) { img.data[i * 4 + 3] = vis[i] ? 0 : 150; }
    g.putImageData(img, 0, 0);
    if (!fogSoft) fogSoft = makeCanvas(GW * 2, GH * 2);
    const g2 = fogSoft.getContext('2d');
    g2.clearRect(0, 0, GW * 2, GH * 2);
    g2.filter = 'blur(3px)';
    g2.drawImage(fogCanvas, 0, 0, GW * 2, GH * 2);
    g2.filter = 'none';
  }
  return fogSoft;
}
function seen(x, y) { return isVisible(G.player.team, x, y); }
function bigMapRect() { const w = Math.min(VW - 80, (VH - 120) * W / H), h = w * H / W; return { x: (VW - w) / 2, y: (VH - h) / 2, w, h }; }
function mapToWorld(sx, sy) {
  const r = bigMapRect();
  if (sx < r.x || sy < r.y || sx > r.x + r.w || sy > r.y + r.h) return null;
  return { x: (sx - r.x) / r.w * W, y: (sy - r.y) / r.h * H };
}
function targetWorld() { return G.showMap ? mapToWorld(mouse.x, mouse.y) : screenToWorld(mouse.x, mouse.y); }
function strikeAt(x, y) {
  return { x: clamp(x, CFG.STRIKE_W / 2, W - CFG.STRIKE_W / 2) - CFG.STRIKE_W / 2, y: clamp(y, CFG.STRIKE_H / 2, H - CFG.STRIKE_H / 2) - CFG.STRIKE_H / 2, w: CFG.STRIKE_W, h: CFG.STRIKE_H };
}
// Announced strike zones are drawn above the fog: both teams see them for the full countdown.
function drawStrikes(z) {
  const D = '"Chakra Petch", sans-serif';
  for (const st of G.strikes) {
    const r = strikeRect(st), mine = st.team === G.player.team, col = mine ? TEAMS[st.team].color : '#ff3b2f';
    const pulse = 0.5 + 0.5 * Math.sin(G.time * (st.t < 3 ? 18 : 7));
    ctx.fillStyle = col; ctx.globalAlpha = 0.12 + 0.12 * pulse; ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.globalAlpha = 1; ctx.strokeStyle = col; ctx.lineWidth = 3 / z;
    ctx.setLineDash([18 / z, 10 / z]); ctx.lineDashOffset = -G.time * 40 / z; ctx.strokeRect(r.x, r.y, r.w, r.h); ctx.setLineDash([]);
    // hazard corners
    ctx.lineWidth = 6 / z; const c = 26;
    for (const [cx, cy, sx, sy] of [[r.x, r.y, 1, 1], [r.x + r.w, r.y, -1, 1], [r.x, r.y + r.h, 1, -1], [r.x + r.w, r.y + r.h, -1, -1]]) {
      ctx.beginPath(); ctx.moveTo(cx + sx * c, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + sy * c); ctx.stroke();
    }
    ctx.font = `700 ${Math.round(34 / Math.sqrt(z))}px ${D}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff'; ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 4;
    const label = st.t > 0 ? `AIR STRIKE  ${Math.ceil(st.t)}` : 'IMPACT';
    ctx.strokeText(label, st.x, st.y); ctx.fillText(label, st.x, st.y);
    // bomber shadow passing over during the run
    if (st.t <= 0.8) {
      const prog = clamp((0.8 - st.t) / 1.6, 0, 1), px = st.dir > 0 ? r.x - 400 + (r.w + 800) * prog : r.x + r.w + 400 - (r.w + 800) * prog;
      ctx.save(); ctx.translate(px, st.y - 30); ctx.scale(st.dir, 1); ctx.globalAlpha = 0.35; ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.moveTo(60, 0); ctx.lineTo(-40, -8); ctx.lineTo(-10, -70); ctx.lineTo(-30, -70); ctx.lineTo(-60, -8); ctx.lineTo(-80, -6); ctx.lineTo(-95, -30); ctx.lineTo(-105, -30); ctx.lineTo(-100, 0);
      ctx.lineTo(-105, 30); ctx.lineTo(-95, 30); ctx.lineTo(-80, 6); ctx.lineTo(-60, 8); ctx.lineTo(-30, 70); ctx.lineTo(-10, 70); ctx.lineTo(-40, 8); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }
  if (G.targeting && !G.showMap && typeof mouse !== 'undefined') {
    const w = screenToWorld(mouse.x, mouse.y), r = strikeAt(w.x, w.y);
    ctx.fillStyle = 'rgba(230,173,69,0.16)'; ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = '#e6ad45'; ctx.lineWidth = 2 / z; ctx.setLineDash([12 / z, 8 / z]); ctx.strokeRect(r.x, r.y, r.w, r.h); ctx.setLineDash([]);
  }
}
function screenToWorld(sx, sy) { const z = zoom(); return { x: G.cam.x + (sx - VW / 2) / z, y: G.cam.y + (sy - VH / 2) / z }; }

function render(dt) {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = '#0b0d0c'; ctx.fillRect(0, 0, VW, VH);
  if (!G) return;
  const m = G.m, B = BIOMES[m.biome], z = zoom();
  // camera
  const P = G.player;
  let tx = P.x, ty = P.y;
  const spec = spectateTarget();
  if (spec) { tx = spec.x; ty = spec.y; }
  if (P.alive && !G.auto && typeof mouse !== 'undefined') {
    const lim = P.scoped ? P.cls.scopeRange * 0.65 : 260;
    const f = P.scoped ? 0.9 : 0.25;
    const ox = clamp((mouse.x - VW / 2) / z * f, -lim, lim), oy = clamp((mouse.y - VH / 2) / z * f, -lim * 0.8, lim * 0.8);
    tx += ox; ty += oy;
  }
  zoomScope = lerp(zoomScope, P.scoped ? 0.72 : 1, 1 - Math.exp(-dt * 6));
  const k = 1 - Math.exp(-dt * 8);
  G.cam.x = lerp(G.cam.x, tx, k); G.cam.y = lerp(G.cam.y, ty, k);
  // keep the view inside the map
  const chw = VW / 2 / z, chh = VH / 2 / z;
  G.cam.x = chw * 2 >= W ? W / 2 : clamp(G.cam.x, chw, W - chw);
  G.cam.y = chh * 2 >= H ? H / 2 : clamp(G.cam.y, chh, H - chh);
  SFX.listener.x = G.cam.x; SFX.listener.y = G.cam.y;
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const sh = reduce ? 0 : G.cam.shake;
  const cx = G.cam.x + rand(-sh, sh), cy = G.cam.y + rand(-sh, sh);
  const hw = VW / 2 / z, hh = VH / 2 / z;
  const vx0 = cx - hw, vy0 = cy - hh, vx1 = cx + hw, vy1 = cy + hh;
  ctx.setTransform(DPR * z, 0, 0, DPR * z, DPR * (VW / 2 - cx * z), DPR * (VH / 2 - cy * z));

  // ground
  const gx0 = Math.max(0, vx0), gy0 = Math.max(0, vy0), gx1 = Math.min(W, vx1), gy1 = Math.min(H, vy1);
  if (gx1 > gx0 && gy1 > gy0) ctx.drawImage(G.art.ground, gx0 * GS, gy0 * GS, (gx1 - gx0) * GS, (gy1 - gy0) * GS, gx0, gy0, gx1 - gx0, gy1 - gy0);

  drawBridges(m);
  drawPoints(m);
  drawDepots(m);
  drawDrops();
  drawC4();
  drawGrenades();
  for (const s of G.soldiers) if (s.alive && s.x > vx0 - 50 && s.x < vx1 + 50 && s.y > vy0 - 50 && s.y < vy1 + 50 && (s.team === P.team || seen(s.x, s.y))) drawSoldier(s);
  drawBullets();
  // obstacles
  forBlockersNear(m, vx0 - 60, vy0 - 60, vx1 + 60, vy1 + 60, o => { if (!o.water) drawSolid(ctx, o, B); });
  drawTrucks();
  drawCarts();
  // fog of war: dim what your team cannot currently see
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(fogLayer(), 0, 0, W, H);
  drawStrikes(z);
  drawParticles();

  // screen space
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  drawWeather(dt, B);
  ctx.fillStyle = B.tint; ctx.fillRect(0, 0, VW, VH);
  ctx.drawImage(vignette, 0, 0, VW, VH);
  if (G.hurtT > 0) {
    ctx.globalAlpha = G.hurtT * 1.4;
    const g = ctx.createRadialGradient(VW / 2, VH / 2, Math.min(VW, VH) * 0.3, VW / 2, VH / 2, Math.max(VW, VH) * 0.7);
    g.addColorStop(0, 'rgba(160,0,0,0)'); g.addColorStop(1, 'rgba(160,0,0,0.6)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, VW, VH); ctx.globalAlpha = 1;
  }
  drawHUD();
}

function drawBridges(m) {
  for (const b of m.bridges) {
    if (b.destroyed) {
      ctx.fillStyle = '#4a3a24';
      ctx.fillRect(b.x, b.y + 6, 22, b.h - 12); ctx.fillRect(b.x + b.w - 22, b.y + 6, 22, b.h - 12);
      ctx.fillStyle = '#3a2d1b';
      for (let i = 0; i < 6; i++) ctx.fillRect(b.x + 30 + i * 16, b.y + 10 + ((i * 37) % (b.h - 30)), 14, 6);
      continue;
    }
    ctx.fillStyle = '#3e2f1d'; ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = '#7a5c38'; ctx.fillRect(b.x, b.y + 8, b.w, b.h - 16);
    ctx.strokeStyle = 'rgba(40,28,14,0.6)'; ctx.lineWidth = 2; ctx.beginPath();
    for (let x = b.x + 10; x < b.x + b.w; x += 10) { ctx.moveTo(x, b.y + 8); ctx.lineTo(x, b.y + b.h - 8); }
    ctx.stroke();
    // charge point
    const pulse = 0.5 + 0.5 * Math.sin(G.time * 4);
    ctx.save(); ctx.translate(b.cx, b.cy);
    ctx.strokeStyle = `rgba(230,173,69,${0.5 + pulse * 0.5})`; ctx.lineWidth = 3; ctx.setLineDash([6, 5]);
    ctx.strokeRect(-22, -22, 44, 44); ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(230,173,69,0.9)'; ctx.font = '700 12px "Chakra Petch", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('C4', 0, 0);
    ctx.restore();
  }
}

function drawPoints(m) {
  for (const p of m.points) {
    const col = p.owner >= 0 ? TEAMS[p.owner].color : '#d8d4c4';
    ctx.globalAlpha = 0.12; ctx.fillStyle = col; circle(ctx, p.x, p.y, CFG.CAP_R); ctx.globalAlpha = 1;
    ctx.strokeStyle = col; ctx.globalAlpha = 0.5; ctx.lineWidth = 3; ctx.setLineDash([14, 10]);
    ctx.beginPath(); ctx.arc(p.x, p.y, CFG.CAP_R, 0, TAU); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    if (Math.abs(p.prog) > 0.5) {
      const tc = p.prog > 0 ? TEAMS[0].color : TEAMS[1].color;
      ctx.strokeStyle = tc; ctx.lineWidth = 7;
      ctx.beginPath(); ctx.arc(p.x, p.y, CFG.CAP_R + 6, -Math.PI / 2, -Math.PI / 2 + TAU * Math.abs(p.prog) / 100); ctx.stroke();
    }
    // flag
    ctx.fillStyle = '#2a2a26'; ctx.fillRect(p.x - 2, p.y - 40, 4, 44);
    ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(p.x + 2, p.y - 40); ctx.lineTo(p.x + 34 + Math.sin(G.time * 5) * 3, p.y - 31); ctx.lineTo(p.x + 2, p.y - 22); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.font = '700 36px "Chakra Petch", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(p.name, p.x, p.y + 30);
  }
}

function drawDepots(m) {
  for (const c of G.caches) {
    if (c.team !== G.player.team && !seen(c.x, c.y)) continue;
    for (let i = 0; i < Math.min(6, Math.ceil(c.charges / 2)); i++) {
      const x = c.x - 45 + (i % 3) * 32, y = c.y - 10 + Math.floor(i / 3) * 32;
      ctx.fillStyle = '#4f6b3a'; ctx.fillRect(x, y, 28, 28);
      ctx.strokeStyle = '#2c3d20'; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, 26, 26);
      ctx.fillStyle = '#e6ad45'; ctx.fillRect(x + 10, y + 12, 8, 4);
    }
    ctx.fillStyle = '#fff'; ctx.font = '600 14px "IBM Plex Mono", monospace'; ctx.textAlign = 'center';
    ctx.fillText(`${c.charges} resupplies`, c.x, c.y + 64);
  }
}

function drawDrops() {
  for (const d of G.drops) {
    if (d.fall > 0) {
      const f = d.fall / 4;
      ctx.globalAlpha = 0.35 * (1 - f) + 0.1; ctx.fillStyle = '#000'; circle(ctx, d.x, d.y, 16 + f * 10); ctx.globalAlpha = 1;
      const y = d.y - f * 260;
      ctx.fillStyle = '#e8e4d6'; ctx.beginPath(); ctx.arc(d.x, y - 30, 34, Math.PI, 0); ctx.fill();
      ctx.strokeStyle = '#999'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(d.x - 34, y - 30); ctx.lineTo(d.x, y); ctx.lineTo(d.x + 34, y - 30); ctx.stroke();
      ctx.fillStyle = '#4f6b3a'; ctx.fillRect(d.x - 14, y - 14, 28, 28);
      continue;
    }
    const glow = 0.5 + 0.5 * Math.sin(d.t * 5);
    ctx.globalAlpha = 0.25 + glow * 0.25; ctx.fillStyle = '#7fd18b'; circle(ctx, d.x, d.y, 34); ctx.globalAlpha = 1;
    ctx.fillStyle = '#4f6b3a'; ctx.fillRect(d.x - 16, d.y - 16, 32, 32);
    ctx.strokeStyle = '#2c3d20'; ctx.lineWidth = 2; ctx.strokeRect(d.x - 15, d.y - 15, 30, 30);
    ctx.fillStyle = '#fff'; ctx.fillRect(d.x - 3, d.y - 10, 6, 20); ctx.fillRect(d.x - 10, d.y - 3, 20, 6);
    if (d.c4) { ctx.fillStyle = '#e6ad45'; ctx.fillRect(d.x + 8, d.y - 20, 12, 8); }
  }
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

function drawCarts() {
  for (const c of G.carts) {
    if (c.team !== G.player.team && !seen(c.x, c.y)) continue;
    ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.angle);
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(-30, -16, 66, 40);
    ctx.fillStyle = '#151515'; for (const wx of [-18, 18]) { ctx.fillRect(wx - 8, -22, 16, 6); ctx.fillRect(wx - 8, 16, 16, 6); }
    ctx.fillStyle = '#4b5236'; ctx.fillRect(-32, -18, 64, 36);
    ctx.fillStyle = TEAMS[c.team].dark; ctx.fillRect(14, -16, 18, 32);
    ctx.fillStyle = 'rgba(160,200,220,0.6)'; ctx.fillRect(26, -12, 4, 24);
    // passengers' helmets
    ctx.fillStyle = TEAMS[c.team].helmet;
    c.riders.slice(0, 8).forEach((r, i) => { const px = -24 + (i % 4) * 10, py = i < 4 ? -8 : 8; ctx.beginPath(); ctx.arc(px, py, 4.5, 0, TAU); ctx.fill(); });
    ctx.restore();
    const f = Math.max(0, c.hp / CFG.CART_HP);
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(c.x - 26, c.y - 38, 52, 6);
    ctx.fillStyle = f > 0.5 ? '#7fd18b' : f > 0.25 ? '#e6ad45' : '#ff5a4e'; ctx.fillRect(c.x - 26, c.y - 38, 52 * f, 6);
    if (G.player.riding === c) { ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(c.x, c.y, 42, 0, TAU); ctx.stroke(); }
  }
}

function drawGrenades() {
  for (const g of G.grenades) {
    if (g.team !== G.player.team && !seen(g.x, g.y)) continue;
    ctx.fillStyle = '#3b4a2c'; circle(ctx, g.x, g.y, 6);
    ctx.fillStyle = '#26301c'; ctx.fillRect(g.x - 2 + Math.cos(g.spin) * 3, g.y - 2 + Math.sin(g.spin) * 3, 4, 4);
    // danger ring and fuse
    ctx.strokeStyle = `rgba(255,90,78,${0.25 + 0.25 * Math.sin(G.time * 12)})`; ctx.lineWidth = 2; ctx.setLineDash([8, 8]);
    ctx.beginPath(); ctx.arc(g.x, g.y, CFG.GRENADE_RADIUS, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = '#ff5a4e'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(g.x, g.y, 13, -Math.PI / 2, -Math.PI / 2 + TAU * g.fuse / CFG.GRENADE_FUSE); ctx.stroke();
  }
}

function drawC4() {
  for (const c of G.c4s) {
    ctx.fillStyle = '#6b6a4c'; ctx.fillRect(c.x - 12, c.y - 8, 24, 16);
    const on = c.beep > (c.fuse < 2 ? 0.15 : 0.4);
    ctx.fillStyle = on ? '#ff3b2f' : '#601511'; circle(ctx, c.x + 6, c.y - 2, 3.5);
    ctx.fillStyle = '#fff'; ctx.font = '700 16px "IBM Plex Mono", monospace'; ctx.textAlign = 'center';
    ctx.fillText(c.fuse.toFixed(1), c.x, c.y - 18);
  }
}

function drawSoldier(s) {
  const T = TEAMS[s.team];
  ctx.save(); ctx.translate(s.x, s.y);
  ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(4, 5, 15, 13, 0, 0, TAU); ctx.fill();
  if (s.isPlayer) { ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, 22, 0, TAU); ctx.stroke(); }
  if (s.shield > 0) { ctx.strokeStyle = 'rgba(180,220,255,0.6)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, 19, 0, TAU); ctx.stroke(); }
  ctx.rotate(s.angle);
  const step = Math.sin(s.walkPhase) * 4;
  // feet
  ctx.fillStyle = '#23241f'; ctx.beginPath(); ctx.ellipse(step, -6, 5, 3.5, 0, 0, TAU); ctx.ellipse(-step, 6, 5, 3.5, 0, 0, TAU); ctx.fill();
  // rifle
  ctx.fillStyle = '#1b1d1c'; ctx.fillRect(4, 1, 26, 5); ctx.fillRect(12, 5, 5, 5);
  // backpack
  ctx.fillStyle = '#3c3f33'; ctx.fillRect(-15, -8, 8, 16);
  // body
  ctx.fillStyle = T.dark; ctx.beginPath(); ctx.ellipse(0, 0, 10, 13.5, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = T.color; ctx.beginPath(); ctx.ellipse(0, 0, 8, 11.5, 0, 0, TAU); ctx.fill();
  // arms to rifle
  ctx.fillStyle = T.dark; circle(ctx, 9, 5, 3.6); circle(ctx, 18, 3.5, 3.4);
  // helmet
  ctx.fillStyle = T.helmet; circle(ctx, 0, 0, 7.5);
  ctx.fillStyle = 'rgba(255,255,255,0.18)'; circle(ctx, -2, -2, 3.5);
  if (s.c4 > 0 && s.bot && s.bot.role === 'sapper') { ctx.fillStyle = '#e6ad45'; ctx.fillRect(-14, -4, 5, 8); }
  ctx.restore();
  // health / reload bars
  if (s.hp < maxHp(s)) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(s.x - 18, s.y - 30, 36, 5);
    ctx.fillStyle = s.hp > 50 ? '#7fd18b' : s.hp > 25 ? '#e6ad45' : '#ff5a4e'; ctx.fillRect(s.x - 18, s.y - 30, 36 * s.hp / maxHp(s), 5);
  }
  if (s.reloading) {
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(s.x, s.y, 26, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - s.reloadT / s.reloadMax)); ctx.stroke();
  }
  if (s.act) {
    ctx.strokeStyle = '#e6ad45'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(s.x, s.y, 30, -Math.PI / 2, -Math.PI / 2 + TAU * s.actT / CFG.C4_PLANT); ctx.stroke();
  }
  if (!s.isPlayer && s.team === G.player.team) {
    ctx.fillStyle = 'rgba(180,216,255,0.8)'; ctx.font = '500 11px "IBM Plex Mono", monospace'; ctx.textAlign = 'center';
    ctx.fillText(s.name, s.x, s.y + 32);
  }
}

function drawBullets() {
  ctx.lineCap = 'round';
  for (const b of G.bullets) {
    const len = 0.022;
    ctx.strokeStyle = b.team === 0 ? 'rgba(200,230,255,0.9)' : 'rgba(255,220,170,0.9)'; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.moveTo(b.x - b.vx * len, b.y - b.vy * len); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
}

function drawTrucks() {
  for (const t of G.trucks) {
    if (t.team !== G.player.team && !seen(t.x, t.y)) continue;
    ctx.save(); ctx.translate(t.x, t.y); if (t.dir < 0) ctx.rotate(Math.PI);
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(-38, -16, 90, 40);
    ctx.fillStyle = '#151515'; for (const wx of [-30, -8, 26]) { ctx.fillRect(wx - 7, -22, 14, 6); ctx.fillRect(wx - 7, 16, 14, 6); }
    ctx.fillStyle = '#3f4a30'; ctx.fillRect(-42, -18, 62, 36);
    ctx.fillStyle = '#5a4a30'; for (let i = 0; i < 3; i++) ctx.fillRect(-38 + i * 19, -13, 16, 26);
    ctx.fillStyle = TEAMS[t.team].dark; ctx.fillRect(22, -17, 26, 34);
    ctx.fillStyle = 'rgba(160,200,220,0.7)'; ctx.fillRect(38, -13, 7, 26);
    ctx.restore();
  }
}

function drawParticles() {
  for (const p of G.particles) {
    const a = p.life / p.max;
    if (p.type === 'flash') {
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a;
      ctx.fillStyle = '#ffd27a'; ctx.translate(p.x, p.y); ctx.rotate(p.a);
      ctx.beginPath(); ctx.moveTo(0, -5); ctx.lineTo(18, 0); ctx.lineTo(0, 5); ctx.fill(); circle(ctx, 0, 0, 7);
      ctx.restore();
    } else if (p.type === 'spark') { ctx.globalAlpha = a; ctx.fillStyle = '#ffd27a'; ctx.fillRect(p.x, p.y, 2.5, 2.5); }
    else if (p.type === 'blood') { ctx.globalAlpha = a; ctx.fillStyle = '#8a1010'; circle(ctx, p.x, p.y, p.size); }
    else if (p.type === 'dust') { ctx.globalAlpha = a * 0.5; ctx.fillStyle = '#b9ad94'; circle(ctx, p.x, p.y, p.size * (2 - a)); }
    else if (p.type === 'smoke') { ctx.globalAlpha = (p.ambient ? 0.22 : 0.4) * Math.min(1, a * 1.5); ctx.fillStyle = p.ambient ? '#59585a' : '#3b3a38'; circle(ctx, p.x, p.y, p.size); }
    else if (p.type === 'fire') {
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a;
      ctx.fillStyle = a > 0.5 ? '#ffd27a' : '#ff7a2f'; circle(ctx, p.x, p.y, p.size * (0.5 + a)); ctx.restore();
    }
  }
  ctx.globalAlpha = 1;
}

// ---- weather in screen space
function drawWeather(dt, B) {
  const kind = B.weather;
  const want = { snow: 170, sand: 70, leaves: 40, fog: 14, ash: 80 }[kind] || 0;
  while (weather.length < want) weather.push({ x: Math.random() * VW, y: Math.random() * VH, s: Math.random(), a: Math.random() * TAU, t: Math.random() * 10 });
  weather.length = want;
  for (const p of weather) {
    p.t += dt;
    if (kind === 'snow') {
      p.x += (25 + p.s * 30) * dt; p.y += (40 + p.s * 70) * dt;
      ctx.fillStyle = `rgba(255,255,255,${0.45 + p.s * 0.45})`; circle(ctx, p.x, p.y, 1 + p.s * 2.2);
    } else if (kind === 'sand') {
      p.x += (380 + p.s * 300) * dt; p.y += 30 * dt;
      ctx.strokeStyle = `rgba(230,205,150,${0.15 + p.s * 0.2})`; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - 40 - p.s * 50, p.y - 3); ctx.stroke();
    } else if (kind === 'leaves') {
      p.x += (30 + Math.sin(p.t + p.a) * 30) * dt; p.y += (35 + p.s * 25) * dt; p.a += dt * 2;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a);
      ctx.fillStyle = p.s > 0.5 ? 'rgba(150,120,50,0.7)' : 'rgba(90,120,50,0.7)';
      ctx.beginPath(); ctx.ellipse(0, 0, 4, 2, 0, 0, TAU); ctx.fill(); ctx.restore();
    } else if (kind === 'fog') {
      p.x += (10 + p.s * 10) * dt;
      const r = 160 + p.s * 220;
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      g.addColorStop(0, 'rgba(190,205,185,0.16)'); g.addColorStop(1, 'rgba(190,205,185,0)');
      ctx.fillStyle = g; ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2);
      // a firefly per fog blob
      const fx = p.x + Math.cos(p.t * 0.7 + p.a) * 80, fy = p.y + Math.sin(p.t * 0.9 + p.a) * 60;
      ctx.fillStyle = `rgba(220,255,140,${0.4 + 0.4 * Math.sin(p.t * 3 + p.a)})`; circle(ctx, fx, fy, 2);
      if (p.x - r > VW) p.x = -r;
    } else if (kind === 'ash') {
      p.x += (20 + Math.sin(p.t + p.a) * 15) * dt; p.y += (-6 + p.s * 20) * dt;
      ctx.fillStyle = `rgba(200,195,185,${0.25 + p.s * 0.3})`; ctx.fillRect(p.x, p.y, 2 + p.s * 2, 2 + p.s * 2);
    }
    if (kind !== 'fog') { if (p.x > VW + 60) p.x = -60; if (p.y > VH + 20) p.y = -20; if (p.y < -30) p.y = VH + 20; }
  }
}

// ---- HUD
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
    panel(12, 12, 230, 92);
    txt(fmtTime(G.time), 24, 40, `700 22px ${D}`, '#fff');
    txt(`limit ${fmtTime(CFG.TIME_LIMIT)}`, 230, 40, `400 11px ${M}`, '#8e9b92', 'right');
    const myBridge = m.bridges[P.team];
    const sup = myBridge.destroyed ? 'Supply line cut' : `Supply truck in ${fmtTime(G.teams[P.team].supplyT)}`;
    txt(sup, 24, 64, `500 13px ${M}`, myBridge.destroyed ? '#ff5a4e' : '#e3e7df');
    const eb = m.bridges[1 - P.team];
    txt(eb.destroyed ? 'Enemy bridge: destroyed' : 'Enemy bridge: standing', 24, 86, `400 12px ${M}`, eb.destroyed ? '#7fd18b' : '#8e9b92');
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
  txt(P.cls.name.toUpperCase() + (P.scoped ? '  · SCOPED' : ''), 24, by - 8, `700 12px ${D}`, P.scoped ? '#e6ad45' : '#cfd5cc');
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
  // message
  if (G.msg) {
    ctx.globalAlpha = Math.min(1, G.msg.t * 1.5);
    txt(G.msg.text, VW / 2, VH * 0.24, `700 ${small ? 18 : 26}px ${D}`, G.msg.color, 'center');
    ctx.globalAlpha = 1;
  }
  // crosshair
  if (P.alive && !G.auto && typeof mouse !== 'undefined' && !G.paused) {
    const moving = Math.hypot(P.vx, P.vy) > 20;
    const sp = currentSpread(P, moving);
    const dW = Math.hypot(screenToWorld(mouse.x, mouse.y).x - P.x, screenToWorld(mouse.x, mouse.y).y - P.y);
    const gapPx = 6 + sp * dW * zoom();
    ctx.strokeStyle = G.hitT > 0 ? '#ff5a4e' : 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(mouse.x - gapPx - 8, mouse.y); ctx.lineTo(mouse.x - gapPx, mouse.y);
    ctx.moveTo(mouse.x + gapPx, mouse.y); ctx.lineTo(mouse.x + gapPx + 8, mouse.y);
    ctx.moveTo(mouse.x, mouse.y - gapPx - 8); ctx.lineTo(mouse.x, mouse.y - gapPx);
    ctx.moveTo(mouse.x, mouse.y + gapPx); ctx.lineTo(mouse.x, mouse.y + gapPx + 8);
    ctx.stroke();
    if (P.reloading) { ctx.strokeStyle = '#e6ad45'; ctx.beginPath(); ctx.arc(mouse.x, mouse.y, gapPx + 14, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - P.reloadT / P.reloadMax)); ctx.stroke(); }
  }
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

// Map view used by minimap and the M overlay
function drawMap(c, x, y, w, h, big) {
  const m = G.m, s = w / W, P = G.player;
  c.save();
  c.fillStyle = '#000'; c.fillRect(x - 2, y - 2, w + 4, h + 4);
  c.drawImage(G.art.thumb, x, y, w, h);
  c.beginPath(); c.rect(x, y, w, h); c.clip();
  // bridges / depots
  for (const b of m.bridges) {
    c.fillStyle = b.destroyed ? '#ff5a4e' : '#c9a36b';
    c.fillRect(x + b.x * s, y + b.y * s, Math.max(3, b.w * s), Math.max(3, b.h * s));
  }
  for (const p of m.points) {
    const col = p.owner >= 0 ? TEAMS[p.owner].color : '#d8d4c4';
    c.strokeStyle = col; c.lineWidth = big ? 3 : 2; c.beginPath(); c.arc(x + p.x * s, y + p.y * s, Math.max(5, CFG.CAP_R * s), 0, TAU); c.stroke();
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
  // camera rect
  const z = zoom(), vw = VW / z, vh = VH / z;
  c.strokeStyle = 'rgba(255,255,255,0.6)'; c.lineWidth = 1;
  c.strokeRect(x + (G.cam.x - vw / 2) * s, y + (G.cam.y - vh / 2) * s, vw * s, vh * s);
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
    G.soldiers.filter(s => s.team === t).sort((a, b) => b.kills - a.kills).forEach((s, i) => {
      const yy = y + 80 + i * 24;
      txt(s.name + (s.alive ? '' : '  †'), cx, yy, `${s.isPlayer ? 700 : 400} 13px ${M}`, s.isPlayer ? '#fff' : '#cfd5cc');
      txt(String(s.kills), cx + w / 2 - 130, yy, `500 13px ${M}`, '#fff', 'right');
      txt(String(s.deaths), cx + w / 2 - 90, yy, `500 13px ${M}`, '#fff', 'right');
      txt(String(s.points), cx + w / 2 - 44, yy, `500 13px ${M}`, '#e6ad45', 'right');
    });
  }
}
