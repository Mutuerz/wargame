'use strict';
// Match state and simulation.

let G = null;

function makeSoldier(team, idx, isPlayer) {
  return {
    id: team * 100 + idx, team, idx, isPlayer, name: CALLSIGNS[team][idx] || (TEAMS[team].name + '-' + (idx + 1)),
    x: 0, y: 0, vx: 0, vy: 0, angle: team === 0 ? 0 : Math.PI,
    hp: CFG.HP, alive: false, respawnT: 0, shield: 0,
    cls: CLASSES.rifleman, nades: 0, scoped: false, aimX: 0, aimY: 0,
    mag: 25, mags: [], reloading: false, reloadT: 0, reloadMax: 1, fireCD: 0, heat: 0,
    c4: 0, act: null, actT: 0, cacheCD: 0,
    spot: 0, kills: 0, deaths: 0, points: 0, perks: [], mods: { speed: 1, reload: 1, dmg: 1, maxHp: 1, spread: 1 },
    spotted: [0, 0], lastHitBy: null, lastHitT: -99, walkPhase: 0,
    bot: isPlayer ? null : newBrain(),
  };
}
function maxHp(s) { return CFG.HP * s.mods.maxHp; }
function ammoTotal(s) { return s.mag + s.mags.reduce((a, b) => a + b, 0); }
function ammoFull(s) { return s.cls.mag * (s.cls.mags + 1); }
function refillAmmo(s) { s.mag = s.cls.mag; s.mags = Array(s.cls.mags).fill(s.cls.mag); s.reloading = false; }
function visionRange(s) { return s.cls.vision; }

// Bot commander: picks a deployment pattern automatically.
function botCommanderCounts() {
  const patterns = [
    [2, 2, 2, 2, 2], [4, 3, 2, 1, 0], [0, 1, 2, 3, 4], [1, 2, 4, 2, 1], [3, 1, 2, 1, 3], [1, 3, 2, 3, 1],
  ];
  return pickRand(patterns).slice();
}

function startMatch(m, art, counts, playerSpot, opts = {}) {
  G = {
    m, art, time: 0, state: 'play', paused: false, over: false, winner: -1,
    skill: SKILLS[opts.skill ?? 1], auto: !!opts.auto,
    soldiers: [], bullets: [], particles: [], drops: [], caches: [], c4s: [], trucks: [], feed: [], msg: null,
    teams: [
      { points: 0, supplyT: CFG.SUPPLY_INTERVAL, sapperT: 100 + Math.random() * 40, counts: counts.slice(), vis: new Uint8Array(GW * GH) },
      { points: 0, supplyT: CFG.SUPPLY_INTERVAL, sapperT: 100 + Math.random() * 40, counts: botCommanderCounts(), vis: new Uint8Array(GW * GH) },
    ],
    lock: { team: -1, t: 0 }, holdT: 0, dropT: CFG.DROP_INTERVAL, pathBudget: 0, cam: { x: 0, y: 0, shake: 0 }, hurtT: 0, hitT: 0,
    grenades: [], carts: [], specIdx: 0, visT: 0, smokers: [],
    stats: { captures: [0, 0], bridges: [false, false] },
  };
  for (let t = 0; t < 2; t++) {
    const list = [];
    G.teams[t].counts.forEach((n, i) => { for (let k = 0; k < n; k++) list.push(i); });
    if (t === 0) { // player first, at their chosen spot
      const pi = list.indexOf(playerSpot); if (pi >= 0) list.splice(pi, 1);
      list.unshift(playerSpot);
    }
    const snipers = new Set();
    while (snipers.size < CFG.SNIPERS_PER_TEAM) snipers.add(Math.floor(Math.random() * CFG.TEAM_SIZE));
    for (let i = 0; i < CFG.TEAM_SIZE; i++) {
      const s = makeSoldier(t, i, t === 0 && i === 0);
      if (snipers.has(i) || (t === 0 && i === 0 && opts.playerClass === 'sniper')) s.cls = CLASSES.sniper;
      s.spot = list[i] ?? (i % 5);
      G.soldiers.push(s);
      spawnSoldier(s, { type: 'base', idx: s.spot });
    }
  }
  G.player = G.soldiers[0];
  for (let t = 0; t < 2; t++) { const c = G.soldiers.filter(x => x.team === t && x.bot && !x.isPlayer && x.cls === CLASSES.rifleman); if (c.length) pickRand(c).bot.guard = true; }
  if (G.auto) { G.player.bot = newBrain(); }
  G.player.c4 = 1;
  for (let i = 0; i < CFG.DROP_START; i++) spawnDrop(true);
  // ambient smoke columns for urban ruins
  if (m.biome === 'urban') {
    const fl = m.floors.slice().sort(() => Math.random() - 0.5).slice(0, 10);
    G.smokers = fl.map(f => ({ x: f.x + f.w / 2, y: f.y + f.h / 2, t: Math.random() }));
  }
  G.cam.x = G.player.x; G.cam.y = G.player.y;
  message('Hold all five points (A to E) at the same time to win', '#e6ad45', 5);
}

