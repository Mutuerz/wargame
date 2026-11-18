#!/usr/bin/env bash
# Bridgehead server setup for a fresh Ubuntu 24.04 VM (Oracle Cloud Always Free, ARM or x86).
#
#   curl -fsSL https://raw.githubusercontent.com/Mutuerz/wargame/<branch>/deploy/setup.sh | sudo bash
#
# Optional environment variables (put them after `sudo`, e.g. `sudo DOMAIN=mygame.duckdns.org bash`):
#   DOMAIN   public name for HTTPS. Default: <your-ip-with-dashes>.sslip.io (free, no sign-up)
#   BRANCH   git branch to run. Default: main
#   REPO     git URL. Default: https://github.com/Mutuerz/wargame.git
#
# What it does: installs Node.js 22 and Caddy, clones the game to /opt/bridgehead, runs the game server
# as a systemd service (restarts on crash and on reboot), opens ports 80/443 in the VM firewall, and has
# Caddy fetch a free Let's Encrypt certificate so browsers can connect with wss://.
# Safe to run again: it updates the code and restarts the service.
set -euo pipefail

REPO="${REPO:-https://github.com/Mutuerz/wargame.git}"
BRANCH="${BRANCH:-main}"
APP=/opt/bridgehead
SVC_USER=bridgehead

if [ "$(id -u)" -ne 0 ]; then echo "Run this with sudo." >&2; exit 1; fi
export DEBIAN_FRONTEND=noninteractive

echo "==> Installing base packages"
apt-get update -y
apt-get install -y curl git ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https iptables-persistent

echo "==> Installing Node.js 22"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node -v

echo "==> Installing Caddy"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

echo "==> Getting the game code ($BRANCH)"
id -u "$SVC_USER" >/dev/null 2>&1 || useradd --system --home "$APP" --shell /usr/sbin/nologin "$SVC_USER"
# the checkout belongs to the service user; let root run git in it (setup re-runs and update.sh)
git config --system --get-all safe.directory 2>/dev/null | grep -qx "$APP" || git config --system --add safe.directory "$APP"
if [ -d "$APP/.git" ]; then
  git -C "$APP" fetch --depth 1 origin "$BRANCH"
  git -C "$APP" checkout -B "$BRANCH" FETCH_HEAD
else
  rm -rf "$APP"
  git clone --depth 1 --branch "$BRANCH" "$REPO" "$APP"
fi
(cd "$APP/server" && npm ci --omit=dev --no-audit --no-fund)
chown -R "$SVC_USER:$SVC_USER" "$APP"

echo "==> Installing the systemd service"
cat > /etc/systemd/system/bridgehead.service <<UNIT
[Unit]
Description=Bridgehead game server
After=network-online.target
Wants=network-online.target

[Service]
User=$SVC_USER
WorkingDirectory=$APP/server
Environment=NODE_ENV=production PORT=8080 HOST=127.0.0.1
ExecStart=/usr/bin/node index.js
Restart=always
RestartSec=2
NoNewPrivileges=true
ProtectSystem=full
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable bridgehead
systemctl restart bridgehead

echo "==> Opening ports 80 and 443 in the VM firewall"
# Oracle's Ubuntu images ship iptables rules that reject everything except SSH.
for port in 80 443; do
  iptables -C INPUT -p tcp -m state --state NEW --dport "$port" -j ACCEPT 2>/dev/null \
    || iptables -I INPUT 1 -p tcp -m state --state NEW --dport "$port" -j ACCEPT
done
netfilter-persistent save

echo "==> Configuring HTTPS"
if [ -z "${DOMAIN:-}" ]; then
  IP="$(curl -fsS4 https://api.ipify.org || curl -fsS4 https://ifconfig.me)"
  DOMAIN="${IP//./-}.sslip.io"
fi
cat > /etc/caddy/Caddyfile <<CADDY
$DOMAIN {
	encode gzip
	# game connections
	handle /ws* {
		reverse_proxy 127.0.0.1:8080
	}
	handle /status {
		reverse_proxy 127.0.0.1:8080
	}
	# the game itself, so friends can just open https://$DOMAIN
	handle {
		root * $APP
		@other not path / /index.html /src/* /sfx/* /assets/*
		respond @other 404
		file_server
	}
}
CADDY
systemctl enable caddy
systemctl reload caddy || systemctl restart caddy

echo
echo "Done."
echo "  Game page:   https://$DOMAIN"
echo "  Server URL:  wss://$DOMAIN/ws"
echo "  Status:      https://$DOMAIN/status"
echo "The HTTPS certificate is issued on the first visit and can take up to a minute."
echo "If the page does not load, check that ports 80 and 443 are open in the Oracle security list (see deploy/README.md)."
echo "Logs: sudo journalctl -u bridgehead -f    |    sudo journalctl -u caddy -f"
