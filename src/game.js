'use strict';
// Match state and simulation.

let G = null;

function makeSoldier(team, idx, isPlayer) {
  return {
    id: team * 100 + idx, team, idx, isPlayer, name: CALLSIGNS[team][idx] || (TEAMS[team].name + '-' + (idx + 1)),
    x: 0, y: 0, z: 0, vx: 0, vy: 0, angle: team === 0 ? 0 : Math.PI, pitch: 0,
    hp: CFG.HP, alive: false, respawnT: 0, shield: 0,
    cls: CLASSES.rifleman, nades: 0, scoped: false, ads: false, aimX: 0, aimY: 0,
    mag: 25, mags: [], reloading: false, reloadT: 0, reloadMax: 1, fireCD: 0, heat: 0,
    c4: 0, act: null, actT: 0, cacheCD: 0, steady: true, steadyT: 0, crouch: false, para: 0, streak: 0, lastKillT: -99,
    spot: 0, kills: 0, deaths: 0, points: 0, perks: [], mods: { speed: 1, reload: 1, dmg: 1, maxHp: 1, spread: 1 },
    spotted: [0, 0], lastHitBy: null, lastHitT: -99, walkPhase: 0,
    bot: isPlayer ? null : newBrain(),
  };
}
function maxHp(s) { return CFG.HP * s.mods.maxHp; }
function ammoTotal(s) { return s.mag + s.mags.reduce((a, b) => a + b, 0); }
function ammoFull(s) { return s.cls.mag * (s.cls.mags + 1); }
function refillAmmo(s) { s.mag = s.cls.mag; s.mags = Array(s.cls.mags).fill(s.cls.mag); s.reloading = false; s.stash = {}; }
// 1 = main weapon, 2 = sidearm. Each keeps its own ammo; an empty stash means full magazines.
function switchWeapon(s, slot) {
  if (!s.alive || s.riding || (s.slot || 0) === slot || !s.prim || s.vault) return false;
  s.stash = s.stash || {};
  s.stash[s.slot || 0] = { mag: s.mag, mags: s.mags };
  s.slot = slot; s.cls = slot ? SIDEARM : s.prim;
  const st = s.stash[slot];
  if (st) { s.mag = st.mag; s.mags = st.mags; } else { s.mag = s.cls.mag; s.mags = Array(s.cls.mags).fill(s.cls.mag); }
  s.reloading = false; s.scoped = false; s.heat = 0; s.fireCD = Math.max(s.fireCD, CFG.SWITCH_T);
  if (s.isPlayer) SFX.reload();
  return true;
}
function visionRange(s) { return s.cls.vision; }

// Bot commander: picks a deployment pattern automatically.
function botCommanderCounts() {
  const patterns = [
    [2, 2, 2, 2, 2], [4, 3, 2, 1, 0], [0, 1, 2, 3, 4], [1, 2, 4, 2, 1], [3, 1, 2, 1, 3], [1, 3, 2, 3, 1],
  ];
  return pickRand(patterns).slice();
}

// Bot commander loadout: mostly rifles with a mix of specialists.
function botLoadout() {
  const pool = ['rifleman', 'rifleman', 'rifleman', 'shotgun', 'sniper', 'sniper', 'smg', 'smg', 'lmg', pickRand(['rifleman', 'smg', 'lmg', 'shotgun'])];
  return pool.sort(() => Math.random() - 0.5);
}

