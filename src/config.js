'use strict';
// All gameplay tuning lives here.

const W = 6000, H = 3600;          // world size in pixels
const CELL = 20, GW = W / CELL, GH = H / CELL;   // fine grid (collision, line of sight)
const NC = 40, NW = W / NC, NH = H / NC;         // coarse grid (path finding)
const HC = 200, HW = W / HC, HH = H / HC;        // spatial hash for obstacles
const GS = 0.5;                                  // ground texture scale

const CFG = {
  TEAM_SIZE: 10,
  BASE_W: W * 0.10,           // each base is 10% of the map width; the neutral zone is the middle 80%
  R: 14,                      // soldier radius
  WALK: 100,                  // px/s, 6000 px map = 60 s on foot
  SPRINT: 150,
  HP: 100,
  VISION_NEAR: 90,            // always visible around each soldier (fog of war)
  SPAWN_SHIELD: 1.5,
  REGEN_DELAY: 5,             // seconds without taking damage before self-heal starts
  REGEN_TIME: 5,              // seconds to heal from 1 HP to full
  CAP_R: 170,                 // capture radius
  CAP_TIME: 30,               // seconds for one soldier to take a neutral sector (twice that from the enemy)
  CAP_LOG: 0.2,               // each doubling of the majority's edge adds this much speed: 2 -> 1.2x, 4 -> 1.4x, 8 -> 1.6x
  WIN_HOLD: 15,               // seconds a team must keep all five sectors to win
  SUPPLY_INTERVAL: 60,        // a truck every minute: ammo and health (it no longer brings soldiers)
  TRUCK_SPEED: 306,          // 1.8x the original 170
  CACHE_CHARGES: 6,
  FIELD_CACHE: 4,             // resupplies the cart leaves at the point it reaches
  CART_HP: 350,               // transport cart: carries reinforcements from the depot to the front
  CART_R: 28,
  CART_SPEED: 288,           // 1.8x the original 160
  CACHE_MAX: 12,
  GRENADES: 1,                // every soldier spawns with this many grenades
  GRENADE_RANGE: 380,         // max throw distance
  GRENADE_LAND_FUSE: 2,       // seconds from first touching the ground to the explosion
  GRENADE_G: 520,             // gravity for thrown grenades (px/s²)
  GRENADE_RADIUS: 170,
  GRENADE_DMG: 110,
  STRIKE_COST: 500,           // team points needed (and spent) for an air strike
  STRIKE_DELAY: 10,           // seconds of warning before it hits
  STRIKE_W: 380, STRIKE_H: 150,   // target rectangle (plane flies along the long side)
  STRIKE_DMG: 130,
  HEIGHT_MAX: 3,              // terrain levels
  HEIGHT_STEP: 0.25,          // level difference that counts as up/downhill
  DOWNHILL_ACC: 1.1,          // spread divided by this when shooting downhill
  UPHILL_PEN: 1.2,            // spread multiplied by this when shooting uphill
  C4_PLANT: 3,                // seconds holding F
  C4_FUSE: 5,
  C4_RADIUS: 230,
  DROP_MIN_BASE_DIST: 1500,   // drops land at least this far from either base
  DROP_INTERVAL: 75,
  DROP_START: 2,
  DROP_MAX: 4,
  CAPTURE_REWARD: 100,        // perk points to the team per conquest
  CAPTURER_REWARD: 25,        // perk points to each soldier on the point
  HOLD_REWARD: 5,             // per held point, every HOLD_TICK seconds
  HOLD_TICK: 10,
  SABOTAGE_REWARD: 50,
  TIME_LIMIT: 10 * 60,
  VIEW_H: 1000,               // world pixels visible vertically (top-down map views)
  // ---- 3D (world units are the same pixels as the map; about 20 px = 1 m)
  LEVEL_H: 60,                // height of one terrain level
  EYE: 30,                    // eye height above the floor
  BODY_H: 36,                 // soldier hitbox height
  HEAD_H: 28,                 // hits above this height are headshots
  HEADSHOT: 1.6,              // headshot damage multiplier
  FLOOR_H: 64,                // one storey of a house
  STAIR_LEN: 110, STAIR_W: 36,
  TWO_STOREY: 0.67,           // share of houses that get an upper floor
  FOV: 75,                    // camera field of view (degrees)
  SCOPE_ZOOM: 5,              // sniper scope magnification
  SCOPE_SWAY: 0.013,          // radians the scoped aim wobbles (crouched: 40%)
  SENS: 0.0022,               // mouse look sensitivity (radians per pixel)
  RECOIL_BACK: 0.55,          // share of the recoil climb the aim drifts back down after you stop firing
  V_SPREAD: 0.6,              // vertical spread relative to horizontal
  ADS_ACC: 1.5,               // aiming down the sights divides spread by this
  ADS_SPEED: 0.6,             // movement speed while aiming down the sights
  ADS_ZOOM: 1.35,             // camera zoom while aiming down the sights
  SWITCH_T: 0.45,             // seconds to swap between the main weapon (1) and the sidearm (2)
  STEADY_T: 1,                // seconds standing still without shooting before the next shot is dead accurate (moving cancels it)
  CROUCH_ACC: 1.2,            // crouching (Ctrl) divides spread by this; you cannot move while crouched
  CROUCH_EYE: 19, CROUCH_BODY: 25, CROUCH_HEAD: 18,
  CAP_AMMO: 2,                // an ammo crate for this many soldiers appears on a point when it is captured
  STREAK_T: 8,                // kills within this many seconds of each other chain into multi-kills
  PARA_INTERVAL: 30,          // the only respawn: every 30 s up to PARA_N dead soldiers parachute over a held sector
  PARA_N: 5,
  JUMP_V: 210, GRAV: 980,     // Space: jump about 1.1 m
  VAULT_H: 44, VAULT_T: 48,   // Space next to cover at most this tall and this thick (px) vaults over it; windows too
  VAULT_TIME: 0.5,
  PARA_H: 400,                // drop height (20 m)
  PARA_FALL: 75,              // descent speed (px/s)
};
// Obstacle heights above the ground they stand on (px). Windows leave a gap you can see and shoot through.
const OBST_H = {
  tree: 230, pine: 250, deadtree: 150, cactus: 52, bag: 22, crate: 30, log: 20, car: 32, barrier: 26, snowwall: 36,
  hwall: 64, window: 64, timber: 62, adobe: 66, concrete: 84, cabin: 60, hut: 54,
};
const WIN_LO = 20, WIN_HI = 48;   // window opening, above the storey floor
function obstHeight(o) {
  if (o.kind === 'rock') return o.r * 1.15;
  if (o.kind === 'ice') return o.r * 1.0;
  if (o.kind === 'rubble') return o.r * 0.7;
  return OBST_H[o.kind] || 40;
}

