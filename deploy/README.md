# Running the Bridgehead online server

The server runs the real match (the same simulation as the offline game) and the browsers only send
keys and draw what the server says. The host picks how many bots join each team (0 to 10, default 10 = fill every free slot).

These steps are for the free Oracle Cloud VM (Ubuntu 24.04, shape VM.Standard.A1.Flex) in Bogotá,
but `setup.sh` works on any Ubuntu 24.04 machine with a public IP.

## 1. Open ports 80 and 443 in Oracle Cloud (one time)

Oracle blocks everything except SSH at the network level, so the browser cannot reach the server until you add two rules.

1. In the Oracle console open **Compute → Instances** and click your instance.
2. Under **Instance details**, click the link next to **Virtual cloud network** (for example `vcn-2026...`).
3. Open the **Security** tab (older consoles: **Security Lists** in the left menu) and click **Default Security List for ...**.
4. Open **Security rules** (or **Ingress Rules**) and click **Add Ingress Rules**.
5. Fill in: **Source CIDR** `0.0.0.0/0`, **IP Protocol** `TCP`, **Destination Port Range** `80,443`. Leave the rest. Click **Add Ingress Rules**.

Port 80 is only used by Let's Encrypt to issue the HTTPS certificate. The game itself runs on 443.

## 2. Connect to the VM

From your computer, with the private key you saved when you created the VM:

```bash
# macOS / Linux (on Windows use PowerShell, same command)
chmod 600 ~/Downloads/ssh-key-*.key          # skip this line on Windows
ssh -i ~/Downloads/ssh-key-XXXX.key ubuntu@YOUR_PUBLIC_IP
```

The user name is `ubuntu`. Type `yes` the first time it asks about the fingerprint.

## 3. Run the setup script

```bash
curl -fsSL https://raw.githubusercontent.com/Mutuerz/wargame/main/deploy/setup.sh | sudo BRANCH=main bash
```

Until the multiplayer code is merged into `main`, use its branch instead:

```bash
curl -fsSL https://raw.githubusercontent.com/Mutuerz/wargame/claude/project-thread-g40a4k/deploy/setup.sh | sudo BRANCH=claude/project-thread-g40a4k bash
```

It takes 2 to 4 minutes. At the end it prints the address, something like:

```
Game page:   https://129-151-1-2.sslip.io
Server URL:  wss://129-151-1-2.sslip.io/ws
```

`sslip.io` is a free service that turns `129-151-1-2.sslip.io` into the IP `129.151.1.2`, so Caddy can get a real
HTTPS certificate without you buying a domain. If you prefer your own free name, create one at
[duckdns.org](https://www.duckdns.org) pointing to the VM's IP and run the script with `sudo DOMAIN=yourname.duckdns.org BRANCH=... bash`.

## 4. Play

- Open the **Game page** link (first load can take up to a minute while the certificate is issued).
- Click **Play online with friends**, type your name and a room code (anything, for example `JUANES`), and **Join room**.
  The server box can stay empty: the page connects to the server it came from.
- Your friends open the same link and type the same room code. The first person in is the host and starts the match.
- People can join a match that is already running; they take over one of the bots.

If you play from the GitHub Pages copy (or a local copy) instead, paste the **Server URL** into the Server box
(or just the VM's IP; the page turns it into the sslip.io address).

## Everyday commands (on the VM)

| What | Command |
| --- | --- |
| Update to the latest code and restart | `sudo bash /opt/bridgehead/deploy/update.sh` |
| See the server log live | `sudo journalctl -u bridgehead -f` |
| Restart the game server | `sudo systemctl restart bridgehead` |
| Is it running? | `systemctl status bridgehead` or open `https://<your address>/status` |
| HTTPS / certificate log | `sudo journalctl -u caddy -f` |

## Troubleshooting

- **The page never loads**: the Oracle ingress rules (step 1) are missing, or the VM firewall was reset. Re-run the setup script; it reopens the ports.
- **Certificate errors right after setup**: wait a minute and reload. If it keeps failing, `sudo journalctl -u caddy` shows why (usually port 80 is blocked in step 1). sslip.io shares a certificate quota with everyone who uses it; if Let's Encrypt says the rate limit is hit, use a DuckDNS name instead.
- **"Could not reach ..." in the lobby**: the server address is wrong or the service is down (`systemctl status bridgehead`).

## How it fits together

```
browser ──https──▶ Caddy :443 ──▶ /            static game files (/opt/bridgehead)
                              └─▶ /ws, /status  Node game server 127.0.0.1:8080 (systemd: bridgehead)
```

- `server/index.js` accepts WebSocket connections and puts players in rooms by code.
- `server/room.js` runs a match: 60 simulation steps per second, snapshots to each player 20 times per second.
- `server/sim.js` loads `src/config.js`, `mapgen.js`, `nav.js`, `game.js`, `bots.js` and friends into a sandbox, so the
  online rules are exactly the offline rules. `server/sim-hooks.js` swaps sound, decals and messages for network events.
- `src/net.js` is the client side: lobby, input, smoothing other players (drawn 100 ms in the past) and predicting
  your own movement so it feels instant.
- Each player only receives enemy positions that their team can see, so fog of war cannot be bypassed by reading the network traffic.

One match uses about 1 to 2% of one CPU core and roughly 30 KB/s of upload per player, so the free VM can run many rooms at once.

## Running it locally

```bash
cd server && npm install && npm start      # ws://localhost:8080
python3 -m http.server 8000                # from the repo root, then open http://localhost:8000
```

On localhost the lobby connects to `ws://localhost:8080` automatically.
