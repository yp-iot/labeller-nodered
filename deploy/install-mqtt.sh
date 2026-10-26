#!/usr/bin/env bash
# One-time setup of the MQTT broker on the VPS for the cloud copy (Pi -> VPS).
#   - Mosquitto: port 8883 from the internet (TLS, each Pi logs in with its own client certificate, no passwords),
#                port 1883 on 127.0.0.1 only (this server's Node-RED).
#   - A private certificate authority in ~/.node-red/mqtt-ca (keep it here, never commit it).
#   - A certificate bundle per machine: ~/.node-red/mqtt-ca/<line>.tar.gz -> unpack into the Pi's ~/.node-red/mqtt/
# Run as the normal user (asks for sudo):  bash deploy/install-mqtt.sh [line1] [public ip]
# Re-run with another line name to add a machine; existing certificates are kept.
set -euo pipefail
LINE=${1:-line1}
IP=${2:-$(curl -fsS -4 ifconfig.me)}
DIR=$(cd "$(dirname "$0")/.." && pwd)
CA=$DIR/mqtt-ca
[[ $LINE =~ ^[a-z0-9_-]+$ ]] || { echo "Line name: lower-case letters, digits, - or _"; exit 1; }
[ "$(id -u)" = 0 ] && { echo "Run as a normal user, not root"; exit 1; }

echo "== certificates ($CA)"
mkdir -p "$CA" && chmod 700 "$CA" && cd "$CA"
if [ ! -f ca.key ]; then
    openssl req -x509 -newkey rsa:3072 -nodes -days 3650 -subj "/CN=SoloSense MQTT CA" -keyout ca.key -out ca.crt 2>/dev/null
fi
if [ ! -f server.crt ] || ! openssl x509 -in server.crt -noout -ext subjectAltName 2>/dev/null | grep -q "IP Address:$IP"; then
    openssl req -newkey rsa:2048 -nodes -subj "/CN=$IP" -keyout server.key -out server.csr 2>/dev/null
    openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -days 3650 -out server.crt \
        -extfile <(printf 'subjectAltName=IP:%s\nextendedKeyUsage=serverAuth\n' "$IP") 2>/dev/null
fi
if [ ! -f "$LINE.crt" ]; then
    openssl req -newkey rsa:2048 -nodes -subj "/CN=$LINE" -keyout "$LINE.key" -out "$LINE.csr" 2>/dev/null
    openssl x509 -req -in "$LINE.csr" -CA ca.crt -CAkey ca.key -CAcreateserial -days 3650 -out "$LINE.crt" \
        -extfile <(printf 'extendedKeyUsage=clientAuth\n') 2>/dev/null
fi
B=$(mktemp -d)
cp ca.crt "$B/ca.crt"; cp "$LINE.crt" "$B/client.crt"; cp "$LINE.key" "$B/client.key"
tar -czf "$LINE.tar.gz" -C "$B" ca.crt client.crt client.key && rm -rf "$B"
rm -f ./*.csr

echo "== mosquitto"
command -v mosquitto >/dev/null || { sudo apt-get update -qq; sudo apt-get install -y -qq mosquitto; }
sudo install -d -m 755 /etc/mosquitto/certs
sudo install -m 644 ca.crt server.crt /etc/mosquitto/certs/
sudo install -m 640 -g mosquitto server.key /etc/mosquitto/certs/
sudo tee /etc/mosquitto/conf.d/solosense.conf >/dev/null <<CONF
# SoloSense cloud copy (deploy/install-mqtt.sh)
per_listener_settings true

# this server's Node-RED only
listener 1883 127.0.0.1
allow_anonymous true

# machines (Pis): TLS + client certificate, user name = certificate CN = line name
listener 8883
cafile /etc/mosquitto/certs/ca.crt
certfile /etc/mosquitto/certs/server.crt
keyfile /etc/mosquitto/certs/server.key
require_certificate true
use_identity_as_username true
acl_file /etc/mosquitto/solosense.acl
CONF
# each machine may only use solosense/<its line>/...
printf 'pattern readwrite solosense/%%u/#\n' | sudo tee /etc/mosquitto/solosense.acl >/dev/null
sudo chmod 644 /etc/mosquitto/solosense.acl
sudo systemctl enable -q mosquitto
sudo systemctl restart mosquitto
sleep 1; systemctl is-active mosquitto

if sudo ufw status 2>/dev/null | grep -q 'Status: active'; then sudo ufw allow 8883/tcp >/dev/null; echo "ufw: 8883/tcp allowed"; fi

cat <<NEXT

Broker ready on $IP:8883. Also open TCP 8883 in the VPS provider's firewall if it has one.
Machine bundle: $CA/$LINE.tar.gz
On the Pi:
  mkdir -p ~/.node-red/mqtt && cd ~/.node-red/mqtt
  scp $USER@$IP:$CA/$LINE.tar.gz . && tar -xzf $LINE.tar.gz && rm $LINE.tar.gz && chmod 600 client.key
  ~/.node-red/deploy/update.sh --force
NEXT
