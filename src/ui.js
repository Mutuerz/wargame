'use strict';
// Input, menus, commander deployment, respawn, perks panel and the main loop.

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const keys = new Set();
const mouse = { x: 0, y: 0, down: false, right: false };
let throwPressed = false;
let reloadPressed = false;
let SPEED = Math.max(1, Math.min(16, Number(params.get('speed')) || 1));

const menu = {
  biome: params.get('biome') && BIOMES[params.get('biome')] ? params.get('biome') : 'forest',
  seed: Number(params.get('seed')) || Math.floor(Math.random() * 1e6),
  skill: 1, map: null, art: null,
  counts: [2, 2, 2, 2, 2], playerSpot: 2, loadout: DEFAULT_LOADOUT.slice(),
};

// ---------- input
function isTyping() { const a = document.activeElement; return a && a.tagName === 'INPUT'; }
window.addEventListener('keydown', e => {
  if (isTyping()) return;
  if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
  keys.add(e.code);
  if (!G || G.over || G.state !== 'play') return;
  if (e.code === 'Escape' && G.targeting) G.targeting = false;
  else if (e.code === 'Escape') togglePause();
  else if (e.code === 'KeyB') {
    if (canStrike(G.player.team)) { G.targeting = !G.targeting; if (G.targeting) message('Click to mark the air strike target. Right click or Esc cancels', '#e6ad45', 3); }
    else message(G.strikes.some(s => s.team === G.player.team) ? 'An air strike is already on its way' : `Air strike needs ${CFG.STRIKE_COST} team points (you have ${G.teams[G.player.team].points})`, '#8e9b92', 2);
  }
  else if (e.code === 'KeyR') reloadPressed = true;
  else if (e.code === 'KeyG') throwPressed = true;
  else if (e.code === 'KeyE' && G.player.riding) dismount(G.player.riding, G.player);
  else if (!G.player.alive && (e.code === 'Space' || e.code === 'ArrowRight')) G.specIdx++;
  else if (!G.player.alive && e.code === 'ArrowLeft') G.specIdx--;
  else if (e.code === 'KeyM') G.showMap = !G.showMap;
  else if (e.code === 'KeyP') togglePerks();
  else if (e.code === 'KeyN') { const on = SFX.toggle(); message(on ? 'Sound on' : 'Sound muted', '#8e9b92', 1.5); }
  else if (e.code === 'Tab') G.showScores = true;
});
window.addEventListener('keyup', e => { keys.delete(e.code); if (e.code === 'Tab' && G) G.showScores = false; });
window.addEventListener('blur', () => { keys.clear(); mouse.down = false; mouse.right = false; });
cv.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });
cv.addEventListener('mousedown', e => {
  if (G && G.targeting && !G.over) {
    if (e.button === 0) { const w = G.showMap ? mapToWorld(mouse.x, mouse.y) : screenToWorld(e.clientX, e.clientY); if (w) callStrike(G.player.team, w.x, w.y); }
    G.targeting = false; return;
  }
  if (G && !G.player.alive && !G.player.riding && !G.over) { G.specIdx += e.button === 2 ? -1 : 1; return; }
  if (e.button === 0) mouse.down = true; if (e.button === 2) mouse.right = true; SFX.init(); });
window.addEventListener('mouseup', e => { if (e.button === 0) mouse.down = false; if (e.button === 2) mouse.right = false; });
cv.addEventListener('contextmenu', e => e.preventDefault());

function playerControl(s) {
  let mx = 0, my = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) my -= 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) my += 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) mx -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) mx += 1;
  const w = screenToWorld(mouse.x, mouse.y);
  s.angle = Math.atan2(w.y - s.y, w.x - s.x);
  const scope = (mouse.right || keys.has('KeyQ')) && !!s.cls.scopeRange;
  if (scope) { mx = 0; my = 0; }   // scoping means holding position
  const ctl = { mx, my, fire: mouse.down && !G.paused, sprint: keys.has('ShiftLeft') || keys.has('ShiftRight'), reload: reloadPressed, interact: keys.has('KeyF'),
    scope, aimX: w.x, aimY: w.y, throwAt: throwPressed ? { x: w.x, y: w.y } : null };
  reloadPressed = false; throwPressed = false;
  return ctl;
}

// ---------- main menu
function show(id) { for (const s of ['menu', 'deploy', 'pause', 'over', 'perks']) $(s).hidden = s !== id; }

