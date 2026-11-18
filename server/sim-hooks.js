'use strict';
// Runs inside the match's sandbox after the game scripts (src/*.js) are loaded.
// It replaces the browser-only pieces (sound, decals, particles, local-player messages) with
// network events, and exposes SIM: the API the room uses to drive one authoritative match.

const NET = { ev: [], nid: 0, gone: [], over: false };
const r1 = v => Math.round(v * 10) / 10;
const r2 = v => Math.round(v * 100) / 100;
// Audience: 'a' everyone, 't0' / 't1' one team, 's<id>' one soldier's client.
function emit(to, e) { NET.ev.push([to, e]); }
function nid(o) { if (!o.nid) o.nid = ++NET.nid; return o.nid; }

// ---------- browser stand-ins
const SFX = {
  listener: { x: 0, y: 0 },
  boom(x, y) { emit('a', ['boom', r1(x), r1(y)]); },
  beep(x, y) { emit('a', ['beep', r1(x), r1(y)]); },
  shot() {}, click() {}, reload() {}, pickup() {}, capture() {}, hit() {}, init() {}, toggle() { return true; },
};
function stampBody(art, s) { emit('a', ['body', r1(s.x), r1(s.y), r2(s.angle), s.team, r2(s.fallA ?? s.angle + Math.PI), r1(s.z || 0), r1(s.para || 0), s.cls.key]); }
function stampScorch(art, x, y, r) { emit('a', ['scorch', r1(x), r1(y), r1(r)]); }
function stampRubble(art, o) { if (o.sid !== undefined) { NET.gone.push(o.sid); emit('a', ['wall', o.sid]); } }
function stampBlood() {}
function stampCasing() {}
function onMatchEnd() { NET.over = true; }

message = function (text, color = '#e3e7df', t = 3.5) { emit('a', ['m', text, color, t]); };
feed = function (text, color) { emit('a', ['f', text, color]); };
msgFor = function (team, text, color = '#e3e7df', t = 3.5) { emit('t' + team, ['m', text, color, t]); };
msgTo = function (s, text, color = '#e3e7df', t = 3.5) { if (s.human) emit('s' + s.id, ['m', text, color, t, 1]); };
feedFor = function (team, text, color) { emit('t' + team, ['f', text, color]); };
killStreak = function (s, n) { if (s.human) emit('s' + s.id, ['ks', n]); };

const _shoot = shoot;
shoot = function (s, moving) {
  const n = G.bullets.length;
  _shoot(s, moving);
  const b = G.bullets[n];
  if (b) emit('a', ['b', r1(b.x), r1(b.y), Math.round(b.vx), Math.round(b.vy), r2(b.life), b.team, b.sniper ? 1 : 0, s.id, r1(b.z), Math.round(b.vz)]);
};
const _damage = damage;
damage = function (target, amount, attacker) {
  const before = target.hp, wasAlive = target.alive;
  _damage(target, amount, attacker);
  if (wasAlive && target.hp < before) emit('a', ['hit', target.id, attacker ? attacker.id : -1, r1(target.x), r1(target.y)]);
};
const _destroyBridge = destroyBridge;
destroyBridge = function (team, attacker) {
  const was = G.m.bridges[team].destroyed;
  _destroyBridge(team, attacker);
  if (!was) emit('a', ['bridge', team]);
};
const _onCapture = onCapture;
onCapture = function (p, t) { _onCapture(p, t); emit('a', ['cap', t]); };

const _spawnSoldier = spawnSoldier;
spawnSoldier = function (s, choice) {
  _spawnSoldier(s, choice);
  if (s.human) { s.human.queue.length = 0; s.human.last = null; s.c4 = Math.max(s.c4, 0); }
};

// Humans are driven by their latest network input instead of the keyboard.
function playerControl(s) {
  const h = s.human;
  let inp = h.queue.shift();
  if (inp) { h.ack = inp.seq; h.last = inp; } else inp = h.last;
  const ctl = inp ? { mx: inp.mx, my: inp.my, fire: inp.fire, sprint: inp.sprint, interact: inp.interact, scope: inp.scope, crouch: inp.crouch, aimX: inp.ax, aimY: inp.ay, pitch: inp.pitch }
    : { mx: 0, my: 0, aimX: s.x + Math.cos(s.angle) * 100, aimY: s.y + Math.sin(s.angle) * 100 };
  if (inp) s.angle = Math.atan2(inp.ay - s.y, inp.ax - s.x);
  if (ctl.scope && s.cls.scopeRange) { ctl.mx = 0; ctl.my = 0; }
  if (h.reload) { ctl.reload = true; h.reload = false; }
  if (h.throwAt) { ctl.throwAt = h.throwAt; h.throwAt = null; }
  return ctl;
}

