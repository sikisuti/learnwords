#!/usr/bin/env bash
# Runs on the Raspberry Pi as root (deploy.sh starts it) and switches the app to the release unpacked in
# $APP_DIR/incoming:
#   1. installs the release's dependencies while the current release keeps running
#   2. stops the app, backs up the database and applies the pending migrations with the new release; they
#      run in one transaction, so if one fails the database is unchanged and the current release starts again
#   3. moves the current release to $APP_DIR/previous, puts the new one in place and starts it
#   4. if it does not answer on /health, puts the previous release back, and the pre-migration backup
#      too if the schema changed, and starts that
set -euo pipefail

APP_DIR="${APP_DIR:?}"
DATA_DIR="${DATA_DIR:?}"
PORT="${PORT:-80}"
NEW="$APP_DIR/incoming"
OLD="$APP_DIR/previous"
DB="$DATA_DIR/learnwords.db"
BACKUP_DIR="$DATA_DIR/backups/pre-migrate"
RELEASE_FILES=(dist public package.json package-lock.json node_modules)
NODE=(node --disable-warning=ExperimentalWarning)

as_app() { sudo -u learnwords DATA_DIR="$DATA_DIR" "$@"; }

schema_version() {
  if [ -f "$DB" ]; then
    "${NODE[@]}" -e 'const { DatabaseSync } = require("node:sqlite");
      console.log(new DatabaseSync(process.argv[1], { readOnly: true }).prepare("PRAGMA user_version").get().user_version);' "$DB"
  else
    echo 0
  fi
}

# The service must be running (not crash-looping) and answer /health; checked for up to 30 seconds.
healthy() {
  for _ in $(seq 1 30); do
    if systemctl is-active --quiet learnwords &&
      "${NODE[@]}" -e 'fetch(process.argv[1]).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))' \
        "http://127.0.0.1:$PORT/health"; then
      # Still up a few seconds later, so it did not answer just before crashing.
      sleep 3
      systemctl is-active --quiet learnwords && return 0
    fi
    sleep 1
  done
  return 1
}

cd "$NEW"
npm install --omit=dev --no-audit --no-fund
install -d -o learnwords -g learnwords "$DATA_DIR"

systemctl stop learnwords
# Whatever happens from here on, don't leave the app stopped.
trap 'systemctl start learnwords' EXIT

before=$(schema_version)
if ! as_app "${NODE[@]}" "$NEW/dist/scripts/migrate-db.js" --backup-dir "$BACKUP_DIR"; then
  echo "Migration failed, the database is unchanged. Starting the current release again." >&2
  exit 1
fi
after=$(schema_version)

rm -rf "$OLD"
mkdir "$OLD"
for f in "${RELEASE_FILES[@]}"; do
  if [ -e "$APP_DIR/$f" ]; then mv "$APP_DIR/$f" "$OLD/"; fi
  if [ -e "$NEW/$f" ]; then mv "$NEW/$f" "$APP_DIR/"; fi
done
rm -rf "$NEW"

systemctl start learnwords
if healthy; then
  echo "Release is up, schema version $after (was $before). The previous release is in $OLD."
  systemctl --no-pager --lines=5 status learnwords
  exit 0
fi

echo "The new release does not answer on /health; rolling back." >&2
journalctl -u learnwords -n 20 --no-pager >&2 || true
systemctl stop learnwords
if [ "$before" != "$after" ]; then
  # The newest backup is the one migrate-db.js just made (names sort by time; globs expand sorted).
  shopt -s nullglob
  backups=("$BACKUP_DIR"/learnwords-*.db)
  backup="${backups[-1]:-}"
  rm -f "$DB-wal" "$DB-shm"
  if [ "$before" = 0 ] || [ -z "$backup" ]; then
    rm -f "$DB"
    echo "Removed the database the new release created." >&2
  else
    install -o learnwords -g learnwords -m 640 "$backup" "$DB"
    echo "Database restored from $backup (schema version $before)." >&2
  fi
fi
for f in "${RELEASE_FILES[@]}"; do
  rm -rf "${APP_DIR:?}/$f"
  if [ -e "$OLD/$f" ]; then mv "$OLD/$f" "$APP_DIR/"; fi
done
rmdir "$OLD"
echo "Previous release restored." >&2
exit 1
