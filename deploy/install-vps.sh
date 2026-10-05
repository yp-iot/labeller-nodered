#!/usr/bin/env bash
# One-time setup of the stand-alone Labeller dashboard on a Debian/Ubuntu VPS.
# Run as a normal sudo-capable user (not root):
#   curl -fsSL <raw url of this file> -o install-vps.sh && bash install-vps.sh git@github.com:<you>/<repo>.git
set -euo pipefail
REPO=${1:?usage: install-vps.sh <git ssh url>}
DIR=$HOME/.node-red
[ "$(id -u)" = 0 ] && { echo "Run as a normal user, not root"; exit 1; }

echo "== packages"
sudo apt-get update -qq
sudo apt-get install -y -qq git python3 build-essential curl ca-certificates
if ! node -v 2>/dev/null | grep -q '^v20'; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y -qq nodejs
fi
command -v node-red >/dev/null || sudo npm install -g --unsafe-perm node-red@4

echo "== GitHub deploy key (read-only)"
[ -f ~/.ssh/id_ed25519 ] || ssh-keygen -t ed25519 -N '' -C "vps-$(hostname)" -f ~/.ssh/id_ed25519 -q
ssh-keyscan -t ed25519 github.com >> ~/.ssh/known_hosts 2>/dev/null
until git ls-remote "$REPO" >/dev/null 2>&1; do
    echo; echo "Add this key in GitHub: repo -> Settings -> Deploy keys -> Add (read access only):"
    cat ~/.ssh/id_ed25519.pub; read -rp "Press Enter once added... "
done

echo "== code"
[ -d "$DIR/.git" ] || git clone -q "$REPO" "$DIR"
cd "$DIR"
echo vps > .role
mkdir -p data
npm install --omit=dev --no-audit --no-fund
python3 deploy/make-vps-flows.py

echo "== editor login"
if [ ! -f environment ]; then
    read -rp "Editor username [admin]: " U; U=${U:-admin}
    H=$(node-red admin hash-pw | grep -o '\$2[aby]\$.*' | tail -1)
    [ -n "$H" ] || { echo "Password hashing failed"; exit 1; }
    printf 'NR_ADMIN_USER=%s\nNR_ADMIN_HASH=%s\n' "$U" "$H" > environment
    chmod 600 environment
    echo "(optional) add NR_PAGE_USER / NR_PAGE_HASH to $DIR/environment to password-protect the dashboard pages"
fi

echo "== service + auto-update every 5 min"
NR=$(command -v node-red)
sudo tee /etc/systemd/system/nodered.service >/dev/null <<UNIT
[Unit]
Description=Node-RED (Labeller VPS copy)
After=network-online.target
[Service]
User=$USER
WorkingDirectory=$DIR
EnvironmentFile=$DIR/environment
Environment=NODE_OPTIONS=--max_old_space_size=512
ExecStart=$NR --userDir $DIR --settings $DIR/settings-vps.js
Restart=on-failure
[Install]
WantedBy=multi-user.target
UNIT
sudo tee /etc/systemd/system/nodered-update.service >/dev/null <<UNIT
[Unit]
Description=Pull latest Labeller code from GitHub
[Service]
Type=oneshot
User=$USER
ExecStart=$DIR/deploy/update.sh
UNIT
sudo tee /etc/systemd/system/nodered-update.timer >/dev/null <<UNIT
[Unit]
Description=Check GitHub for Labeller updates
[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
[Install]
WantedBy=timers.target
UNIT
echo "$USER ALL=(root) NOPASSWD: /usr/bin/systemctl restart nodered" | sudo tee /etc/sudoers.d/nodered-restart >/dev/null
sudo chmod 440 /etc/sudoers.d/nodered-restart
sudo systemctl daemon-reload
sudo systemctl enable --now nodered nodered-update.timer

sleep 5; systemctl --no-pager -l status nodered | head -5
IP=$(curl -fsS -4 ifconfig.me || hostname -I | cut -d' ' -f1)
echo; echo "Dashboard: http://$IP:1880/labeller    Editor: http://$IP:1880 (login required)"
echo "Open port 1880 in the VPS firewall if needed."
