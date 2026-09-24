#!/usr/bin/env bash
# Builds on this machine and ships the result to the Raspberry Pi. The Pi only runs `npm install` for
# the server's pure-JavaScript dependencies; nothing is compiled there.
#
#   PI=pi@raspberrypi.local ./deploy/deploy.sh
set -euo pipefail

PI="${PI:?Set PI to the ssh target, e.g. PI=pi@raspberrypi.local}"
APP_DIR="${APP_DIR:-/opt/learnwords}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

cd "$ROOT"
npm run build

echo "Uploading to $PI:$APP_DIR"
tar -C server -czf - dist public package.json |
  ssh "$PI" "set -e
    sudo mkdir -p '$APP_DIR'
    sudo rm -rf '$APP_DIR/dist' '$APP_DIR/public'
    sudo tar -C '$APP_DIR' -xzf -
    cd '$APP_DIR'
    sudo npm install --omit=dev --no-audit --no-fund
    sudo systemctl restart learnwords
    systemctl --no-pager --lines=5 status learnwords"
