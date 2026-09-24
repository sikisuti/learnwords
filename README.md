# learnwords

A mobile-first web app for learning foreign-language vocabulary with flash cards and spaced repetition.
It is small enough to run on a Raspberry Pi 3.

- **server/**: Node.js 24 + Fastify. It uses SQLite through the built-in `node:sqlite` module, so there are no native modules to compile. It serves the API under `/api` and the built frontend.
- **client/**: Angular 21 (standalone components, signals, zoneless). Its build output goes to `server/public`.
- **deploy/**: systemd unit and deploy script for the Pi.

See [initial-plan.md](initial-plan.md) for the functional specification.

## How learning works

- Words live in one global dictionary. Adding a word whose foreign text already exists (ignoring case and spacing) does not create a duplicate. Either way, the word goes on **your** list at stage 1, or back to stage 1 if it was already on your list.
- A session deck is built from **N** words on your list (N is set in Settings, default 5). Only words due for their next stage count: stage 1 is always due, 2→3 after 3 days, 3→4 after 1 week, 4→5 after 2 weeks, 5→6 after 1 month. The eligible words are sorted by stage. The deck takes the 3 lowest-stage words and fills the rest from the highest stages. Up to 8 known (stage 6) words are added too, the least recently seen first, one per turn.
- A session has 8 turns: 3 showing the native side first, 3 showing the foreign side first, and 2 mixed turns. In a mixed turn each card first shows a random side, then the opposite side in a second pass.
- Tap a card to flip it. Swipe right to see the card again later in this pass, and swipe down when you know it. The Again / Flip / Done buttons and the → / Space / ↓ keys do the same.
- When all turns are done, every learned word moves up one stage. Known words stay at stage 6. An unfinished session is kept in the browser and can be resumed from the home screen.

## Development

Requires Node.js 24+.

```bash
npm install
npm run build -w client          # builds the frontend into server/public
npm run dev:server               # http://localhost:3000, restarts on changes
```

To get live reload for the frontend, run `npm run dev:client` as well and open http://localhost:4200. It proxies `/api` to port 3000.

Tests:

```bash
npm test                         # server (node:test) + client (Vitest)
```

### Importing words

The import script takes a CSV (with a header row) or a JSON array. The fields are `native`, `foreign`, `definition`, `example`, `pronunciation`, `level` (A1–C2, or empty) and `lexical_category`. Only `native` and `foreign` are required. See [server/scripts/sample-words.csv](server/scripts/sample-words.csv).

```bash
npm run import -- server/scripts/sample-words.csv            # skips words that already exist
npm run import -- words.csv --update                        # overwrites existing words instead
```

Imported words go into the dictionary but not onto anyone's list. Users add them by typing on the **Add a word** screen and tapping a match.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `DATA_DIR` | `data` (relative to the working directory) | Folder that holds `learnwords.db` |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | Where the server listens |
| `PUBLIC_DIR` | `public` | Built frontend |
| `COOKIE_SECURE` | `false` | Set to `true` when served over HTTPS |
| `LOG_LEVEL` | `info` | Fastify/pino log level |

## Raspberry Pi deployment

Use the 64-bit Raspberry Pi OS (the Pi 3 Model B v1.2 supports it) with Node.js 24 installed, for example from NodeSource.

One-time setup on the Pi:

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin learnwords
sudo mkdir -p /opt/learnwords
# copy deploy/learnwords.service to /etc/systemd/system/, then:
sudo systemctl daemon-reload && sudo systemctl enable learnwords
```

Every release, from the development machine (needs `ssh` and `tar`; Git Bash works):

```bash
PI=pi@raspberrypi.local ./deploy/deploy.sh
```

This builds everything locally, uploads `dist/`, `public/` and `package.json` to `/opt/learnwords`, installs the server's dependencies (pure JavaScript) and restarts the service. The database lives in `/var/lib/learnwords`, separate from the application.

To import words on the Pi:

```bash
cd /opt/learnwords && sudo -u learnwords DATA_DIR=/var/lib/learnwords node dist/scripts/import-words.js words.csv
```

## Backup and restore

`backup-db` writes a consistent snapshot using SQLite's `VACUUM INTO`. It is safe while the app is running, and it keeps the newest 14 snapshots by default. Nightly cron entry on the Pi (`sudo crontab -u learnwords -e`):

```cron
30 3 * * * cd /opt/learnwords && DATA_DIR=/var/lib/learnwords /usr/bin/node dist/scripts/backup-db.js --keep 14
```

The backups go to `/var/lib/learnwords/backups`. Copy them off the SD card regularly (rsync to a NAS, a USB stick, and so on).

To restore:

```bash
sudo systemctl stop learnwords
sudo -u learnwords cp /path/to/learnwords-<date>.db /var/lib/learnwords/learnwords.db
sudo rm -f /var/lib/learnwords/learnwords.db-wal /var/lib/learnwords/learnwords.db-shm
sudo systemctl start learnwords
```
