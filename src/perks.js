'use strict';
// Perk system groundwork.
//
// Points come from conquering capture points (see game.js: onCapture / hold bonus).
// Each team has a shared pool (G.teams[t].points) and each soldier has personal points (s.points).
// Perks are not designed yet. To add one later:
//
//   Perks.register({
//     id: 'fast-hands', name: 'Fast hands', desc: 'Reload 20% faster',
//     cost: 200, pool: 'team',            // 'team' spends the team pool, 'personal' spends s.points
//     apply(soldier) { soldier.mods.reload *= 0.8; },
//   });
//
// Soldier stats already read their modifiers: s.mods = { speed, reload, dmg, maxHp, spread }.
// The perk menu (P) lists registered perks automatically and lets the player buy them.

const Perks = {
  defs: [],
  SLOTS: 3,
  register(def) { this.defs.push(Object.assign({ pool: 'team', cost: 100, desc: '' }, def)); },
  canBuy(G, s, def) {
    if (!s || (s.perks && s.perks.includes(def.id))) return false;
    const have = def.pool === 'team' ? G.teams[s.team].points : s.points;
    return have >= def.cost && s.perks.length < this.SLOTS;
  },
  buy(G, s, id) {
    const def = this.defs.find(d => d.id === id);
    if (!def || !this.canBuy(G, s, def)) return false;
    if (def.pool === 'team') G.teams[s.team].points -= def.cost; else s.points -= def.cost;
    s.perks.push(def.id);
    def.apply(s, G);
    return true;
  },
  // Re-applied on respawn so perks survive death.
  reapply(G, s) {
    s.mods = { speed: 1, reload: 1, dmg: 1, maxHp: 1, spread: 1 };
    for (const id of s.perks) { const d = this.defs.find(x => x.id === id); if (d) d.apply(s, G); }
  },
};