function startMatch(m, art, counts, playerSpot, opts = {}) {
  G = {
    m, art, time: 0, state: 'play', paused: false, over: false, winner: -1,
    skill: SKILLS[opts.skill ?? 1], auto: !!opts.auto,
    soldiers: [], bullets: [], particles: [], drops: [], caches: [], c4s: [], trucks: [], feed: [], msg: null,
    teams: [
      { points: 0, supplyT: CFG.SUPPLY_INTERVAL, paraT: CFG.PARA_INTERVAL, sapperT: 100 + Math.random() * 40, counts: counts.slice(), vis: new Uint8Array(GW * GH) },
      { points: 0, supplyT: CFG.SUPPLY_INTERVAL, paraT: CFG.PARA_INTERVAL, sapperT: 100 + Math.random() * 40, counts: botCommanderCounts(), vis: new Uint8Array(GW * GH) },
    ],
    lock: { team: -1, t: 0 }, holdT: 0, dropT: CFG.DROP_INTERVAL, pathBudget: 0, cam: { x: 0, y: 0, shake: 0 }, hurtT: 0, hitT: 0,
    grenades: [], carts: [], strikes: [], targeting: false, specIdx: 0, visT: 0, smokers: [],
    stats: { captures: [0, 0], bridges: [false, false] },
  };
  for (let t = 0; t < 2; t++) {
    const list = [];
    G.teams[t].counts.forEach((n, i) => { for (let k = 0; k < n; k++) list.push(i); });
    if (t === 0) { // player first, at their chosen spot
      const pi = list.indexOf(playerSpot); if (pi >= 0) list.splice(pi, 1);
      list.unshift(playerSpot);
    }
    const loadout = t === 0 ? (opts.loadout || DEFAULT_LOADOUT) : botLoadout();
    for (let i = 0; i < CFG.TEAM_SIZE; i++) {
      const s = makeSoldier(t, i, t === 0 && i === 0);
      s.cls = CLASSES[loadout[i]] || CLASSES.rifleman;
      if (t === 0 && i === 0 && CLASSES[opts.playerClass]) s.cls = CLASSES[opts.playerClass];
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
  message('Hold all five sectors (A to E) at the same time to win', '#e6ad45', 5);
}

function spawnSoldier(s, choice) {
  const m = G.m;
  let base;
  if (choice.type === 'at') base = { x: choice.x, y: choice.y };
  else if (choice.type === 'depot') base = m.depots[s.team];
  else base = m.spawns[s.team][choice.idx ?? s.spot] || m.spawns[s.team][0];
  const p = randomFreeNear(m, base.x + (choice.type === 'depot' ? (s.team === 0 ? 110 : -110) : 0), base.y, choice.type === 'depot' ? 80 : choice.type === 'at' ? 70 : 55);
  s.x = p.x; s.y = p.y; s.z = 0; s.vx = s.vy = 0; s.pitch = 0;
  Perks.reapply(G, s);
  s.hp = maxHp(s); s.alive = true; s.shield = CFG.SPAWN_SHIELD;
  refillAmmo(s); s.fireCD = 0; s.heat = 0; s.scoped = false; s.steady = false; s.steadyT = 0; s.crouch = false; s.para = 0; s.jz = 0; s.jv = 0; s.vault = null;
  if (s.slot) s.cls = s.prim;   // always come back holding the main weapon
  if (s.nextCls) { s.cls = s.nextCls; s.nextCls = null; refillAmmo(s); }
  s.prim = s.cls; s.slot = 0; s.stash = {};
  s.nades = CFG.GRENADES;
  s.act = null; s.actT = 0;
  s.angle = s.team === 0 ? 0 : Math.PI;
  if (s.bot) resetBrain(s);
}

// Kill feedback (enemy down, double kill ... pentakill). The online server routes it to the killer's client.
function killStreak(s, n, head) { if (s === G.player && typeof announceKill === 'function') announceKill(n, head); }
function message(text, color = '#e3e7df', t = 3.5) { G.msg = { text, color, t, max: t }; }
function feed(text, color) { G.feed.unshift({ text, color, t: 7 }); if (G.feed.length > 6) G.feed.pop(); }
// Messages meant for one team or one soldier. Offline they show only when they concern the local player;
// the online server replaces these three to route them to the right clients.
function msgFor(team, text, color, t) { if (G.player && team === G.player.team) message(text, color, t); }
function msgTo(s, text, color, t) { if (s === G.player) message(text, color, t); }
function feedFor(team, text, color) { if (G.player && team === G.player.team) feed(text, color); }

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
  s.lastShotT = G.time;
  s.steady = false; s.steadyT = 0;   // the first shot is dead on; the next ones spread until you hold still again
  const a = s.angle + (Math.random() - 0.5) * 2 * spread;
  const pa = clamp(s.pitch + (Math.random() - 0.5) * 2 * spread * CFG.V_SPREAD, -1.4, 1.4);
  const mx = s.x + Math.cos(s.angle) * 18, my = s.y + Math.sin(s.angle) * 18, mz = eyeZ(s) - 3;
  const sp = s.cls.bulletSpeed, n = s.cls.pellets || 1, ps = s.cls.pelletSpread || 0;
  for (let i = 0; i < n; i++) {
    // pellets fan out evenly around the aim point (a random disc), so the cone is wide but the centre stays dense
    const r = ps * Math.sqrt(Math.random()), th = Math.random() * TAU;
    const ba = a + (i ? Math.cos(th) * r : 0), bp = clamp(pa + (i ? Math.sin(th) * r * 0.7 : 0), -1.4, 1.4), cp = Math.cos(bp);
    G.bullets.push({ x: mx, y: my, z: mz, px: mx, py: my, ox: mx, oy: my, vx: Math.cos(ba) * sp * cp, vy: Math.sin(ba) * sp * cp, vz: Math.sin(bp) * sp,
      life: s.cls.range / sp, team: s.team, owner: s, dmg: s.cls.dmg * s.mods.dmg, sniper: s.cls === CLASSES.sniper, fo: s.cls.falloff, pel: n > 1 });
  }
  s.mag--; s.fireCD = 1 / s.cls.rate; s.heat = Math.min(0.025, s.heat + (s.cls.auto ? 0.004 : 0.015));
  const sn = s.cls === CLASSES.sniper;   // the sniper's muzzle flash is much brighter and easier to spot
  G.particles.push({ type: 'flash', x: mx, y: my, z: mz, a: s.angle, life: sn ? 0.14 : 0.05, max: sn ? 0.14 : 0.05, big: sn });
  if (Math.random() < 0.5) stampCasing(G.art, s.x + Math.cos(s.angle + 1.6) * 16, s.y + Math.sin(s.angle + 1.6) * 16);
  if (s.cls.pellets) SFX.shotgun(s.x, s.y, s.isPlayer, () => s.alive && s.mag > 0 && s.cls.pellets);
  else if (s.cls === CLASSES.sniper && SFX.sniper) SFX.sniper(s.x, s.y, s.isPlayer);
  else if (s.cls.key === 'smg' && SFX.smg) SFX.smg(s.x, s.y, s.isPlayer);
  else SFX.shot(s.x, s.y, s.isPlayer);
}

// Heights in the world: the floor a soldier stands on, and their eyes.
function feetZ(s) { return elevAt(G.m, s.x, s.y) + (s.z || 0) + (s.para || 0) + (s.jz || 0); }
function eyeZ(s) { return feetZ(s) + (s.crouch ? CFG.CROUCH_EYE : CFG.EYE); }
function bodyH(s) { return s.crouch ? CFG.CROUCH_BODY : CFG.BODY_H; }
function headH(s) { return s.crouch ? CFG.CROUCH_HEAD : CFG.HEAD_H; }
function chestZ(s) { return feetZ(s) + bodyH(s) * 0.62; }
// Floors: a staircase ramps between the ground floor and the upper floor of a two-storey house.
// Walking into the side of the staircase from below is blocked (px, py: position before this step).
function updateFloor(m, s, px, py) {
  const f = houseAt(m, s.x, s.y);
  if (!f || f.stories < 2) { s.z = 0; return; }
  const st = f.stair, FH = CFG.FLOOR_H;
  if (inStair(st, s.x, s.y)) {
    const t = stairT(st, s.x, s.y), z = t * FH;
    if ((s.z || 0) < z - 22 && px !== undefined) {
      // came in under the high end of the stairs: stay on the ground floor
      if (!inStair(st, px, s.y)) s.x = px; else if (!inStair(st, s.x, py)) s.y = py; else { s.x = px; s.y = py; }
      s.z = 0; return;
    }
    s.z = z; return;
  }
  s.z = (s.z || 0) >= FH / 2 ? FH : 0;
}
// ---------- jumping and vaulting (Space)
function circleFree(m, x, y, z) { const t = { x, y }; collideCircle(m, t, CFG.R - 1, z); return Math.abs(t.x - x) + Math.abs(t.y - y) < 0.5; }
// Low, thin cover (sandbags, crates, logs, barriers, low walls) or a window right in front: vault over / through it.
function findVault(m, s, a) {
  const cx = Math.cos(a), cy = Math.sin(a), fz = feetZ(s) + 8;
  let hit = null, d1 = 0;
  for (let d = CFG.R - 2; d <= CFG.R + 26; d += 2) {
    const o = blockedAt(m, s.x + cx * d, s.y + cy * d, fz);
    if (o && o !== 'ground') { hit = o; d1 = d; break; }
  }
  if (!hit || hit.water) return null;
  const top = hit.gz + hit.z1 - feetZ(s);
  if (!hit.window && (top > CFG.VAULT_H || (hit.breakable && !hit.window))) return null;
  // how thick is it along this direction?
  let d2 = -1;
  for (let d = d1 + 2; d <= d1 + CFG.VAULT_T + 2; d += 2) {
    const o = blockedAt(m, s.x + cx * d, s.y + cy * d, fz);
    if (!o || o === 'ground') { d2 = d; break; }
  }
  if (d2 < 0) return null;
  const land = d2 + CFG.R + 3, x1 = s.x + cx * land, y1 = s.y + cy * land;
  if (x1 < 20 || y1 < 20 || x1 > W - 20 || y1 > H - 20) return null;
  if (!circleFree(m, x1, y1, s.z || 0)) return null;
  if (Math.abs(elevAt(m, x1, y1) - elevAt(m, s.x, s.y)) > 40) return null;
  return { x0: s.x, y0: s.y, x1, y1, t: 0, dur: CFG.VAULT_TIME, h: (hit.window ? WIN_LO : Math.max(10, top)) + 6 };
}
function tryJump(m, s, a) {
  if (s.vault || s.jz > 0 || s.para > 0 || s.crouch) return;
  const v = findVault(m, s, a);
  if (v) s.vault = v; else s.jv = CFG.JUMP_V;
}
function vaultStep(m, s, dt) {
  const v = s.vault; v.t += dt;
  const f = Math.min(1, v.t / v.dur);
  s.x = lerp(v.x0, v.x1, f); s.y = lerp(v.y0, v.y1, f); s.jz = Math.sin(Math.PI * f) * v.h; s.vx = s.vy = 0;
  if (f >= 1) {
    s.vault = null; s.jz = 0;
    const z0 = s.z || 0; updateFloor(m, s);
    if (s.z < z0) { s.jz = z0 - s.z; s.jv = 0; }   // out of an upper-floor window: fall to the ground
  }
}
function airStep(s, dt) {
  if (!(s.jz > 0 || s.jv > 0)) return;
  s.jv -= CFG.GRAV * dt; s.jz += s.jv * dt;
  if (s.jz <= 0) { s.jz = 0; s.jv = 0; }
}

// Terrain: shooting downhill tightens spread, uphill widens it.
function slopeFactor(s) {
  const d = (feetZ(s) - elevAt(G.m, s.aimX, s.aimY)) / CFG.LEVEL_H;
  if (d > CFG.HEIGHT_STEP) return 1 / CFG.DOWNHILL_ACC;
  if (d < -CFG.HEIGHT_STEP) return CFG.UPHILL_PEN;
  return 1;
}
function currentSpread(s, moving) {
  if (s.cls.hipSpread && !s.scoped) return s.cls.hipSpread * (moving ? 1.3 : 1) / (s.crouch ? CFG.CROUCH_ACC : 1);   // sniper from the hip
  if (s.steady) return 0;
  let sp = (moving ? s.cls.spreadMove : s.cls.spread) * s.mods.spread + s.heat;
  if (s.scoped) sp *= s.cls.scopeSpread;
  else if (s.ads) sp /= CFG.ADS_ACC;
  if (s.crouch) sp /= CFG.CROUCH_ACC;
  return sp * slopeFactor(s);
}

// where the bullet being resolved struck (the server sends it so pellet hit markers work online)
let HITPT = null;
// shotgun pellet hit markers: small marks at each point a pellet struck, drawn by the HUD for half a second
function pelletMark(x, y, z, head) { if (G) { (G.pelHits || (G.pelHits = [])).push({ x, y, z, head, t: 0.5 }); if (G.pelHits.length > 40) G.pelHits.shift(); } }
function damage(target, amount, attacker, head) {
  if (!target.alive || target.shield > 0) return;
  target.hp -= amount;
  target.lastHitBy = attacker; target.lastHitT = G.time;
  if (target.isPlayer) { G.hurtT = 0.45; if (attacker) G.hurtFrom = Math.atan2(attacker.y - target.y, attacker.x - target.x); }
  if (attacker && attacker.isPlayer) { G.hitT = 0.15; if (head) G.headT = 0.3; SFX.hit(); }
  else SFX.hitNear && SFX.hitNear(target.x, target.y);
  if (Math.random() < 0.6) stampBlood(G.art, target.x + rand(-10, 10), target.y + rand(-10, 10), rand(3, 7));
  for (let i = 0; i < 4; i++) G.particles.push({ type: 'blood', x: target.x, y: target.y, vx: rand(-80, 80), vy: rand(-80, 80), life: 0.4, max: 0.4, size: rand(1.5, 3) });
  if (target.hp <= 0) kill(target, attacker, head);
}

function kill(s, killer, head) {
  s.alive = false; s.hp = 0; s.deaths++; s.diedAt = G.time;
  // which way the body falls: away from whoever shot it
  s.fallA = killer && killer !== s ? Math.atan2(s.y - killer.y, s.x - killer.x) : s.angle + Math.PI;
  s.reloading = false; s.act = null; s.scoped = false;
  stampBody(G.art, s);
  if (killer && killer !== s) {
    killer.kills++;
    if (killer.team !== s.team) {
      killer.streak = G.time - killer.lastKillT <= CFG.STREAK_T ? Math.min(5, killer.streak + 1) : 1;
      killer.lastKillT = G.time;
      killStreak(killer, killer.streak, !!head);
    }
  }
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
  // self-heal: after REGEN_DELAY s without damage, refill from empty to full in REGEN_TIME s
  if (s.hp < maxHp(s) && G.time - s.lastHitT >= CFG.REGEN_DELAY) s.hp = Math.min(maxHp(s), s.hp + maxHp(s) / CFG.REGEN_TIME * dt);
  s.cacheCD -= dt;
  s.heat = Math.max(0, s.heat - dt * 0.08);
  let mvx = ctl.mx || 0, mvy = ctl.my || 0;
  // crouching (Ctrl): steadier aim, but you stay where you are
  s.crouch = !!(ctl.crouch && !(s.para > 0));
  if (s.crouch) { mvx = 0; mvy = 0; }
  const ml = Math.hypot(mvx, mvy);
  if (ml > 1) { mvx /= ml; mvy /= ml; }
  const moving = ml > 0.1;
  const fire = ctl.fire;
  const sprint = ctl.sprint && moving && !fire && !s.reloading && !(ctl.scope && !s.cls.scopeRange) && !(s.para > 0);
  // stand still without shooting for STEADY_T seconds and the next shot is dead accurate; moving or jumping loses it
  if (moving || (s.jz || 0) > 1 || s.para > 0) { s.steadyT = 0; s.steady = false; }
  else if (fire) s.steadyT = 0;
  else if ((s.steadyT += dt) >= CFG.STEADY_T) s.steady = true;

  if (ctl.aimX !== undefined) { s.aimX = ctl.aimX; s.aimY = ctl.aimY; }
  if (ctl.pitch !== undefined) s.pitch = clamp(ctl.pitch, -1.4, 1.4);
  s.scoped = !!(ctl.scope && s.cls.scopeRange && !moving && !s.reloading);
  // aiming down the sights (every gun but the sniper, whose right click is the scope): tighter aim, slower walk
  s.ads = !!(ctl.scope && !s.cls.scopeRange && !s.reloading);
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
  if (s.ads) speed *= CFG.ADS_SPEED;
  if (s.para > 0) speed = CFG.WALK * 0.6;   // steering the parachute
  if (ctl.jump && !s.vault) tryJump(m, s, moving ? Math.atan2(mvy, mvx) : s.angle);
  if (s.vault) { vaultStep(m, s, dt); s.fireCD -= dt; return; }   // no shooting mid-vault
  const k = 1 - Math.exp(-dt * 14);
  s.vx = lerp(s.vx, mvx * speed, k); s.vy = lerp(s.vy, mvy * speed, k);
  const ox = s.x, oy = s.y;
  s.x += s.vx * dt; s.y += s.vy * dt;
  collideCircle(m, s, CFG.R, (s.z || 0) + (s.jz || 0));
  airStep(s, dt);
  if (s.para > 0) { s.para = Math.max(0, s.para - CFG.PARA_FALL * dt); s.z = 0; }
  else updateFloor(m, s, ox, oy);
  if (moving && !(s.para > 0)) s.walkPhase += dt * speed * 0.12;

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
    msgFor(a.bridge.team, 'Enemy C4 on our bridge! Defuse it with F', '#ff5a4e', 4);
    msgFor(s.team, 'C4 planted on the enemy bridge', TEAMS[s.team].color, 3);
  } else {
    G.c4s.splice(G.c4s.indexOf(a.c4), 1);
    feed(`${s.name} defused the C4`, TEAMS[s.team].color);
    msgFor(s.team, 'C4 defused. Bridge saved', TEAMS[s.team].color, 3);
    s.points += 25;
  }
}

