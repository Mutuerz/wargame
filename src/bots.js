'use strict';
// Bot soldiers: objective choice, path following, target scanning and shooting.

function newBrain() {
  return {
    obj: null, objT: 0, path: null, pi: 0, goal: null, repathT: 0,
    enemy: null, vis: false, seeT: 0, scanT: Math.random() * 0.2, react: 0, aimErr: 0.3,
    burst: 0, pause: 0, strafeDir: 1, strafeT: 0, lookA: 0, lookT: 0,
    stuckClock: 0, lx: 0, ly: 0, stuck: 0, nudgeT: 0, nudgeA: 0,
    bias: [0, 0, 0, 0, 0].map(() => Math.random() * 900),
    defender: Math.random() < 0.2, role: null,
  };
}
function resetBrain(s) {
  const b = s.bot;
  b.obj = null; b.objT = 0; b.path = null; b.enemy = null; b.vis = false; b.seeT = 0; b.stuck = 0;
  b.lx = s.x; b.ly = s.y;
  if (b.role === 'sapper' && s.c4 <= 0) b.role = null;
}

function scan(s) {
  const b = s.bot, sk = G.skill;
  const near = Math.min(sk.range, visionRange(s)), far = s.scoped ? s.cls.scopeRange : 0;
  let best = null, bd = Math.max(near, far) ** 2;
  for (const e of G.soldiers) {
    if (!e.alive || e.team === s.team) continue;
    const d = dist2(s.x, s.y, e.x, e.y);
    if (d >= bd) continue;
    if (d > near * near && Math.abs(angDiff(s.angle, Math.atan2(e.y - s.y, e.x - s.x))) > s.cls.scopeCone) continue;
    // aim at the chest, or at the head when only the head shows over cover
    const ez = eyeZ(s), cz = chestZ(e), hz = feetZ(e) + CFG.BODY_H - 5;
    let az = cz;
    if (!los3(G.m, s.x, s.y, ez, e.x, e.y, cz)) { if (!los3(G.m, s.x, s.y, ez, e.x, e.y, hz)) continue; az = hz; }
    bd = d; best = e; b.aimZ = az - feetZ(e);
  }
  if (!best) {
    // no soldier in sight: shoot at enemy transport carts
    for (const c of G.carts) {
      if (c.team === s.team) continue;
      const d = dist2(s.x, s.y, c.x, c.y);
      if (d < near * near && los3(G.m, s.x, s.y, eyeZ(s), c.x, c.y, elevAt(G.m, c.x, c.y) + 24)) { best = c; b.aimZ = 24; break; }
    }
  }
  if (best) {
    best.spotted[s.team] = G.time;
    if (b.enemy !== best) { b.react = rand(sk.react[0], sk.react[1]); b.aimErr = rand(sk.aimErr[0], sk.aimErr[1]); }
    b.enemy = best; b.vis = true; b.seeT = 2.5;
  } else {
    b.vis = false;
    if (b.enemy && !b.enemy.alive) b.enemy = null;
  }
}

function enemiesAt(p, team) { return team === 0 ? p.c1 : p.c0; }

