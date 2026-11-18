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
  flinch: { x: 0, v: 0 }, flinchCam: { x: 0, v: 0 }, lastHurt: 0, throwT: 9, lastNades: null, seat: { x: 0, v: 0 }, seated: false,
  brass: [], eject: [],
  // adaptive resolution
  ft: 1 / 60, pr: 1, prT: 0,
};

// critically damped-ish spring step: k stiffness, d damping
// sub-stepped (semi-implicit Euler at <= 1/120 s), so a slow frame can never make a stiff spring blow up
function springStep(s, target, k, d, dt) {
  dt = Math.min(dt, 0.1);
  const n = Math.max(1, Math.ceil(dt * 120)), h = dt / n;
  for (let i = 0; i < n; i++) { s.v += ((target - s.x) * k - s.v * d) * h; s.x += s.v * h; }
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
  // getting hit jolts the view a little (spring, not a shake)
  springStep(F.flinchCam, 0, 200, 16, dt);
  out.roll += F.flinchCam.x * 0.6 * k; out.pitch += F.flinchCam.x * 0.25 * k;
  // sprinting widens the view a few degrees
  F.fovKick += ((sprint && grounded && !P.ads ? 6 : 0) - F.fovKick) * (1 - Math.exp(-dt * 6));
  out.fov = reduce ? 0 : F.fovKick;
  return out;
}
function feelShot(P) {
  if (!FEEL.on) return;
  const k = P.cls.key, up = k === 'sniper' ? 0.6 : k === 'shotgun' ? 0.5 : k === 'lmg' ? 0.18 : k === 'pistol' ? 0.14 : 0.2;
  const ads = P.ads ? 0.6 : 1;
  FEEL.recoilP.v += up * ads * 0.4;   // a small visual kick on top of the real aim recoil (ui.js)
  FEEL.recoilY.v += (Math.random() - 0.5) * up * 0.5 * ads;
  FEEL.kick.v += (k === 'sniper' || k === 'shotgun' ? 9 : 4) * (P.ads ? 0.6 : 1);
  // a spent case flies out of the ejection port: at once for self-loaders, on the pump or bolt for the others
  FEEL.eject.push({ t: k === 'shotgun' ? 0.32 : k === 'sniper' ? 0.36 : 0, shell: k === 'shotgun' });
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
  // weapon switch / spawn: the gun swings up from below
  R3.drawT = Math.min(1, (R3.drawT ?? 1) + dt / 0.38);
  const dr = 1 - (1 - R3.drawT) ** 3, down = 1 - dr;
  // grenade throw: the gun dips out of the way, then comes back
  if (F.lastNades !== null && P.nades < F.lastNades) F.throwT = 0;
  F.lastNades = P.nades; F.throwT += dt;
  const th = F.throwT < 0.6 ? Math.sin(F.throwT / 0.6 * Math.PI) : 0;
  // hit: a sideways jolt on the weapon and the view
  if (G.hurtT > F.lastHurt + 0.05) { const d = Math.random() < 0.5 ? -1 : 1; F.flinch.v += 6 * d; F.flinchCam.v += 0.35 * d; }
  F.lastHurt = G.hurtT;
  springStep(F.flinch, 0, 160, 14, dt);
  // reload: the magazine drops out, a fresh one comes up and is slapped home (the whole gun jolts)
  const mag = vm.getObjectByName('mag');
  if (mag) {
    const p = P.reloading ? clamp(1 - P.reloadT / P.reloadMax, 0, 1) : 1;
    const out = p < 0.18 ? 0 : p < 0.38 ? (p - 0.18) / 0.2 : p < 0.62 ? 1 : p < 0.82 ? 1 - (p - 0.62) / 0.2 : 0;
    const e = out * out * (3 - 2 * out);
    mag.position.set(0, -e * 0.9, e * 0.12); mag.rotation.x = e * 0.35; mag.visible = e < 0.98;
    if (P.reloading && p >= 0.82 && !F.seated) { F.seated = true; F.seat.v += 9; }
    if (!P.reloading || p < 0.5) F.seated = false;
  }
  springStep(F.seat, 0, 300, 18, dt);
  const fx = F.flinch.x * 0.004, seat = F.seat.x * 0.003;
  vm.position.set(
    lerp(0.12, 0, ad) + bx + F.sway.x.x + sp * 0.04 + fx + down * 0.05,
    lerp(-0.11, -0.062, ad) + by + breathe + F.sway.y.x - sp * 0.03 - rl * 0.1 + F.land.x * 0.0012 + seat - down * 0.2 - th * 0.16,
    lerp(-0.2, -0.17, ad) + F.kick.x * 0.004 + sp * 0.02 + down * 0.05);
  vm.rotation.set(
    F.kick.x * 0.02 * (1 - ad * 0.6) + rl * 0.5 - sp * 0.35 + F.sway.y.x * 1.5 - down * 0.9 - th * 0.7 + seat * 3,
    lerp(0.04, 0, ad) * (1 - sp) + sp * 0.55 + F.sway.x.x * 2 + down * 0.3,
    rl * 0.6 + bx * 2 - F.sway.x.x * 1.2 + fx * 8 + down * 0.5 + th * 0.4);
  feelBrass(dt, vm);
  return true;
}

// ---------- spent cases: little brass (or red shotgun) cylinders that tumble out to the right and fall away
let BRASS_GEO = null, BRASS_MAT = null, SHELL_MAT = null;
function feelBrass(dt, vm) {
  const F = FEEL;
  if (!BRASS_GEO) {
    BRASS_GEO = new THREE.CylinderGeometry(0.0035, 0.0035, 0.013, 8).rotateZ(Math.PI / 2);
    BRASS_MAT = new THREE.MeshStandardMaterial({ color: '#c99a3c', metalness: 0.9, roughness: 0.3 });
    SHELL_MAT = new THREE.MeshStandardMaterial({ color: '#a8262a', metalness: 0.2, roughness: 0.5 });
  }
  for (let i = F.eject.length - 1; i >= 0; i--) {
    const e = F.eject[i]; e.t -= dt;
    if (e.t > 0) continue;
    F.eject.splice(i, 1);
    if (F.brass.length > 14) { const o = F.brass.shift(); vmScene.remove(o.m); }
    const m = new THREE.Mesh(BRASS_GEO, e.shell ? SHELL_MAT : BRASS_MAT);
    if (e.shell) m.scale.set(1.5, 1.9, 1.9);
    vm.updateMatrixWorld(true);
    const port = new THREE.Vector3(0.03, 0.14, -0.1); vm.children[0].localToWorld(port);
    m.position.copy(port); m.frustumCulled = false; vmScene.add(m);
    F.brass.push({ m, vx: 0.55 + Math.random() * 0.25, vy: 0.5 + Math.random() * 0.3, vz: 0.1 + Math.random() * 0.15, sx: (Math.random() - 0.5) * 30, sy: (Math.random() - 0.5) * 30, life: 0.7 });
  }
  for (let i = F.brass.length - 1; i >= 0; i--) {
    const b = F.brass[i]; b.life -= dt; b.vy -= 3.2 * dt;
    b.m.position.x += b.vx * dt; b.m.position.y += b.vy * dt; b.m.position.z += b.vz * dt;
    b.m.rotation.x += b.sx * dt; b.m.rotation.y += b.sy * dt;
    if (b.life <= 0) { vmScene.remove(b.m); F.brass.splice(i, 1); }
  }
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