function benchSoldier(s) { s.off = true; s.alive = false; s.x = s.y = -9999; s.riding = null; if (s.bot) s.bot.role = null; }

// ---------- API used by the room (server/room.js)
const DEFAULT_NAMES = [['Scout', 'Hawk', 'Moss', 'Flint', 'Rook', 'Birch', 'Cobalt', 'Wren', 'Atlas', 'Ember'], CALLSIGNS[1]];

const SIM = {
  start(opts) {
    const m = generateMap(opts.biome, opts.seed);
    const counts = botCommanderCounts();
    startMatch(m, null, counts, counts.findIndex(n => n > 0), { skill: opts.skill, loadout: botLoadout() });
    G.visTeams = [0, 1];
    for (const s of G.soldiers) {
      s.isPlayer = false; s.human = null; s.name = DEFAULT_NAMES[s.team][s.idx];
      if (!s.bot) { s.bot = newBrain(); resetBrain(s); }
      s.c4 = 0;
    }
    G.player = null;
    NET.ev.length = 0;
  },
  // Puts a human in control of a bot soldier on `team`. Returns the soldier id, or -1 if the team is full.
  addHuman(team, name, cls) {
    const free = G.soldiers.filter(s => s.team === team && !s.human);
    if (!free.length) return -1;
    // prefer an empty slot (keeps the bot count), then a soldier who is alive and not a bridge guard
    free.sort((a, b) => ((b.off ? 1 : 0) - (a.off ? 1 : 0)) || (b.alive - a.alive) || ((a.bot && a.bot.guard ? 1 : 0) - (b.bot && b.bot.guard ? 1 : 0)) || a.idx - b.idx);
    const s = free[0];
    if (s.bot && s.bot.guard) { const o = G.soldiers.find(x => x.team === team && x.bot && !x.human && x !== s); if (o) o.bot.guard = true; }
    s.human = { queue: [], last: null, ack: 0, reload: false, throwAt: null };
    s.isPlayer = true; s.bot = null; s.name = name;
    if (s.off) { s.off = false; spawnSoldier(s, { type: 'base', idx: s.spot }); }
    s.c4 = Math.max(s.c4, 1);
    this.setClass(s.id, cls);
    feed(`${name} joined ${TEAMS[team].name}`, TEAMS[team].color);
    return s.id;
  },
  removeHuman(id) {
    const s = this.get(id); if (!s || !s.human) return;
    feed(`${s.name} left`, '#8e9b92');
    s.human = null; s.isPlayer = false; s.name = DEFAULT_NAMES[s.team][s.idx];
    s.bot = newBrain(); resetBrain(s);
    // over the room's bot limit: the slot goes empty instead of becoming a bot
    if (G.soldiers.filter(x => x.team === s.team && !x.human && !x.off).length > (G.botLimit ?? 10)) benchSoldier(s);
  },
  // Keeps at most n bots per team (humans always play). Extra soldiers sit out the whole match.
  setBots(n) {
    G.botLimit = n;
    for (let t = 0; t < 2; t++) {
      const bots = G.soldiers.filter(s => s.team === t && !s.human && !s.off);
      bots.sort((a, b) => ((a.bot && a.bot.guard ? 0 : 1) - (b.bot && b.bot.guard ? 0 : 1)) || a.idx - b.idx);
      bots.slice(n).forEach(benchSoldier);
    }
  },
  setClass(id, cls) {
    const s = this.get(id); if (!s || !CLASSES[cls] || s.cls === CLASSES[cls]) return;
    s.cls = CLASSES[cls];
    if (s.alive) refillAmmo(s);
  },
  get(id) { return G.soldiers.find(s => s.id === id); },
  input(id, a) {
    const s = this.get(id); if (!s || !s.human || !Array.isArray(a)) return;
    const n = v => (typeof v === 'number' && isFinite(v) ? v : 0);
    const f = n(a[4]) | 0;
    const q = s.human.queue;
    q.push({ seq: n(a[1]), mx: clamp(n(a[2]), -1, 1), my: clamp(n(a[3]), -1, 1), fire: !!(f & 1), sprint: !!(f & 2), interact: !!(f & 4), scope: !!(f & 8), crouch: !!(f & 16),
      ax: clamp(n(a[5]), -500, W + 500), ay: clamp(n(a[6]), -500, H + 500), pitch: clamp(n(a[7]) / 1000, -1.4, 1.4) });
    if (q.length > 8) q.splice(0, q.length - 8);
  },
  act(id, a) {
    const s = this.get(id); if (!s || !s.human || !a) return;
    const n = v => (typeof v === 'number' && isFinite(v) ? v : 0);
    if (a.a === 'reload') s.human.reload = true;
    else if (a.a === 'throw') s.human.throwAt = { x: clamp(n(a.x), 0, W), y: clamp(n(a.y), 0, H) };
    else if (a.a === 'dismount' && s.riding) dismount(s.riding, s);
    else if (a.a === 'strike') { if (callStrike(s.team, n(a.x), n(a.y))) { const st = G.strikes[G.strikes.length - 1]; if (st) st.caller = s; } }
  },
  step(dt) {
    update(dt);
    G.particles.length = 0;
    G.art = null;
  },
  isOver() { return NET.over || G.over; },
  // Map changes a late joiner must apply to its freshly generated copy of the map.
  mapState() { return { gone: NET.gone.slice(), bridges: G.m.bridges.map(b => b.destroyed) }; },
  roster() {
    return G.soldiers.map(s => [s.id, s.name, s.cls.key, s.human ? 1 : 0, s.kills, s.deaths, s.points, s.alive ? 1 : 0, s.off ? 1 : 0]);
  },
  teamView(T) {
    const sol = [];
    for (const s of G.soldiers) {
      if (!s.alive) continue;
      if (s.team !== T && !(soldierVisible(T, s) || G.time - s.spotted[T] < 1.6)) continue;
      let f = 0;
      if (s.reloading) f |= 1; if (s.scoped) f |= 2; if (s.shield > 0) f |= 4;
      if (s.c4 > 0 && s.bot && s.bot.role === 'sapper') f |= 8; if (s.act) f |= 16;
      if (s.team !== T && G.time - s.spotted[T] < 1.6) f |= 32;
      if (s.crouch) f |= 64;
      sol.push([s.id, r1(s.x), r1(s.y), r2(s.angle), Math.ceil(s.hp), f, s.reloading ? r2(1 - s.reloadT / s.reloadMax) : 0, s.act ? r2(s.actT / CFG.C4_PLANT) : 0, r1(s.z), r2(s.pitch), r1(s.para || 0)]);
    }
    return {
      time: r2(G.time),
      sol,
      pts: G.m.points.map(p => [p.owner, r1(p.prog), p.c0, p.c1]),
      tm: G.teams.map(t => [t.points, r1(t.supplyT), r1(t.paraT || 0)]),
      lock: [G.lock.team, r2(G.lock.t)],
      trk: G.trucks.map(t => [nid(t), t.team, r1(t.x), r1(t.y), t.dir, t.state]),
      carts: G.carts.map(c => [nid(c), c.team, r1(c.x), r1(c.y), r2(c.angle), Math.ceil(c.hp), c.riders.length, c.target.name]),
      gr: G.grenades.map(g => [nid(g), r1(g.x), r1(g.y), r2(g.fuse), g.team, r2(g.spin), r1(g.z)]),
      c4: G.c4s.map(c => [r1(c.x), r1(c.y), r2(c.fuse), c.bridge, c.team, r2(c.beep)]),
      drops: G.drops.map(d => [nid(d), r1(d.x), r1(d.y), r2(d.fall), d.c4 ? 1 : 0]),
      caches: G.caches.map(c => [c.team, r1(c.x), r1(c.y), c.charges, c.depot ? 1 : 0, c.ammo ? 1 : 0]),
      str: G.strikes.map(s => [s.team, r1(s.x), r1(s.y), r2(s.t), s.dir]),
    };
  },
  me(id) {
    const s = this.get(id); if (!s) return null;
    return { id: s.id, alive: s.alive, hp: Math.ceil(s.hp), mag: s.mag, mags: s.mags.slice(), nades: s.nades, c4: s.c4,
      rl: s.reloading ? 1 : 0, rlT: r2(s.reloadT), rlM: r2(s.reloadMax), act: s.act, actT: r2(s.actT), pts: s.points,
      ride: s.riding ? nid(s.riding) : 0, x: r1(s.x), y: r1(s.y), z: r1(s.z), vx: r1(s.vx), vy: r1(s.vy), cls: s.cls.key,
      ack: s.human ? s.human.ack : 0, sh: r2(Math.max(0, s.shield)), sc: s.scoped ? 1 : 0, team: s.team, pa: r1(s.para || 0), st: s.steady ? 1 : 0, cr: s.crouch ? 1 : 0 };
  },
  takeEvents() { const e = NET.ev; NET.ev = []; return e; },
  result() {
    return { winner: G.winner, reason: G.reason, time: r1(G.time), teams: G.teams.map(t => t.points), captures: G.stats.captures.slice() };
  },
};
