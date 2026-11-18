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
const KC_LEN = 5, KC_AFTER = 1, KC_HZ = 30;   // 5 s before your death and 1 s after it (your body falling)

// ---------- recording (called once per rendered frame, after the simulation step)
function kcRecord(dt) {
  if (!KC.enabled || !G || !G.soldiers) { KC.frames.length = 0; return; }
  const P = G.player;
  // death: keep recording one more second (your body going down), then freeze the clip for the replay
  if (P && KC.wasAlive && !P.alive) { const k = P.lastHitBy; KC.pend = k && k !== P && k.team !== P.team ? { k, td: G.time } : null; KC.clip = null; KC.wait = 2.3; }
  if (P) { KC.wasAlive = P.alive; if (P.alive) { KC.pend = null; if (KC.on || KC.clip) kcStop(); } }
  if (KC.pend && G.time >= KC.pend.td + KC_AFTER) kcCapture();
  if (KC.on) return;   // no need to record while watching
  KC.acc += dt;
  if (KC.acc < 1 / KC_HZ) return;
  KC.acc %= 1 / KC_HZ;
  const s = [];
  for (const q of G.soldiers) {
    if (!q.alive || q.x < -9000) continue;
    s.push([q, q.rx ?? q.x, q.ry ?? q.y, q.rfz ?? feetZ(q), q.ra ?? q.angle, q.pitch || 0, q.crouch ? 1 : 0, q.jz || 0, q.rwp ?? q.walkPhase ?? 0, q.lastShotT ?? -9, q.reloading ? 1 : 0, q.para || 0, q.ads ? 1 : 0, q.scoped ? 1 : 0]);
  }
  const b = [];
  for (const u of G.bullets) if (b.length < 60) b.push({ x: u.x, y: u.y, z: u.z, vx: u.vx, vy: u.vy, vz: u.vz, sniper: u.sniper, pel: u.pel, team: u.team, life: u.life, gs: 9, seen: 1 });
  KC.frames.push({ t: G.time, s, b });
  while (KC.frames.length && KC.frames[0].t < G.time - KC_LEN - KC_AFTER - 0.5) KC.frames.shift();
}

function kcCapture() {
  const { k, td } = KC.pend; KC.pend = null;
  if (KC.frames.length < 10) { KC.clip = null; return; }
  const end = KC.frames[KC.frames.length - 1].t;
  KC.clip = KC.frames.filter(f => f.t >= td - KC_LEN);
  KC.frames = [];
  KC.killer = k; KC.td = td; KC.t0 = KC.clip[0].t; KC.t1 = end; KC.t = KC.t0;
  KC.label = `${k.name}${k.cls ? ' · ' + k.cls.name : ''}`;
}

// starts after the death fall (cameraView's 2.2 s), unless you already respawned
function kcUpdate(dt) {
  const P = G && G.player;
  if (!P) return;
  KC.wait -= dt;
  if (!KC.on && KC.clip && !P.alive && (R3.death ? R3.death.t >= 2.2 : KC.wait <= 0)) KC.on = true;   // after the 2.2 s death fall
  if (!KC.on) return;
  const slow = KC.t > KC.td - 0.5 && KC.t < KC.td + 0.25 ? 0.35 : 1;   // slow motion around the killing shot
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
  txt('KILL CAM', 24, bar / 2, `800 20px ${D}`, '#ff5a4e', 'left', 'middle');
  txt(`Killed by ${KC.label}`, VW / 2, bar / 2, `700 18px ${D}`, '#ffffff', 'center', 'middle');
  txt('Space to skip', VW - 24, bar / 2, `500 13px "IBM Plex Mono", monospace`, '#b8c0b4', 'right', 'middle');
  const p = clamp((KC.t - KC.t0) / Math.max(0.1, KC.t1 - KC.t0), 0, 1);
  ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(VW * 0.3, VH - bar / 2 - 2, VW * 0.4, 4);
  ctx.fillStyle = '#ff5a4e'; ctx.fillRect(VW * 0.3, VH - bar / 2 - 2, VW * 0.4 * p, 4);
  if (KC.t > KC.td - 0.5 && KC.t < KC.td + 0.25) txt('SLOW MOTION', VW / 2, VH - bar - 18, `700 13px ${D}`, '#ffd27a', 'center', 'middle');
}

window.addEventListener('keydown', e => {
  if (KC.on && e.code === 'Space') { e.preventDefault(); e.stopImmediatePropagation(); kcStop(); }
}, true);
