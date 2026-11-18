'use strict';
// Game feel (preview): the techniques most modern shooters layer on top of a fixed-rate simulation.
//  1. Render interpolation: the simulation ticks at 60 Hz, the screen refreshes at 60-240 Hz and never exactly in
//     step. Drawing the last tick as-is makes motion judder (a tick is shown twice, or one is skipped). We keep the
//     previous tick and draw a blend between the two by how far we are into the next tick.
//  2. Springs instead of straight lerps and linear decays for the camera and the weapon: recoil kicks and settles,
//     the weapon lags behind the mouse and swings back, landings dip, sprinting blends in and out.
//  3. Movement-driven head bob and footsteps: two steps per stride, phase taken from distance walked so the camera,
//     the sounds and the third-person legs all agree.
// ?smooth=0 starts with all of it off, and F7 flips it during a match to compare.

const FEEL = {
  on: params.get('smooth') !== '0',
  alpha: 1,
  // camera
  eyeOff: null, bobAmt: 0, roll: 0, fovKick: 0, land: { x: 0, v: 0 }, recoilP: { x: 0, v: 0 }, recoilY: { x: 0, v: 0 },
  lastJz: 0, lastAir: false, stepPhase: 0,
  // weapon
  sway: { x: { x: 0, v: 0 }, y: { x: 0, v: 0 } }, kick: { x: 0, v: 0 }, sprintT: 0, moveT: 0, lastYaw: null, lastPitch: 0,
  // adaptive resolution
  ft: 1 / 60, pr: 1, prT: 0,
};

// critically damped-ish spring step: k stiffness, d damping
function springStep(s, target, k, d, dt) {
  const a = (target - s.x) * k - s.v * d;
  s.v += a * dt; s.x += s.v * dt;
  return s.x;
}

// ---------- 1. interpolation
function feelSnapshot() {
  if (!G) return;
  for (const s of G.soldiers) { s._px = s.x; s._py = s.y; s._pfz = s.alive && s.x > -9000 ? feetZ(s) : 0; s._pa = s.angle; s._pw = s.walkPhase; s._palive = s.alive; }
}
function feelInterpolate(alpha) {
  if (!G) return;
  const on = FEEL.on;
  FEEL.alpha = alpha;
  for (const s of G.soldiers) {
    const fz = s.alive && s.x > -9000 ? feetZ(s) : 0;
    // teleports (spawns, parachute drops) and the online view of others (already interpolated) are drawn as they are
    if (!on || s._px === undefined || !s._palive || !s.alive || Math.abs(s.x - s._px) + Math.abs(s.y - s._py) > 60 || (G.online && s !== G.player)) {
      s.rx = s.x; s.ry = s.y; s.rfz = fz; s.ra = s.angle; s.rwp = s.walkPhase; continue;
    }
    s.rx = lerp(s._px, s.x, alpha); s.ry = lerp(s._py, s.y, alpha); s.rfz = lerp(s._pfz, fz, alpha);
    s.ra = s._pa + angDiff(s._pa, s.angle) * alpha; s.rwp = lerp(s._pw, s.walkPhase, alpha);
  }
}
// the online client predicts its own soldier at 60 Hz too: same blend for it
function feelOwnPrev(P) { P._px = P.x; P._py = P.y; P._pfz = feetZ(P); P._pa = P.angle; P._pw = P.walkPhase; P._palive = P.alive; }

// ---------- 2 + 3. first-person camera
// Returns offsets to add to the plain first-person view.
function feelCamera(P, dt) {
  const F = FEEL, reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const out = { dz: 0, dx: 0, dy: 0, pitch: 0, yaw: 0, roll: 0, fov: 0 };
  if (!F.on) return out;
  const yaw = R3.look.yaw;
  const spd = Math.hypot(P.vx || 0, P.vy || 0), grounded = !((P.jz || 0) > 0.5) && !(P.para > 0) && !P.vault;
  const sprint = spd > CFG.WALK * 1.15;
  // eye height glides when crouching or standing up instead of snapping
  const eyeT = P.crouch ? CFG.CROUCH_EYE : CFG.EYE;
  if (F.eyeOff === null) F.eyeOff = eyeT;
  F.eyeOff += (eyeT - F.eyeOff) * (1 - Math.exp(-dt * 12));
  out.dz += F.eyeOff - eyeT;
  // head bob: vertical twice per stride (each footfall), sideways once; grows with speed
  const bobT = grounded ? clamp(spd / CFG.WALK, 0, 1.6) * (P.ads ? 0.25 : 1) : 0;
  F.bobAmt += (bobT - F.bobAmt) * (1 - Math.exp(-dt * 8));
  const ph = P.rwp ?? P.walkPhase, k = reduce ? 0.3 : 1;
  out.dz += -Math.abs(Math.sin(ph)) * 1.6 * F.bobAmt * k + 0.8 * F.bobAmt * k;
  const side = Math.sin(ph) * 0.9 * F.bobAmt * k;
  out.dx += -Math.sin(yaw) * side; out.dy += Math.cos(yaw) * side;
  out.roll += Math.sin(ph) * 0.006 * F.bobAmt * k;
  // footsteps on each footfall (phase crossing a multiple of pi)
  const step = Math.floor(ph / Math.PI);
  if (grounded && spd > 25 && step !== F.stepPhase) SFX.step && SFX.step(sprint ? 0.16 : 0.1, P.crouch);
  F.stepPhase = step;
  // strafe lean: a slight roll toward the side you move
  const lat = (-(P.vx || 0) * Math.sin(yaw) + (P.vy || 0) * Math.cos(yaw)) / CFG.WALK;
  F.roll += (clamp(lat, -1.3, 1.3) * 0.018 - F.roll) * (1 - Math.exp(-dt * 8));
  out.roll += reduce ? 0 : F.roll;
  // landing: a dip that springs back
  const air = !grounded;
  if (F.lastAir && !air) { const hard = clamp(Math.abs(P.jv || 0) / 200 + 0.6, 0.6, 1.5); F.land.v -= 55 * hard; }
  F.lastAir = air;
  springStep(F.land, 0, 260, 22, dt);
  out.dz += F.land.x * k; out.pitch += F.land.x * 0.004 * k;
  // recoil: kick up and a little sideways, then settle (springs, not a linear fade)
  springStep(F.recoilP, 0, 180, 20, dt); springStep(F.recoilY, 0, 180, 20, dt);
  out.pitch += F.recoilP.x; out.yaw += F.recoilY.x;
  // sprinting widens the view a few degrees
  F.fovKick += ((sprint && grounded && !P.ads ? 6 : 0) - F.fovKick) * (1 - Math.exp(-dt * 6));
  out.fov = reduce ? 0 : F.fovKick;
  return out;
}
function feelShot(P) {
  if (!FEEL.on) return;
  const k = P.cls.key, up = k === 'sniper' ? 0.6 : k === 'shotgun' ? 0.5 : k === 'lmg' ? 0.18 : k === 'pistol' ? 0.14 : 0.2;
  const ads = P.ads ? 0.6 : 1;
  FEEL.recoilP.v += up * ads; FEEL.recoilY.v += (Math.random() - 0.5) * up * 0.5 * ads;
  FEEL.kick.v += (k === 'sniper' || k === 'shotgun' ? 9 : 4) * (P.ads ? 0.6 : 1);
}