function chooseObjective(s) {
  const b = s.bot, m = G.m, t = s.team;
  // 1. defuse C4 on our bridge
  const c4 = G.c4s.find(c => c.bridge === t);
  if (c4 && dist(s.x, s.y, c4.x, c4.y) < 1500) { b.obj = { type: 'defuse', x: c4.x, y: c4.y }; return; }
  // 1b. bridge guard: one bot per team watches its own bridge
  if (b.guard && !m.bridges[t].destroyed) {
    const br = m.bridges[t], gx = br.cx + (t === 0 ? 260 : -260);
    if (!b.obj || b.obj.type !== 'guard' || Math.random() < 0.3) { const f = randomFreeNear(m, gx, br.cy, 160); b.obj = { type: 'guard', x: f.x, y: f.y }; }
    return;
  }
  // 2. sapper run
  if (b.role === 'sapper') {
    const br = m.bridges[1 - t];
    if (s.c4 > 0 && !br.destroyed && !G.c4s.some(c => c.bridge === br.team)) { b.obj = { type: 'plant', x: br.cx, y: br.cy }; return; }
    b.role = null;
  }
  // 3. supplies
  const ammo = ammoTotal(s), hpMax = maxHp(s);
  const need = ammo < Math.min(30, s.cls.mag * 1.2) || s.hp < hpMax * 0.5;
  const want = ammo < ammoFull(s) - 10 || s.hp < hpMax * 0.85;
  let tgt = null, td = Infinity;
  for (const c of G.caches) if (c.team === t) { const d = dist(s.x, s.y, c.x, c.y); if (d < td) { td = d; tgt = c; } }
  for (const d of G.drops) if (d.fall <= 0) { const dd = dist(s.x, s.y, d.x, d.y); if (dd < td) { td = dd; tgt = d; } }
  if (tgt && ((need && td < 2600) || (want && td < 650))) { b.obj = { type: 'supply', x: tgt.x, y: tgt.y }; return; }
  // 4. capture points
  let best = 0, bs = Infinity;
  m.points.forEach((p, i) => {
    const d = dist(s.x, s.y, p.x, p.y);
    let sc = d + b.bias[i];
    if (p.owner === t) {
      sc += b.defender ? 200 : 2400;
      if (enemiesAt(p, t) > 0) sc -= 2000;
    } else if (p.owner === -1) sc -= 150;
    if (sc < bs) { bs = sc; best = i; }
  });
  if (b.obj && b.obj.type === 'cap' && b.obj.p === best) return;
  if (b.obj && b.obj.type === 'perch' && b.obj.p === best && G.time < b.obj.until) return;
  const p = m.points[best];
  // snipers (and some defenders) watch the point from the upper floor of a nearby house
  if ((sniper(s) ? 0.55 : b.defender ? 0.3 : 0.06) > Math.random()) {
    const perch = perchSpot(s, p);
    if (perch) { b.obj = Object.assign({ type: 'perch', p: best, until: G.time + rand(25, 50) }, perch); return; }
  }
  const spot = randomFreeNear(m, p.x, p.y, CFG.CAP_R * 0.65);
  b.obj = { type: 'cap', p: best, x: spot.x, y: spot.y };
}

const sniper = s => s.cls === CLASSES.sniper;
// A spot by an upper-floor window of a two-storey house near point p, facing the enemy side.
function perchSpot(s, p) {
  const m = G.m, ex = s.team === 0 ? 1 : -1;
  const houses = m.houses.filter(f => f.stories === 2 && dist(f.x + f.w / 2, f.y + f.h / 2, p.x, p.y) < 1000 &&
    !G.soldiers.some(o => o !== s && o.alive && o.team === s.team && o.bot && o.bot.obj && o.bot.obj.house === f));
  if (!houses.length) return null;
  const f = pickRand(houses), cx = f.x + f.w / 2, cy = f.y + f.h / 2;
  const wins = m.solids.filter(o => o.window && o.up && o.x >= f.x - 1 && o.x + o.w <= f.x + f.w + 1 && o.y >= f.y - 1 && o.y + o.h <= f.y + f.h + 1);
  let best = null, bs = -Infinity;
  for (const o of wins) {
    const wx = o.x + o.w / 2, wy = o.y + o.h / 2;
    const nx = wx - cx, ny = wy - cy, nl = Math.hypot(nx, ny) || 1;
    const spot = { x: wx - nx / nl * 30, y: wy - ny / nl * 30 };
    if (o.w > o.h) spot.x = wx; else spot.y = wy;
    spot.y = clamp(spot.y, f.y + 32, f.y + f.h - 32); spot.x = clamp(spot.x, f.x + 32, f.x + f.w - 32);
    if (o.w > o.h) spot.y = wy < cy ? f.y + 34 : f.y + f.h - 34; else spot.x = wx < cx ? f.x + 34 : f.x + f.w - 34;
    const st = f.stair;
    if (spot.x > st.rx - 20 && spot.x < st.rx + st.rw + 20 && spot.y > st.ry - 20 && spot.y < st.ry + st.rh + 20) continue;
    const sc = (nx / nl) * ex * 2 + Math.random() - dist(wx, wy, p.x, p.y) / 1500;
    if (sc > bs) { bs = sc; best = { x: spot.x, y: spot.y, look: Math.atan2(ny, nx) }; }
  }
  if (!best) return null;
  return Object.assign(best, { house: f, up: true });
}
// Points just outside each end of a staircase (where you step on and off).
function stairEnds(st) {
  const dx = st.x1 - st.x0, dy = st.y1 - st.y0, l = Math.hypot(dx, dy), ux = dx / l, uy = dy / l;
  return { bot: { x: st.x0 - ux * 22, y: st.y0 - uy * 22 }, low: { x: st.x0 + ux * 6, y: st.y0 + uy * 6 },
    high: { x: st.x1 - ux * 6, y: st.y1 - uy * 6 }, top: { x: st.x1 + ux * 26, y: st.y1 + uy * 26 } };
}
const toward = (s, p) => { const dx = p.x - s.x, dy = p.y - s.y, d = Math.hypot(dx, dy) || 1; return [dx / d, dy / d, d]; };