// Weapons / classes. The commander picks one per soldier on the deployment screen.
const CLASSES = {
  rifleman: {
    name: 'Rifleman', mag: 25, mags: 2, rate: 10, reload: 2.2, reloadEmpty: 2.8, dmg: 15,
    bulletSpeed: 2250, range: 1500, spread: 0.0175, spreadMove: 0.035, speed: 1, vision: 1300, auto: true, recoil: [0.0165, 0.0075, 0.00225],
    falloff: [500, 1400, 0.75],   // damage: full up to 500, down to 75% at 1400
  },
  sniper: {
    name: 'Sniper', mag: 5, mags: 3, rate: 0.9, reload: 3.0, reloadEmpty: 3.4, dmg: 75,
    bulletSpeed: 3900, range: 3120, spread: 0.005, spreadMove: 0.05, speed: 0.95, vision: 1300, auto: false, recoil: [0.105, 0.018, 0.0],
    scopeRange: 2400, scopeCone: 0.32, scopeSpread: 0.35,
    hipSpread: 0.13,              // not scoped: no crosshair and a very wide cone (no damage drop for the sniper)
  },
  smg: {
    name: 'SMG', mag: 30, mags: 2, rate: 14, reload: 1.8, reloadEmpty: 2.2, dmg: 11,
    bulletSpeed: 2100, range: 840, spread: 0.03, spreadMove: 0.04, speed: 1.1, vision: 1300, auto: true, recoil: [0.012, 0.0105, -0.0015],
    falloff: [250, 800, 0.6],     // SMG hits hurt less from afar: 60% at 800
  },
  lmg: {
    name: 'Machine gun', mag: 60, mags: 1, rate: 9, reload: 4.5, reloadEmpty: 5, dmg: 16,
    bulletSpeed: 2250, range: 1560, spread: 0.025, spreadMove: 0.055, speed: 0.85, vision: 1300, auto: true, recoil: [0.0135, 0.009, 0.003],
    falloff: [550, 1500, 0.75],
  },
  // Pump shotgun: 9 pellets in a wide cone. Point blank one shot kills; damage fades past ~110 px and the pellets stop at 560.
  shotgun: {
    name: 'Shotgun', mag: 6, mags: 3, rate: 1.3, reload: 2.6, reloadEmpty: 3.0, dmg: 14,
    bulletSpeed: 1950, range: 672, spread: 0.015, spreadMove: 0.03, speed: 1.05, vision: 1300, auto: false, recoil: [0.09, 0.0225, 0.0],
    pellets: 9, pelletSpread: 0.085, falloff: [110, 480, 0.2],
  },
};
for (const k in CLASSES) CLASSES[k].key = k;
// Sidearm everyone carries on key 2: a small automatic machine pistol with 8-round magazines.
const SIDEARM = {
  key: 'pistol', name: 'Machine pistol', mag: 8, mags: 4, rate: 13, reload: 1.4, reloadEmpty: 1.7, dmg: 11,
  bulletSpeed: 1950, range: 780, spread: 0.025, spreadMove: 0.035, speed: 1, vision: 1300, auto: true, recoil: [0.021, 0.0135, 0.0],
  falloff: [200, 700, 0.6],
};
const weaponByKey = k => CLASSES[k] || (k === SIDEARM.key ? SIDEARM : null);
const WEAPON_BLURB = {
  rifleman: 'Assault rifle · 25 rds · all-round',
  sniper: 'Bolt sniper · 5 rds · scope, 75 dmg',
  smg: 'SMG · 30 rds · fast, short range',
  lmg: 'Machine gun · 60 rds · slow, long reload',
  shotgun: 'Pump shotgun · 6 shells · deadly up close, wide spread',
};
const DEFAULT_LOADOUT = ['rifleman', 'rifleman', 'rifleman', 'sniper', 'shotgun', 'smg', 'rifleman', 'sniper', 'lmg', 'smg'];

