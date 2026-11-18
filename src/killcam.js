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
  clip: null, killer: null, t: 0, t0: 0, t1: 0, saved: null, savedB: null, label: '',
};
const KC_LEN = 5, KC_HZ = 30, KC_SLOW = 0.6;

// ---------- recording (called once per rendered frame, after the simulation step)
function kcRecord(dt) {
  if (!KC.enabled || !G || !G.soldiers) { KC.frames.length = 0; return; }
  const P = G.player;
  // death: freeze the last 5 s, to replay once the death fall is over
  if (P && KC.wasAlive && !P.alive) kcCapture(P);
  if (P) { KC.wasAlive = P.alive; if (P.alive && KC.on) kcStop(); }
  if (KC.on) return;   // no need to record while watching
  KC.acc += dt;
  if (KC.acc < 1 / KC_HZ) return;
  KC.acc %= 1 / KC_HZ;
  const s = [];
  for (const q of G.soldiers) {
    if (!q.alive || q.x < -9000) continue;
    s.push([q, q.rx ?? q.x, q.ry ?? q.y, q.rfz ?? feetZ(q), q.ra ?? q.angle, q.pitch || 0, q.crouch ? 1 : 0, q.jz || 0, q.rwp ?? q.walkPhase ?? 0, q.lastShotT ?? -9, q.reloading ? 1 : 0, q.para || 0]);
  }
  const b = [];
  for (const u of G.bullets) if (b.length < 60) b.push({ x: u.x, y: u.y, z: u.z, vx: u.vx, vy: u.vy, vz: u.vz, sniper: u.sniper, pel: u.pel, team: u.team, life: u.life, gs: 9, seen: 1 });
  KC.frames.push({ t: G.time, s, b });
  while (KC.frames.length && KC.frames[0].t < G.time - KC_LEN - 0.5) KC.frames.shift();
}

function kcCapture(P) {
  const k = P.lastHitBy;
  if (!k || k.team === P.team || k === P || KC.frames.length < 10) { KC.clip = null; return; }
  const end = KC.frames[KC.frames.length - 1].t;
  KC.clip = KC.frames.filter(f => f.t >= end - KC_LEN);
  KC.frames = [];
  KC.killer = k; KC.t0 = KC.clip[0].t; KC.t1 = end; KC.t = KC.t0;
  KC.label = `${k.name}${k.cls ? ' · ' + k.cls.name : ''}`;
}

// starts after the death fall (cameraView's 2.2 s), unless you already respawned
function kcUpdate(dt) {
  const P = G && G.player;
  if (!P) return;
  if (!KC.on && KC.clip && !P.alive && (!R3.death || R3.death.t >= 2.2)) KC.on = true;
  if (!KC.on) return;
  const slow = KC.t > KC.t1 - KC_SLOW ? 0.35 : 1;
  KC.t += dt * slow;
  if (KC.t >= KC.t1 + 0.4) kcStop();
}
function kcStop() { KC.on = false; KC.clip = null; KC.killer = null; }

// the two recorded frames around time t and how far between them
function kcAt(t) {
  const c = KC.clip;
  let i = 0;
  while (i < c.length - 2 && c[i + 1].t <= t) i++;
  const a = c[i], b = c[Math.min(i + 1, c.length - 1)];
  return { a, b, f: b.t > a.t ? clamp((t - a.t) / (b.t - a.t), 0, 1) : 0 };
}

// ---------- playback: before the 3D view draws, pose everyone as recorded; afterwards put the real state back
const KC_FIELDS = ['x', 'y', 'rx', 'ry', 'rfz', 'ra', 'rwp', 'angle', 'pitch', 'alive', 'crouch', 'jz', 'para', 'lastShotT', 'reloading', 'walkPhase'];
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
    q.lastShotT = G.time - (KC.t - r[9]); q.reloading = !!r[10]; q.para = r[11];
  }
  // soldiers not in the recording at this moment are hidden for the frame
  for (const q of G.soldiers) if (!seen.has(q)) { const o = {}; for (const k of KC_FIELDS) o[k] = q[k]; saved.set(q, o); q.alive = false; }
  KC.saved = saved; KC.savedB = G.bullets; G.bullets = a.b;
}
function kcEnd() {
  if (!KC.saved) return;
  for (const [q, o] of KC.saved) for (const k of KC_FIELDS) q[k] = o[k];
  G.bullets = KC.savedB; KC.saved = null; KC.savedB = null;
}

// the camera: just behind and to the right of the killer's head, looking where they aim
function kcCamera() {
  const k = KC.killer;
  if (!KC.on || !k || !KC.saved) return null;
  const m = G.m, a = k.angle, p = clamp(k.pitch || 0, -0.6, 0.6);
  const ez = k.rfz + (k.crouch ? CFG.CROUCH_EYE : CFG.EYE) + 6;
  const back = 46, side = 16;
  let f = 1;
  for (let s = 0.2; s <= 1.0001; s += 0.1) {
    const x = k.x - Math.cos(a) * back * s - Math.sin(a) * side * s, y = k.y - Math.sin(a) * back * s + Math.cos(a) * side * s;
    if (x < 10 || y < 10 || x > W - 10 || y > H - 10 || blockedAt(m, x, y, ez)) { f = Math.max(0.15, s - 0.1); break; }
  }
  const x = k.x - Math.cos(a) * back * f - Math.sin(a) * side * f, y = k.y - Math.sin(a) * back * f + Math.cos(a) * side * f;
  return { fp: false, kc: true, x, y, z: Math.max(ez, elevAt(m, x, y) + 12), yaw: a, pitch: p };
}

// ---------- overlay
function kcOverlay() {
  if (!KC.on || !KC.clip) return;
  const D = '"Chakra Petch", sans-serif', bar = Math.round(VH * 0.07);
  ctx.fillStyle = 'rgba(0,0,0,0.85)'; ctx.fillRect(0, 0, VW, bar); ctx.fillRect(0, VH - bar, VW, bar);
  ctx.fillStyle = 'rgba(255,40,30,0.06)'; ctx.fillRect(0, bar, VW, VH - bar * 2);
  txt('KILL CAM', 24, bar / 2, `800 20px ${D}`, '#ff5a4e', 'left', 'middle');
  txt(`Killed by ${KC.label}`, VW / 2, bar / 2, `700 18px ${D}`, '#ffffff', 'center', 'middle');
  txt('Space to skip', VW - 24, bar / 2, `500 13px "IBM Plex Mono", monospace`, '#b8c0b4', 'right', 'middle');
  const p = clamp((KC.t - KC.t0) / Math.max(0.1, KC.t1 - KC.t0), 0, 1);
  ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(VW * 0.3, VH - bar / 2 - 2, VW * 0.4, 4);
  ctx.fillStyle = '#ff5a4e'; ctx.fillRect(VW * 0.3, VH - bar / 2 - 2, VW * 0.4 * p, 4);
  if (KC.t > KC.t1 - KC_SLOW) txt('SLOW MOTION', VW / 2, VH - bar - 18, `700 13px ${D}`, '#ffd27a', 'center', 'middle');
}

window.addEventListener('keydown', e => {
  if (KC.on && e.code === 'Space') { e.preventDefault(); e.stopImmediatePropagation(); kcStop(); }
}, true);
