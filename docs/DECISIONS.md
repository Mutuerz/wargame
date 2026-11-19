# Decisions and things to remember

Rules Juanes chose, with the date. If you change one, ask first and record the new choice here.
Numbers live in `src/config.js`; this file says _why_ and what must not silently change.

## Core rules

- **Teams:** 10 v 10, everyone except human players is a bot. Online, the host picks 0-10 bots per team; humans always
  get a slot. (2026-11-17)
- **Map:** 6000 × 3600 px, about 60 s to cross on foot. Bases are the outer 10% each side, neutral zone 80%. West half
  is generated and copied with a 180° rotation so both sides are identical. Five theatres: Forest, Desert, Urban ruins,
  Snowfield, Swamp. (2026-11-17)
- **Objective:** five sectors A-E. Majority inside a sector captures it, no capture circles. One soldier takes a
  neutral sector in 30 s. Speed = 1 + 0.2 × log2(majority − minority), based on the edge, not the ratio. Equal numbers
  freeze it. **Win = hold all five at once for 15 s** (`WIN_HOLD`). At the time limit, more sectors wins, then more
  perk points. C is a two-storey house in the center. (2026-11-17)
- **Match length:** 4 minutes (`TIME_LIMIT`, changed 2026-11-18 from 10). README still says 10.
- **Respawn:** parachute only, every 30 s, up to 5 per team, first killed first back, over a fully controlled sector
  flag or the home base. No team-wipe loss. (2026-11-17)
- **Supplies:** truck crosses the bridge to the depot, then a cart drives to the front sector and drops a cache.
  Trucks/carts carry supplies only, never soldiers. Destroying the enemy bridge with C4 (hold F 3 s, 5 s fuse) cuts
  their supplies but not their respawns. (2026-11-17)
- **Commander:** the player commands Blue: picks spawns and each soldier's weapon on the deployment screen. Red's
  commander is AI.
- **Perk points:** earned and banked (conquests, held sectors, bridge). The perks themselves are not designed yet.
  Air strike costs 500 team points. (2026-11-17)

## Combat feel

- First-person 3D, houses at most two floors. Sim stays 2D + heights. Headshots 1.6×.
- **No fog of war in the 3D view** (Juanes's choice, 2026-11-17): every soldier is drawn; only walls, terrain and haze
  hide them. Fog of war stays on the minimap and the full map. Spotting uses a direct `los3` from a teammate's eyes to
  head/chest/feet.
- Aim down sights 1.5× accuracy, crouch 1.2× (crouch cannot move; C/Ctrl while sprinting slides about 8 m).
- First shot is exact; spread resets after 2 s without shooting or moving. Recoil with partial recovery.
- Self-heal after 5 s without damage.
- Mags: rifle 25 + 2 spares with reload. Weapons: rifle, sniper (2 per team default), SMG, machine gun, shotgun,
  machine-pistol sidearm on 2, knife on 3.
- Multi-kill chain (8 s window) DOUBLE ... PENTAKILL with voice clips.

## Gotchas

- **Offline and online must run the same rules.** The server loads `src/*.js` into a sandbox. Browser-only APIs in
  game logic break the server; route them through `sim-hooks.js`.
- Cloud sessions cannot reach CDNs, so Three.js is vendored in `src/vendor/`. The npm registry works.
- Fonts come from Google Fonts in `index.html`; the game must still work if they fail to load.
- Caddy on the VM serves `/src/*`, `/sfx/*` and `/assets/*` only. A new top-level folder needs a Caddyfile change
  (`update.sh` patched `/assets/*` in).
- Both `main` and `codex-textures` deploy GitHub Pages; the last push wins.
- Deploying: Claude cannot run the ssh update from Juanes's PC (blocked by its safety check). Give Juanes the
  one-line PowerShell command and let them run it. Never put key paths or keys in the repo.
- `sfx/voice/*` and some other clips come from commercial games (private use only). `final30.mp3` has a store
  watermark.
- Juanes uses Codex locally for textures. Their clone is on their PC; pull before you touch `assets/`.

## How Juanes likes to work

- Short answers, in plain words. Spanish is fine.
- Wants things to work right away: test in a headless browser before handing over.
- Tries changes in the preview artifact first, then asks for deploy.