// Movement toward (tx, ty), handling upper floors: down the stairs first, or up them when the goal is upstairs.
function followPath(s, tx, ty, dt, goalUp) {
  const b = s.bot, m = G.m;
  if (s.z > 2 || goalUp) {
    const here = houseAt(m, s.x, s.y), goalHouse = goalUp ? houseAt(m, tx, ty) : null;
    if (s.z > 2 && here && here.stair) {
      const st = here.stair, e = stairEnds(st);
      if (goalHouse === here) {
        if (s.z >= CFG.FLOOR_H - 1) { const [x, y, d] = toward(s, { x: tx, y: ty }); return d < 16 ? [0, 0] : [x, y]; }
        const [x, y] = toward(s, e.top); return [x, y];
      }
      // going down: to the top of the stairs, then down to the bottom and off
      if (inStair(st, s.x, s.y)) { const [x, y] = toward(s, e.bot); return [x, y]; }
      const [x, y, d] = toward(s, e.high);
      return [x, y];
    }
    if (goalHouse && goalHouse.stair && s.z <= 2) {
      const st = goalHouse.stair, e = stairEnds(st);
      if (inStair(st, s.x, s.y)) { const [x, y] = toward(s, e.top); return [x, y]; }
      if (dist(s.x, s.y, e.bot.x, e.bot.y) < 18) { const [x, y] = toward(s, e.low); return [x, y]; }
      tx = e.bot.x; ty = e.bot.y;
    }
  }
  const dx = tx - s.x, dy = ty - s.y, dGoal = Math.hypot(dx, dy);
  if (dGoal < 16) return [0, 0];
  if (dGoal < 160 && walkLine(m, s.x, s.y, tx, ty)) { b.path = null; return [dx / dGoal, dy / dGoal]; }
  b.repathT -= dt;
  const goalMoved = !b.goal || dist(b.goal.x, b.goal.y, tx, ty) > 90;
  if ((!b.path || goalMoved || b.repathT <= 0) && G.pathBudget > 0) {
    G.pathBudget--;
    b.goal = { x: tx, y: ty };
    b.path = findPath(m, s.x, s.y, tx, ty); b.pi = 0;
    b.repathT = 5 + Math.random() * 3;
  }
  if (b.path && b.pi < b.path.length) {
    let wp = b.path[b.pi], d = dist(wp.x, wp.y, s.x, s.y);
    while (d < 24 && b.pi < b.path.length - 1) { b.pi++; wp = b.path[b.pi]; d = dist(wp.x, wp.y, s.x, s.y); }
    if (d < 1) return [0, 0];
    return [(wp.x - s.x) / d, (wp.y - s.y) / d];
  }
  return [dx / dGoal, dy / dGoal];
}

