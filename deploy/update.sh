#!/usr/bin/env bash
# Pull the latest code from GitHub and restart Node-RED if anything changed.
# Works on both the Pi and the VPS. Usage: deploy/update.sh [--force]
set -euo pipefail
cd "$(dirname "$0")/.."

if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "Local uncommitted changes - commit/push or stash them first:"; git status --short; exit 1
fi

before=$(git rev-parse HEAD)
git pull --ff-only --quiet
after=$(git rev-parse HEAD)
[ "$before" = "$after" ] && [ "${1:-}" != "--force" ] && { echo "Already up to date ($after)"; exit 0; }

if [ "$before" != "$after" ] && git diff --name-only "$before" "$after" | grep -q '^package'; then
    npm install --omit=dev --no-audit --no-fund
fi

if [ -f settings-vps.js ] && [ "$(cat .role 2>/dev/null)" = vps ]; then
    python3 deploy/make-vps-flows.py
fi

sudo systemctl restart nodered
echo "Updated ${before:0:7} -> ${after:0:7}, Node-RED restarted"
