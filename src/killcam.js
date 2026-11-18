'use strict';
// Kill cam (preview). The client keeps a 5.5 s rolling recording of what it already knows (soldier poses and
// bullets in flight, 30 samples a second: a few hundred small arrays). When you are killed by an enemy, the death
// fall plays as before, then the last 5 seconds before your death replay from just behind your killer's shoulder,
// following their aim, with the last half second in slow motion. Then the usual spectator view takes over.
// Nothing in the simulation changes: the replay only swaps what the 3D view draws for one frame at a time and puts
// the real state back before the HUD and the next tick. Respawning ends it at once; Space skips it. Works online
// too (it records what the client draws). ?killcam=0 turns it off.

const KC = {
  on: false, enabled: params.get('killcam') !== '0',
  frames: [], acc: 0, wasAlive: true,
  clip: null, killer: null, t: 0, t0: 0, t1: 0, saved: null, savedB: null, label: '', hl: false, slowAt: [],
};
const KC_LEN = 5, KC_AFTER = 1, KC_HZ = 30;   // 5 s before your death and 1 s after it (your body falling)

// ---------- recording (called once per rendered frame, after the simulation step)
function kcRecord(dt) {
  if (!KC.enabled || !G || !G.soldiers) { KC.frames.length = 0; return; }
  if (G.over || KC.hl) return;
  const P = G.player;
  // death: keep recording one more second (your body going down), then freeze the clip for the replay
  if (P && KC.wasAlive && !P.alive) { const k = P.lastHitBy; KC.pend = k && k !== P && k.team !== P.team ? { k, td: G.time } : null; KC.clip = null; KC.wait = 2.3; }
  // respawning does not cut it short: it keeps playing while you parachute in, and ends when you land (or Space)
  if (P) { KC.wasAlive = P.alive; if (P.alive && !(P.para > 0)) { KC.pend = null; if (KC.on || KC.clip) kcStop(); } }
  if (KC.pend && G.time >= KC.pend.td + KC_AFTER) kcCapture();
  if (KC.on) return;   // no need to record while watching
  KC.acc += dt;
  if (KC.acc < 1 / KC_HZ) return;
  KC.acc %= 1 / KC_HZ;
  KC.frames.push(kcSnap());
  while (KC.frames.length && KC.frames[0].t < G.time - KC_LEN - KC_AFTER - 0.5) KC.frames.shift();
}

// one recorded frame: every live soldier's pose and the bullets in flight
function kcSnap() {
  const s = [];
  for (const q of G.soldiers) {
    if (!q.alive || q.x < -9000) continue;
    s.push([q, q.rx ?? q.x, q.ry ?? q.y, q.rfz ?? feetZ(q), q.ra ?? q.angle, q.pitch || 0, q.crouch ? 1 : 0, q.jz || 0, q.rwp ?? q.walkPhase ?? 0, q.lastShotT ?? -9, q.reloading ? 1 : 0, q.para || 0, q.ads ? 1 : 0, q.scoped ? 1 : 0]);
  }
  const b = [];
  for (const u of G.bullets) if (b.length < 60) b.push({ x: u.x, y: u.y, z: u.z, vx: u.vx, vy: u.vy, vz: u.vz, sniper: u.sniper, pel: u.pel, team: u.team, life: u.life, gs: 9, seen: 1 });
  return { t: G.time, s, b };
}

function kcCapture() {
  const { k, td } = KC.pend; KC.pend = null;
  if (KC.frames.length < 10) { KC.clip = null; return; }
  const end = KC.frames[KC.frames.length - 1].t;
  KC.clip = KC.frames.filter(f => f.t >= td - KC_LEN);
  KC.frames = [];
  KC.killer = k; KC.td = td; KC.slowAt = [td]; KC.t0 = KC.clip[0].t; KC.t1 = end; KC.t = KC.t0;
  KC.label = `${k.name}${k.cls ? ' · ' + k.cls.name : ''}`;
}

// starts after the death fall (cameraView's 2.2 s), unless you already respawned
function kcUpdate(dt) {
  const P = G && G.player;
  if (!P) return;
  KC.wait -= dt;
  if (!KC.on && KC.clip && (!P.alive || P.para > 0) && (R3.death ? R3.death.t >= 2.2 : KC.wait <= 0)) KC.on = true;   // after the 2.2 s death fall
  if (!KC.on) return;
  KC.t += dt * (kcSlow() ? 0.35 : 1);   // slow motion around the killing shot (each kill, in a highlight)
  if (KC.t >= KC.t1 + 0.4) kcStop();
}
function kcSlow() { return KC.slowAt.some(t => KC.t > t - 0.5 && KC.t < t + 0.25); }
function kcStop() {
  const hl = KC.hl;
  KC.on = false; KC.clip = null; KC.killer = null; KC.hl = false;
  if (hl && G && G.over) $('over').hidden = false;   // highlight over: back to the results
}

