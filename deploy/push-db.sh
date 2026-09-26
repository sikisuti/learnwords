#!/usr/bin/env bash
# Replaces the production database on the Raspberry Pi with a local database file. The current
# production database is backed up first to $DATA_DIR/backups/pre-push (the newest 14 are kept).
#
#   PI=pi@raspberrypi.local ./deploy/push-db.sh [path/to/learnwords.db]
#
# The local file defaults to server/data/learnwords.db. Set YES=1 to skip the confirmation prompt.
set -euo pipefail

PI="${PI:?Set PI to the ssh target, e.g. PI=pi@raspberrypi.local}"
APP_DIR="${APP_DIR:-/opt/learnwords}"
DATA_DIR="${DATA_DIR:-/var/lib/learnwords}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="${1:-$ROOT/server/data/learnwords.db}"

[ -f "$DB" ] || { echo "No database at $DB" >&2; exit 1; }

# Take a consistent snapshot, so changes still in a -wal file are included even if the dev server
# is running, and check its integrity before it goes anywhere.
SNAPSHOT="$DB.push-$$.tmp"
trap 'rm -f "$SNAPSHOT"' EXIT
node --disable-warning=ExperimentalWarning -e '
  const { DatabaseSync } = require("node:sqlite");
  const [src, dest] = process.argv.slice(1);
  const db = new DatabaseSync(src, { readOnly: true });
  db.prepare("VACUUM INTO ?").run(dest);
  db.close();
  const snap = new DatabaseSync(dest, { readOnly: true });
  const { integrity_check } = snap.prepare("PRAGMA integrity_check").get();
  snap.close();
  if (integrity_check !== "ok") { console.error("Integrity check failed: " + integrity_check); process.exit(1); }
' "$DB" "$SNAPSHOT"

echo "Local database: $DB ($(wc -c < "$SNAPSHOT") bytes)"
if [ "${YES:-}" != 1 ]; then
  read -r -p "Replace the production database on $PI:$DATA_DIR? [y/N] " answer
  [[ "$answer" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 1; }
fi

echo "Uploading to $PI"
ssh "$PI" "set -e
  tmp=\$(mktemp)
  trap 'rm -f \"\$tmp\"' EXIT
  cat > \"\$tmp\"

  sudo systemctl stop learnwords
  # Bring the service back even if something below fails.
  trap 'rm -f \"\$tmp\"; sudo systemctl start learnwords' EXIT

  if [ -f '$DATA_DIR/learnwords.db' ]; then
    cd '$APP_DIR'
    sudo -u learnwords DATA_DIR='$DATA_DIR' node dist/scripts/backup-db.js --dest '$DATA_DIR/backups/pre-push' --keep 14
  else
    echo 'No existing production database, skipping backup'
    sudo install -d -o learnwords -g learnwords '$DATA_DIR'
  fi

  sudo install -o learnwords -g learnwords -m 640 \"\$tmp\" '$DATA_DIR/learnwords.db'
  sudo rm -f '$DATA_DIR/learnwords.db-wal' '$DATA_DIR/learnwords.db-shm'
  echo 'Production database replaced'

  trap 'rm -f \"\$tmp\"' EXIT
  sudo systemctl start learnwords
  systemctl --no-pager --lines=5 status learnwords" < "$SNAPSHOT"
