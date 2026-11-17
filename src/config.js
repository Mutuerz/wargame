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
  MAG: 25,                    // rounds per magazine
  EXTRA_MAGS: 2,              // spare magazines carried
  FIRE_RATE: 10,              // rounds per second
  RELOAD: 2.2,                // seconds, tactical reload
  RELOAD_EMPTY: 2.8,          // seconds, reload from an empty magazine
  DMG: 15,
  BULLET_SPEED: 1500,
  BULLET_RANGE: 1050,
  SPREAD: 0.035,
  SPREAD_MOVING: 0.07,
  RESPAWN: 8,
  SPAWN_SHIELD: 1.5,
  CAP_R: 170,                 // capture radius
  CAP_RATE: 4,                // % per second per soldier (max 3 counted): 25 s alone from neutral
  WIN_HOLD: 20,               // seconds a team must keep all three points to win
  SUPPLY_INTERVAL: 300,       // a supply truck every 5 minutes
  TRUCK_SPEED: 170,
  CACHE_CHARGES: 12,
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
  TIME_LIMIT: 25 * 60,
  VIEW_H: 1000,               // world pixels visible vertically
};

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
  timber: ['#5f4830', '#86683f'], adobe: ['#a9875c', '#d1b285'], concrete: ['#838079', '#aeaaa2'],
  cabin: ['#5a412d', '#7e5d40'], hut: ['#4b3d26', '#6b5a39'],
};
const FLOOR_COLORS = { timber: '#5a4832', adobe: '#b39669', concrete: '#7a7871', cabin: '#6c5238', hut: '#4f4630' };