// the two recorded frames around time t and how far between them
function kcAt(t) {
  const c = KC.clip;
  let i = 0;
  while (i < c.length - 2 && c[i + 1].t <= t) i++;
  const a = c[i], b = c[Math.min(i + 1, c.length - 1)];
  return { a, b, f: b.t > a.t ? clamp((t - a.t) / (b.t - a.t), 0, 1) : 0 };
}

// ---------- playback: before the 3D view draws, pose everyone as recorded; afterwards put the real state back
const KC_FIELDS = ['x', 'y', 'rx', 'ry', 'rfz', 'ra', 'rwp', 'angle', 'pitch', 'alive', 'crouch', 'jz', 'para', 'lastShotT', 'reloading', 'walkPhase', 'ads', 'scoped'];
function kcBegin() {
  if (!KC.on || !KC.clip) return;
  const { a, b, f } = kcAt(KC.t), saved = new Map();
  const bmap = new Map(b.s.map(r => [r[0], r]));
  const seen = new Set();
  for (const r of a.s) {
    const q = r[0], n = bmap.get(q) || r;
    const o = {}; for (const k of KC_FIELDS) o[k] = q[k]; saved.set(q, o);
    seen.add(q);
    q.x = q.rx = lerp(r[1], n[1], f); q.y = q.ry = lerp(r[2], n[2], f); q.rfz = lerp(r[3], n[3], f);
    q.ra = q.angle = r[4] + angDiff(r[4], n[4]) * f; q.pitch = lerp(r[5], n[5], f);
    q.alive = true; q.crouch = !!r[6]; q.jz = r[7]; q.rwp = q.walkPhase = lerp(r[8], n[8], f);
    q.lastShotT = G.time - (KC.t - r[9]); q.reloading = !!r[10]; q.para = r[11]; q.ads = !!r[12]; q.scoped = !!r[13];
  }
  // soldiers not in the recording at this moment are hidden for the frame
  for (const q of G.soldiers) if (!seen.has(q)) { const o = {}; for (const k of KC_FIELDS) o[k] = q[k]; saved.set(q, o); q.alive = false; }
  KC.saved = saved; KC.savedB = G.bullets; G.bullets = a.b;
  // bodies: hidden until they fall in the replay, then posed at their age at that moment (your own included)
  KC.bodies = [];
  for (const bd of R3.bodies) {
    if (bd.born === undefined) continue;
    KC.bodies.push([bd, bd.t]);
    const age = KC.t - bd.born;
    if (age < 0) bd.kcHide = true; else { bd.t = age; animateBody(bd, 0); }
  }
}
function kcEnd() {
  if (!KC.saved) return;
  for (const [q, o] of KC.saved) for (const k of KC_FIELDS) q[k] = o[k];
  G.bullets = KC.savedB; KC.saved = null; KC.savedB = null;
  for (const [bd, t] of KC.bodies || []) { bd.t = t; bd.kcHide = false; animateBody(bd, 0); }
  KC.bodies = null;
}

// the camera: the killer's own eyes, looking where they aimed (render3d draws their gun and hides their body)
function kcCamera() {
  const k = KC.killer;
  if (!KC.on || !k || !KC.saved) return null;
  return { fp: true, who: k, x: k.x, y: k.y, z: k.rfz + (k.crouch ? CFG.CROUCH_EYE : CFG.EYE), yaw: k.angle, pitch: clamp(k.pitch || 0, -1.4, 1.4) };
}

// ---------- overlay
function kcOverlay() {
  if (!KC.on || !KC.clip) return;
  const D = '"Chakra Petch", sans-serif', bar = Math.round(VH * 0.07);
  ctx.fillStyle = 'rgba(0,0,0,0.85)'; ctx.fillRect(0, 0, VW, bar); ctx.fillRect(0, VH - bar, VW, bar);
  ctx.fillStyle = 'rgba(255,40,30,0.06)'; ctx.fillRect(0, bar, VW, VH - bar * 2);
  txt(KC.hl ? 'BEST PLAY' : 'KILL CAM', 24, bar / 2, `800 20px ${D}`, KC.hl ? '#ffd27a' : '#ff5a4e', 'left', 'middle');
  txt(KC.hl ? KC.label : `Killed by ${KC.label}`, VW / 2, bar / 2, `700 18px ${D}`, '#ffffff', 'center', 'middle');
  if (KC.hl) {   // kill counter: ticks up as each kill of the streak happens in the replay
    const n = KC.slowAt.filter(t => KC.t >= t).length;
    if (n) txt(n >= 2 ? HL_NAMES[Math.min(n, 5)] : '1 KILL', VW / 2, bar + 46, `800 34px ${D}`, '#ffd27a', 'center', 'middle');
  }
  txt(KC.hl ? 'Space to skip' : G.player.alive ? 'Parachuting in · Space to skip' : 'Space to skip', VW - 24, bar / 2, `500 13px "IBM Plex Mono", monospace`, '#b8c0b4', 'right', 'middle');
  const p = clamp((KC.t - KC.t0) / Math.max(0.1, KC.t1 - KC.t0), 0, 1);
  ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(VW * 0.3, VH - bar / 2 - 2, VW * 0.4, 4);
  ctx.fillStyle = '#ff5a4e'; ctx.fillRect(VW * 0.3, VH - bar / 2 - 2, VW * 0.4 * p, 4);
  if (kcSlow()) txt('SLOW MOTION', VW / 2, VH - bar - 18, `700 13px ${D}`, '#ffd27a', 'center', 'middle');
}

