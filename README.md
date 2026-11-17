# Bridgehead

A 2D top-down team shooter that runs in the browser. Two teams of 10 fight over three capture points on a procedurally generated, symmetrical map. You play one Blue soldier and command Blue's deployment; everyone else is a bot.

## Run it

No build step and no dependencies. Either:

- open `index.html` directly in Chrome, Edge or Firefox, or
- serve the folder, for example `python3 -m http.server` and visit `http://localhost:8000`.

A keyboard and mouse are required.

## Controls

| Key | Action |
| --- | --- |
| W A S D / arrows | Move |
| Mouse | Aim |
| Left click (hold) | Fire (automatic) |
| R | Reload |
| Shift | Sprint (you cannot fire while sprinting) |
| F (hold 3 s) | Plant C4 on the enemy bridge, or defuse C4 on yours |
| M | Toggle the full map |
| Tab (hold) | Scoreboard |
| P | Perk points panel |
| Esc | Pause |
| N | Mute or unmute |

On the deployment screen: left click a spawn on the map to send a soldier there, right click to pull one back, shift-click (or "Spawn here") to choose where you spawn.

## How a match works

- **Teams:** 10 v 10. You are Blue (west base). Red's commander picks a deployment pattern on its own.
- **Map:** 6000 × 3600 px. Each base is the outer 10% of the width and the neutral zone is the middle 80%. Crossing the whole map on foot takes about 60 seconds. The west half is generated from the seed and copied with a 180° rotation, so both sides are identical.
- **Theatres:** Forest, Desert, Urban ruins, Snowfield and Swamp. Each has its own obstacles, ground art and weather (falling leaves, blowing sand, ash and smoke, snow, fog and fireflies). Swamp pools halve your speed.
- **Weapons:** automatic rifle, 25-round magazine plus 2 spare magazines. Reload takes 2.2 s (2.8 s from empty). Partly used magazines go back in your pouch, so magazines are real, not a shared ammo pool.
- **Capture points:** A, B and C sit in the neutral zone with sandbag cover. Standing in the circle captures it (faster with more soldiers, up to 3; contested points freeze). **Win** by holding all three at the same time for 20 seconds. After 25 minutes, the team holding more points wins.
- **Supply trucks:** every 5 minutes each team's truck crosses its bridge and stocks the base depot. Walk onto the depot crates for full health and ammo.
- **C4:** you start with one charge. Stand on the marked section in the middle of the enemy bridge and hold F for 3 seconds. After a 5 second fuse the bridge is destroyed and that team gets no more trucks. Red sends its own sappers at your bridge from time to time.
- **Supply drops:** crates parachute in at random spots at least 1500 px from both bases (2 at the start, more every 75 s, up to 4 on the map). They give 2 full magazines, 60 health and sometimes a C4 charge.
- **Respawn:** 8 seconds, at any base spawn or at a point your team holds and is not contested.

## Perk points

Points are earned and banked now; perks themselves are not designed yet.

- +100 to the team pool for each conquest, +25 to every soldier standing on the point when it falls.
- +5 to the team pool every 10 s for each point held.
- +50 for destroying the enemy bridge, +25 for defusing.

`src/perks.js` has the registry. Register a perk with `Perks.register({ id, name, desc, cost, pool: 'team' | 'personal', apply(soldier) { ... } })` and it shows up in the P panel automatically. Soldiers already read `s.mods` (`speed`, `reload`, `dmg`, `maxHp`, `spread`), and perks are re-applied on respawn.

## Code layout

| File | What it does |
| --- | --- |
| `src/config.js` | All tuning values, team colors, biome palettes |
| `src/mapgen.js` | Procedural symmetric map, collision / line-of-sight / nav grids |
| `src/nav.js` | A* path finding, line of sight, collision |
| `src/game.js` | Match state, weapons, bullets, capture logic, trucks, drops, C4, victory |
| `src/bots.js` | Bot AI: objectives, path following, scanning and shooting, sappers |
| `src/render-map.js` | Pre-rendered ground, decals, obstacle art |
| `src/render.js` | Per-frame world rendering, weather, HUD, minimap |
| `src/perks.js` | Perk registry (empty for now) |
| `src/ui.js` | Menus, commander deployment, input, main loop |

## Testing helpers

URL parameters: `?biome=desert&seed=42` pick the map, `?autoplay=1` makes your soldier a bot and starts immediately, and `?speed=8` runs the simulation 8× faster. `window.__game()` returns the live match state in the console.