function spawnSoldier(s, choice) {
  const m = G.m;
  let base;
  if (choice.type === 'at') base = { x: choice.x, y: choice.y };
  else if (choice.type === 'depot') base = m.depots[s.team];
  else base = m.spawns[s.team][choice.idx ?? s.spot] || m.spawns[s.team][0];
  const p = randomFreeNear(m, base.x + (choice.type === 'depot' ? (s.team === 0 ? 110 : -110) : 0), base.y, choice.type === 'depot' ? 80 : choice.type === 'at' ? 70 : 55);
  s.x = p.x; s.y = p.y; s.vx = s.vy = 0;
  Perks.reapply(G, s);
  s.hp = maxHp(s); s.alive = true; s.shield = CFG.SPAWN_SHIELD;
  refillAmmo(s); s.fireCD = 0; s.heat = 0; s.scoped = false;
  s.nades = Math.random() < CFG.GRENADE_CHANCE ? 1 : 0;
  s.act = null; s.actT = 0;
  s.angle = s.team === 0 ? 0 : Math.PI;
  if (s.bot) resetBrain(s);
}

function message(text, color = '#e3e7df', t = 3.5) { G.msg = { text, color, t, max: t }; }
function feed(text, color) { G.feed.unshift({ text, color, t: 7 }); if (G.feed.length > 6) G.feed.pop(); }

// ---------------- Weapons
function startReload(s) {
  if (s.reloading || s.mag >= s.cls.mag || !s.mags.some(x => x > 0)) return false;
  s.reloading = true; s.scoped = false;
  s.reloadT = s.reloadMax = (s.mag > 0 ? s.cls.reload : s.cls.reloadEmpty) * s.mods.reload;
  if (s.isPlayer) SFX.reload();
  return true;
}
function finishReload(s) {
  s.reloading = false;
  if (s.mag > 0) s.mags.push(s.mag);
  s.mags.sort((a, b) => b - a);
  s.mag = s.mags.shift() || 0;
  s.mags = s.mags.filter(x => x > 0);
}
function shoot(s, moving) {
  const spread = currentSpread(s, moving);
  const a = s.angle + (Math.random() - 0.5) * 2 * spread;
  const mx = s.x + Math.cos(s.angle) * 26, my = s.y + Math.sin(s.angle) * 26;
  G.bullets.push({ x: mx, y: my, px: mx, py: my, vx: Math.cos(a) * s.cls.bulletSpeed, vy: Math.sin(a) * s.cls.bulletSpeed,
    life: s.cls.range / s.cls.bulletSpeed, team: s.team, owner: s, dmg: s.cls.dmg * s.mods.dmg, sniper: s.cls === CLASSES.sniper });
  s.mag--; s.fireCD = 1 / s.cls.rate; s.heat = Math.min(0.05, s.heat + (s.cls.auto ? 0.008 : 0.03));
  G.particles.push({ type: 'flash', x: mx, y: my, a: s.angle, life: 0.05, max: 0.05 });
  if (Math.random() < 0.5) stampCasing(G.art, s.x + Math.cos(s.angle + 1.6) * 16, s.y + Math.sin(s.angle + 1.6) * 16);
  SFX.shot(s.x, s.y, s.isPlayer);
}

// Terrain: shooting downhill tightens spread, uphill widens it.
function slopeFactor(s) {
  const d = heightAt(G.m, s.x, s.y) - heightAt(G.m, s.aimX, s.aimY);
  if (d > CFG.HEIGHT_STEP) return 1 / CFG.DOWNHILL_ACC;
  if (d < -CFG.HEIGHT_STEP) return CFG.UPHILL_PEN;
  return 1;
}
function currentSpread(s, moving) {
  let sp = (moving ? s.cls.spreadMove : s.cls.spread) * s.mods.spread + s.heat;
  if (s.scoped) sp *= s.cls.scopeSpread;
  return sp * slopeFactor(s);
}

function damage(target, amount, attacker) {
  if (!target.alive || target.shield > 0) return;
  target.hp -= amount;
  target.lastHitBy = attacker; target.lastHitT = G.time;
  if (target.isPlayer) G.hurtT = 0.45;
  if (attacker && attacker.isPlayer) { G.hitT = 0.15; SFX.hit(); }
  if (Math.random() < 0.6) stampBlood(G.art, target.x + rand(-10, 10), target.y + rand(-10, 10), rand(3, 7));
  for (let i = 0; i < 4; i++) G.particles.push({ type: 'blood', x: target.x, y: target.y, vx: rand(-80, 80), vy: rand(-80, 80), life: 0.4, max: 0.4, size: rand(1.5, 3) });
  if (target.hp <= 0) kill(target, attacker);
}

function kill(s, killer) {
  s.alive = false; s.hp = 0; s.deaths++;
  s.reloading = false; s.act = null; s.scoped = false;
  stampBody(G.art, s);
  if (killer && killer !== s) { killer.kills++; }
  const kn = killer ? killer.name : 'Explosion';
  const kc = killer ? TEAMS[killer.team].color : '#e6ad45';
  feed(`${kn}  ✕  ${s.name}`, kc);
  s.c4 = s.isPlayer ? s.c4 : 0;
  if (s.bot) s.bot.role = null;
}