// ---------- weapon: sway lag, bob, sprint blend, recoil spring
function feelWeapon(P, dt, vm, base) {
  const F = FEEL;
  if (!F.on) return false;
  const yaw = R3.look.yaw, pitch = R3.look.pitch;
  const dyaw = F.lastYaw === null ? 0 : angDiff(F.lastYaw, yaw), dpitch = pitch - F.lastPitch;
  F.lastYaw = yaw; F.lastPitch = pitch;
  // the weapon trails the view: mouse movement pushes the target, a spring pulls it back
  const ad = base.ads;
  const sx = clamp(-dyaw / Math.max(dt, 1e-3) * 0.004, -0.05, 0.05) * (1 - ad * 0.8), sy = clamp(dpitch / Math.max(dt, 1e-3) * 0.004, -0.05, 0.05) * (1 - ad * 0.8);
  springStep(F.sway.x, sx, 120, 14, dt); springStep(F.sway.y, sy, 120, 14, dt);
  const spd = Math.hypot(P.vx || 0, P.vy || 0), grounded = !((P.jz || 0) > 0.5) && !(P.para > 0);
  F.moveT += ((grounded ? clamp(spd / CFG.WALK, 0, 1.5) : 0) - F.moveT) * (1 - Math.exp(-dt * 8));
  F.sprintT += ((base.sprint ? 1 : 0) - F.sprintT) * (1 - Math.exp(-dt * 9));
  springStep(F.kick, 0, 260, 20, dt);
  const ph = P.rwp ?? P.walkPhase, mv = F.moveT * (1 - ad * 0.85), sp = F.sprintT;
  // figure-eight bob in step with the camera
  const bx = Math.sin(ph) * 0.018 * mv, by = -Math.abs(Math.cos(ph)) * 0.012 * mv;
  const breathe = Math.sin(performance.now() / 1300) * 0.003 * (1 - ad * 0.7);
  const rl = base.reload;
  vm.position.set(
    lerp(0.12, 0, ad) + bx + F.sway.x.x + sp * 0.04,
    lerp(-0.11, -0.062, ad) + by + breathe + F.sway.y.x - sp * 0.03 - rl * 0.1 + F.land.x * 0.0012,
    lerp(-0.2, -0.17, ad) + F.kick.x * 0.004 + sp * 0.02);
  vm.rotation.set(
    F.kick.x * 0.02 * (1 - ad * 0.6) + rl * 0.5 - sp * 0.35 + F.sway.y.x * 1.5,
    lerp(0.04, 0, ad) * (1 - sp) + sp * 0.55 + F.sway.x.x * 2,
    rl * 0.6 + bx * 2 - F.sway.x.x * 1.2);
  return true;
}

// ---------- adaptive resolution: drop render scale when frames run long, raise it back when there is headroom
function feelResolution(dt) {
  if (!FEEL.on || !R3.ok) return;
  const F = FEEL;
  F.ft = lerp(F.ft, dt, 0.05);
  F.prT += dt;
  if (F.prT < 2) return;
  const max = Math.min(1.5, window.devicePixelRatio || 1);
  let pr = F.pr;
  if (F.ft > 1 / 40 && pr > 0.6) pr = Math.max(0.6, pr - 0.15);
  else if (F.ft < 1 / 70 && pr < max) pr = Math.min(max, pr + 0.1);
  if (pr !== F.pr) { F.pr = pr; F.prT = 0; gl3.setPixelRatio(pr); gl3.setSize(window.innerWidth, window.innerHeight, false); }
  else F.prT = 1.5;
}

window.addEventListener('keydown', e => {
  if (e.code !== 'F7') return;
  e.preventDefault();
  FEEL.on = !FEEL.on;
  if (!FEEL.on && R3.ok) { gl3.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1)); gl3.setSize(window.innerWidth, window.innerHeight, false); }
  FEEL.pr = Math.min(1.5, window.devicePixelRatio || 1);
  if (G) message(FEEL.on ? 'Smooth feel ON (F7 to compare)' : 'Smooth feel OFF: the current game (F7 to compare)', '#e6ad45', 2.5);
});
