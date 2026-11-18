'use strict';
// Online play: lobby, connection, snapshot interpolation and client-side prediction.
//
// The server (server/) runs the real simulation and sends each client a snapshot 20 times a second.
// The client draws other soldiers about 100 ms in the past, smoothly interpolated between snapshots,
// and moves its own soldier immediately (prediction), correcting it when the server disagrees.

// Default game server. Leave empty to use the address typed in the lobby (remembered per browser).
// When the page itself is served by the game server (https://<server>/), it connects there automatically.
const NET_DEFAULT_SERVER = '';

const NET_INTERP = 0.1;       // seconds of interpolation delay for other entities
const NET_STEP = 1 / 60;      // input rate (matches the server tick)

const NET = {
  ws: null, phase: 'off',     // off | connecting | lobby | play | over
  lobby: null, sid: -1, team: 0,
  snaps: [], latestT: 0, lastRecv: 0, renderT: 0,
  seq: 0, acc: 0, pending: [], pred: null, off: { x: 0, y: 0 },
  carts: new Map(), wasReloading: false, lastAlive: false, wantLeave: false,

  // ---------- lobby UI
  open() {
    show('online');
    const store = k => { try { return localStorage.getItem('bh.' + k) || ''; } catch { return ''; } };
    if (!$('netName').value) $('netName').value = store('name');
    if (!$('netRoom').value) $('netRoom').value = params.get('room') || store('room');
    if (!$('netServer').value) $('netServer').value = params.get('server') || store('server') || NET_DEFAULT_SERVER;
    $('netServer').placeholder = netAutoServer() || 'wss://your-server or its IP address';
    this.showJoin(this.ws ? '' : $('netStatus').textContent);
  },
  showJoin(status, err) {
    $('netJoin').hidden = false; $('netRoomView').hidden = true; $('netTitle').textContent = 'Play with friends';
    $('netStatus').textContent = status || ''; $('netStatus').classList.toggle('err', !!err);
  },
  connect() {
    const name = $('netName').value.trim(), room = $('netRoom').value.trim().toUpperCase();
    const url = netServerUrl($('netServer').value);
    if (!url) return this.showJoin('Type the server address first (ask whoever runs the server).', true);
    try { localStorage.setItem('bh.name', name); localStorage.setItem('bh.room', room); localStorage.setItem('bh.server', $('netServer').value.trim()); } catch { }
    this.close();
    $('netStatus').classList.remove('err');
    $('netStatus').textContent = `Connecting to ${url} …`;
    let ws;
    try { ws = new WebSocket(url); } catch (e) { return this.showJoin(`That server address is not valid: ${url}`, true); }
    this.ws = ws; this.phase = 'connecting'; this.wantLeave = false;
    ws.onopen = () => this.send({ t: 'join', name, room, cls: this.cls || 'rifleman' });
    ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch { return; } this.onMessage(m); };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      const wasPlaying = G && G.online;
      this.ws = null; this.phase = 'off';
      if (wasPlaying) this.endLocal();
      if (!this.wantLeave) { show('online'); this.showJoin(wasPlaying ? 'Lost the connection to the server.' : `Could not reach ${url}. Check the address and that the server is running.`, true); }
    };
  },
  close() { if (this.ws) { const ws = this.ws; this.ws = null; try { ws.close(); } catch { } } this.phase = 'off'; },
  send(o) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); },
  act(o) { this.send(Object.assign({ t: 'act' }, o)); },
  leave() {
    this.wantLeave = true;
    this.send({ t: 'leave' });
    this.close();
    this.endLocal();
    show('menu');
  },
  endLocal() {
    G = null; cv.classList.remove('playing'); $('respawn').hidden = true; $('pause').hidden = true;
  },
  backToLobby() {
    if (this.lobby && this.lobby.host) this.send({ t: 'lobby' });
    this.endLocal();
    show('online'); this.renderLobby();
  },

  renderLobby() {
    const L = this.lobby; if (!L) return;
    if (G && G.online && !G.over) return;   // in a match: the lobby stays hidden
    $('netJoin').hidden = true; $('netRoomView').hidden = false;
    $('netTitle').textContent = `Room ${L.room}`;
    const me = L.players.find(p => p.id === L.you);
    for (let t = 0; t < 2; t++) {
      const ul = $('netTeam' + t); ul.innerHTML = '';
      const list = L.players.filter(p => p.team === t);
      for (const p of list) {
        const li = document.createElement('li'); if (p.id === L.you) li.className = 'me';
        li.textContent = p.name + (p.host ? ' ★' : '');
        const sm = document.createElement('small'); sm.textContent = CLASSES[p.cls] ? CLASSES[p.cls].name : p.cls; li.appendChild(sm);
        ul.appendChild(li);
      }
      const nb = Math.max(0, Math.min(L.settings.bots ?? 10, 10 - list.length));
      const li = document.createElement('li'); li.className = 'bots'; li.textContent = `+ ${nb} bot${nb === 1 ? '' : 's'}`; ul.appendChild(li);
    }
    const sel = $('netCls');
    if (!sel.childElementCount) for (const k in CLASSES) { const o = document.createElement('option'); o.value = k; o.textContent = `${CLASSES[k].name} · ${WEAPON_BLURB[k].split(' · ').slice(1).join(', ')}`; sel.appendChild(o); }
    if (me) { sel.value = me.cls; this.cls = me.cls; }
    const bs = $('netBiome');
    if (!bs.childElementCount) for (const k of BIOME_KEYS) { const o = document.createElement('option'); o.value = k; o.textContent = BIOMES[k].name; bs.appendChild(o); }
    bs.value = L.settings.biome; $('netSkill').value = String(L.settings.skill);
    const bb = $('netBots');
    if (!bb.childElementCount) for (let i = 0; i <= 10; i++) { const o = document.createElement('option'); o.value = String(i); o.textContent = i === 10 ? '10 (fill the team)' : String(i); bb.appendChild(o); }
    bb.value = String(L.settings.bots ?? 10);
    if (document.activeElement !== $('netSeed')) $('netSeed').value = L.settings.seed;
    for (const id of ['netBiome', 'netSeed', 'netSkill', 'netBots']) $(id).disabled = !L.host;
    $('netStart').hidden = !L.host;
    const playing = L.state === 'play';
    $('netStart').textContent = 'Start match';
    $('netRoomInfo').classList.remove('err');
    $('netRoomInfo').textContent = playing ? 'A match is running. Joining it now…'
      : L.state === 'over' ? 'The last match just ended. The room returns to the lobby shortly.'
      : L.host ? `You are the host. Share the room code ${L.room} with your friends, then start when everyone is in.`
      : 'Waiting for the host (★) to start the match.';
  },

  // ---------- messages from the server
  onMessage(m) {
    switch (m.t) {
      case 'lobby': {
        this.lobby = m;
        if (this.phase === 'connecting') this.phase = 'lobby';
        if (m.state === 'lobby' && G && G.online && G.over) { this.endLocal(); show('online'); }
        if (!(G && G.online)) this.renderLobby();
        break;
      }
      case 'start': this.startMatch(m); break;
      case 'roster': if (G && G.online) this.applyRoster(m.roster); break;
      case 's': if (G && G.online) this.onSnapshot(m); break;
      case 'over': if (G && G.online) this.onOver(m); break;
      case 'error': this.showJoin(m.msg, true); break;
    }
  },

  startMatch(m) {
    const map = generateMap(m.biome, m.seed);
    for (const sid of m.map.gone) { const o = map.solids.find(x => x.sid === sid); if (o) map.solids.splice(map.solids.indexOf(o), 1); }
    m.map.bridges.forEach((d, t) => { map.bridges[t].destroyed = d; });
    buildGrids(map);
    const art = buildArt(map);
    this.sid = m.sid; this.team = m.team; this.phase = 'play';
    G = {
      m: map, art, time: 0, state: 'play', paused: false, over: false, winner: -1, online: true, skill: SKILLS[m.skill] || SKILLS[1],
      soldiers: [], bullets: [], particles: [], drops: [], caches: [], c4s: [], trucks: [], feed: [], msg: null,
      teams: [0, 1].map(() => ({ points: 0, supplyT: CFG.SUPPLY_INTERVAL, vis: new Uint8Array(GW * GH) })),
      lock: { team: -1, t: 0 }, holdT: 0, cam: { x: 0, y: 0, shake: 0 }, hurtT: 0, hitT: 0,
      grenades: [], carts: [], strikes: [], targeting: false, specIdx: 0, visT: 0, smokers: [],
      stats: { captures: [0, 0], bridges: [false, false] },
    };
    for (let t = 0; t < 2; t++) for (let i = 0; i < CFG.TEAM_SIZE; i++) {
      const s = makeSoldier(t, i, false);
      s.bot = null; s.x = s.y = -9999;
      G.soldiers.push(s);
    }
    G.player = G.soldiers.find(s => s.id === m.sid) || G.soldiers[0];
    G.player.isPlayer = true;
    if (map.biome === 'urban') {
      const fl = map.floors.slice().sort(() => Math.random() - 0.5).slice(0, 10);
      G.smokers = fl.map(f => ({ x: f.x + f.w / 2, y: f.y + f.h / 2, t: Math.random() }));
    }
    this.applyRoster(m.roster);
    this.snaps = []; this.carts = new Map(); this.pending = []; this.seq = 0; this.acc = 0;
    this.pred = null; this.off = { x: 0, y: 0 }; this.renderT = 0; this.latestT = 0; this.lastAlive = false;
    const sp = map.spawns[m.team][2]; G.cam.x = sp.x; G.cam.y = sp.y;
    show(null); $('over').hidden = true;
    cv.classList.add('playing');
    message(`You are on ${TEAMS[m.team].name}. Hold all five sectors at the same time to win`, TEAMS[m.team].color, 5);
  },

  applyRoster(r) {
    if (!r || !G) return;
    for (const [id, name, cls, human, k, d, pts, alive, off] of r) {
      const s = G.soldiers.find(x => x.id === id); if (!s) continue;
      s.off = !!off;
      s.name = name; s.cls = CLASSES[cls] || s.cls; s.human = !!human; s.kills = k; s.deaths = d; s.points = pts; s.rAlive = !!alive;
    }
  },

  onSnapshot(m) {
    const now = performance.now();
    if (!this.snaps.length || m.time < this.latestT - 1) this.renderT = m.time - NET_INTERP;   // first snapshot (or a new match)
    m.solMap = new Map(m.sol.map(a => [a[0], a]));
    this.snaps.push(m);
    if (this.snaps.length > 40) this.snaps.shift();
    this.latestT = m.time; this.lastRecv = now;
    if (m.roster) this.applyRoster(m.roster);
    for (const e of m.ev) this.onEvent(e);
    this.applyMe(m.me);
  },

  // Own soldier: authoritative state, then replay the inputs the server has not processed yet.
  applyMe(me) {
    if (!me) return;
    const P = G.player;
    P.hp = me.hp; P.mag = me.mag; P.mags = me.mags; P.nades = me.nades; P.c4 = me.c4;
    P.reloading = !!me.rl; P.reloadT = me.rlT; P.reloadMax = me.rlM || 1; P.act = me.act; P.actT = me.actT;
    P.points = me.pts; P.shield = me.sh; P.cls = CLASSES[me.cls] || P.cls;
    if (performance.now() - (this.shotAt || 0) > 400) P.steady = !!me.st;   // a local shot wins until the server catches up
    if (P.reloading && !this.wasReloading) SFX.reload();
    this.wasReloading = P.reloading;
    P.riding = me.ride ? this.cartObj(me.ride) : null;
    if (me.alive && !this.lastAlive) { this.pending = []; this.pred = null; P.nextCls = null; }
    this.lastAlive = me.alive;
    P.alive = me.alive;
    if (!me.alive) { this.pending = []; this.pred = null; if (P.riding) { P.x = P.riding.x; P.y = P.riding.y; } return; }
    const shownX = this.pred ? this.pred.x + this.off.x : me.x, shownY = this.pred ? this.pred.y + this.off.y : me.y;
    const pr = this.pred || (this.pred = { x: me.x, y: me.y, z: 0, vx: 0, vy: 0, walkPhase: 0 });
    pr.x = me.x; pr.y = me.y; pr.z = me.z || 0; pr.vx = me.vx; pr.vy = me.vy; pr.para = me.pa || 0; pr.jz = me.jz || 0; pr.jv = me.jv || 0;
    pr.vault = me.vt ? { x0: me.vt[0], y0: me.vt[1], x1: me.vt[2], y1: me.vt[3], t: me.vt[4], dur: me.vt[5], h: me.vt[6] } : null;
    pr.reloading = P.reloading; pr.cls = P.cls; pr.mods = P.mods;
    this.pending = this.pending.filter(i => i.seq > me.ack);
    for (const i of this.pending) netMove(pr, i, NET_STEP);
    this.off.x = shownX - pr.x; this.off.y = shownY - pr.y;
    if (Math.hypot(this.off.x, this.off.y) > 140) this.off.x = this.off.y = 0;
  },

  cartObj(nid) {
    let c = this.carts.get(nid);
    if (!c) { c = { isCart: true, nid, team: 0, x: -9999, y: -9999, angle: 0, hp: CFG.CART_HP, riders: [], target: { name: '?' }, spotted: [0, 0], alive: true }; this.carts.set(nid, c); }
    return c;
  },

  onEvent(e) {
    const P = G.player, k = e[0];
    if (k === 'b') {
      const [, x, y, vx, vy, life, team, sniper, owner, z, vz] = e;
      G.bullets.push({ x, y, z: z || 0, vx, vy, vz: vz || 0, life, team, sniper: !!sniper, mine: owner === P.id });
      G.particles.push({ type: 'flash', x, y, z: z || undefined, a: Math.atan2(vy, vx), life: sniper ? 0.14 : 0.05, max: sniper ? 0.14 : 0.05, big: !!sniper });
      if (Math.random() < 0.5) { const a = Math.atan2(vy, vx); stampCasing(G.art, x - Math.cos(a) * 26 + Math.cos(a + 1.6) * 16, y - Math.sin(a) * 26 + Math.sin(a + 1.6) * 16); }
      SFX.shot(x, y, owner === P.id);
    } else if (k === 'hit') {
      const [, tid, aid, x, y] = e;
      if (Math.random() < 0.6) stampBlood(G.art, x + rand(-10, 10), y + rand(-10, 10), rand(3, 7));
      for (let i = 0; i < 4; i++) G.particles.push({ type: 'blood', x, y, vx: rand(-80, 80), vy: rand(-80, 80), life: 0.4, max: 0.4, size: rand(1.5, 3) });
      if (tid === P.id) { G.hurtT = 0.45; P.lastHitBy = G.soldiers.find(s => s.id === aid) || null; }
      if (aid === P.id && tid !== P.id) { G.hitT = 0.15; SFX.hit(); }
    } else if (k === 'body') {
      stampBody(G.art, { x: e[1], y: e[2], angle: e[3], team: e[4], fallA: e[5], z: e[6] || 0, para: e[7] || 0, cls: CLASSES[e[8]] || CLASSES.rifleman });
    } else if (k === 'boom') {
      netExplosionFx(e[1], e[2]);
    } else if (k === 'scorch') {
      stampScorch(G.art, e[1], e[2], e[3]);
    } else if (k === 'wall') {
      const m = G.m, o = m.solids.find(x => x.sid === e[1]);
      if (o) {
        m.solids.splice(m.solids.indexOf(o), 1);
        stampRubble(G.art, o);
        for (let i = 0; i < 6; i++) G.particles.push({ type: 'dust', x: o.x + Math.random() * o.w, y: o.y + Math.random() * o.h, vx: rand(-60, 60), vy: rand(-60, 60), life: 1.2, max: 1.2, size: rand(8, 16) });
        G.gridDirty = true;
      }
    } else if (k === 'bridge') {
      G.m.bridges[e[1]].destroyed = true; G.stats.bridges[e[1]] = true; G.gridDirty = true;
    } else if (k === 'beep') SFX.beep(e[1], e[2]);
    else if (k === 'cap') { G.stats.captures[e[1]]++; SFX.capture(e[1] === P.team); }
    else if (k === 'm') { message(e[1], e[2], e[3]); if (e[4]) SFX.pickup(); }
    else if (k === 'f') feed(e[1], e[2]);
    else if (k === 'ks') announceKill(e[1]);
  },

  onOver(m) {
    G.over = true; G.winner = m.winner; G.reason = m.reason; G.time = m.time;
    G.teams.forEach((t, i) => { t.points = m.teams[i]; });
    G.stats.captures = m.captures;
    this.applyRoster(m.roster);
    for (const s of G.soldiers) s.alive = s.rAlive;
    G.paused = false; $('pause').hidden = true; $('perks').hidden = true;
    onMatchEnd();
    $('rematch').textContent = 'Back to the room';
    $('toMenu').textContent = 'Leave room';
    $('overText').textContent += ` The room returns to the lobby in ${m.back} s.`;
  },

  // ---------- per frame
  frame(dt) {
    if (!G) return;
    // inputs at a fixed rate, predicted locally right away
    this.acc += dt;
    let n = 0;
    while (this.acc >= NET_STEP && n < 8) { this.acc -= NET_STEP; this.inputStep(); n++; }
    if (this.acc > NET_STEP * 8) this.acc = 0;
    if (G.over) return;
    // the clock we draw other entities at
    if (this.snaps.length) {
      const est = this.latestT + (performance.now() - this.lastRecv) / 1000 - NET_INTERP;
      this.renderT += dt;
      if (Math.abs(this.renderT - est) > 0.3) this.renderT = est; else this.renderT += (est - this.renderT) * 0.08;
      this.interpolate();
    }
    G.time = Math.max(0, this.renderT);
    if (G.gridDirty) { G.gridDirty = false; buildGrids(G.m); }
    // own soldier: predicted position plus a fading correction
    const P = G.player;
    if (P.alive && this.pred) {
      const k = Math.exp(-dt * 10); this.off.x *= k; this.off.y *= k;
      const nx = this.pred.x + this.off.x, ny = this.pred.y + this.off.y;
      P.walkPhase += Math.hypot(nx - P.x, ny - P.y) * 0.12;
      P.x = nx; P.y = ny; P.z = this.pred.z; P.para = this.pred.para || 0; P.jz = this.pred.jz || 0; P.vault = this.pred.vault; P.vx = this.pred.vx; P.vy = this.pred.vy;
    }
    netUpdateBullets(dt);
    updateParticles(dt);
    for (const d of G.drops) d.t += dt;
    for (const f of G.feed) f.t -= dt;
    G.feed = G.feed.filter(f => f.t > 0);
    if (G.msg) { G.msg.t -= dt; if (G.msg.t <= 0) G.msg = null; }
    G.hurtT = Math.max(0, G.hurtT - dt); G.hitT = Math.max(0, G.hitT - dt);
    G.cam.shake = Math.max(0, G.cam.shake - dt * 30);
    G.visT -= dt;
    if (G.visT <= 0) { G.visT = 0.15; computeVision(P.team); }
  },

  inputStep() {
    const P = G.player;
    if (!P.alive || G.over) { reloadPressed = false; throwPressed = false; return; }
    const ctl = playerControl(P);
    P.aimX = ctl.aimX; P.aimY = ctl.aimY;
    const flags = (ctl.fire ? 1 : 0) | (ctl.sprint ? 2 : 0) | (ctl.interact ? 4 : 0) | (ctl.scope ? 8 : 0) | (ctl.crouch ? 16 : 0) | (ctl.jump ? 32 : 0);
    const inp = { seq: ++this.seq, mx: ctl.mx, my: ctl.my, fire: !!ctl.fire, sprint: !!ctl.sprint, ads: !!(ctl.scope && !P.cls.scopeRange), crouch: !!ctl.crouch, jump: !!ctl.jump, angle: P.angle };
    if (ctl.fire && P.mag > 0 && !P.reloading) { P.steady = false; this.shotAt = performance.now(); }
    this.send({ t: 'i', d: [0, inp.seq, ctl.mx, ctl.my, flags, Math.round(ctl.aimX), Math.round(ctl.aimY), Math.round(ctl.pitch * 1000)] });
    if (ctl.reload) this.act({ a: 'reload' });
    if (ctl.throwAt) this.act({ a: 'throw', x: Math.round(ctl.throwAt.x), y: Math.round(ctl.throwAt.y) });
    if (this.pred) { netMove(this.pred, inp, NET_STEP); this.pending.push(inp); if (this.pending.length > 120) this.pending.shift(); }
    const moving = Math.hypot(ctl.mx, ctl.my) > 0.1;
    P.scoped = !!(ctl.scope && P.cls.scopeRange && !moving && !P.reloading);
    P.ads = !!(ctl.scope && !P.cls.scopeRange && !P.reloading);
    P.crouch = !!(ctl.crouch && !(P.para > 0));
  },

  // Positions of everything except your own soldier, interpolated between the two snapshots around renderT.
  interpolate() {
    const S = this.snaps, T = this.renderT;
    let b = S.length - 1;
    while (b > 0 && S[b - 1].time >= T) b--;
    const B = S[b], A = b > 0 ? S[b - 1] : B;
    const f = B.time > A.time ? clamp((T - A.time) / (B.time - A.time), 0, 1) : 1;
    const P = G.player, myT = P.team;
    const L = (a, b2) => a + (b2 - a) * f, LA = (a, b2) => a + angDiff(a, b2) * f;
    for (const s of G.soldiers) {
      if (s === P) continue;
      const nb = B.solMap.get(s.id);
      if (!nb) {
        s.alive = false; s.x = s.y = -9999;   // every living soldier is in each snapshot
        continue;
      }
      const na = A.solMap.get(s.id) || nb;
      const x = L(na[1], nb[1]), y = L(na[2], nb[2]);
      if (s.alive && s.x > -9000) s.walkPhase += Math.hypot(x - s.x, y - s.y) * 0.12;
      s.alive = true; s.x = x; s.y = y; s.z = L(na[8] || 0, nb[8] || 0); s.pitch = nb[9] || 0; s.para = L(na[10] || 0, nb[10] || 0); s.jz = L(na[11] || 0, nb[11] || 0); s.angle = LA(na[3], nb[3]);
      s.hp = nb[4];
      const fl = nb[5];
      s.reloading = !!(fl & 1); s.scoped = !!(fl & 2); s.crouch = !!(fl & 64); s.shield = fl & 4 ? 1 : 0;
      s.c4 = fl & 8 ? 1 : 0; s.bot = fl & 8 ? { role: 'sapper' } : null;
      s.act = fl & 16 ? 'plant' : null; s.actT = nb[7] * CFG.C4_PLANT;
      s.reloadMax = 1; s.reloadT = 1 - nb[6];
      if (s.team !== myT && (fl & 32)) s.spotted[myT] = G.time;
    }
    // points, team counters, objectives (latest values)
    B.pts.forEach((p, i) => { const mp = G.m.points[i]; mp.owner = p[0]; mp.prog = p[1]; mp.c0 = p[2]; mp.c1 = p[3]; });
    B.tm.forEach((t, i) => { G.teams[i].points = t[0]; G.teams[i].supplyT = t[1]; G.teams[i].paraT = t[2] || 0; });
    G.lock = { team: B.lock[0], t: B.lock[1] };
    const byId = (arr, i) => new Map(arr.map(a => [a[i], a]));
    const ta = byId(A.trk, 0);
    G.trucks = B.trk.map(t => { const a = ta.get(t[0]) || t; return { team: t[1], x: L(a[2], t[2]), y: L(a[3], t[3]), dir: t[4], state: t[5] }; });
    const ca = byId(A.carts, 0), live = new Set();
    G.carts = B.carts.map(c => {
      const a = ca.get(c[0]) || c, o = this.cartObj(c[0]);
      live.add(c[0]);
      o.team = c[1]; o.x = L(a[2], c[2]); o.y = L(a[3], c[3]); o.angle = LA(a[4], c[4]); o.hp = c[5];
      o.riders.length = c[6]; o.riders.fill(0); o.target.name = c[7];
      return o;
    });
    for (const k of this.carts.keys()) if (!live.has(k) && !(P.riding && P.riding.nid === k)) this.carts.delete(k);
    const ga = byId(A.gr, 0);
    G.grenades = B.gr.map(g => { const a = ga.get(g[0]) || g; return { nid: g[0], x: L(a[1], g[1]), y: L(a[2], g[2]), fuse: g[3], team: g[4], spin: g[5], z: g[6] || 0 }; });
    G.c4s = B.c4.map(c => ({ x: c[0], y: c[1], fuse: c[2], bridge: c[3], team: c[4], beep: c[5] }));
    const oldDrops = new Map(G.drops.map(d => [d.nid, d]));
    G.drops = B.drops.map(d => { const o = oldDrops.get(d[0]); return { nid: d[0], x: d[1], y: d[2], fall: d[3], c4: !!d[4], t: o ? o.t : Math.random() * 10 }; });
    G.caches = B.caches.map(c => ({ team: c[0], x: c[1], y: c[2], charges: c[3], depot: !!c[4], ammo: !!c[5] }));
    G.strikes = B.str.map(s => ({ team: s[0], x: s[1], y: s[2], t: s[3], dir: s[4] }));
  },
};