// ---------------- Soldier update (shared by player and bots)
function updateSoldier(s, dt, ctl) {
  const m = G.m;
  if (s.shield > 0) s.shield -= dt;
  s.cacheCD -= dt;
  s.heat = Math.max(0, s.heat - dt * 0.08);
  let mvx = ctl.mx || 0, mvy = ctl.my || 0;
  const ml = Math.hypot(mvx, mvy);
  if (ml > 1) { mvx /= ml; mvy /= ml; }
  const moving = ml > 0.1;
  const fire = ctl.fire;
  const sprint = ctl.sprint && moving && !fire && !s.reloading;

  if (ctl.aimX !== undefined) { s.aimX = ctl.aimX; s.aimY = ctl.aimY; }
  s.scoped = !!(ctl.scope && s.cls.scopeRange && !moving && !s.reloading);
  if (ctl.throwAt && s.nades > 0) throwGrenade(s, ctl.throwAt.x, ctl.throwAt.y);
  if (ctl.reload) startReload(s);
  if (s.reloading) { s.reloadT -= dt; if (s.reloadT <= 0) finishReload(s); }

  // interaction (plant / defuse C4)
  let busy = false;
  if (ctl.interact && !moving) {
    const a = availableAction(s);
    if (a) {
      if (s.act !== a.type) { s.act = a.type; s.actT = 0; }
      s.actT += dt; busy = true;
      if (s.actT >= CFG.C4_PLANT) { doAction(s, a); s.act = null; s.actT = 0; }
    } else { s.act = null; s.actT = 0; }
  } else { s.act = null; s.actT = 0; }

  let speed = (sprint ? CFG.SPRINT : CFG.WALK) * s.mods.speed * s.cls.speed;
  if (m.slow[((s.y / CELL) | 0) * GW + ((s.x / CELL) | 0)]) speed *= 0.5;
  if (s.reloading) speed *= 0.85;
  if (fire) speed *= 0.8;
  const k = 1 - Math.exp(-dt * 14);
  s.vx = lerp(s.vx, mvx * speed, k); s.vy = lerp(s.vy, mvy * speed, k);
  s.x += s.vx * dt; s.y += s.vy * dt;
  collideCircle(m, s, CFG.R);
  if (moving) s.walkPhase += dt * speed * 0.12;

  s.fireCD -= dt;
  if (fire && !sprint && !busy) {
    if (s.reloading) { /* wait */ }
    else if (s.mag > 0) { if (s.fireCD <= 0) shoot(s, moving); }
    else if (!startReload(s) && s.isPlayer && s.fireCD <= 0) { SFX.click(); s.fireCD = 0.3; }
  }
}

function availableAction(s) {
  const m = G.m;
  const eb = m.bridges[1 - s.team];
  if (s.c4 > 0 && !eb.destroyed && !G.c4s.some(c => c.bridge === eb.team) && dist(s.x, s.y, eb.cx, eb.cy) < 60) return { type: 'plant', bridge: eb };
  const c = G.c4s.find(c => c.bridge === s.team && dist(s.x, s.y, c.x, c.y) < 60);
  if (c) return { type: 'defuse', c4: c };
  return null;
}
function doAction(s, a) {
  if (a.type === 'plant') {
    s.c4--;
    G.c4s.push({ x: a.bridge.cx, y: a.bridge.cy, bridge: a.bridge.team, team: s.team, fuse: CFG.C4_FUSE, beep: 0, owner: s });
    feed(`${s.name} planted C4 on ${TEAMS[a.bridge.team].name}'s bridge`, TEAMS[s.team].color);
    if (a.bridge.team === G.player.team) message('Enemy C4 on our bridge! Defuse it with F', '#ff5a4e', 4);
    else if (s.team === G.player.team) message('C4 planted on the enemy bridge', TEAMS[0].color, 3);
  } else {
    G.c4s.splice(G.c4s.indexOf(a.c4), 1);
    feed(`${s.name} defused the C4`, TEAMS[s.team].color);
    if (s.team === G.player.team) message('C4 defused. Bridge saved', TEAMS[0].color, 3);
    s.points += 25;
  }
}

function explode(x, y, radius, maxDmg, attacker) {
  SFX.boom(x, y);
  for (const s of G.soldiers) {
    if (!s.alive || (attacker && s.team === attacker.team && s !== attacker)) continue;
    if (!losClear(G.m, x, y, s.x, s.y)) continue;   // walls block blast
    const d = dist(s.x, s.y, x, y);
    if (d < radius) damage(s, maxDmg * (1 - d / radius), attacker);
  }
  stampScorch(G.art, x, y, radius * 0.5);
  breakWalls(x, y, radius * 0.75);
  for (const c of G.carts.slice()) {
    if (attacker && c.team === attacker.team) continue;
    const d = dist(c.x, c.y, x, y);
    if (d < radius + CFG.CART_R) damageCart(c, maxDmg * 1.5 * (1 - Math.max(0, d - CFG.CART_R) / radius), attacker);
  }
  for (let i = 0; i < 40; i++) {
    const a = Math.random() * TAU, sp = rand(60, 420);
    G.particles.push({ type: 'fire', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.3, 0.8), max: 0.8, size: rand(6, 16) });
  }
  for (let i = 0; i < 26; i++) {
    const a = Math.random() * TAU, sp = rand(20, 120);
    G.particles.push({ type: 'smoke', x: x + rand(-30, 30), y: y + rand(-30, 30), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(1.5, 3.5), max: 3.5, size: rand(20, 50) });
  }
  const pd = dist(x, y, G.cam.x, G.cam.y);
  if (pd < 1400) G.cam.shake = Math.max(G.cam.shake, 18 * (1 - pd / 1400));
}

