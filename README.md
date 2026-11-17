# Bridgehead

A 2D top-down team shooter that runs in the browser. Two teams of 10 fight over five capture points on a procedurally generated, symmetrical map. You play one Blue soldier and command Blue's deployment; everyone else is a bot.

## Run it

No build step and no dependencies. Either:

- open `index.html` directly in Chrome, Edge or Firefox, or
- serve the folder, for example `python3 -m http.server` and visit `http://localhost:8000`.

A keyboard and mouse are required.

## Play online

Bridgehead also has an online mode for up to 20 people (bots fill the empty slots). Click **Play online with friends**
on the main menu, pick a name and a room code, and share the code. The server lives in `server/`; how to run it on a
free Oracle Cloud VM (setup script included) is in [deploy/README.md](deploy/README.md).

## Controls

| Key | Action |
| --- | --- |
| W A S D / arrows | Move |
| Mouse | Aim |
| Left click (hold) | Fire (automatic) |
| R | Reload |
| Shift | Sprint (you cannot fire while sprinting) |
| G | Throw grenade toward the cursor (if you carry one) |
| Right click (hold) or Q | Sniper scope: hold position and see/shoot much farther |
| B | Air strike: mark a target (needs 500 team points). Works on the full map (M) too. Esc or right click cancels |
| E | Jump off the transport cart early |
| Click / Space / ← → (while dead) | Switch which teammate you spectate |
| F (hold 3 s) | Plant C4 on the enemy bridge, or defuse C4 on yours |
| M | Toggle the full map |
| Tab (hold) | Scoreboard |
| P | Perk points panel |
| Esc | Pause |
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
  | Sniper | 5 + 3 spares | 75 damage, 2200 px range, wider vision, scope (see below) |
  | SMG | 30 + 2 spares | Very fast fire, short range (650 px), 10% faster movement |
  | Machine gun | 60 + 1 spare | Steady fire, 4.5 s reload, 15% slower movement |

  Holding the sniper scope roots the soldier in place, zooms the view out toward the cursor, extends vision in a narrow cone out to 1900 px and tightens accuracy. Your weapon shows above the health bar. Partly used magazines go back in your pouch.
- **Air strike:** once your team pool has 500 points, press B (the HUD shows AIR STRIKE READY) and click a target, on screen or on the full map. The strike is announced to both teams: a 380 × 150 px rectangle appears on the ground, on the minimap and on the map with a 10 second countdown and warning beeps. Then a bomber passes over and everything still inside the rectangle takes 130 damage, friend or foe, carts included, and house walls inside it collapse. The 500 points come out of the same pool that perks will use. One strike per team at a time. Red's commander calls strikes too, on groups of Blue soldiers it can see, and bots run out of any marked zone.
- **Self-heal:** after 10 seconds without taking damage, soldiers heal steadily back to full health; from nearly dead it takes 5 seconds. Any hit restarts the 10-second wait.
- **Grenades:** each soldier has a 50% chance to spawn carrying one. Throw range is at most 380 px, it bounces off cover, and it detonates 5 seconds later (170 px radius, walls block the blast, no friendly fire). Bots throw at enemies hiding behind cover and run from live grenades.
- **Fog of war:** you only see what your team sees. Each soldier lights up a radius around them (750 px riflemen, 950 px snipers) blocked by obstacles, plus a scope cone for snipers. Enemies outside that area are hidden on screen and on the minimap.
- **Terrain height:** the ground has hills and ridges, shown with shading and contour lines (one line every half level). Shooting at a point lower than you gives 1.1× accuracy; shooting uphill gives 1.2× more spread. The HUD shows ▼ DOWNHILL or ▲ UPHILL when it applies.
- **Capture points:** five points, A to E, sit in the neutral zone with sandbag cover (C is in the center, B and D are mirrored, A is nearest Blue and E nearest Red). Standing in the circle captures it (faster with more soldiers, up to 3; contested points freeze). **Win** by holding all five at the same time for 15 seconds. The match lasts **10 minutes**; at the limit the team holding more points wins, then the team with more perk points.
- **Houses:** each map has six stone houses (three per side, mirrored) with doors and windows. Windows block movement but not bullets or vision, so you can shoot out of them. Grenade and C4 blasts knock down walls and windows.
- **Trucks, carts and respawn:** every minute each team's truck crosses its bridge to the base depot and restocks it (walk onto the crates for full health and ammo). It is the **only way back into the fight**: everyone who died since the last truck boards a **transport cart** at the depot. The cart runs every time, even with nobody aboard: it drives to your team's frontmost uncontested point (or stops short of the nearest point if you hold none), the soldiers jump off, and it leaves a **field supply cache** there (4 resupplies, full health and ammo). So supplies reach both the base depot and the front. Carts have 350 HP and can be shot or blown up; if one is destroyed, everyone aboard is lost until the next truck. Press E to jump off your cart early. One bot per team guards its own bridge.
- **Spectating:** while dead, the camera follows a living teammate. Click (right click goes back), Space or the arrow keys switch between teammates. While riding a cart, the camera follows the cart.
- **C4:** you start with one charge. Stand on the marked section in the middle of the enemy bridge and hold F for 3 seconds. After a 5 second fuse the bridge is destroyed: that team gets no more trucks, supplies or reinforcements. A team whose bridge is down and whose last soldier dies loses. Red sends its own sappers at your bridge from time to time.
- **Supply drops:** crates parachute in at random spots at least 1500 px from both bases (2 at the start, more every 75 s, up to 4 on the map). They refill your spare magazines, give 60 health and sometimes a C4 charge.

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

URL parameters: `?biome=desert&seed=42` pick the map, `?autoplay=1` makes your soldier a bot and starts immediately, and `?speed=8` runs the simulation 8× faster, and `?class=sniper` (or `smg`, `lmg`, `rifleman`) forces your own weapon. `window.__game()` returns the live match state in the console.