function botThink(s, dt) {
  const b = s.bot, sk = G.skill, m = G.m;
  const ctl = { mx: 0, my: 0, fire: false, sprint: false, reload: false, interact: false, scope: false, aimX: s.x + Math.cos(s.angle) * 300, aimY: s.y + Math.sin(s.angle) * 300, pitch: s.pitch * 0.9 };
  const sniper = s.cls === CLASSES.sniper;
  const perched = b.obj && b.obj.type === 'perch' && s.z >= CFG.FLOOR_H - 1 && dist(s.x, s.y, b.obj.x, b.obj.y) < 30;
  b.nadeCD = (b.nadeCD || 0) - dt;

  b.scanT -= dt;
  if (b.scanT <= 0) { b.scanT = 0.18 + Math.random() * 0.08; scan(s); }
  if (b.enemy && !b.enemy.alive) { b.enemy = null; b.vis = false; }
  b.seeT -= dt;
  if (b.seeT <= 0 && !b.vis) b.enemy = null;

  b.objT -= dt;
  if (b.objT <= 0 || !b.obj) { chooseObjective(s); b.objT = 3 + Math.random() * 2.5; }

  // react to being shot by someone we cannot see
  if (!b.enemy && G.time - s.lastHitT < 1.2 && s.lastHitBy && s.lastHitBy.alive) {
    b.lookA = Math.atan2(s.lastHitBy.y - s.y, s.lastHitBy.x - s.x); b.lookT = 1.5;
  }

  const e = b.enemy;
  let moveX = 0, moveY = 0;
  if (e) {
    const dx = e.x - s.x, dy = e.y - s.y, d = Math.hypot(dx, dy) || 1;
    const lead = d / s.cls.bulletSpeed;
    ctl.aimX = e.x; ctl.aimY = e.y;
    const want = Math.atan2(e.y + e.vy * lead - s.y, e.x + e.vx * lead - s.x) + b.aimErr * Math.sin(G.time * 2.1 + s.id);
    s.angle = turnTo(s.angle, want, sk.turn * dt);
    const tz = (e.isCart ? elevAt(m, e.x, e.y) : feetZ(e)) + (b.aimZ ?? 22);
    ctl.pitch = Math.atan2(tz - (eyeZ(s) - 3), d) + b.aimErr * 0.25 * Math.sin(G.time * 1.7 + s.id * 3);
    b.aimErr = Math.max(sk.minErr, b.aimErr - dt * 0.16);
    b.react -= dt;
    if (b.vis && b.react <= 0 && Math.abs(angDiff(s.angle, want)) < 0.1 && d < s.cls.range * 0.95 && s.mag > 0 && !s.reloading) {
      if (sniper) ctl.fire = Math.abs(angDiff(s.angle, want)) < 0.04;
      else {
        b.burst -= dt;
        if (b.burst > 0) ctl.fire = true;
        else if (b.burst < -b.pause) { b.burst = rand(0.35, 0.9); b.pause = rand(0.15, 0.4); }
      }
    }
    // grenade: enemy in throwing range, especially when hiding behind cover
    if (s.nades > 0 && b.nadeCD <= 0 && d > 140 && d < CFG.GRENADE_RANGE && (!b.vis || Math.random() < 0.01)) {
      ctl.throwAt = { x: e.x + e.vx * 1.5, y: e.y + e.vy * 1.5 }; b.nadeCD = 6;
    }
    if (s.mag === 0) ctl.reload = true;
    // strafe
    b.strafeT -= dt;
    if (b.strafeT <= 0) { b.strafeDir = Math.random() < 0.5 ? -1 : 1; if (Math.random() < 0.25) b.strafeDir = 0; b.strafeT = rand(0.6, 1.6); }
    moveX = -dy / d * b.strafeDir * 0.7; moveY = dx / d * b.strafeDir * 0.7;
    if (perched) { moveX = 0; moveY = 0; }
    else if (!b.vis || d > 650) {
      // close in (or chase to last seen position)
      const [fx, fy] = followPath(s, e.x, e.y, dt);
      moveX = moveX * 0.3 + fx; moveY = moveY * 0.3 + fy;
    } else if (d < 220) { moveX -= dx / d * 0.5; moveY -= dy / d * 0.5; }
    // snipers hold still and scope in at range
    if (sniper && b.vis && d > 450) { moveX = 0; moveY = 0; ctl.scope = true; }
    else if (!sniper && b.vis && d > 380) ctl.scope = true;   // aim down the sights at range
    // sappers and defusers keep pushing to their goal while fighting
    if (b.obj && (b.obj.type === 'plant' || b.obj.type === 'defuse') && d > 300) {
      const [fx, fy] = followPath(s, b.obj.x, b.obj.y, dt);
      moveX = fx + moveX * 0.3; moveY = fy + moveY * 0.3;
    }
  } else {
    const o = b.obj;
    const [fx, fy] = followPath(s, o.x, o.y, dt, o.up);
    moveX = fx; moveY = fy;
    const dGoal = dist(s.x, s.y, o.x, o.y);
    const moving = Math.abs(fx) + Math.abs(fy) > 0.01;
    if (b.lookT > 0) { b.lookT -= dt; s.angle = turnTo(s.angle, b.lookA, sk.turn * dt); }
    else if (perched) {
      if ((b.sweepT = (b.sweepT || 0) - dt) <= 0) { b.sweepT = rand(1.5, 3); b.sweepA = o.look + rand(-0.6, 0.6); }
      s.angle = turnTo(s.angle, b.sweepA, 2 * dt);
    }
    else if (moving) s.angle = turnTo(s.angle, Math.atan2(fy, fx), 5 * dt);
    else {
      b.lookT = 0;
      if ((b.sweepT = (b.sweepT || 0) - dt) <= 0) { b.sweepT = rand(1, 2.5); b.sweepA = (s.team === 0 ? 0 : Math.PI) + rand(-1.4, 1.4); }
      s.angle = turnTo(s.angle, b.sweepA, 2.5 * dt);
    }
    ctl.sprint = dGoal > 500 && s.hp > 30 && s.z === 0;
    if (sniper && !moving) ctl.scope = true;   // overwatch
    if (s.mag < 15 && !s.reloading) ctl.reload = true;
    if ((o.type === 'plant' || o.type === 'defuse') && dGoal < 40) { moveX = 0; moveY = 0; ctl.interact = true; ctl.sprint = false; }
    if (o.type === 'supply' && dGoal < 30) b.objT = Math.min(b.objT, 0.5);
  }

  // stuck handling
  b.stuckClock += dt;
  if (b.stuckClock >= 1) {
    const moved = dist(s.x, s.y, b.lx, b.ly);
    const wanted = Math.abs(moveX) + Math.abs(moveY) > 0.3;
    if (wanted && moved < 12) {
      b.stuck++; b.path = null; b.repathT = 0; b.nudgeT = 0.6; b.nudgeA = Math.random() * TAU;
      if (b.stuck > 3) { b.objT = 0; b.stuck = 0; b.obj = null; }
    } else if (moved > 30) b.stuck = 0;
    b.stuckClock = 0; b.lx = s.x; b.ly = s.y;
  }
  // run from live grenades
  for (const g of G.grenades) {
    if (g.team === s.team) continue;
    const dx = s.x - g.x, dy = s.y - g.y, d = Math.hypot(dx, dy) || 1;
    if (d < CFG.GRENADE_RADIUS + 40 && g.fuse < 3.5) { moveX = dx / d; moveY = dy / d; ctl.sprint = true; ctl.scope = false; ctl.interact = false; }
  }
  // clear out of announced air strike zones (both sides can see the marker)
  for (const st of G.strikes) {
    if (st.t > 8 || !inStrike(st, s.x, s.y, 50)) continue;
    const dy = s.y >= st.y ? 1 : -1;
    moveX = 0; moveY = dy; ctl.sprint = true; ctl.scope = false; ctl.interact = false;
  }
  if (b.nudgeT > 0) { b.nudgeT -= dt; moveX = Math.cos(b.nudgeA); moveY = Math.sin(b.nudgeA); }

  // spread out from nearby allies
  for (const a of G.soldiers) {
    if (a === s || !a.alive || a.team !== s.team) continue;
    const dx = s.x - a.x, dy = s.y - a.y, d2 = dx * dx + dy * dy;
    if (d2 < 60 * 60 && d2 > 1) { const d = Math.sqrt(d2); moveX += dx / d * 0.35 * (1 - d / 60); moveY += dy / d * 0.35 * (1 - d / 60); }
  }

  ctl.mx = moveX; ctl.my = moveY;
  return ctl;
}