function destroyBridge(team, attacker) {
  const b = G.m.bridges[team];
  if (b.destroyed) return;
  b.destroyed = true;
  G.stats.bridges[team] = true;
  buildGrids(G.m);
  // trucks of this team still on the road are lost
  for (const t of G.trucks.slice()) if (t.team === team && t.state !== 'unload') { G.trucks.splice(G.trucks.indexOf(t), 1); explode(t.x, t.y, 120, 0, null); }
  for (const s of G.soldiers) if (s.bot) s.bot.path = null;
  G.teams[1 - team].points += CFG.SABOTAGE_REWARD;
  if (attacker) attacker.points += CFG.SABOTAGE_REWARD;
  feed(`${TEAMS[team].name}'s bridge destroyed`, TEAMS[1 - team].color);
  message(team === G.player.team ? 'Our bridge is down. No more trucks or reinforcements' : 'Enemy bridge destroyed. They can no longer reinforce', team === G.player.team ? '#ff5a4e' : '#5aa9ff', 5);
}

// ---------------- Drops
function spawnDrop(instant) {
  const m = G.m;
  for (let i = 0; i < 60; i++) {
    const x = rand(CFG.BASE_W + CFG.DROP_MIN_BASE_DIST, W - CFG.BASE_W - CFG.DROP_MIN_BASE_DIST);
    const y = rand(150, H - 150);
    if (fineBlocked(m.walk, x, y) || m.slow[((y / CELL) | 0) * GW + ((x / CELL) | 0)]) continue;
    if (G.drops.some(d => dist(d.x, d.y, x, y) < 500)) continue;
    if (m.points.some(p => dist(p.x, p.y, x, y) < CFG.CAP_R + 40)) continue;
    G.drops.push({ x, y, fall: instant ? 0 : 4, t: Math.random() * 10, c4: Math.random() < 0.4 });
    if (!instant) feed('Supply drop incoming', '#e6ad45');
    return;
  }
}

// ---------------- Main update
function update(dt) {
  if (!G || G.over) return;
  G.time += dt;
  G.pathBudget = 5;
  const m = G.m;

  for (const s of G.soldiers) {
    if (!s.alive) continue;   // the dead wait for the next truck
    const ctl = (s.isPlayer && !G.auto) ? playerControl(s) : botThink(s, dt);
    updateSoldier(s, dt, ctl);
  }
  // soldier separation
  const SS = G.soldiers, R2 = CFG.R * 2;
  for (let i = 0; i < SS.length; i++) {
    const a = SS[i]; if (!a.alive) continue;
    for (let j = i + 1; j < SS.length; j++) {
      const b = SS[j]; if (!b.alive) continue;
      const dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy;
      if (d2 < R2 * R2 && d2 > 0.01) {
        const d = Math.sqrt(d2), push = (R2 - d) / 2;
        a.x -= dx / d * push; a.y -= dy / d * push; b.x += dx / d * push; b.y += dy / d * push;
      }
    }
  }

  updateBullets(dt);
  updateParticles(dt);
  updateCapture(dt);
  updateSupply(dt);
  updateGrenades(dt);
  updateCarts(dt);
  G.visT -= dt;
  if (G.visT <= 0) { G.visT = 0.15; computeVision(G.player.team); }
  updateDrops(dt);
  updateC4(dt);
  updateSappers(dt);

  for (const f of G.feed) f.t -= dt;
  G.feed = G.feed.filter(f => f.t > 0);
  if (G.msg) { G.msg.t -= dt; if (G.msg.t <= 0) G.msg = null; }
  G.hurtT = Math.max(0, G.hurtT - dt); G.hitT = Math.max(0, G.hitT - dt);
  G.cam.shake = Math.max(0, G.cam.shake - dt * 30);

  // victory
  let lockTeam = -1;
  for (let t = 0; t < 2; t++) if (m.points.every(p => p.owner === t)) lockTeam = t;
  if (lockTeam !== G.lock.team) {
    G.lock = { team: lockTeam, t: 0 };
    if (lockTeam >= 0) message(lockTeam === G.player.team ? `We hold all five points. Keep them for ${CFG.WIN_HOLD} s` : `Enemy holds all five points! Retake one within ${CFG.WIN_HOLD} s`, TEAMS[lockTeam].color, 4);
  }
  if (lockTeam >= 0) { G.lock.t += dt; if (G.lock.t >= CFG.WIN_HOLD) return endMatch(lockTeam, 'Held all five points at once'); }
  for (let t = 0; t < 2; t++) {
    if (m.bridges[t].destroyed && !G.trucks.some(k => k.team === t) && !G.carts.some(c => c.team === t) && !G.soldiers.some(s => s.team === t && s.alive))
      return endMatch(1 - t, `${TEAMS[t].name} was wiped out with no bridge left to reinforce`);
  }
  if (G.time >= CFG.TIME_LIMIT) {
    const h0 = m.points.filter(p => p.owner === 0).length, h1 = m.points.filter(p => p.owner === 1).length;
    if (h0 !== h1) return endMatch(h0 > h1 ? 0 : 1, 'Time limit: held more points');
    if (G.teams[0].points !== G.teams[1].points) return endMatch(G.teams[0].points > G.teams[1].points ? 0 : 1, 'Time limit: more points earned');
    return endMatch(-1, 'Time limit reached with the front deadlocked');
  }
}

