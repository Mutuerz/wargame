#!/usr/bin/env bash
# Pull the latest code for the branch the server runs and restart it.  Usage: sudo bash /opt/bridgehead/deploy/update.sh
set -euo pipefail
APP=/opt/bridgehead
# the checkout belongs to the service user; let root run git in it
git config --system --get-all safe.directory 2>/dev/null | grep -qx "$APP" || git config --system --add safe.directory "$APP"
BRANCH="$(git -C "$APP" rev-parse --abbrev-ref HEAD)"
git -C "$APP" fetch --depth 1 origin "$BRANCH"
git -C "$APP" reset --hard FETCH_HEAD
(cd "$APP/server" && npm ci --omit=dev --no-audit --no-fund)
chown -R bridgehead:bridgehead "$APP"
systemctl restart bridgehead
# older Caddy configs only served /src and /sfx: let the texture and sky files in assets/ through too
if [ -f /etc/caddy/Caddyfile ] && grep -q '/src/\* /sfx/\*$' /etc/caddy/Caddyfile; then
  sed -i 's|/src/\* /sfx/\*$|/src/* /sfx/* /assets/*|' /etc/caddy/Caddyfile && (systemctl reload caddy || systemctl restart caddy)
fi
echo "Updated $BRANCH to $(git -C "$APP" log -1 --format='%h %s') and restarted."