function buildMenu() {
  const wrap = $('biomes'); wrap.innerHTML = '';
  for (const k of BIOME_KEYS) {
    const b = document.createElement('button');
    b.id = 'biome-' + k;
    b.innerHTML = `<span>${BIOMES[k].name}</span><small>${BIOMES[k].blurb}</small>`;
    b.onclick = () => { menu.biome = k; regenMenuMap(); };
    wrap.appendChild(b);
  }
  $('seed').value = menu.seed;
  $('seed').onchange = () => { menu.seed = Math.abs(Math.floor(Number($('seed').value) || 0)); regenMenuMap(); };
  $('reroll').onclick = () => { menu.seed = Math.floor(Math.random() * 1e6); $('seed').value = menu.seed; regenMenuMap(); };
  document.querySelectorAll('#skill button').forEach(b => b.onclick = () => {
    menu.skill = Number(b.dataset.skill);
    document.querySelectorAll('#skill button').forEach(x => x.classList.toggle('on', x === b));
  });
  $('toDeploy').onclick = () => { SFX.init(); openDeploy(); };
}

function regenMenuMap() {
  for (const k of BIOME_KEYS) $('biome-' + k).classList.toggle('on', k === menu.biome);
  $('biomeDesc').textContent = BIOMES[menu.biome].desc;
  menu.map = generateMap(menu.biome, menu.seed);
  menu.art = buildArt(menu.map);
  drawPreview($('preview'), menu.map, menu.art, false);
}

function drawPreview(canvas, m, art, deploy) {
  const c = canvas.getContext('2d'), w = canvas.width, h = canvas.height, s = w / W;
  c.drawImage(art.thumb, 0, 0, w, h);
  c.textAlign = 'center'; c.textBaseline = 'middle';
  for (const b of m.bridges) { c.fillStyle = '#c9a36b'; c.fillRect(b.x * s - 2, b.y * s, b.w * s + 4, b.h * s); }
  for (let t = 0; t < 2; t++) {
    const d = m.depots[t];
    c.strokeStyle = '#e6ad45'; c.lineWidth = 2; c.strokeRect(d.x * s - 12, d.y * s - 9, 24, 18);
  }
  for (const p of m.points) {
    c.strokeStyle = '#e6ad45'; c.lineWidth = 2.5; c.beginPath(); c.arc(p.x * s, p.y * s, CFG.CAP_R * s, 0, TAU); c.stroke();
    c.fillStyle = '#e6ad45'; c.font = '700 22px "Chakra Petch", sans-serif'; c.fillText(p.name, p.x * s, p.y * s);
  }
  // drop zone band
  c.strokeStyle = 'rgba(127,209,139,0.5)'; c.setLineDash([6, 6]); c.lineWidth = 1.5;
  const dz0 = (CFG.BASE_W + CFG.DROP_MIN_BASE_DIST) * s, dz1 = (W - CFG.BASE_W - CFG.DROP_MIN_BASE_DIST) * s;
  c.strokeRect(dz0, 8, dz1 - dz0, h - 16); c.setLineDash([]);
  c.fillStyle = 'rgba(127,209,139,0.8)'; c.font = '500 11px "IBM Plex Mono", monospace'; c.fillText('supply drop zone', (dz0 + dz1) / 2, 20);
  for (let t = 0; t < 2; t++) {
    m.spawns[t].forEach((sp, i) => {
      const x = sp.x * s, y = sp.y * s;
      if (deploy && t === 0) {
        const n = menu.counts[i], me = menu.playerSpot === i;
        c.fillStyle = 'rgba(10,20,35,0.85)'; c.beginPath(); c.arc(x, y, 19, 0, TAU); c.fill();
        c.strokeStyle = me ? '#ffffff' : TEAMS[0].color; c.lineWidth = me ? 3 : 2; c.stroke();
        c.fillStyle = '#fff'; c.font = '700 17px "Chakra Petch", sans-serif'; c.fillText(String(n), x, y + 1);
        c.textAlign = 'left'; c.fillStyle = '#b4d8ff'; c.font = '500 12px "IBM Plex Mono", monospace';
        c.fillText(sp.name + (me ? ' (you)' : ''), x + 26, y); c.textAlign = 'center';
      } else {
        c.fillStyle = TEAMS[t].color; c.beginPath(); c.arc(x, y, deploy ? 6 : 5, 0, TAU); c.fill();
      }
    });
  }
  if (deploy) {
    c.fillStyle = 'rgba(255,90,78,0.85)'; c.font = '500 12px "IBM Plex Mono", monospace';
    c.textAlign = 'right'; c.fillText('Red deploys automatically', w - 30, 20); c.textAlign = 'center';
  }
}