function updateBullets(dt) {
  const m = G.m;
  const out = [];
  for (const b of G.bullets) {
    b.px = b.x; b.py = b.y;
    const nx = b.x + b.vx * dt, ny = b.y + b.vy * dt;
    let hit = false;
    // soldiers
    let bestT = 2, bestS = null;
    for (const s of G.soldiers) {
      if (!s.alive || s.team === b.team) continue;
      const t = segCircleHit(b.x, b.y, nx, ny, s.x, s.y, CFG.R);
      if (t >= 0 && t < bestT) { bestT = t; bestS = s; }
    }
    for (const c of G.carts) {
      if (c.team === b.team) continue;
      const t = segCircleHit(b.x, b.y, nx, ny, c.x, c.y, CFG.CART_R);
      if (t >= 0 && t < bestT) { bestT = t; bestS = c; }
    }
    // obstacles: step along the segment
    const steps = Math.ceil(Math.hypot(nx - b.x, ny - b.y) / 8);
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      if (bestS && t > bestT) break;
      const x = b.x + (nx - b.x) * t, y = b.y + (ny - b.y) * t;
      if (x < 0 || y < 0 || x > W || y > H) { hit = true; break; }
      if (m.shot[((y / CELL) | 0) * GW + ((x / CELL) | 0)] && solidAt(m, x, y)) {
        hit = true;
        for (let i = 0; i < 3; i++) G.particles.push({ type: 'spark', x, y, vx: -b.vx * 0.08 + rand(-90, 90), vy: -b.vy * 0.08 + rand(-90, 90), life: 0.2, max: 0.2, size: 2 });
        G.particles.push({ type: 'dust', x, y, vx: rand(-20, 20), vy: rand(-20, 20), life: 0.5, max: 0.5, size: rand(5, 9) });
        b.x = x; b.y = y;
        break;
      }
    }
    if (!hit && bestS && bestS.isCart) { damageCart(bestS, b.dmg, b.owner); hit = true; b.x += (nx - b.x) * bestT; b.y += (ny - b.y) * bestT;
      for (let i = 0; i < 3; i++) G.particles.push({ type: 'spark', x: b.x, y: b.y, vx: rand(-120, 120), vy: rand(-120, 120), life: 0.2, max: 0.2, size: 2 }); }
    else if (!hit && bestS) { damage(bestS, b.dmg, b.owner); hit = true; b.x = b.x + (nx - b.x) * bestT; b.y = b.y + (ny - b.y) * bestT; }
    if (!hit) { b.x = nx; b.y = ny; b.life -= dt; if (b.life > 0) out.push(b); }
  }
  G.bullets = out;
}

function updateParticles(dt) {
  const out = [];
  for (const p of G.particles) {
    p.life -= dt;
    if (p.life <= 0) continue;
    if (p.vx !== undefined) { p.x += p.vx * dt; p.y += p.vy * dt; const f = p.type === 'smoke' ? 0.6 : 3; p.vx *= Math.exp(-dt * f); p.vy *= Math.exp(-dt * f); }
    if (p.type === 'smoke') p.size += dt * 12;
    out.push(p);
  }
  // ambient smoke columns (urban)
  for (const sm of G.smokers) {
    sm.t -= dt;
    if (sm.t <= 0) { sm.t = 0.35; out.push({ type: 'smoke', x: sm.x + rand(-10, 10), y: sm.y + rand(-10, 10), vx: rand(15, 35), vy: rand(-25, -10), life: 5, max: 5, size: rand(14, 24), ambient: true }); }
  }
  G.particles = out.length > 1500 ? out.slice(out.length - 1500) : out;
}

function updateCapture(dt) {
  const m = G.m, R2 = CFG.CAP_R * CFG.CAP_R;
  for (const p of m.points) {
    let c0 = 0, c1 = 0;
    for (const s of G.soldiers) if (s.alive && dist2(s.x, s.y, p.x, p.y) < R2) { if (s.team === 0) c0++; else c1++; }
    p.c0 = c0; p.c1 = c1;
    const before = p.owner;
    if (c0 > 0 && c1 > 0) { /* contested */ }
    else if (c0 > 0) p.prog = Math.min(100, p.prog + CFG.CAP_RATE * Math.min(c0, 3) * dt);
    else if (c1 > 0) p.prog = Math.max(-100, p.prog - CFG.CAP_RATE * Math.min(c1, 3) * dt);
    else {
      const target = p.owner === 0 ? 100 : p.owner === 1 ? -100 : 0;
      p.prog += clamp(target - p.prog, -4 * dt, 4 * dt);
    }
    if (p.owner === 1 && p.prog >= 0) p.owner = -1;
    if (p.owner === 0 && p.prog <= 0) p.owner = -1;
    if (p.prog >= 100 && p.owner !== 0) p.owner = 0;
    if (p.prog <= -100 && p.owner !== 1) p.owner = 1;
    if (p.owner !== before) {
      if (p.owner === -1) feed(`Point ${p.name} neutralized`, '#8e9b92');
      else onCapture(p, p.owner);
    }
  }
  G.holdT += dt;
  if (G.holdT >= CFG.HOLD_TICK) {
    G.holdT -= CFG.HOLD_TICK;
    for (const p of m.points) if (p.owner >= 0) G.teams[p.owner].points += CFG.HOLD_REWARD;
  }
}
function onCapture(p, t) {
  G.teams[t].points += CFG.CAPTURE_REWARD;
  G.stats.captures[t]++;
  for (const s of G.soldiers) if (s.alive && s.team === t && dist2(s.x, s.y, p.x, p.y) < CFG.CAP_R * CFG.CAP_R) s.points += CFG.CAPTURER_REWARD;
  feed(`${TEAMS[t].name} captured ${p.name}  +${CFG.CAPTURE_REWARD} pts`, TEAMS[t].color);
  const mine = t === G.player.team;
  message(mine ? `Point ${p.name} captured` : `Point ${p.name} lost`, TEAMS[t].color, 2.5);
  SFX.capture(mine);
  for (const s of G.soldiers) if (s.bot) s.bot.objT = Math.min(s.bot.objT, Math.random() * 1.5);
}

