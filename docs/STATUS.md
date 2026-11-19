# Status

_Last updated: 2026-11-19. Update this file at the end of every piece of work._

## Right now

- **Game:** first-person 3D, 10v10, five sectors, offline vs bots and online multiplayer. Playable and deployed.
- **Live server:** https://129-38-97-8.sslip.io (Oracle Cloud VM, Bogotá, Pay As You Go account). Runs branch
  `claude/project-thread-dessg0` at `0376d83`, deployed 2026-11-18 by Juanes.
- **Preview artifact** (Juanes's main way to try changes): https://claude.ai/artifact/E1ZqWiXs7RJxqfWRZLckC2
  (older top-down/3D artifact: https://claude.ai/artifact/FEsSCBHyXifBHcbm3p7Wug).
- **Open PRs:** none.

## Branches

| Branch | State |
| --- | --- |
| `codex-textures` | **Newest game code.** Textures, sky, kill cam, best play, knife, 3D audio (PR #4 merged here). Pages deploys from it |
| `claude/project-thread-dessg0` | `codex-textures` + bots change `3ef0529` (no bridge guard, bots engage only what they see, chase the last-seen spot). **What the live server runs** |
| `main` | Behind: has PRs #1-#3 and its own copy of the textures/sky commits plus a Pages workflow, but not kill cam, best play, knife, audio or the bots change. Also deploys Pages |
| `claude/project-thread-ymejvg`, `-g40a4k`, `feat/bridgehead-prototype` | Merged, can be deleted |

**To do soon:** bring `main` up to date (merge `claude/project-thread-dessg0` into `main`, resolve the duplicated
texture/Pages commits), then point the live server and Pages at `main` so there is one branch again.

## Timeline

**2026-11-17**
- Prototype: 2D top-down 10v10 on HTML5 Canvas, five theatres, bridge supply trucks, C4, commander deployment,
  loadouts, air strike, perk points (PR #1).
- Grenades, two snipers per team with scope, terrain height accuracy.
- Five sectors A-E (hold all for 15 s), houses with windows and breakable walls, spectating.
- Online multiplayer: Node + ws authoritative server, Oracle VM setup script with Caddy HTTPS via sslip.io (PR #2).
- Converted to first-person 3D with Three.js, houses up to two floors, 3D bullets and headshots (PR #3).
- Majority capture with log-scale speed, parachute-only respawn, trucks/carts deliver supplies only, death animations,
  multi-kill voice callouts, host picks bots per team, no fog of war in the 3D view.

**2026-11-18**
- Jump and vault, detailed soldier and gun models, shotgun class, machine-pistol sidearm, first-person guns with PBR.
- Feel pass: render interpolation, springs, recoil and recovery, first-shot accuracy, halved spread, damage falloff,
  faster bullets, real grenade arcs, 5 s self-heal delay, slide, hurt and hit sounds, final-30-seconds stinger.
- Kill cam (first person, keeps playing while you parachute in), spectating, kill list with distance, 4-minute rounds.
- End-of-match best play: name card intro, whole streak replay with kill list, music.
- Knife on 3 (one stab kill), enemies glow red briefly after a hit, Codex textures for terrain/trees/vehicles,
  dawn sky panorama as background and environment map, GitHub Pages deploy.
- Directional 3D audio: HRTF headphones, 7.1/5.1, stereo, sound delay, wall muffling, enemy footsteps, whizz (PR #4).
- Bots: no bridge guard, only engage what they see.
- Deployed `0376d83` to the live server.

**2026-11-19**
- Added CLAUDE.md and docs/ (this file, DECISIONS, STORY, STORYBOARD).

## Next steps (ideas, not yet agreed)

1. Merge everything into `main` and use one branch for Pages and the server.
2. Design the actual perks (points are banked, registry exists, no perks yet).
3. Fix README drift: it still says matches last 10 minutes (config is 4 minutes) and mentions a bridge guard bot.
4. Art: swap Lambert for PBR on the world, water shader, CC0 low-poly soldiers/vehicles (see the asset list in
   project files, `notes/asset-list.md`).
5. Decide on the story/faction names in docs/STORY.md and use them in menus and callouts.