function explode(x, y, radius, maxDmg, attacker, z) {
  SFX.boom(x, y);
  if (z === undefined) z = elevAt(G.m, x, y) + 6;
  for (const s of G.soldiers) {
    if (!s.alive || (attacker && s.team === attacker.team && s !== attacker)) continue;
    const cz = chestZ(s), d = Math.hypot(s.x - x, s.y - y, (cz - z) * 0.8);
    if (d >= radius) continue;
    if (!los3(G.m, x, y, z + 8, s.x, s.y, cz)) continue;   // walls, floors and hills block the blast
    damage(s, maxDmg * (1 - d / radius), attacker);
  }
  if (z - elevAt(G.m, x, y) < 20) stampScorch(G.art, x, y, radius * 0.5);
  breakWalls(x, y, radius * 0.75, z);
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
  msgFor(team, 'Our bridge is down. No more supply trucks or carts', '#ff5a4e', 5);
  msgFor(1 - team, 'Enemy bridge destroyed. Their supplies are cut off', TEAMS[1 - team].color, 5);
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
  updateStrikes(dt);
  G.cmdT = (G.cmdT || 0) - dt;
  if (G.cmdT <= 0) { G.cmdT = 1; botCommanderStrike(1); if (G.auto) botCommanderStrike(0); }
  G.visT -= dt;
  if (G.visT <= 0) { G.visT = 0.15; for (const t of (G.visTeams || [G.player.team])) computeVision(t); }
  updateDrops(dt);
  updateC4(dt);
  updateSappers(dt);

  for (const f of G.feed) f.t -= dt;
  G.feed = G.feed.filter(f => f.t > 0);
  if (G.msg) { G.msg.t -= dt; if (G.msg.t <= 0) G.msg = null; }
  G.hurtT = Math.max(0, G.hurtT - dt); G.hitT = Math.max(0, G.hitT - dt);
  if (G.pelHits) { for (const h of G.pelHits) h.t -= dt; G.pelHits = G.pelHits.filter(h => h.t > 0); }
  G.cam.shake = Math.max(0, G.cam.shake - dt * 30);

  // victory
  let lockTeam = -1;
  for (let t = 0; t < 2; t++) if (m.points.every(p => p.owner === t)) lockTeam = t;
  if (lockTeam !== G.lock.team) {
    G.lock = { team: lockTeam, t: 0 };
    if (lockTeam >= 0) {
      msgFor(lockTeam, `We hold all five sectors. Keep them for ${CFG.WIN_HOLD} s`, TEAMS[lockTeam].color, 4);
      msgFor(1 - lockTeam, `Enemy holds all five sectors! Retake one within ${CFG.WIN_HOLD} s`, TEAMS[lockTeam].color, 4);
    }
  }
  if (lockTeam >= 0) { G.lock.t += dt; if (G.lock.t >= CFG.WIN_HOLD) return endMatch(lockTeam, 'Held all five sectors at once'); }
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
    const nx = b.x + b.vx * dt, ny = b.y + b.vy * dt, nz = b.z + b.vz * dt;
    let hit = false;
    // soldiers: the 2D hit circle, then the height of the bullet against the body (headshots above HEAD_H)
    let bestT = 2, bestS = null, head = false;
    for (const s of G.soldiers) {
      if (!s.alive || s.team === b.team) continue;
      const t = segCircleHit(b.x, b.y, nx, ny, s.x, s.y, CFG.R);
      if (t < 0 || t >= bestT) continue;
      const bz = b.z + (nz - b.z) * t, fz = feetZ(s);
      if (bz < fz - 2 || bz > fz + bodyH(s) + 2) continue;
      bestT = t; bestS = s; head = bz > fz + headH(s);
    }
    for (const c of G.carts) {
      if (c.team === b.team) continue;
      const t = segCircleHit(b.x, b.y, nx, ny, c.x, c.y, CFG.CART_R);
      if (t < 0 || t >= bestT) continue;
      const bz = b.z + (nz - b.z) * t, fz = elevAt(m, c.x, c.y);
      if (bz > fz + 44) continue;
      bestT = t; bestS = c; head = false;
    }
    // obstacles, terrain, floors and roofs: step along the segment
    const steps = Math.ceil(Math.hypot(nx - b.x, ny - b.y) / 8);
    let pz = b.z;
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      if (bestS && t > bestT) break;
      const x = b.x + (nx - b.x) * t, y = b.y + (ny - b.y) * t, z = b.z + (nz - b.z) * t;
      if (x < 0 || y < 0 || x > W || y > H || z > 2000) { hit = true; break; }
      if (blockedAt(m, x, y, z) || slabBetween(m, x, y, pz, z)) {
        hit = true;
        for (let i = 0; i < 3; i++) G.particles.push({ type: 'spark', x, y, z, vx: -b.vx * 0.08 + rand(-90, 90), vy: -b.vy * 0.08 + rand(-90, 90), life: 0.2, max: 0.2, size: 2 });
        G.particles.push({ type: 'dust', x, y, z, vx: rand(-20, 20), vy: rand(-20, 20), life: 0.5, max: 0.5, size: rand(5, 9) });
        b.x = x; b.y = y; b.z = z;
        break;
      }
      pz = z;
    }
    if (!hit && bestS && bestS.isCart) { damageCart(bestS, b.dmg, b.owner); hit = true; b.x += (nx - b.x) * bestT; b.y += (ny - b.y) * bestT;
      for (let i = 0; i < 3; i++) G.particles.push({ type: 'spark', x: b.x, y: b.y, z: b.z + (nz - b.z) * bestT, vx: rand(-120, 120), vy: rand(-120, 120), life: 0.2, max: 0.2, size: 2 }); }
    else if (!hit && bestS) {
      let dmg = b.dmg * (head ? CFG.HEADSHOT : 1);
      if (b.fo) {   // shotgun pellets lose damage with distance
        const d = Math.hypot(b.x + (nx - b.x) * bestT - b.ox, b.y + (ny - b.y) * bestT - b.oy), [d0, d1, lo] = b.fo;
        dmg *= d <= d0 ? 1 : d >= d1 ? lo : 1 - (1 - lo) * (d - d0) / (d1 - d0);
      }
      HITPT = { x: b.x + (nx - b.x) * bestT, y: b.y + (ny - b.y) * bestT, z: b.z + (nz - b.z) * bestT, pel: !!b.pel, head };
      if (b.pel && b.owner && b.owner.isPlayer) pelletMark(HITPT.x, HITPT.y, HITPT.z, head);
      damage(bestS, dmg, b.owner, head);
      HITPT = null;
      hit = true; b.x = b.x + (nx - b.x) * bestT; b.y = b.y + (ny - b.y) * bestT;
    }
    if (!hit) { b.x = nx; b.y = ny; b.z = nz; b.life -= dt; if (b.life > 0) out.push(b); }
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

