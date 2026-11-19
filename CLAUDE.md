# Bridgehead: guide for Claude sessions

Bridgehead is a browser war shooter: two teams of 10 fight over five map sectors on a procedurally generated,
symmetrical map. It started as a 2D top-down game and is now a **first-person 3D** shooter (Three.js), playable
offline against bots or online with friends. The owner is Juanes (GitHub `Mutuerz`), who speaks Spanish, types fast
and wants changes to "work right off the bat". Keep answers short.

Read these before you change anything:

| File | What it holds |
| --- | --- |
| [docs/STATUS.md](docs/STATUS.md) | Where things stand: branches, what is deployed, recent work by date, next steps |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Game rules and design choices Juanes made, and gotchas to keep remembering |
| [docs/STORY.md](docs/STORY.md) | Setting, factions and tone (draft, Juanes edits it) |
| [docs/STORYBOARD.md](docs/STORYBOARD.md) | Player flow screen by screen and the key moments of a match |
| [README.md](README.md) | Player-facing rules and controls (keep it in sync when rules change) |
| [deploy/README.md](deploy/README.md) | Online server setup on the Oracle VM |

**Update docs/STATUS.md at the end of every piece of work** (date, branch, what changed, what is deployed).
New rule decisions go in docs/DECISIONS.md.

## Which branch

`main` is **behind**. The newest code lives on `codex-textures`, and the live server runs
`claude/project-thread-dessg0` (codex-textures plus a bots commit). Base new game work on `codex-textures`
unless docs/STATUS.md says otherwise. Check with `git log --oneline origin/main..origin/codex-textures`.

## Run, build, deploy

- **No build step.** Open `index.html` in Chrome/Edge/Firefox, or `python3 -m http.server 8000` from the repo root.
- Test URL params: `?biome=desert&seed=42`, `?autoplay=1` (your soldier is a bot), `?speed=8`, `?class=sniper`,
  `?killcam=0`, `?smooth=0`. `window.__game()` returns the live match state.
- Online server: `cd server && npm install && npm start` (ws://localhost:8080); the page connects to it on localhost.
- Quick headless check: Playwright/Chromium is in cloud sessions; load the page with `?autoplay=1&speed=8` and read
  console errors.
- **Live server:** Oracle Cloud VM (Bogotá), https://129-38-97-8.sslip.io. To update it, on the VM:
  `sudo bash /opt/bridgehead/deploy/update.sh` (pulls the branch the server already runs and restarts).
  Juanes usually runs this themselves over SSH from PowerShell; the safety check on their PC blocks Claude from running ssh.
  Never commit SSH keys, key paths, IPs of other machines or any secret.
- **GitHub Pages:** `.github/workflows/pages.yml` deploys on push. On `main` it triggers on `main`, on `codex-textures`
  it triggers on `codex-textures`; whichever pushed last is what Pages shows.
- **Preview artifact:** Juanes plays previews in a claude.ai artifact (link in docs/STATUS.md); republish it from
  `src/` when the game changes.

## Architecture map

Plain HTML5 + vanilla JS, global scripts loaded in order by `index.html` (no modules, no bundler).
The simulation is 2D (x, y in map px, about 20 px = 1 m) plus heights: `soldier.z` is the floor level, obstacles have
`z0`/`z1`, bullets have `z`/`vz`. Rendering is a separate 3D layer on top.

| File | Role |
| --- | --- |
| `src/config.js` | **All tuning** (`CFG`), weapons, bot skill, `TEAMS`, `BIOMES`. Change numbers here first |
| `src/mapgen.js` | Seeded symmetric map (west half rotated 180°), houses/stairs, heights, collision/LOS/nav grids |
| `src/nav.js` | A*, 3D line of sight (`los3`), bullet blocking, height-aware collision |
| `src/game.js` | Match state, weapons, bullets, sectors and capture, trucks/carts, drops, C4, air strike, victory |
| `src/bots.js` | Bot AI: objectives, paths, scanning, shooting, sappers, grenades |
| `src/perks.js` | Perk registry (`Perks.register`), no perks designed yet |
| `src/render3d.js` | First-person 3D view: terrain, props, houses, soldiers, effects |
| `src/viewmodel.js` | First-person guns (PBR materials) |
| `src/feel.js` | Render interpolation, springs, head bob (F7 toggles) |
| `src/killcam.js` | Kill cam and end-of-match best-play replay |
| `src/post.js`, `src/surface.js` | Post-processing (AO, bloom, grade; F8 quality) and triplanar surface detail |
| `src/audio.js` | Sound: clips in `sfx/`, synthesized sounds, 3D/HRTF/7.1 placement (Shift+N) |
| `src/render.js`, `src/render-map.js` | HUD, scope, minimap, full map, painted ground texture |
| `src/ui.js` | Menus, deployment screen, input, main loop |
| `src/net.js` | Online client: lobby, input, interpolation, prediction |
| `server/` | Node + `ws` authoritative server. `sim.js` runs the same `src/*.js` in a vm sandbox, `room.js` steps at 60 Hz and sends snapshots at 20 Hz, `sim-hooks.js` turns sounds/effects into network events |
| `assets/textures/` | Codex-made textures and the dawn sky panorama |
| `src/vendor/` | Three.js r160 and post-processing, vendored (CDNs are blocked in cloud sessions) |

## Conventions

- Rules must stay identical offline and online: put game logic in `src/game.js`/`bots.js`, never only in the
  client or only in `server/`. Anything the server needs to send goes through `sim-hooks.js`/`net.js`.
- New tuning values go in `CFG` with a comment saying what the number means in-game.
- Keep `README.md` (player rules) true: it has drifted before (for example match length).
- Commits: one line in plain English saying what the player notices ("Slide 30% shorter ..."). Previews of unfinished
  work start with "Preview:".
- Juanes makes art with Codex on their PC (`D:\Trabajo\wargame`), so pull before editing assets.
- Sound clips in `sfx/voice/` are Juanes's own uploads from commercial games: private use only, do not
  redistribute or publish the game commercially with them.