function updateSupply(dt) {
  const m = G.m;
  for (let t = 0; t < 2; t++) {
    const tm = G.teams[t];
    if (m.bridges[t].destroyed) continue;
    tm.supplyT -= dt;
    if (tm.supplyT <= 0) {
      tm.supplyT = CFG.SUPPLY_INTERVAL;
      const lane = m.truckLanes[t];
      G.trucks.push({ team: t, x: lane.from, y: lane.y, dir: lane.dir, state: 'in', t: 0 });
      const dead = G.soldiers.filter(x => x.team === t && !x.alive).length;
      if (t === G.player.team && dead) feed(`Truck crossing the bridge with ${dead} reinforcement${dead > 1 ? 's' : ''}`, TEAMS[t].color);
    }
  }
  for (const tr of G.trucks.slice()) {
    const lane = m.truckLanes[tr.team];
    if (tr.state === 'in') {
      tr.x += tr.dir * CFG.TRUCK_SPEED * dt;
      if ((tr.dir > 0 && tr.x >= lane.to) || (tr.dir < 0 && tr.x <= lane.to)) {
        tr.x = lane.to; tr.state = 'unload'; tr.t = 4;
        const d = m.depots[tr.team];
        let c = G.caches.find(c => c.team === tr.team);
        if (c) c.charges = Math.min(c.charges + CFG.CACHE_CHARGES, CFG.CACHE_MAX);
        else G.caches.push({ team: tr.team, x: d.x, y: d.y, charges: CFG.CACHE_CHARGES });
        // reinforcements board a transport cart to the front
        const riders = G.soldiers.filter(so => so.team === tr.team && !so.alive && !so.riding);
        if (riders.length) launchCart(tr.team, riders);
      }
    } else if (tr.state === 'unload') {
      tr.t -= dt; if (tr.t <= 0) { tr.state = 'out'; tr.dir = -tr.dir; }
    } else {
      tr.x += tr.dir * CFG.TRUCK_SPEED * dt;
      if (tr.x < -150 || tr.x > W + 150) G.trucks.splice(G.trucks.indexOf(tr), 1);
    }
  }
  // depot cache refills
  for (const c of G.caches) {
    for (const s of G.soldiers) {
      if (!s.alive || s.team !== c.team || s.cacheCD > 0 || c.charges <= 0) continue;
      if (dist2(s.x, s.y, c.x, c.y) > 80 * 80) continue;
      if (s.hp >= maxHp(s) && ammoTotal(s) >= ammoFull(s)) continue;
      c.charges--; s.cacheCD = 6;
      s.hp = maxHp(s); refillAmmo(s);
      if (s.isPlayer) { message('Resupplied: full health and ammo', '#7fd18b', 2); SFX.pickup(); }
    }
  }
  G.caches = G.caches.filter(c => c.charges > 0);
}

function updateDrops(dt) {
  G.dropT -= dt;
  if (G.dropT <= 0) { G.dropT = CFG.DROP_INTERVAL; if (G.drops.length < CFG.DROP_MAX) spawnDrop(false); }
  for (const d of G.drops) { d.t += dt; if (d.fall > 0) d.fall -= dt; }
  for (const d of G.drops.slice()) {
    if (d.fall > 0) continue;
    for (const s of G.soldiers) {
      if (!s.alive || dist2(s.x, s.y, d.x, d.y) > 40 * 40) continue;
      s.mags = Array(s.cls.mags).fill(s.cls.mag);
      s.hp = Math.min(maxHp(s), s.hp + 60);
      let txt = `Supply drop: +${s.cls.mags} magazines, +60 health`;
      if (d.c4 && s.c4 < 1) { s.c4 = 1; txt += ', +1 C4'; }
      if (s.isPlayer) { message(txt, '#7fd18b', 2.5); SFX.pickup(); }
      G.drops.splice(G.drops.indexOf(d), 1);
      break;
    }
  }
}

function updateC4(dt) {
  for (const c of G.c4s.slice()) {
    c.fuse -= dt; c.beep -= dt;
    if (c.beep <= 0) { c.beep = c.fuse < 2 ? 0.25 : 0.6; SFX.beep(c.x, c.y); }
    if (c.fuse <= 0) {
      G.c4s.splice(G.c4s.indexOf(c), 1);
      explode(c.x, c.y, CFG.C4_RADIUS, 160, c.owner);
      destroyBridge(c.bridge, c.owner);
    }
  }
}

