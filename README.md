# Bridgehead

A first-person 3D team shooter that runs in the browser (Three.js, bundled in `src/vendor/`). Two teams of 10 fight over five map sectors on a procedurally generated, symmetrical map with real hills and two-storey houses. You play one Blue soldier and command Blue's deployment; everyone else is a bot.

## Run it

No build step and no install. Either:

- open `index.html` directly in Chrome, Edge or Firefox, or
- serve the folder, for example `python3 -m http.server` and visit `http://localhost:8000`.

A keyboard and mouse are required, and a browser with WebGL. Click the game once to capture the mouse (Esc releases it and opens the menu).

## Play online

Bridgehead also has an online mode for up to 20 people (bots fill the empty slots). Click **Play online with friends**
on the main menu, pick a name and a room code, and share the code. The server lives in `server/`; how to run it on a
free Oracle Cloud VM (setup script included) is in [deploy/README.md](deploy/README.md).

## Controls

| Key | Action |
| --- | --- |
| Click | Capture the mouse for looking around |
| W A S D / arrows | Move (relative to where you look) |
| Mouse | Look and aim |
| Left click (hold) | Fire (automatic) |
| R | Reload |
| Shift | Sprint (you cannot fire while sprinting) |
| G | Throw a grenade where you look (look up to throw at full range) |
| Right click (hold) or Q | Aim down the sights: 1.5× better accuracy, slight zoom, walk at 60% speed, no sprint. Snipers get the scope instead: hold position, 5× zoom, see farther |
| Ctrl (hold) or C | Crouch: 1.2× better accuracy and a smaller target, but you cannot move. The game asks before closing the tab, so a stray Ctrl+W does not end your match |
| B | Air strike: opens the map, click to mark a target (needs 500 team points). Esc cancels |
| E | Jump off the transport cart early |
| Click / Space / ← → (while dead) | Switch which teammate you watch (camera behind them) |
| F (hold 3 s) | Plant C4 on the enemy bridge, or defuse C4 on yours |
| M | Toggle the full map |
| Tab (hold) | Scoreboard |
| P | Perk points panel |
| Esc | Release the mouse and open the menu (pause offline) |
| N | Mute or unmute |

On the deployment screen (this sets where the squad starts the match): left click a spawn on the map to send a soldier there, right click to pull one back, shift-click (or "Spawn here") to choose where you spawn. Below the map, the **Loadout** row sets the weapon each soldier (you included) carries for the whole match.

## How a match works

- **Teams:** 10 v 10. You are Blue (west base). Red's commander picks a deployment pattern on its own.
- **Map:** 6000 × 3600 px. Each base is the outer 10% of the width and the neutral zone is the middle 80%. Crossing the whole map on foot takes about 60 seconds. The west half is generated from the seed and copied with a 180° rotation, so both sides are identical.
- **Theatres:** Forest, Desert, Urban ruins, Snowfield and Swamp. Each has its own obstacles, ground art and weather (falling leaves, blowing sand, ash and smoke, snow, fog and fireflies). Swamp pools halve your speed.
- **Weapons (loadout):** as commander you pick each Blue soldier's weapon on the deployment screen. The default mix is 5 rifles, 2 snipers, 2 SMGs and 1 machine gun. Red's commander picks its own mix (4 to 5 rifles, 2 snipers, 2 SMGs, 1 to 2 machine guns).

  | Weapon | Magazine | Notes |
  | --- | --- | --- |
  | Assault rifle | 25 + 2 spares | All-round, reload 2.2 s (2.8 s from empty) |
  | Sniper | 5 + 3 spares | 75 damage, 2600 px range, scope (see below), very bright muzzle flash |
  | SMG | 30 + 2 spares | Very fast fire, short range (650 px), 10% faster movement |
  | Machine gun | 60 + 1 spare | Steady fire, 4.5 s reload, 15% slower movement |

  Holding the sniper scope roots the soldier in place, zooms the view out toward the cursor, extends vision in a narrow cone out to 1900 px and tightens accuracy. Your weapon shows above the health bar. Partly used magazines go back in your pouch.