// ---------- commander deployment
function openDeploy() {
  show('deploy');
  renderDeploy();
}
function unassigned() { return CFG.TEAM_SIZE - menu.counts.reduce((a, b) => a + b, 0); }
function renderDeploy() {
  const list = $('spotList'); list.innerHTML = '';
  menu.map.spawns[0].forEach((sp, i) => {
    const row = document.createElement('div');
    row.className = 'spot' + (menu.playerSpot === i ? ' me' : '');
    row.innerHTML = `<div class="name">${sp.name}<small>spawn ${i + 1}</small></div>
      <button class="minus" aria-label="Remove a soldier from ${sp.name}">−</button>
      <span class="count">${menu.counts[i]}</span>
      <button class="plus" aria-label="Add a soldier to ${sp.name}">+</button>`;
    const you = document.createElement('button');
    you.className = 'youbtn'; you.textContent = menu.playerSpot === i ? 'You' : 'Spawn here';
    you.onclick = () => setPlayerSpot(i);
    row.appendChild(you);
    row.style.gridTemplateColumns = '1fr auto auto auto auto';
    row.querySelector('.minus').onclick = () => changeSpot(i, -1);
    row.querySelector('.plus').onclick = () => changeSpot(i, 1);
    list.appendChild(row);
  });
  const u = unassigned();
  $('unassigned').textContent = u > 0 ? `${u} soldier${u > 1 ? 's' : ''} waiting for orders` : 'All 10 soldiers assigned';
  renderLoadout();
  $('deployBtn').disabled = u > 0;
  $('deployBtn').textContent = u > 0 ? `Deploy (${u} unassigned)` : 'Deploy';
  drawPreview($('deployMap'), menu.map, menu.art, true);
}
function changeSpot(i, d) {
  if (d > 0 && unassigned() <= 0) return;
  if (d < 0 && menu.counts[i] <= (menu.playerSpot === i ? 1 : 0)) return;
  menu.counts[i] += d; renderDeploy();
}
function setPlayerSpot(i) {
  if (menu.counts[i] === 0) {
    if (unassigned() > 0) menu.counts[i] = 1;
    else {
      let j = menu.counts.indexOf(Math.max(...menu.counts));
      menu.counts[j]--; menu.counts[i] = 1;
    }
  }
  menu.playerSpot = i; renderDeploy();
}
$('deployMap').addEventListener('mousedown', e => {
  const r = e.target.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width * W, y = (e.clientY - r.top) / r.height * H;
  let best = -1, bd = 220 * 220;
  menu.map.spawns[0].forEach((sp, i) => { const d = dist2(sp.x, sp.y, x, y); if (d < bd) { bd = d; best = i; } });
  if (best < 0) return;
  if (e.shiftKey) setPlayerSpot(best);
  else changeSpot(best, e.button === 2 ? -1 : 1);
});
$('deployMap').addEventListener('contextmenu', e => e.preventDefault());
function renderLoadout() {
  const wrap = $('loadout');
  if (wrap.childElementCount !== CFG.TEAM_SIZE) {
    wrap.innerHTML = '';
    for (let i = 0; i < CFG.TEAM_SIZE; i++) {
      const lab = document.createElement('label');
      lab.className = i === 0 ? 'me' : '';
      const sel = document.createElement('select'); sel.id = 'weapon-' + i;
      for (const k in CLASSES) { const o = document.createElement('option'); o.value = k; o.textContent = CLASSES[k].name; sel.appendChild(o); }
      sel.onchange = () => { menu.loadout[i] = sel.value; renderLoadout(); };
      lab.append(document.createTextNode(i === 0 ? 'You' : CALLSIGNS[0][i]), sel, document.createElement('small'));
      wrap.appendChild(lab);
    }
  }
  [...wrap.children].forEach((lab, i) => { lab.querySelector('select').value = menu.loadout[i]; lab.querySelector('small').textContent = WEAPON_BLURB[menu.loadout[i]]; });
}
$('loadoutDefault').onclick = () => { menu.loadout = DEFAULT_LOADOUT.slice(); renderLoadout(); };
$('spread').onclick = () => { menu.counts = [2, 2, 2, 2, 2]; renderDeploy(); };
$('clearSpots').onclick = () => { menu.counts = [0, 0, 0, 0, 0]; menu.counts[menu.playerSpot] = 1; renderDeploy(); };
$('backMenu').onclick = () => show('menu');
$('deployBtn').onclick = () => { SFX.init(); beginMatch(); };

function beginMatch(auto = false) {
  // fresh map instance so bridges and decals reset
  const m = generateMap(menu.biome, menu.seed);
  const art = buildArt(m);
  startMatch(m, art, menu.counts, menu.playerSpot, { skill: menu.skill, auto, playerClass: params.get('class'), loadout: menu.loadout.slice() });
  show(null);
  cv.classList.add('playing');
}

// ---------- pause / perks / respawn / end
function togglePause() {
  if (!G || G.over) return;
  if (!$('perks').hidden) { togglePerks(); return; }
  G.paused = !G.paused;
  $('pause').hidden = !G.paused;
  cv.classList.toggle('playing', !G.paused);
}
$('resume').onclick = togglePause;
$('quit').onclick = () => { G = null; $('respawn').hidden = true; cv.classList.remove('playing'); show('menu'); };

