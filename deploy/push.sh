#!/usr/bin/env bash
# Commit whatever changed (e.g. after Deploy in the Node-RED editor) and push to GitHub.
# Usage: deploy/push.sh "what changed"
set -euo pipefail
cd "$(dirname "$0")/.."
git add -A
git diff --cached --quiet && { echo "Nothing to commit"; exit 0; }
git commit -m "${1:-Update flows from $(hostname)}"
git pull --rebase --quiet
git push