window.addEventListener('keydown', e => {
  if (KC.on && e.code === 'Space') { e.preventDefault(); e.stopImmediatePropagation(); kcStop(); }
}, true);

// ---------- best play of the match: the biggest multi-kill anyone made (bots included, the first one wins a tie,
// a human's wins a tie with a bot's), replayed from the shooter's eyes for every human player when the match ends.
// Each client keeps a 16 s rolling recording of its own; when a multi-kill's streak has been quiet for 1.6 s and
// it beats the best so far, the frames around it are kept. Online the server tells every client about each
// multi-kill ('mk' event), so everyone saves and replays the same moment from their own recording.
const HL = { g: null, frames: [], acc: 0, pend: new Map(), best: null };
const HL_LEN = 16, HL_PRE = 2, HL_POST = 1.6;
const HL_NAMES = ['', '', 'DOUBLE KILL', 'TRIPLE KILL', 'QUADRA KILL', 'PENTA KILL'];

function hlReset() { HL.g = G; HL.frames = []; HL.acc = 0; HL.pend.clear(); HL.best = null; }
// a soldier just made kill number n of a streak; ages = how long ago each kill of the streak was
function hlNote(s, n, ages) {
  if (!G) return;
  if (HL.g !== G) hlReset();
  const kills = ages.map(a => G.time - a);
  HL.pend.set(s, { s, n, kills, due: G.time + HL_POST });
}
function hlBetter(p) {
  const b = HL.best;
  if (!b) return true;
  return p.n > b.n || (p.n === b.n && !!(p.s.human || p.s.isPlayer) && !(b.s.human || b.s.isPlayer));
}
function hlKeep(p) {
  if (!hlBetter(p) || !HL.frames.length) return;
  const from = Math.max(p.kills[0] - HL_PRE, G.time - HL_LEN);
  const clip = HL.frames.filter(f => f.t >= from);
  if (clip.length < 10) return;
  HL.best = { s: p.s, n: p.n, kills: p.kills.filter(t => t >= from), clip, name: p.s.name, cls: p.s.cls ? p.s.cls.name : '', team: p.s.team };
}
function hlRecord(dt) {
  if (!G || !G.soldiers) return;
  if (HL.g !== G) hlReset();
  if (G.over) return;
  for (const [k, p] of HL.pend) if (G.time >= p.due) { HL.pend.delete(k); hlKeep(p); }
  HL.acc += dt;
  if (HL.acc < 1 / KC_HZ) return;
  HL.acc %= 1 / KC_HZ;
  HL.frames.push(kcSnap());
  while (HL.frames.length && HL.frames[0].t < G.time - HL_LEN - 0.5) HL.frames.shift();
}
// called once the results screen is up: play the best play first, then show the results again
function hlOnOver() {
  if (HL.g !== G) return;
  for (const p of HL.pend.values()) hlKeep(p);   // a streak that was still going when the match ended
  HL.pend.clear();
  let btn = $('hlReplay');
  if (!btn) {
    btn = document.createElement('button'); btn.id = 'hlReplay'; btn.className = 'ghost';
    btn.onclick = () => { if (hlPlay()) $('over').hidden = true; };
    $('rematch').parentNode.insertBefore(btn, $('rematch'));
  }
  btn.hidden = !HL.best;
  if (HL.best) { btn.textContent = `Watch ${HL_NAMES[HL.best.n].toLowerCase()} again`; if (hlPlay()) $('over').hidden = true; }
}
function hlPlay() {
  const b = HL.best;
  if (!b || !G) return false;
  if (KC.on || KC.clip) { KC.hl = false; kcStop(); }
  KC.pend = null;
  KC.clip = b.clip; KC.killer = b.s; KC.slowAt = b.kills; KC.td = b.kills[b.kills.length - 1];
  KC.t0 = b.clip[0].t; KC.t1 = b.clip[b.clip.length - 1].t; KC.t = KC.t0;
  KC.label = `${b.name}${b.cls ? ' · ' + b.cls : ''} · ${TEAMS[b.team].name}`;
  KC.hl = true; KC.on = true;
  return true;
}