// Same movement rules as updateSoldier() in game.js, for prediction.
function netMove(s, inp, dt) {
  let mvx = inp.mx || 0, mvy = inp.my || 0;
  const falling = s.para > 0;
  if (inp.crouch && !falling) { mvx = 0; mvy = 0; }
  const ml = Math.hypot(mvx, mvy);
  if (ml > 1) { mvx /= ml; mvy /= ml; }
  const moving = ml > 0.1;
  const sprint = inp.sprint && moving && !inp.fire && !s.reloading && !inp.ads && !falling;
  let speed = (sprint ? CFG.SPRINT : CFG.WALK) * s.mods.speed * s.cls.speed;
  if (G.m.slow[((s.y / CELL) | 0) * GW + ((s.x / CELL) | 0)]) speed *= 0.5;
  if (s.reloading) speed *= 0.85;
  if (inp.fire) speed *= 0.8;
  if (inp.ads && !s.reloading) speed *= CFG.ADS_SPEED;
  if (falling) speed = CFG.WALK * 0.6;
  s.crouch = !!(inp.crouch && !falling);
  if (inp.jump && !s.vault) tryJump(G.m, s, moving ? Math.atan2(mvy, mvx) : inp.angle);
  if (s.vault) { vaultStep(G.m, s, dt); return; }
  const k = 1 - Math.exp(-dt * 14);
  s.vx = lerp(s.vx, mvx * speed, k); s.vy = lerp(s.vy, mvy * speed, k);
  const ox = s.x, oy = s.y;
  s.x += s.vx * dt; s.y += s.vy * dt;
  collideCircle(G.m, s, CFG.R, (s.z || 0) + (s.jz || 0));
  airStep(s, dt);
  if (falling) { s.para = Math.max(0, s.para - CFG.PARA_FALL * dt); s.z = 0; }
  else updateFloor(G.m, s, ox, oy);
}