function updateSappers(dt) {
  for (let t = 0; t < 2; t++) {
    const tm = G.teams[t];
    tm.sapperT -= dt;
    if (tm.sapperT > 0) continue;
    tm.sapperT = 70 + Math.random() * 50;
    if (G.m.bridges[1 - t].destroyed) continue;
    if (G.soldiers.some(s => s.alive && s.team === t && s.bot && s.bot.role === 'sapper')) continue;
    if (Math.random() > 0.6) continue;
    const cands = G.soldiers.filter(s => s.alive && s.team === t && s.bot && !(s.isPlayer && !G.auto));
    if (!cands.length) continue;
    const s = pickRand(cands);
    s.bot.role = 'sapper'; s.c4 = Math.max(s.c4, 1); s.bot.objT = 0;
  }
}

function endMatch(winner, reason) {
  G.over = true; G.winner = winner; G.reason = reason;
  if (typeof onMatchEnd === 'function') onMatchEnd();
}

// ---------------- Grenades
function throwGrenade(s, tx, ty) {
  let dx = tx - s.x, dy = ty - s.y, d = Math.hypot(dx, dy) || 1;
  const reach = Math.min(d, CFG.GRENADE_RANGE);
  dx /= d; dy /= d;
  const k = 2.2;                       // ground friction; total travel = v0 / k
  s.nades--;
  G.grenades.push({ x: s.x + dx * 20, y: s.y + dy * 20, vx: dx * reach * k, vy: dy * reach * k, k, fuse: CFG.GRENADE_FUSE, team: s.team, owner: s, spin: 0 });
  if (s.isPlayer) SFX.click(0.15);
}
function updateGrenades(dt) {
  const m = G.m;
  for (const g of G.grenades.slice()) {
    g.fuse -= dt;
    const nx = g.x + g.vx * dt, ny = g.y + g.vy * dt;
    if (solidAt(m, nx, g.y)) g.vx = -g.vx * 0.45; else g.x = nx;
    if (solidAt(m, g.x, ny)) g.vy = -g.vy * 0.45; else g.y = ny;
    g.x = clamp(g.x, 5, W - 5); g.y = clamp(g.y, 5, H - 5);
    const f = Math.exp(-g.k * dt); g.vx *= f; g.vy *= f;
    g.spin += Math.hypot(g.vx, g.vy) * dt * 0.1;
    if (g.fuse <= 0) {
      G.grenades.splice(G.grenades.indexOf(g), 1);
      explode(g.x, g.y, CFG.GRENADE_RADIUS, CFG.GRENADE_DMG, g.owner);
    }
  }
}

// ---------------- Fog of war: shared team vision on the coarse grid
function castVision(vis, m, x, y, range, a0, a1, rays) {
  const step = 12;
  for (let r = 0; r < rays; r++) {
    const a = a0 + (a1 - a0) * (r + 0.5) / rays, cx = Math.cos(a), cy = Math.sin(a);
    for (let d = 0; d <= range; d += step) {
      const px = x + cx * d, py = y + cy * d;
      if (px < 0 || py < 0 || px >= W || py >= H) break;
      vis[((py / CELL) | 0) * GW + ((px / CELL) | 0)] = 1;
      if (m.shot[((py / CELL) | 0) * GW + ((px / CELL) | 0)]) break;
    }
  }
}
function computeVision(team) {
  const m = G.m, vis = G.teams[team].vis;
  vis.fill(0);
  G.visN = (G.visN || 0) + 1;
  for (const s of G.soldiers) {
    if (!s.alive || s.team !== team) continue;
    castVision(vis, m, s.x, s.y, visionRange(s), 0, TAU, 240);
    if (s.scoped) castVision(vis, m, s.x, s.y, s.cls.scopeRange, s.angle - s.cls.scopeCone, s.angle + s.cls.scopeCone, 110);
    // always see the space right around you
    const r = Math.ceil(CFG.VISION_NEAR / CELL), ci = (s.x / CELL) | 0, cj = (s.y / CELL) | 0;
    for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) if (i >= 0 && j >= 0 && i < GW && j < GH && (i - ci) ** 2 + (j - cj) ** 2 <= r * r) vis[j * GW + i] = 1;
  }
  for (const e of G.soldiers) if (e.alive && e.team !== team && isVisible(team, e.x, e.y)) e.spotted[team] = G.time;
}
function isVisible(team, x, y) {
  if (x < 0 || y < 0 || x >= W || y >= H) return false;
  return G.teams[team].vis[((y / CELL) | 0) * GW + ((x / CELL) | 0)] === 1;
}

// Grenades and C4 knock down house walls and windows inside the blast.
function breakWalls(x, y, r) {
  const m = G.m, hit = [];
  forBlockersNear(m, x - r, y - r, x + r, y + r, o => {
    if (!o.breakable) return;
    const cx = clamp(x, o.x, o.x + o.w), cy = clamp(y, o.y, o.y + o.h);
    if (dist2(cx, cy, x, y) < r * r) hit.push(o);
  });
  if (!hit.length) return;
  const gone = new Set(hit);
  m.solids = m.solids.filter(o => !gone.has(o));
  for (const o of hit) {
    stampRubble(G.art, o);
    for (let i = 0; i < 6; i++) G.particles.push({ type: 'dust', x: o.x + Math.random() * o.w, y: o.y + Math.random() * o.h, vx: rand(-60, 60), vy: rand(-60, 60), life: 1.2, max: 1.2, size: rand(8, 16) });
  }
  buildGrids(m);
  for (const s of G.soldiers) if (s.bot) s.bot.path = null;
}