const SKILLS = [
  { name: 'Recruit', react: [0.45, 0.8], aimErr: [0.28, 0.4], minErr: 0.06, turn: 4.5, range: 800 },
  { name: 'Veteran', react: [0.28, 0.55], aimErr: [0.18, 0.3], minErr: 0.035, turn: 6.5, range: 950 },
  { name: 'Elite',   react: [0.16, 0.35], aimErr: [0.12, 0.2], minErr: 0.02,  turn: 9,   range: 1000 },
];

const TEAMS = [
  { name: 'Blue', color: '#5aa9ff', dark: '#1e4f86', light: '#b4d8ff', helmet: '#4f5d3a' },
  { name: 'Red',  color: '#ff5a4e', dark: '#8a2721', light: '#ffc1b9', helmet: '#5c4a33' },
];

const CALLSIGNS = [
  ['You', 'Hawk', 'Moss', 'Flint', 'Rook', 'Birch', 'Cobalt', 'Wren', 'Atlas', 'Ember'],
  ['Viper', 'Ash', 'Kodiak', 'Slate', 'Talon', 'Rust', 'Onyx', 'Lynx', 'Saber', 'Dune'],
];

const SPOT_NAMES = ['North', 'North-center', 'Center', 'South-center', 'South'];

const BIOMES = {
  forest: {
    name: 'Forest', blurb: 'Mixed woodland, boulders and timber shacks',
    desc: 'Dense tree clusters break up sight lines. Fight from boulder to boulder across the clearings.',
    ground: '#4a6431', blot: ['#56713a', '#405a2b', '#5d7a3f', '#3a5228', '#62793d'],
    speck: ['#2f4422', '#6c8a48', '#3d5a2a'],
    water: '#2c5a6e', waterHi: '#4b829a', bank: '#3a4529', road: '#6e5b3c',
    tree: '#2a4520', treeMid: '#36592a', treeHi: '#4f7a37',
    rock: '#7a7d76', rockHi: '#9c9f97', weather: 'leaves', tint: 'rgba(30,60,10,0.06)',
  },
  desert: {
    name: 'Desert', blurb: 'Dunes, rock spires and adobe compounds',
    desc: 'Long open lanes with rock formations for cover. Expect long-range fights.',
    ground: '#c8a76a', blot: ['#d4b678', '#bf9c5d', '#dbc08a', '#b48e56', '#cfae70'],
    speck: ['#a88648', '#e2cb96', '#9c7b44'],
    water: '#3b7c86', waterHi: '#68a8ad', bank: '#a5864f', road: '#a98955',
    tree: '#5f7f3a', treeMid: '#6f9145', treeHi: '#89ab58',
    rock: '#a2774f', rockHi: '#c49a6e', weather: 'sand', tint: 'rgba(255,170,60,0.07)',
  },
  urban: {
    name: 'Urban ruins', blurb: 'Gutted blocks, wrecked cars and barricades',
    desc: 'Close-quarters fighting through roofless buildings. Doors are the chokepoints.',
    ground: '#676761', blot: ['#72726b', '#5c5d58', '#7b7970', '#53544f', '#6e6a60'],
    speck: ['#4a4a46', '#8a877d', '#3f3f3c'],
    water: '#31495a', waterHi: '#4f6d80', bank: '#4d4d49', road: '#3d3d3b',
    tree: '#3c4a30', treeMid: '#4a5a3a', treeHi: '#5d6e48',
    rock: '#8b8982', rockHi: '#a9a69e', weather: 'ash', tint: 'rgba(40,40,50,0.10)',
  },
  snow: {
    name: 'Snowfield', blurb: 'Frozen pine forest, ice boulders and cabins',
    desc: 'Pine groves and snow walls on a bright field. Soldiers stand out against the snow.',
    ground: '#dde4e8', blot: ['#eef3f5', '#cdd7de', '#e6edf0', '#c3ced6', '#f4f7f8'],
    speck: ['#b8c5cf', '#ffffff', '#aebdc8'],
    water: '#557f9b', waterHi: '#8fb5cc', bank: '#b3c0c9', road: '#c0c3bf',
    tree: '#23402f', treeMid: '#2e5340', treeHi: '#e9f0f2',
    rock: '#8794a0', rockHi: '#b9c5cf', weather: 'snow', tint: 'rgba(120,160,220,0.07)',
  },
  swamp: {
    name: 'Swamp', blurb: 'Bog pools, dead trees and stilt huts',
    desc: 'Murky pools slow you down to half speed. Dead trees give thin cover.',
    ground: '#495131', blot: ['#535c38', '#3e462a', '#5b603a', '#373f27', '#4f5a33'],
    speck: ['#2f3620', '#6b7a3e', '#3a4227'],
    water: '#2f4238', waterHi: '#4e6a59', bank: '#3a4228', road: '#5a5035',
    tree: '#3a3624', treeMid: '#4a4530', treeHi: '#5b5639',
    rock: '#5d6052', rockHi: '#7b7e6e', weather: 'fog', tint: 'rgba(40,70,40,0.12)',
    pool: '#2e4236',
  },
};
const BIOME_KEYS = Object.keys(BIOMES);

const WALL_COLORS = {
  hwall: ['#6f6458', '#a39584'],
  timber: ['#5f4830', '#86683f'], adobe: ['#a9875c', '#d1b285'], concrete: ['#838079', '#aeaaa2'],
  cabin: ['#5a412d', '#7e5d40'], hut: ['#4b3d26', '#6b5a39'],
};
const FLOOR_COLORS = { house: '#6e5a45', timber: '#5a4832', adobe: '#b39669', concrete: '#7a7871', cabin: '#6c5238', hut: '#4f4630' };
