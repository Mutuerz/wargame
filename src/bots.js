'use strict';
// Bot soldiers: objective choice, path following, target scanning and shooting.

function newBrain() {
  return {
    obj: null, objT: 0, path: null, pi: 0, goal: null, repathT: 0,
    enemy: null, vis: false, seeT: 0, scanT: Math.random() * 0.2, react: 0, aimErr: 0.3,
    burst: 0, pause: 0, strafeDir: 1, strafeT: 0, lookA: 0, lookT: 0,
    stuckClock: 0, lx: 0, ly: 0, stuck: 0, nudgeT: 0, nudgeA: 0,
    bias: [Math.random() * 900, Math.random() * 900, Math.random() * 900],
    defender: Math.random() < 0.2, role: null,
  };
}
function resetBrain(s) {
  const b = s.bot;
  b.obj = null; b.objT = 0; b.path = null; b.enemy = null; b.vis = false; b.seeT = 0; b.stuck = 0;
  b.lx = s.x; b.ly = s.y;
  if (b.role === 'sapper' && s.c4 <= 0) b.role = null;
}

function botSpawnChoice(s) {
  const opts = spawnOptions(s.team).filter(o => o.type === 'point');
  if (opts.length && Math.random() < 0.5) {
    // closest owned point to the front
    const ex = s.team === 0 ? W : 0;
    opts.sort((a, b) => Math.abs(a.x - ex) - Math.abs(b.x - ex));
    return opts[0];
  }
  return { type: 'base', idx: s.spot };
}

function scan(s) {
  const b = s.bot, sk = G.skill;
  let best = null, bd = sk.range * sk.range;
  for (const e of G.soldiers) {
    if (!e.alive || e.team === s.team) continue;
    const d = dist2(s.x, s.y, e.x, e.y);
    if (d >= bd) continue;
    if (!losClear(G.m, s.x, s.y, e.x, e.y)) continue;
    bd = d; best = e;
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
  // 2. sapper run
  if (b.role === 'sapper') {
    const br = m.bridges[1 - t];
    if (s.c4 > 0 && !br.destroyed && !G.c4s.some(c => c.bridge === br.team)) { b.obj = { type: 'plant', x: br.cx, y: br.cy }; return; }
    b.role = null;
  }
  // 3. supplies
  const ammo = ammoTotal(s), hpMax = maxHp(s);
  const need = ammo < 30 || s.hp < hpMax * 0.5;
  const want = ammo < CFG.MAG * (CFG.EXTRA_MAGS + 1) - 10 || s.hp < hpMax * 0.85;
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
  const p = m.points[best];
  const spot = randomFreeNear(m, p.x, p.y, CFG.CAP_R * 0.65);
  b.obj = { type: 'cap', p: best, x: spot.x, y: spot.y };
}

function followPath(s, tx, ty, dt) {
  const b = s.bot, m = G.m;
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
  const ctl = { mx: 0, my: 0, fire: false, sprint: false, reload: false, interact: false };

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
    const lead = d / CFG.BULLET_SPEED;
    const want = Math.atan2(e.y + e.vy * lead - s.y, e.x + e.vx * lead - s.x) + b.aimErr * Math.sin(G.time * 2.1 + s.id);
    s.angle = turnTo(s.angle, want, sk.turn * dt);
    b.aimErr = Math.max(sk.minErr, b.aimErr - dt * 0.16);
    b.react -= dt;
    if (b.vis && b.react <= 0 && Math.abs(angDiff(s.angle, want)) < 0.1 && d < CFG.BULLET_RANGE * 0.95 && s.mag > 0 && !s.reloading) {
      b.burst -= dt;
      if (b.burst > 0) ctl.fire = true;
      else if (b.burst < -b.pause) { b.burst = rand(0.35, 0.9); b.pause = rand(0.15, 0.4); }
    }
    if (s.mag === 0) ctl.reload = true;
    // strafe
    b.strafeT -= dt;
    if (b.strafeT <= 0) { b.strafeDir = Math.random() < 0.5 ? -1 : 1; if (Math.random() < 0.25) b.strafeDir = 0; b.strafeT = rand(0.6, 1.6); }
    moveX = -dy / d * b.strafeDir * 0.7; moveY = dx / d * b.strafeDir * 0.7;
    if (!b.vis || d > 650) {
      // close in (or chase to last seen position)
      const [fx, fy] = followPath(s, e.x, e.y, dt);
      moveX = moveX * 0.3 + fx; moveY = moveY * 0.3 + fy;
    } else if (d < 220) { moveX -= dx / d * 0.5; moveY -= dy / d * 0.5; }
    // sappers and defusers keep pushing to their goal while fighting
    if (b.obj && (b.obj.type === 'plant' || b.obj.type === 'defuse') && d > 300) {
      const [fx, fy] = followPath(s, b.obj.x, b.obj.y, dt);
      moveX = fx + moveX * 0.3; moveY = fy + moveY * 0.3;
    }
  } else {
    const o = b.obj;
    const [fx, fy] = followPath(s, o.x, o.y, dt);
    moveX = fx; moveY = fy;
    const dGoal = dist(s.x, s.y, o.x, o.y);
    const moving = Math.abs(fx) + Math.abs(fy) > 0.01;
    if (b.lookT > 0) { b.lookT -= dt; s.angle = turnTo(s.angle, b.lookA, sk.turn * dt); }
    else if (moving) s.angle = turnTo(s.angle, Math.atan2(fy, fx), 5 * dt);
    else {
      b.lookT = 0;
      if ((b.sweepT = (b.sweepT || 0) - dt) <= 0) { b.sweepT = rand(1, 2.5); b.sweepA = (s.team === 0 ? 0 : Math.PI) + rand(-1.4, 1.4); }
      s.angle = turnTo(s.angle, b.sweepA, 2.5 * dt);
    }
    ctl.sprint = dGoal > 500 && s.hp > 30;
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
