#!/usr/bin/env bash
# Builds on this machine and ships the result to the Raspberry Pi. The Pi only runs `npm install` for
# the server's pure-JavaScript dependencies; nothing is compiled there.
#
#   PI=pi@raspberrypi.local ./deploy/deploy.sh
#
# The release is unpacked next to the running one and switched in by deploy/install-release.sh, which also
# applies pending database migrations (after a backup) and rolls everything back if the new release fails.
set -euo pipefail

PI="${PI:?Set PI to the ssh target, e.g. PI=pi@raspberrypi.local}"
APP_DIR="${APP_DIR:-/opt/learnwords}"
DATA_DIR="${DATA_DIR:-/var/lib/learnwords}"
PORT="${PORT:-80}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

cd "$ROOT"
npm run build

echo "Uploading to $PI:$APP_DIR"
tar -czf - -C server dist public package.json -C ../deploy install-release.sh |
  ssh "$PI" "set -e
    sudo rm -rf '$APP_DIR/incoming'
    sudo mkdir -p '$APP_DIR/incoming'
    sudo tar -C '$APP_DIR/incoming' -xzf -
    sudo APP_DIR='$APP_DIR' DATA_DIR='$DATA_DIR' PORT='$PORT' bash '$APP_DIR/incoming/install-release.sh'"