- **Air strike:** once your team pool has 500 points, press B (the HUD shows AIR STRIKE READY) and click a target, on screen or on the full map. The strike is announced to both teams: a 380 × 150 px rectangle appears on the ground, on the minimap and on the map with a 10 second countdown and warning beeps. Then a bomber passes over and everything still inside the rectangle takes 130 damage, friend or foe, carts included, and house walls inside it collapse. The 500 points come out of the same pool that perks will use. One strike per team at a time. Red's commander calls strikes too, on groups of Blue soldiers it can see, and bots run out of any marked zone.
- **Self-heal:** after 10 seconds without taking damage, soldiers heal steadily back to full health; from nearly dead it takes 5 seconds. Any hit restarts the 10-second wait.
- **Grenades:** each soldier has a 50% chance to spawn carrying one. Throw range is at most 380 px, it bounces off cover, and it detonates 5 seconds later (170 px radius, walls block the blast, no friendly fire). Bots throw at enemies hiding behind cover and run from live grenades.
- **First person and 3D:** the world is 3D (about 20 map px = 1 m). Bullets fly in 3D: low cover (sandbags, crates, logs, cars, low rocks) stops shots at its height, so you can fire over sandbags and an enemy behind them only shows the head and shoulders. Hits above the shoulders are **headshots** (1.6× damage). Hills block bullets and sight.
- **Accuracy:** the first shot always goes exactly where the crosshair dot is (a green ring around the dot shows it). After that, shots spread as usual until you go 2 seconds without shooting or moving, then the next shot is dead accurate again. Aiming down the sights (1.5×) and crouching (1.2×) tighten the spread of the shots that follow.
- **Kill callouts:** every kill flashes ENEMY DOWN. Kills less than 8 seconds apart chain into DOUBLE KILL, TRIPLE KILL, QUADRA KILL and PENTAKILL, with a voice callout (the browser's speech voice, or your own clips in `sfx/voice/`, see the README there).
- **Fog of war:** you only see enemies your team sees. Every weapon sees the same 1300 px (the sniper's only extra is the scope, out to 2400 px in a narrow cone) unless trees, walls, tall rocks or a hill crest are in the way; low cover does not block sight. Unseen enemies are not drawn, in the 3D view or on the minimap.
- **Terrain height:** hills and ridges are real 3D terrain (the map views keep the contour lines). Shooting at a point lower than you gives 1.1× accuracy; shooting uphill gives 1.2× more spread. The HUD shows ▼ DOWNHILL or ▲ UPHILL when it applies.
- **Sectors:** the neutral zone is split into five sectors, A to E (every spot belongs to the nearest of five flags). There are no capture circles: **whoever has more soldiers anywhere inside a sector captures it**. One soldier alone takes a neutral sector in 30 seconds, and an enemy sector takes 30 seconds to neutralize plus 30 more to capture. A bigger edge (majority minus minority) speeds it up on a log scale: an edge of 2 is 1.2× faster, 4 is 1.4×, 8 is 1.6×. Equal numbers freeze it, and an empty sector drifts back to its owner. Soldiers still parachuting in don't count. Sector A is close to Blue's base and E close to Red's (with sandbag cover around the flag), B and D are mirrored, and C's flag is a two-storey house in the center of the map. Owned sectors are tinted in their team's color on the minimap and the full map, and a line on the ground marks the borders. While you are in a sector, a panel under the badges shows its progress, who is inside and the current speed. Capturing a sector leaves an **ammo crate** at its flag for the first 2 soldiers who reach it. **Win** by holding all five at the same time for 15 seconds. The match lasts **10 minutes**; at the limit the team holding more sectors wins, then the team with more perk points.
- **Houses:** each map has six stone houses (three per side, mirrored), **at most two floors**: about two in three get an upper floor with a staircase along an inside wall and windows all round. Windows block movement but not bullets or vision between knee and head height, so you can shoot out of them, and from upstairs you see and shoot over low cover. Floors and roofs stop bullets (except the stairwell). Grenade and C4 blasts knock down walls and windows on both floors; a soldier who walks out through a hole upstairs drops to the ground. Some bot snipers and defenders climb up to watch a nearby point from an upper window.
- **Trucks, carts and respawn:** trucks and carts drive at 1.8× their old speed. Every minute each team's truck crosses its bridge to the base depot and restocks it (walk onto the crates for full health and ammo). It is the **only way back into the fight**: everyone who died since the last truck boards a **transport cart** at the depot. The cart runs every time, even with nobody aboard: it drives to your team's frontmost uncontested sector flag (or stops short of the nearest flag if you hold none), the soldiers jump off, and it leaves a **field supply cache** there (4 resupplies, full health and ammo). So supplies reach both the base depot and the front. Carts have 350 HP and can be shot or blown up; if one is destroyed, everyone aboard is lost until the next truck. Press E to jump off your cart early. One bot per team guards its own bridge.
- **Spectating:** while dead, the camera follows a living teammate. Click (right click goes back), Space or the arrow keys switch between teammates. While riding a cart, the camera follows the cart.
- **C4:** you start with one charge. Stand on the marked section in the middle of the enemy bridge and hold F for 3 seconds. After a 5 second fuse the bridge is destroyed: that team gets no more trucks or supplies. Instead, every 30 seconds up to 2 dead soldiers **parachute in** 20 m above a sector flag the team holds (steer while you fall). A team whose bridge is down, that holds no sector and whose last soldier dies loses. Red sends its own sappers at your bridge from time to time.
- **Supply drops:** crates parachute in at random spots at least 1500 px from both bases (2 at the start, more every 75 s, up to 4 on the map). They refill your spare magazines, give 60 health and sometimes a C4 charge.

## Perk points

Points are earned and banked now; perks themselves are not designed yet.

- +100 to the team pool for each conquest, +25 to every soldier inside the sector when it falls.
- +5 to the team pool every 10 s for each sector held.
- +50 for destroying the enemy bridge, +25 for defusing.

`src/perks.js` has the registry. Register a perk with `Perks.register({ id, name, desc, cost, pool: 'team' | 'personal', apply(soldier) { ... } })` and it shows up in the P panel automatically. Soldiers already read `s.mods` (`speed`, `reload`, `dmg`, `maxHp`, `spread`), and perks are re-applied on respawn.

## Code layout

| File | What it does |
| --- | --- |
| `src/config.js` | All tuning values, team colors, biome palettes |
| `src/mapgen.js` | Procedural symmetric map, houses and stairs, heights, collision / line-of-sight / nav grids |
| `src/nav.js` | A* path finding, 3D line of sight and bullet blocking, collision by height |
| `src/game.js` | Match state, weapons, bullets, capture logic, trucks, drops, C4, victory |
| `src/bots.js` | Bot AI: objectives, path following, scanning and shooting, sappers |
| `src/render-map.js` | Pre-rendered ground texture, map thumbnail |
| `src/render3d.js` | First-person 3D view: terrain, obstacles, houses, soldiers, effects, weapon view model |
| `src/render.js` | HUD, scope overlay, minimap and full map |
| `src/vendor/three.min.js` | Three.js r160 (MIT) |
| `src/perks.js` | Perk registry (empty for now) |
| `src/ui.js` | Menus, commander deployment, input, main loop |

## Testing helpers

URL parameters: `?biome=desert&seed=42` pick the map, `?autoplay=1` makes your soldier a bot and starts immediately (the camera rides along in first person), and `?speed=8` runs the simulation 8× faster, and `?class=sniper` (or `smg`, `lmg`, `rifleman`) forces your own weapon. `window.__game()` returns the live match state in the console.
