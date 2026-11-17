#!/usr/bin/env bash
# Pull the latest code for the branch the server runs and restart it.  Usage: sudo bash /opt/bridgehead/deploy/update.sh
set -euo pipefail
APP=/opt/bridgehead
BRANCH="$(git -C "$APP" rev-parse --abbrev-ref HEAD)"
git -C "$APP" fetch --depth 1 origin "$BRANCH"
git -C "$APP" reset --hard FETCH_HEAD
(cd "$APP/server" && npm ci --omit=dev --no-audit --no-fund)
chown -R bridgehead:bridgehead "$APP"
systemctl restart bridgehead
echo "Updated $BRANCH to $(git -C "$APP" log -1 --format='%h %s') and restarted."