// Tracers are cosmetic on the client: they stop at walls and soldiers, the server decides the hits.
function netUpdateBullets(dt) {
  const m = G.m, out = [];
  for (const b of G.bullets) {
    const nx = b.x + b.vx * dt, ny = b.y + b.vy * dt, nz = b.z + b.vz * dt;
    let bestT = 2;
    for (const s of G.soldiers) {
      if (!s.alive || s.team === b.team || s.x < -9000) continue;
      const t = segCircleHit(b.x, b.y, nx, ny, s.x, s.y, CFG.R);
      if (t < 0 || t >= bestT) continue;
      const bz = b.z + (nz - b.z) * t, fz = feetZ(s);
      if (bz >= fz - 2 && bz <= fz + bodyH(s) + 2) bestT = t;
    }
    let hit = bestT <= 1, pz = b.z;
    const steps = Math.ceil(Math.hypot(nx - b.x, ny - b.y) / 8);
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      if (t > bestT) break;
      const x = b.x + (nx - b.x) * t, y = b.y + (ny - b.y) * t, z = b.z + (nz - b.z) * t;
      if (x < 0 || y < 0 || x > W || y > H) { hit = true; break; }
      if (blockedAt(m, x, y, z) || slabBetween(m, x, y, pz, z)) {
        hit = true;
        for (let i = 0; i < 3; i++) G.particles.push({ type: 'spark', x, y, z, vx: -b.vx * 0.08 + rand(-90, 90), vy: -b.vy * 0.08 + rand(-90, 90), life: 0.2, max: 0.2, size: 2 });
        G.particles.push({ type: 'dust', x, y, z, vx: rand(-20, 20), vy: rand(-20, 20), life: 0.5, max: 0.5, size: rand(5, 9) });
        break;
      }
      pz = z;
    }
    if (hit) continue;
    b.x = nx; b.y = ny; b.z = nz; b.life -= dt;
    if (b.life > 0) out.push(b);
  }
  G.bullets = out;
}

