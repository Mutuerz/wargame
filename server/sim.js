'use strict';
// Loads the browser game's simulation (src/*.js) into an isolated sandbox, one per match.
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');
const FILES = ['config.js', 'util.js', 'mapgen.js', 'nav.js', 'perks.js', 'game.js', 'bots.js'];
const scripts = FILES.map(f => new vm.Script(fs.readFileSync(path.join(SRC, f), 'utf8'), { filename: 'src/' + f }))
  .concat(new vm.Script(fs.readFileSync(path.join(__dirname, 'sim-hooks.js'), 'utf8'), { filename: 'server/sim-hooks.js' }));

function createSim() {
  const ctx = vm.createContext({ console });
  for (const s of scripts) s.runInContext(ctx);
  // testing aid: BH_TIME_LIMIT=60 node index.js makes matches end after 60 s
  if (Number(process.env.BH_TIME_LIMIT) > 0) vm.runInContext(`CFG.TIME_LIMIT = ${Number(process.env.BH_TIME_LIMIT)}`, ctx);
  return vm.runInContext('SIM', ctx);
}

module.exports = { createSim };