// ---------------- Transport carts: carry reinforcements from the depot to the front
function cartTarget(team) {
  const m = G.m, depot = m.depots[team], ex = team === 0 ? W : 0;
  const owned = m.points.filter(p => p.owner === team && (team === 0 ? p.c1 : p.c0) === 0);
  let p, stopShort = false;
  if (owned.length) p = owned.sort((a, b) => Math.abs(a.x - ex) - Math.abs(b.x - ex))[0];
  else { p = m.points.slice().sort((a, b) => dist(a.x, a.y, depot.x, depot.y) - dist(b.x, b.y, depot.x, depot.y))[0]; stopShort = true; }
  let tx = p.x, ty = p.y;
  if (stopShort) {
    const d = dist(p.x, p.y, depot.x, depot.y), k = (d - CFG.CAP_R - 160) / d;
    tx = depot.x + (p.x - depot.x) * k; ty = depot.y + (p.y - depot.y) * k;
  }
  const f = randomFreeNear(m, tx, ty, 60);
  return { x: f.x, y: f.y, name: p.name };
}
function launchCart(team, riders) {
  const m = G.m, d = m.depots[team];
  const start = { x: d.x + (team === 0 ? 70 : -70), y: d.y };
  const tgt = cartTarget(team);
  const path = findPath(m, start.x, start.y, tgt.x, tgt.y);
  const cart = { isCart: true, team, x: start.x, y: start.y, vx: 0, vy: 0, angle: team === 0 ? 0 : Math.PI, hp: CFG.CART_HP, alive: true,
    riders, path, pi: 0, target: tgt, spotted: [0, 0], name: 'Transport' };
  for (const r of riders) r.riding = cart;
  G.carts.push(cart);
  if (!path) { dismount(cart); return; }
  if (team === G.player.team) feed(`Transport with ${riders.length} soldier${riders.length > 1 ? 's' : ''} heading to ${tgt.name}`, TEAMS[team].color);
}
function dismount(cart, only) {
  const list = only ? [only] : cart.riders;
  for (const r of list) {
    r.riding = null;
    spawnSoldier(r, { type: 'at', x: cart.x, y: cart.y });
    r.shield = CFG.SPAWN_SHIELD;
  }
  cart.riders = cart.riders.filter(r => !list.includes(r));
  if (!cart.riders.length) cart.empty = true;
}
function damageCart(c, amount, attacker) {
  if (!c.alive) return;
  c.hp -= amount;
  if (c.hp > 0) return;
  c.alive = false;
  G.carts.splice(G.carts.indexOf(c), 1);
  const n = c.riders.length;
  for (const r of c.riders) { r.riding = null; r.deaths++; if (attacker) attacker.kills++; }
  c.riders = [];
  explode(c.x, c.y, 110, 30, attacker);
  stampScorch(G.art, c.x, c.y, 50);
  feed(`${attacker ? attacker.name : 'Blast'} destroyed a ${TEAMS[c.team].name} transport${n ? ` (${n} aboard)` : ''}`, attacker ? TEAMS[attacker.team].color : '#e6ad45');
  if (c.team === G.player.team && n) message('Our transport was destroyed', '#ff5a4e', 3);
}
function updateCarts(dt) {
  for (const c of G.carts.slice()) {
    let tx, ty;
    if (c.empty) {
      const d = G.m.depots[c.team];
      if (!c.backPath) { c.backPath = findPath(G.m, c.x, c.y, d.x, d.y) || []; c.pi = 0; }
      if (c.pi >= c.backPath.length) { G.carts.splice(G.carts.indexOf(c), 1); continue; }
      tx = c.backPath[c.pi].x; ty = c.backPath[c.pi].y;
    } else {
      if (c.pi >= c.path.length) { dismount(c); continue; }
      tx = c.path[c.pi].x; ty = c.path[c.pi].y;
    }
    const dx = tx - c.x, dy = ty - c.y, d = Math.hypot(dx, dy);
    if (d < 20) { c.pi++; continue; }
    const want = Math.atan2(dy, dx);
    c.angle = turnTo(c.angle, want, 3 * dt);
    const sp = CFG.CART_SPEED * (G.m.slow[((c.y / CELL) | 0) * GW + ((c.x / CELL) | 0)] ? 0.6 : 1) * (Math.abs(angDiff(c.angle, want)) > 0.8 ? 0.4 : 1);
    c.vx = Math.cos(c.angle) * sp; c.vy = Math.sin(c.angle) * sp;
    c.x += c.vx * dt; c.y += c.vy * dt;
    // push soldiers out of the way
    for (const s of G.soldiers) {
      if (!s.alive) continue;
      const ex = s.x - c.x, ey = s.y - c.y, ed = Math.hypot(ex, ey), min = CFG.CART_R + CFG.R;
      if (ed < min && ed > 0.1) { s.x = c.x + ex / ed * min; s.y = c.y + ey / ed * min; }
    }
  }
}