// Sectors are captured by whoever has more soldiers inside them. The speed grows with the size of the edge
// (majority minus minority), but slowly: 1 soldier takes CAP_TIME s, an edge of 2 is 1.2x faster, 4 is 1.4x ...
function capSpeed(edge) { return edge <= 0 ? 0 : 1 + CFG.CAP_LOG * Math.log2(edge); }
function updateCapture(dt) {
  const m = G.m, rate = 100 / CFG.CAP_TIME;
  for (const p of m.points) { p.c0 = 0; p.c1 = 0; }
  for (const s of G.soldiers) {
    if (!s.alive || s.para > 0) continue;
    const k = sectorAt(m, s.x, s.y);
    if (k >= 0) { if (s.team === 0) m.points[k].c0++; else m.points[k].c1++; }
  }
  for (const p of m.points) {
    const c0 = p.c0, c1 = p.c1;
    const before = p.owner;
    if (c0 > c1) p.prog = Math.min(100, p.prog + rate * capSpeed(c0 - c1) * dt);
    else if (c1 > c0) p.prog = Math.max(-100, p.prog - rate * capSpeed(c1 - c0) * dt);
    else if (c0 > 0) { /* even numbers: contested, frozen */ }
    else {
      const target = p.owner === 0 ? 100 : p.owner === 1 ? -100 : 0;
      p.prog += clamp(target - p.prog, -4 * dt, 4 * dt);
    }
    if (p.owner === 1 && p.prog >= 0) p.owner = -1;
    if (p.owner === 0 && p.prog <= 0) p.owner = -1;
    if (p.prog >= 100 && p.owner !== 0) p.owner = 0;
    if (p.prog <= -100 && p.owner !== 1) p.owner = 1;
    if (p.owner !== before) {
      if (p.owner === -1) feed(`Sector ${p.name} neutralized`, '#8e9b92');
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
  const pk = G.m.points.indexOf(p);
  for (const s of G.soldiers) if (s.alive && s.team === t && sectorAt(G.m, s.x, s.y) === pk) s.points += CFG.CAPTURER_REWARD;
  feed(`${TEAMS[t].name} captured sector ${p.name}  +${CFG.CAPTURE_REWARD} pts`, TEAMS[t].color);
  msgFor(1 - t, `Sector ${p.name} lost`, TEAMS[t].color, 2.5);
  if (G.player) SFX.capture(t === G.player.team);
  // an ammo crate for the first CAP_AMMO soldiers who reach it
  for (const c of G.caches.slice()) if (c.ammo && dist(c.x, c.y, p.x, p.y) < 200) G.caches.splice(G.caches.indexOf(c), 1);
  const f = randomFreeNear(G.m, p.x, p.y, 50);
  G.caches.push({ team: t, x: f.x, y: f.y, charges: CFG.CAP_AMMO, ammo: true });
  msgFor(t, `Sector ${p.name} captured. Ammo crate for ${CFG.CAP_AMMO} at its flag`, TEAMS[t].color, 3);
  for (const s of G.soldiers) if (s.bot) s.bot.objT = Math.min(s.bot.objT, Math.random() * 1.5);
}

function updateSupply(dt) {
  const m = G.m;
  for (let t = 0; t < 2; t++) {
    const tm = G.teams[t];
    updateParachutes(t, dt);
    if (m.bridges[t].destroyed) continue;
    tm.supplyT -= dt;
    if (tm.supplyT <= 0) {
      tm.supplyT = CFG.SUPPLY_INTERVAL;
      const lane = m.truckLanes[t];
      G.trucks.push({ team: t, x: lane.from, y: lane.y, dir: lane.dir, state: 'in', t: 0 });
    }
  }
  for (const tr of G.trucks.slice()) {
    const lane = m.truckLanes[tr.team];
    if (tr.state === 'in') {
      tr.x += tr.dir * CFG.TRUCK_SPEED * dt;
      if ((tr.dir > 0 && tr.x >= lane.to) || (tr.dir < 0 && tr.x <= lane.to)) {
        tr.x = lane.to; tr.state = 'unload'; tr.t = 4;
        const d = m.depots[tr.team];
        let c = G.caches.find(c => c.team === tr.team && c.depot);
        if (c) c.charges = Math.min(c.charges + CFG.CACHE_CHARGES, CFG.CACHE_MAX);
        else G.caches.push({ team: tr.team, x: d.x, y: d.y, charges: CFG.CACHE_CHARGES, depot: true });
        launchCart(tr.team, []);   // the cart carries supplies (no soldiers) to the front
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
      if (c.ammo) {
        if (ammoTotal(s) >= ammoFull(s)) continue;
        c.charges--; s.cacheCD = 6;
        const m0 = s.mag; refillAmmo(s); s.mag = Math.max(m0, s.mag);
        msgTo(s, `Ammo crate: full ammo (${c.charges} left)`, '#7fd18b', 2);
        if (s.isPlayer) SFX.pickup();
        continue;
      }
      if (s.hp >= maxHp(s) && ammoTotal(s) >= ammoFull(s)) continue;
      c.charges--; s.cacheCD = 6;
      s.hp = maxHp(s); refillAmmo(s);
      msgTo(s, 'Resupplied: full health and ammo', '#7fd18b', 2);
      if (s.isPlayer) SFX.pickup();
    }
  }
  G.caches = G.caches.filter(c => c.charges > 0);
}

// A sector counts for respawns only when it is fully controlled: owned, at 100% and with no enemy inside.
function fullyHeld(p, t) { return p.owner === t && (t === 0 ? p.prog >= 99.9 : p.prog <= -99.9) && (t === 0 ? p.c1 : p.c0) === 0; }
// The only respawn: every PARA_INTERVAL s the first PARA_N soldiers to have died parachute in 20 m above
// the flag of a sector the team holds (over the home base if it holds none).
function updateParachutes(t, dt) {
  const tm = G.teams[t], m = G.m;
  tm.paraT -= dt;
  if (tm.paraT > 0) return;
  tm.paraT = CFG.PARA_INTERVAL;
  const dead = G.soldiers.filter(s => s.team === t && !s.alive && !s.riding && !s.off).sort((a, b) => (a.diedAt || 0) - (b.diedAt || 0)).slice(0, CFG.PARA_N);
  if (!dead.length) return;
  const held = m.points.filter(p => fullyHeld(p, t));
  const zones = held.length ? held : m.spawns[t].map(sp => ({ x: sp.x, y: sp.y, name: 'base' }));
  for (const s of dead) {
    const p = pickRand(zones);
    let f = null;
    for (let k = 0; k < 20 && !f; k++) { const c = randomFreeNear(m, p.x + rand(-150, 150), p.y + rand(-150, 150), 110); if (!houseAt(m, c.x, c.y)) f = c; }
    f = f || randomFreeNear(m, p.x, p.y, 160);
    spawnSoldier(s, { type: 'at', x: f.x, y: f.y });
    s.x = f.x; s.y = f.y; s.para = CFG.PARA_H; s.shield = CFG.SPAWN_SHIELD;
    msgTo(s, p.name === 'base' ? 'Parachuting into our base (no sector fully under our control)' : `Parachuting into sector ${p.name}`, TEAMS[t].color, 3);
  }
  feedFor(t, `${dead.length} soldier${dead.length > 1 ? 's' : ''} parachuting in`, TEAMS[t].color);
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
      msgTo(s, txt, '#7fd18b', 2.5);
      if (s.isPlayer) SFX.pickup();
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
// Grenades fly a real arc: thrown from eye height at about 40 degrees (steeper when the target is above you),
// with just the speed to land on the aimed point. They bounce off walls, floors, roofs and the ground, roll
// to a stop, and go off CFG.GRENADE_LAND_FUSE seconds after first touching down.
function throwGrenade(s, tx, ty) {
  const m = G.m;
  let dx = tx - s.x, dy = ty - s.y, d = Math.hypot(dx, dy) || 1;
  const reach0 = clamp(d, 40, CFG.GRENADE_RANGE);
  dx /= d; dy /= d;
  const reach = reach0 - 14;   // measured from the hand, a little in front of you
  const sx = s.x + dx * 14, sy = s.y + dy * 14, sz = eyeZ(s) + 2, g0 = CFG.GRENADE_G;
  const dh = elevAt(m, clamp(s.x + dx * reach0, 0, W - 1), clamp(s.y + dy * reach0, 0, H - 1)) + 3 - sz;
  let th = 0.7, v = 0;
  for (let i = 0; i < 6; i++, th += 0.1) {   // steepen until the arc can reach (target far above you)
    const den = 2 * Math.cos(th) ** 2 * (reach * Math.tan(th) - dh);
    if (den > 0) { v = Math.sqrt(g0 * reach * reach / den); break; }
  }
  if (!v) v = 520;
  v = Math.min(v, 620);
  s.nades--;
  const ch = Math.cos(th) * v;
  G.grenades.push({ x: sx, y: sy, z: sz - elevAt(m, sx, sy), vx: dx * ch, vy: dy * ch, vz: Math.sin(th) * v, fuse: null, life: 0,
    team: s.team, owner: s, spin: 0 });
  if (s.isPlayer) SFX.click(0.15);
}
// Floor under a grenade at height h above the terrain: ground, the upper floor, a stair step or a roof.
function nadeFloor(m, x, y, h) {
  const f = houseAt(m, x, y);
  if (!f) return 0;
  const FH = CFG.FLOOR_H, roof = f.stories * FH;
  if (h >= roof - 3) return roof;
  if (f.stories === 2) {
    if (inStair(f.stair, x, y)) { const t = stairT(f.stair, x, y) * FH; return h >= t - 3 ? t : 0; }
    if (h >= FH - 3) return FH;
  }
  return 0;
}
function nadeCeiling(m, x, y, h) {
  const f = houseAt(m, x, y);
  if (!f) return Infinity;
  const FH = CFG.FLOOR_H, roof = f.stories * FH;
  if (h >= roof - 3) return Infinity;
  if (f.stories === 2 && h < FH - 3 && !inStair(f.stair, x, y)) return FH;
  return roof;
}
function updateGrenades(dt) {
  const m = G.m, g0 = CFG.GRENADE_G;
  for (const g of G.grenades.slice()) {
    g.life += dt;
    if (g.fuse !== null) g.fuse -= dt;
    const air = g.vz !== 0 || g.z > nadeFloor(m, g.x, g.y, g.z) + 0.5;
    // horizontal: bounce off walls and anything solid at the grenade's height
    const nx = g.x + g.vx * dt, ny = g.y + g.vy * dt;
    const absZ = g.z + elevAt(m, g.x, g.y);
    const hit = (x, y) => x < 5 || y < 5 || x > W - 5 || y > H - 5 || !!blockedAt(m, x, y, absZ + 2);
    if (hit(nx, g.y)) { g.vx = -g.vx * 0.4; g.vy *= 0.8; SFX.nade && SFX.nade(g.x, g.y); } else g.x = nx;
    if (hit(g.x, ny)) { g.vy = -g.vy * 0.4; g.vx *= 0.8; SFX.nade && SFX.nade(g.x, g.y); } else g.y = ny;
    if (air) {
      g.vz -= g0 * dt;
      let h = g.z + g.vz * dt;
      const ceil = nadeCeiling(m, g.x, g.y, g.z);
      if (h > ceil - 2) { h = ceil - 2; g.vz = -Math.abs(g.vz) * 0.3; }
      const fl = nadeFloor(m, g.x, g.y, g.z);
      if (h <= fl) {
        h = fl;
        if (g.fuse === null) g.fuse = CFG.GRENADE_LAND_FUSE;   // starts counting on the first touch-down
        if (Math.abs(g.vz) > 60) { g.vz = -g.vz * 0.28; g.vx *= 0.42; g.vy *= 0.42; SFX.nade && SFX.nade(g.x, g.y); }
        else g.vz = 0;
      }
      g.z = h;
    } else {
      // rolling: settle on whatever floor is below, slow down by friction
      const fl = nadeFloor(m, g.x, g.y, g.z);
      if (g.z > fl + 0.5) g.vz = -1; else g.z = fl;
      const f = Math.exp(-6 * dt); g.vx *= f; g.vy *= f;
      if (g.fuse === null) g.fuse = CFG.GRENADE_LAND_FUSE;
    }
    g.spin += (Math.hypot(g.vx, g.vy) + Math.abs(g.vz)) * dt * 0.12;
    if ((g.fuse !== null && g.fuse <= 0) || g.life > 8) {
      G.grenades.splice(G.grenades.indexOf(g), 1);
      explode(g.x, g.y, CFG.GRENADE_RADIUS, CFG.GRENADE_DMG, g.owner, elevAt(m, g.x, g.y) + g.z + 4);
    }
  }
}

// ---------------- Fog of war: shared team vision on the fine grid
// Rays stop at obstacles taller than eye height and at hill crests (a cell counts as seen when the top
// of a soldier standing there would be visible). Upper floors use their own grid: you see over low cover.
function castVision(vis, grid, m, x, y, eyeZ, targetH, range, a0, a1, rays) {
  const step = 14, hm = m.height, LH = CFG.LEVEL_H;
  for (let r = 0; r < rays; r++) {
    const a = a0 + (a1 - a0) * (r + 0.5) / rays, cx = Math.cos(a), cy = Math.sin(a);
    let maxS = -Infinity;
    for (let d = step; d <= range; d += step) {
      const px = x + cx * d, py = y + cy * d;
      if (px < 0 || py < 0 || px >= W || py >= H) break;
      const idx = ((py / CELL) | 0) * GW + ((px / CELL) | 0), e = hm[idx] * LH;
      if ((e + targetH - eyeZ) / d >= maxS) vis[idx] = 1;
      const gs = (e - eyeZ) / d; if (gs > maxS) maxS = gs;
      if (grid[idx]) break;
    }
  }
}
function computeVision(team) {
  const m = G.m, tm = G.teams[team], vis = tm.vis;
  if (!tm.visHi) tm.visHi = new Uint8Array(GW * GH);
  const visHi = tm.visHi;
  vis.fill(0); visHi.fill(0);
  G.visN = (G.visN || 0) + 1;
  const RAYS = 220, upH = CFG.FLOOR_H + CFG.BODY_H;
  for (const s of G.soldiers) {
    if (!s.alive || s.team !== team) continue;
    const ez = eyeZ(s), up = s.z >= CFG.FLOOR_H / 2, range = visionRange(s);
    castVision(vis, up ? m.shotHi : m.shot, m, s.x, s.y, ez, CFG.BODY_H, range, 0, TAU, RAYS);
    if (s.scoped) castVision(vis, up ? m.shotHi : m.shot, m, s.x, s.y, ez, CFG.BODY_H, s.cls.scopeRange, s.angle - s.cls.scopeCone, s.angle + s.cls.scopeCone, 110);
    // upper floors of houses in range: sight lines at window height
    for (const f of m.houses) {
      if (f.stories < 2) continue;
      const fx = f.x + f.w / 2, fy = f.y + f.h / 2, d = dist(s.x, s.y, fx, fy);
      const reach = s.scoped ? s.cls.scopeRange : range;
      if (d > reach + 200) continue;
      if (d < Math.max(f.w, f.h)) { castVision(visHi, m.shotHi, m, s.x, s.y, ez, upH, Math.min(reach, d + 300), 0, TAU, 90); continue; }
      const ac = Math.atan2(fy - s.y, fx - s.x), half = Math.atan2(Math.max(f.w, f.h) * 0.75, d);
      castVision(visHi, m.shotHi, m, s.x, s.y, ez, upH, Math.min(reach, d + 300), ac - half, ac + half, Math.max(4, Math.ceil(half * 2 / TAU * RAYS * 1.5)));
    }
    // always see the space right around you
    const r = Math.ceil(CFG.VISION_NEAR / CELL), ci = (s.x / CELL) | 0, cj = (s.y / CELL) | 0;
    for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) if (i >= 0 && j >= 0 && i < GW && j < GH && (i - ci) ** 2 + (j - cj) ** 2 <= r * r) { vis[j * GW + i] = 1; if (s.z > 0) visHi[j * GW + i] = 1; }
  }
  // Enemy soldiers: a direct 3D line from some teammate's eyes to their head or chest (the grid above is only
  // for the map fog; it is too coarse for people, who vanished behind cover they were peeking over).
  for (const e of G.soldiers) {
    if (!e.alive || e.team === team) continue;
    if (!e.seenT) e.seenT = [-99, -99];
    if (seesSoldier(team, e)) { e.seenT[team] = G.time; e.spotted[team] = G.time; }
  }
}
function seesSoldier(team, e) {
  const m = G.m, hz = feetZ(e) + bodyH(e) - 4, cz = chestZ(e);
  for (const a of G.soldiers) {
    if (!a.alive || a.team !== team) continue;
    const d = dist(a.x, a.y, e.x, e.y);
    if (d <= CFG.VISION_NEAR) return true;
    const scope = a.scoped && d <= a.cls.scopeRange && Math.abs(angDiff(a.angle, Math.atan2(e.y - a.y, e.x - a.x))) <= a.cls.scopeCone;
    if (d > visionRange(a) && !scope) continue;
    const ez = eyeZ(a);
    if (los3(m, a.x, a.y, ez, e.x, e.y, hz) || los3(m, a.x, a.y, ez, e.x, e.y, cz) || los3(m, a.x, a.y, ez, e.x, e.y, feetZ(e) + 8)) return true;
  }
  return false;
}
function isVisible(team, x, y) {
  if (x < 0 || y < 0 || x >= W || y >= H) return false;
  return G.teams[team].vis[((y / CELL) | 0) * GW + ((x / CELL) | 0)] === 1;
}
// Seen by the team at its last vision update (computeVision runs every 0.15 s).
function soldierVisible(team, s) { return !!s.seenT && G.time - s.seenT[team] <= 0.32; }

// Grenades and C4 knock down house walls and windows inside the blast.
function breakWalls(x, y, r, z) {
  const m = G.m, hit = [];
  if (z === undefined) z = elevAt(m, x, y);
  forBlockersNear(m, x - r, y - r, x + r, y + r, o => {
    if (!o.breakable) return;
    const cx = clamp(x, o.x, o.x + o.w), cy = clamp(y, o.y, o.y + o.h), cz = clamp(z, o.gz + o.z0, o.gz + o.z1);
    if (dist2(cx, cy, x, y) + (cz - z) ** 2 < r * r) hit.push(o);
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
    const d = dist(p.x, p.y, depot.x, depot.y), k = Math.max(0.3, (d - 700) / d);
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
  feedFor(team, riders.length ? `Transport with ${riders.length} soldier${riders.length > 1 ? 's' : ''} and supplies heading to ${tgt.name}` : `Supply cart heading to ${tgt.name}`, TEAMS[team].color);
}
function dropFieldCache(cart) {
  if (cart.dropped) return;
  cart.dropped = true;
  const near = G.caches.find(c => c.team === cart.team && !c.depot && dist(c.x, c.y, cart.x, cart.y) < 200);
  if (near) near.charges = Math.min(near.charges + CFG.FIELD_CACHE, CFG.FIELD_CACHE * 2);
  else { const f = randomFreeNear(G.m, cart.x, cart.y, 50); G.caches.push({ team: cart.team, x: f.x, y: f.y, charges: CFG.FIELD_CACHE }); }
}
function dismount(cart, only) {
  if (!only) dropFieldCache(cart);
  const list = only ? [only] : cart.riders;
  for (const r of list) {
    r.riding = null;
    spawnSoldier(r, { type: 'at', x: cart.x, y: cart.y });
    r.shield = CFG.SPAWN_SHIELD;
  }
  cart.riders = cart.riders.filter(r => !list.includes(r));
  if (!cart.riders.length && cart.dropped) cart.empty = true;
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
  if (n) msgFor(c.team, 'Our transport was destroyed', '#ff5a4e', 3);
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

// ---------------- Air strikes (commander ability)
function strikeRect(st) { return { x: st.x - CFG.STRIKE_W / 2, y: st.y - CFG.STRIKE_H / 2, w: CFG.STRIKE_W, h: CFG.STRIKE_H }; }
function inStrike(st, x, y, pad = 0) { const r = strikeRect(st); return x > r.x - pad && x < r.x + r.w + pad && y > r.y - pad && y < r.y + r.h + pad; }
function canStrike(team) { return G.teams[team].points >= CFG.STRIKE_COST && !G.strikes.some(s => s.team === team); }
function callStrike(team, x, y) {
  if (!canStrike(team)) return false;
  G.teams[team].points -= CFG.STRIKE_COST;
  x = clamp(x, CFG.STRIKE_W / 2, W - CFG.STRIKE_W / 2); y = clamp(y, CFG.STRIKE_H / 2, H - CFG.STRIKE_H / 2);
  G.strikes.push({ team, x, y, t: CFG.STRIKE_DELAY, beep: 0, dir: team === 0 ? 1 : -1 });
  msgFor(team, `Air strike called. Impact in ${CFG.STRIKE_DELAY} s`, TEAMS[team].color, 4);
  msgFor(1 - team, 'ENEMY AIR STRIKE INCOMING! Clear the red zone', '#ff5a4e', 4);
  feed(`${TEAMS[team].name} commander called an air strike`, TEAMS[team].color);
  return true;
}
function updateStrikes(dt) {
  for (const st of G.strikes.slice()) {
    st.t -= dt; st.beep -= dt;
    if (st.beep <= 0 && st.t > 0) { st.beep = st.t < 3 ? 0.35 : 1; SFX.beep(st.x, st.y); }
    if (st.t > 0) continue;
    // a run of bombs along the rectangle
    if (st.drop === undefined) { st.drop = 0; st.dropT = 0; SFX.boom(st.x, st.y); }
    st.dropT -= dt;
    if (st.dropT > 0) continue;
    const n = 5, r = strikeRect(st);
    const bx = r.x + r.w * ((st.dir > 0 ? st.drop : n - 1 - st.drop) + 0.5) / n, by = st.y + rand(-r.h * 0.2, r.h * 0.2);
    bombAt(st, bx, by);
    st.drop++; st.dropT = 0.12;
    if (st.drop >= n) {
      // anything still inside the rectangle takes the full hit
      for (const s of G.soldiers) if (s.alive && inStrike(st, s.x, s.y, CFG.R)) damage(s, CFG.STRIKE_DMG, st.caller || null);
      for (const c of G.carts.slice()) if (inStrike(st, c.x, c.y, CFG.CART_R)) damageCart(c, CFG.STRIKE_DMG * 2, null);
      const rr = strikeRect(st);
      breakWallsRect(rr);
      G.strikes.splice(G.strikes.indexOf(st), 1);
    }
  }
}
function bombAt(st, x, y) {
  stampScorch(G.art, x, y, 45);
  for (let i = 0; i < 18; i++) { const a = Math.random() * TAU, sp = rand(60, 320); G.particles.push({ type: 'fire', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.3, 0.7), max: 0.7, size: rand(6, 14) }); }
  for (let i = 0; i < 10; i++) { const a = Math.random() * TAU; G.particles.push({ type: 'smoke', x: x + rand(-20, 20), y: y + rand(-20, 20), vx: Math.cos(a) * 40, vy: Math.sin(a) * 40, life: rand(2, 4), max: 4, size: rand(20, 40) }); }
  SFX.boom(x, y);
  const pd = dist(x, y, G.cam.x, G.cam.y);
  if (pd < 1400) G.cam.shake = Math.max(G.cam.shake, 14 * (1 - pd / 1400));
}
function breakWallsRect(r) {
  const m = G.m, hit = [];
  forBlockersNear(m, r.x, r.y, r.x + r.w, r.y + r.h, o => {
    if (o.breakable && o.x < r.x + r.w && o.x + o.w > r.x && o.y < r.y + r.h && o.y + o.h > r.y) hit.push(o);
  });
  if (!hit.length) return;
  const gone = new Set(hit);
  m.solids = m.solids.filter(o => !gone.has(o));
  for (const o of hit) stampRubble(G.art, o);
  buildGrids(m);
  for (const s of G.soldiers) if (s.bot) s.bot.path = null;
}
// Red's commander: once it can afford a strike, it targets the biggest group of Blue soldiers it can see.
function botCommanderStrike(team) {
  if (!canStrike(team)) return;
  const tm = G.teams[team];
  tm.strikeT = (tm.strikeT ?? rand(5, 20)) - 1;   // called once per second
  if (tm.strikeT > 0) return;
  let best = null, bn = 0;
  const foes = G.soldiers.filter(s => s.alive && s.team !== team && G.time - s.spotted[team] < 2);
  for (const f of foes) {
    const n = foes.filter(o => Math.abs(o.x - f.x) < CFG.STRIKE_W / 2 && Math.abs(o.y - f.y) < CFG.STRIKE_H / 2).length;
    const friends = G.soldiers.filter(o => o.alive && o.team === team && Math.abs(o.x - f.x) < CFG.STRIKE_W / 2 + 60 && Math.abs(o.y - f.y) < CFG.STRIKE_H / 2 + 60).length;
    if (n - friends * 2 > bn) { bn = n - friends * 2; best = f; }
  }
  // prefers a group of two or more; after waiting a while it settles for a lone target
  tm.strikeWait = (tm.strikeWait || 0) + 1;
  if (best && (bn >= 2 || (bn >= 1 && tm.strikeWait > 6))) { callStrike(team, best.x, best.y); tm.strikeT = undefined; tm.strikeWait = 0; }
  else tm.strikeT = rand(2, 5);
}