function togglePerks() {
  const open = $('perks').hidden;
  $('perks').hidden = !open;
  cv.classList.toggle('playing', !open);
  if (open) renderPerks();
}
$('closePerks').onclick = togglePerks;
function renderPerks() {
  const P = G.player;
  $('perkTeam').textContent = G.teams[P.team].points;
  $('perkMine').textContent = P.points;
  const list = $('perkList'); list.innerHTML = '';
  if (Perks.defs.length) {
    for (const d of Perks.defs) {
      const el = document.createElement('div'); el.className = 'perk-slot';
      el.innerHTML = `<b>${d.name}</b><span>${d.desc}</span><span>${d.cost} pts (${d.pool})</span>`;
      const btn = document.createElement('button'); btn.textContent = P.perks.includes(d.id) ? 'Owned' : 'Buy';
      btn.disabled = !Perks.canBuy(G, P, d);
      btn.onclick = () => { Perks.buy(G, P, d.id); renderPerks(); };
      el.appendChild(btn); list.appendChild(el);
    }
  } else {
    for (let i = 0; i < Perks.SLOTS; i++) {
      const el = document.createElement('div'); el.className = 'perk-slot';
      el.innerHTML = `<b>Slot ${i + 1}</b><span>Empty. Perks will appear here once they are designed.</span>`;
      list.appendChild(el);
    }
  }
}

function updateRespawnDock() {
  const P = G && G.player;
  if (!G || G.over || P.alive || G.auto) { $('respawn').hidden = true; return; }
  $('respawn').hidden = false;
  const t = P.team, tm = G.teams[t];
  const truck = G.trucks.find(k => k.team === t && k.state === 'in');
  let msg;
  const spec = spectateTarget();
  const specTxt = spec && !P.riding ? ` Spectating ${spec.name}: click or Space to switch.` : '';
  if (P.riding) msg = `Riding the transport to point ${P.riding.target.name} (${Math.ceil(P.riding.hp)} HP). Press E to jump out early.`;
  else if (G.m.bridges[t].destroyed) msg = 'You were killed. Our bridge is down, so no more reinforcements can arrive.' + specTxt;
  else if (truck) msg = 'You were killed. Your truck is crossing the bridge now.' + specTxt;
  else {
    const lane = G.m.truckLanes[t];
    const eta = tm.supplyT + Math.abs(lane.to - lane.from) / CFG.TRUCK_SPEED;
    msg = `You were killed. You return with the next truck in ${eta.toFixed(0)} s.` + specTxt;
  }
  $('respawnText').textContent = msg;
}

function onMatchEnd() {
  cv.classList.remove('playing');
  $('respawn').hidden = true;
  const P = G.player, w = G.winner;
  $('overEyebrow').textContent = `Match over · ${fmtTime(G.time)}`;
  $('overTitle').textContent = w === -1 ? 'Draw' : w === P.team ? 'Victory' : 'Defeat';
  $('overTitle').style.color = w === -1 ? 'var(--fg)' : TEAMS[w].color;
  $('overText').textContent = (w === -1 ? '' : `${TEAMS[w].name} wins. `) + G.reason + '.';
  const tables = [0, 1].map(t => {
    const rows = G.soldiers.filter(s => s.team === t).sort((a, b) => b.kills - a.kills)
      .map(s => `<tr><td>${s.isPlayer ? '<b>' + s.name + '</b>' : s.name}</td><td class="n">${s.kills}</td><td class="n">${s.deaths}</td><td class="n">${s.points}</td></tr>`).join('');
    return `<table><thead><tr><th style="color:${TEAMS[t].color}">${TEAMS[t].name} · ${G.teams[t].points} pts · ${G.stats.captures[t]} captures</th><th class="n">K</th><th class="n">D</th><th class="n">Pts</th></tr></thead><tbody>${rows}</tbody></table>`;
  });
  $('overStats').innerHTML = tables.join('');
  show('over');
}
$('rematch').onclick = () => beginMatch();
$('toMenu').onclick = () => { G = null; show('menu'); };

// ---------- loop
let last = performance.now(), acc = 0;
const STEP = 1 / 60;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (G && !G.paused && !G.over) {
    acc += dt * SPEED;
    let n = 0;
    while (acc >= STEP && n < SPEED * 6 + 2) { update(STEP); acc -= STEP; n++; if (G.over) break; }
    if (acc > STEP * 10) acc = 0;
  }
  try { render(dt); } catch (e) { console.error(e); }
  if (G) updateRespawnDock();
  requestAnimationFrame(frame);
}

// ---------- boot
buildMenu();
regenMenuMap();
show('menu');
if (params.get('autoplay')) { beginMatch(true); }
requestAnimationFrame(frame);
window.__game = () => G;
window.__setSpeed = v => { SPEED = v; };
