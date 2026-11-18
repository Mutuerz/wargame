'use strict';
// A room: a lobby of players that plays one match at a time. Bots fill every empty slot.
const { createSim } = require('./sim');

const TICK = 1 / 60;           // simulation step (same as the offline game)
const SEND_EVERY = 3;          // snapshots at 20 Hz
const ROSTER_EVERY = 30;       // scoreboard twice a second
const LOBBY_AFTER = 40;        // seconds on the result screen before the room returns to the lobby
const BIOMES = ['forest', 'desert', 'urban', 'snow', 'swamp'];
const CLASSES = ['rifleman', 'sniper', 'smg', 'lmg', 'shotgun'];
const MAX_PLAYERS = 20;

class Room {
  constructor(code, onEmpty) {
    this.code = code;
    this.onEmpty = onEmpty;
    this.clients = new Set();
    this.host = null;
    this.state = 'lobby';
    this.settings = { biome: 'forest', seed: Math.floor(Math.random() * 1e6), skill: 1, bots: 10 };   // bots: per team, humans come on top (10 max per team)
    this.sim = null;
    this.timer = null;
    this.tickN = 0;
  }

  // ---------- membership
  join(c, want) {
    if (this.clients.size >= MAX_PLAYERS) return c.send({ t: 'error', msg: 'This room is full (20 players).' });
    c.room = this;
    c.team = this.pickTeam(want.team);
    c.cls = CLASSES.includes(want.cls) ? want.cls : 'rifleman';
    c.sid = -1;
    this.clients.add(c);
    if (!this.host) this.host = c;
    if (this.state === 'play') this.enterMatch(c);
    else c.send({ t: 'lobby', ...this.lobbyState(c) });
    this.broadcastLobby();
  }
  leave(c) {
    if (!this.clients.has(c)) return;
    this.clients.delete(c);
    if (this.sim && c.sid >= 0) this.sim.removeHuman(c.sid);
    c.sid = -1; c.room = null;
    if (this.host === c) this.host = this.clients.values().next().value || null;
    if (!this.clients.size) { this.stop(); this.onEmpty(this); return; }
    this.broadcastLobby();
  }
  teamCount(t) { let n = 0; for (const c of this.clients) if (c.team === t) n++; return n; }
  pickTeam(want) {
    const a = this.teamCount(0), b = this.teamCount(1);
    if ((want === 0 || want === 1) && this.teamCount(want) < 10) return want;
    return a <= b ? 0 : 1;
  }

  // ---------- lobby
  lobbyState(c) {
    return {
      room: this.code, state: this.state, host: this.host === c, you: c.id,
      settings: this.settings,
      players: [...this.clients].map(p => ({ id: p.id, name: p.name, team: p.team, cls: p.cls, host: p === this.host })),
    };
  }
  broadcastLobby() { for (const c of this.clients) c.send({ t: 'lobby', ...this.lobbyState(c) }); }

  handle(c, msg) {
    switch (msg.t) {
      case 'i': if (this.sim && c.sid >= 0) this.sim.input(c.sid, msg.d); break;
      case 'act': if (this.sim && c.sid >= 0) this.sim.act(c.sid, msg); break;
      case 'team': {
        const t = msg.team === 1 ? 1 : 0;
        if (t === c.team || this.teamCount(t) >= 10) break;
        c.team = t;
        if (this.sim && c.sid >= 0) { this.sim.removeHuman(c.sid); this.enterMatch(c); }
        this.broadcastLobby();
        break;
      }
      case 'cls':
        if (!CLASSES.includes(msg.cls)) break;
        c.cls = msg.cls;
        if (this.sim && c.sid >= 0) this.sim.setClass(c.sid, c.cls);
        this.broadcastLobby();
        break;
      case 'settings':
        if (c !== this.host || this.state === 'play') break;
        if (BIOMES.includes(msg.biome)) this.settings.biome = msg.biome;
        if (Number.isFinite(msg.seed)) this.settings.seed = Math.abs(Math.floor(msg.seed)) % 1e8;
        if ([0, 1, 2].includes(msg.skill)) this.settings.skill = msg.skill;
        if (Number.isInteger(msg.bots) && msg.bots >= 0 && msg.bots <= 10) this.settings.bots = msg.bots;
        this.broadcastLobby();
        break;
      case 'start':
        if (c !== this.host || this.state === 'play') break;
        this.start();
        break;
      case 'lobby':
        // a player on the result screen asks to go back to the lobby early (host only resets for everyone)
        if (this.state === 'over' && c === this.host) this.toLobby();
        break;
    }
  }

  // ---------- match
  start() {
    this.stop();
    this.sim = createSim();
    this.sim.start(this.settings);
    this.state = 'play';
    this.tickN = 0;
    for (const c of this.clients) { c.sid = -1; this.enterMatch(c); }
    this.sim.setBots(this.settings.bots);
    for (const c of this.clients) c.send({ t: 'roster', roster: this.sim.roster() });
    this.broadcastLobby();
    this.last = process.hrtime.bigint();
    this.acc = 0;
    this.timer = setInterval(() => this.loop(), 1000 / 120);
  }
  enterMatch(c) {
    let sid = this.sim.addHuman(c.team, c.name, c.cls);
    if (sid < 0) { c.team = 1 - c.team; sid = this.sim.addHuman(c.team, c.name, c.cls); }
    c.sid = sid;
    c.send({ t: 'start', biome: this.settings.biome, seed: this.settings.seed, skill: this.settings.skill, sid, team: c.team, map: this.sim.mapState(), roster: this.sim.roster() });
  }
  loop() {
    const now = process.hrtime.bigint();
    this.acc += Math.min(0.25, Number(now - this.last) / 1e9);
    this.last = now;
    while (this.acc >= TICK && this.state === 'play') {
      this.acc -= TICK;
      try { this.sim.step(TICK); } catch (e) { console.error(`[room ${this.code}] simulation error`, e); }
      this.tickN++;
      if (this.tickN % SEND_EVERY === 0 || this.sim.isOver()) this.send();
      if (this.sim.isOver()) { this.finish(); break; }
    }
  }
  send() {
    const ev = this.sim.takeEvents();
    const views = [this.sim.teamView(0), this.sim.teamView(1)];
    const roster = this.tickN % ROSTER_EVERY === 0 ? this.sim.roster() : undefined;
    for (const c of this.clients) {
      if (c.sid < 0) continue;
      const mine = ev.filter(([to]) => to === 'a' || to === 't' + c.team || to === 's' + c.sid).map(x => x[1]);
      c.sendRaw(JSON.stringify({ t: 's', ...views[c.team], me: this.sim.me(c.sid), ev: mine, roster }));
    }
  }
  finish() {
    clearInterval(this.timer); this.timer = null;
    this.state = 'over';
    const res = this.sim.result();
    const roster = this.sim.roster();
    for (const c of this.clients) c.send({ t: 'over', ...res, roster, back: LOBBY_AFTER });
    this.overTimer = setTimeout(() => this.toLobby(), LOBBY_AFTER * 1000);
  }
  toLobby() {
    clearTimeout(this.overTimer);
    this.sim = null;
    this.state = 'lobby';
    for (const c of this.clients) c.sid = -1;
    this.settings.seed = Math.floor(Math.random() * 1e6);
    this.broadcastLobby();
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    clearTimeout(this.overTimer);
    this.timer = null;
  }
}

module.exports = { Room };