function netExplosionFx(x, y) {
  SFX.boom(x, y);
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

// When the page is served by the game server itself, play on that server.
function netAutoServer() {
  if (NET_DEFAULT_SERVER) return NET_DEFAULT_SERVER;
  if (location.protocol === 'https:' && !location.hostname.endsWith('github.io') && !location.hostname.endsWith('claude.ai')) return `wss://${location.host}/ws`;
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') return 'ws://localhost:8080';
  return '';
}
// Accepts "wss://host", "host", "host/ws" or a bare IP (turned into its free <ip>.sslip.io HTTPS name).
function netServerUrl(input) {
  let s = String(input || '').trim();
  if (!s) return netAutoServer();
  const secure = location.protocol === 'https:';
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) s = secure ? `wss://${s.replace(/\./g, '-')}.sslip.io` : `ws://${s}:8080`;
  s = s.replace(/^https:\/\//, 'wss://').replace(/^http:\/\//, 'ws://');
  if (!/^wss?:\/\//.test(s)) s = (secure ? 'wss://' : (/^(localhost|127\.)/.test(s) ? 'ws://' : 'wss://')) + s;
  if (!/^wss?:\/\/[^/]+\/./.test(s)) s = s.replace(/\/$/, '') + (/^ws:\/\/(localhost|127\.|\d)/.test(s) ? '' : '/ws');
  return s;
}

// ---------- lobby wiring
$('netConnect').onclick = () => NET.connect();
$('netBack').onclick = () => { NET.close(); show('menu'); };
$('netLeave').onclick = () => { NET.wantLeave = true; NET.send({ t: 'leave' }); NET.close(); NET.lobby = null; NET.showJoin('You left the room.'); };
$('netSwitch').onclick = () => { const me = NET.lobby && NET.lobby.players.find(p => p.id === NET.lobby.you); if (me) NET.send({ t: 'team', team: 1 - me.team }); };
$('netCls').onchange = () => { NET.cls = $('netCls').value; NET.send({ t: 'cls', cls: NET.cls }); };
$('netBiome').onchange = () => NET.send({ t: 'settings', biome: $('netBiome').value });
$('netSeed').onchange = () => NET.send({ t: 'settings', seed: Number($('netSeed').value) || 0 });
$('netSkill').onchange = () => NET.send({ t: 'settings', skill: Number($('netSkill').value) });
$('netBots').onchange = () => NET.send({ t: 'settings', bots: Number($('netBots').value) });
$('netStart').onclick = () => { $('netStart').textContent = 'Starting…'; NET.send({ t: 'start' }); };
for (const id of ['netName', 'netRoom', 'netServer']) $(id).addEventListener('keydown', e => { if (e.key === 'Enter') NET.connect(); });
