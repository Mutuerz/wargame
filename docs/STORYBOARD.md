# Storyboard: the player's path through a match

Screens are `<section>` overlays in `index.html`, driven by `src/ui.js`. Screenshots of recent features are in the
project files (`previews/`, `screens/`).

## 1. Main menu (`#menu`)
Title BRIDGEHEAD. Pick a theatre (five cards), a map seed ("New map" rerolls), bot skill (Recruit / Veteran / Elite).
Buttons: **Continue to deployment** (offline) or **Play online with friends**.

## 2a. Online lobby (`#online`)
Name, room code, optional server URL. First player in is the host, picks bots per team (0-10) and starts.
Late joiners take over a bot.

## 2b. Deployment (`#deploy`)
Top-down map of the whole battlefield. As Blue's commander: left click a spawn to send a soldier, right click to pull
one back, shift-click to place yourself. **Loadout** row: each soldier's weapon for the match. Start.

## 3. Drop-in and first push
Squad spawns at its chosen points. First-person view, HUD: health, weapon and ammo, sector badges A-E, minimap,
timer. Two supply drops parachute into the neutral zone. Blue runs for A/B, Red for E/D, everyone converges on C.

## 4. The fight (the loop)
- Enter a sector: capture panel shows progress, who is inside, speed.
- Gunfight: hit markers, red glow on enemies you hit, headshot sound, ENEMY DOWN, kill list with distance.
  Chains: DOUBLE ... PENTAKILL voice callouts.
- Capture: ammo crate at the flag, perk points to the team.
- Supply truck crosses the bridge every minute; the cart drives a cache to the front.
- Big plays: C4 on the enemy bridge (hold F), air strike (B, 500 points, 10 s warning, bomber pass), grenades through
  windows, sniping from an upstairs window.

## 5. Death and return
Body falls (three death animations), view drops to the ground, **kill cam** replays the last 5 s from the killer's
shoulder (slow motion at the end). Then spectate a teammate. Respawn card: pick the next weapon (1-5).
Every 30 s, up to 5 dead teammates **parachute** in over a held sector; you can steer while you fall.

## 6. Climax
**Final 30 seconds** stinger. A team holding all five sectors starts a 15 s countdown to win. Otherwise the timer
(4 minutes) decides: more sectors, then more perk points.

## 7. Match over (`#over`)
**Best play** of the match plays for everyone: name card intro and music, then the whole kill streak (up to 40 s,
gaps fast-forwarded) with a list of each kill. Then the result card: Victory/Defeat, stats,
**Rematch on this map** or **Main menu**.

## Other screens
Pause (`#pause`, Esc), perks panel (`#perks`, P, empty for now), full map (M), scoreboard (hold Tab).

## Key moments to protect when changing things
- The first exact shot and the kill sound: the core "feels good" beat.
- The kill cam into parachute return: death should never feel like a long wait.
- The best-play replay at the end: the shareable highlight.
