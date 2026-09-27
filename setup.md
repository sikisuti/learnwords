# SikiPortal Setup

## System setup

### Create bootable Raspberry Pi OS on either an USB pendrive or an SD card

For creating such OS Raspberry Pi Imager application required. Follow the steps:

- Select Raspberry Pi device
- Select operating system (find headless lite OS in other section)
- Select storage device (here you can choose either USB pendrive or SD card)
- Customize operating system (hostname, timezone, user, wifi, connectivity)

The application will create the bootable device. Insert it to the Raspberry Pi and give power to it. That's it!

## System configuration

### Update system

> sudo apt update
> sudo apt full-upgrade -y

### Set auto-login
> sudo raspi-config
1. Choose option 1: System Options
2. Choose option S6: Auto Login

### Install Node.js

1. Add the NodeSource repository for Node 24
  > curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
2. Install Node.js (npm comes with it)
  > sudo apt-get install -y nodejs
  
## One-time setup on the Pi

### Create a service account

> sudo useradd --system --no-create-home --shell /usr/sbin/nologin learnwords

This makes a system user learnwords with no home directory and no login shell. On Raspberry Pi OS it also creates a matching learnwords group, which the unit file uses. The app runs as this user instead of root.

### Create the app folder

> sudo mkdir -p /opt/learnwords

The code goes here. It's owned by root, and the service only reads it.

### Install the systemd unit

Copy deploy/learnwords.service to /etc/systemd/system/, for example with scp to /tmp and then sudo cp. Then run:

> sudo systemctl daemon-reload && sudo systemctl enable learnwords
  
### Passwordless sudo for pi user

On the Pi, create a separate sudoers file. Always edit sudoers through visudo, which checks the syntax before saving. A typo in a sudoers file can lock you out of sudo entirely.

> sudo visudo -f /etc/sudoers.d/010-deploy

Add this one line, with your username in place of pi, then save and exit:
  pi ALL=(ALL) NOPASSWD: ALL
  
Check that it works, still on the Pi:
  sudo -k && sudo -n true && echo OK

### Set up SSH key login to the Pi

In Git Bash:

> ssh-keygen -t ed25519

Press Enter at each prompt to accept the defaults. This creates ~/.ssh/id_ed25519 and id_ed25519.pub (~ is C:\Users\tamas.siklosi).
Copy the public key to the Pi. You'll type the Pi user's password this one time:

> cat ~/.ssh/id_ed25519.pub | ssh pi@raspberrypi.local 'mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys'

Check that login works without a password and that sudo doesn't ask for one either. Both are required, because the script runs sudo over a non-interactive SSH session:

> ssh pi@raspberrypi.local sudo -n true && echo OK

## Deploy release

Open Git Bash in the repo.

> cd /c/Sources/learnwords
> PI=pi@raspberrypi.local ./deploy/deploy.sh

The script builds locally, uploads the release to /opt/learnwords/incoming and runs deploy/install-release.sh on the Pi, which:

1. installs the release's dependencies while the current release keeps running
2. stops the app, backs up the database to /var/lib/learnwords/backups/pre-migrate (only if migrations are pending; the newest 14 are kept) and applies the pending migrations
3. moves the current release to /opt/learnwords/previous, puts the new one in place and starts it
4. waits up to 30 seconds for the app to answer on /health

If a migration fails, all of that deploy's migrations are rolled back together, the database is unchanged and the current release starts again. If the new release doesn't come up, the previous release is put back, and the database backup too if the schema changed. Either way the script ends with an error and prints the reason.

## Database schema changes

The schema is changed only by migrations in server/src/db/migrations.ts. The database stores how many have been applied (PRAGMA user_version), and each deploy applies the new ones in order. The app also applies pending migrations at startup, so the dev database and a pushed database are upgraded the same way.

To change the schema, append a migration to the list with a name and an up step: a SQL script, or a function that gets the database for changes SQL can't make on its own. Never edit, reorder or remove one that has been deployed. SQLite's ALTER TABLE can only add, rename and drop columns. For anything else (changing a constraint or a column type), rebuild the table: create the new table, copy the rows, drop the old table, rename the new one. Foreign keys are switched off while migrations run, so the drop doesn't cascade to other tables, and they are checked before the commit.

Check the migrations against real data before deploying. Copy the newest backup from the Pi and run them on it:

> scp pi@raspberrypi.local:/var/lib/learnwords/backups/learnwords-*.db /tmp/
> cd server
> node scripts/migrate-db.ts --db /tmp/learnwords-<date>.db --backup-dir /tmp/pre

Show which migrations the production database has applied:

> ssh pi@raspberrypi.local "cd /opt/learnwords && sudo -u learnwords DATA_DIR=/var/lib/learnwords node dist/scripts/migrate-db.js --status"

The app refuses to start when the database has more migrations than it knows about, for example when an older build is started on a newer database.

### Rolling back a release by hand

To go back after a deploy that succeeded but turned out to be broken, put the previous release back. If that deploy changed the schema, restore the pre-migrate backup too. Everything saved since that deploy is then lost, so fixing forward with a new release is usually better.

> ssh pi@raspberrypi.local
> sudo systemctl stop learnwords
> cd /opt/learnwords && for f in dist public package.json package-lock.json node_modules; do sudo rm -rf $f; sudo mv previous/$f .; done
> ls /var/lib/learnwords/backups/pre-migrate    # only if the schema changed: restore the newest one
> sudo install -o learnwords -g learnwords -m 640 /var/lib/learnwords/backups/pre-migrate/learnwords-<date>.db /var/lib/learnwords/learnwords.db
> sudo rm -f /var/lib/learnwords/learnwords.db-wal /var/lib/learnwords/learnwords.db-shm
> sudo systemctl start learnwords

## Upload database

PI=pi@raspberrypi.local ./deploy/push-db.sh [path/to/learnwords.db]

It uses server/data/learnwords.db by default, or you can pass a different file as the first argument.

## Database backup to Google Drive

Every night at 02:00 a systemd timer takes a snapshot of the database. It keeps the newest 14 snapshots on the Pi in /var/lib/learnwords/backups and uploads them to Google Drive, encrypted, with rclone. Snapshots older than 90 days are deleted from Drive.

### Install rclone

The Debian package is old, so use the official install script:

> sudo -v ; curl https://rclone.org/install.sh | sudo bash

### Create a Google OAuth client

rclone's built-in client is shared by everyone and rate limited, so create your own. On the PC, open https://console.cloud.google.com:

1. Create a project, for example learnwords-backup.
2. APIs & Services → Library: find Google Drive API and enable it.
3. Google Auth Platform → Branding (called OAuth consent screen on older consoles): enter an app name and your email, user type External.
4. Audience: click Publish app, so the status is In production. In Testing status Google expires the token after 7 days and the uploads stop.
5. Clients → Create client, application type Desktop app. Note the client ID and client secret.

### Create the rclone config folder

The service user has no home directory, so the config lives in /etc/learnwords. rclone writes refreshed tokens back to the file, so the service user owns the folder:

> sudo install -d -o learnwords -g learnwords -m 700 /etc/learnwords

### Add the Google Drive remote

> sudo -u learnwords rclone config --config /etc/learnwords/rclone.conf

Answer the prompts:

- n (new remote), name: gdrive
- Storage: drive
- client_id and client_secret: the values from the Google Cloud Console
- scope: drive.file (rclone only sees the files it created)
- service_account_file: leave empty
- Edit advanced config: n
- Use web browser to automatically authenticate: n (the Pi has no browser)

rclone prints a command like rclone authorize "drive" "eyJ...". Run it on the PC, which has a browser. Install rclone there first if needed:

> winget install Rclone.Rclone
> rclone authorize "drive" "eyJ...the exact string from the Pi..."

Sign in to Google. On the "Google hasn't verified this app" warning click Advanced → Go to ... (unsafe), it's your own app, then allow access. Paste the token the PC prints into the config_token prompt on the Pi. Answer n to Configure this as a Shared Drive, then y to keep the remote.

### Add the backup remote

The backup service uploads to a remote named backup. That remote decides the Drive folder (learnwords/backup) and whether the files are encrypted, so the service itself never changes. The database contains user accounts, so it's encrypted before it leaves the Pi. Run rclone config again (same command as above) and add a second remote:

- n (new remote), name: backup
- Storage: crypt
- remote: gdrive:learnwords/backup (the folder in Drive; its name stays readable, only the files inside are encrypted)
- filename_encryption: standard
- directory_name_encryption: true
- password: g to generate one
- password2 (salt): g to generate one

Save both passwords in a password manager. The config file only obscures them, and without them the backups on Drive can't be read if the Pi is lost.

For testing without encryption, make backup an alias remote instead (Storage: alias, remote: gdrive:learnwords/backup). Swap it for the crypt remote later by deleting it and adding the crypt one under the same name. Files uploaded without encryption stay readable in Drive, so delete them once the crypt remote is in place.

Don't put a remote = line in the [gdrive] section. A drive remote ignores it, and the files end up in the Drive root.

### Test the upload by hand

> sudo -u learnwords rclone --config /etc/learnwords/rclone.conf lsd gdrive:
> sudo -u learnwords rclone --config /etc/learnwords/rclone.conf copy /var/lib/learnwords/backups backup: -v
> sudo -u learnwords rclone --config /etc/learnwords/rclone.conf ls backup:

The Drive web page shows a learnwords/backup folder with scrambled file names inside (plain names with the alias remote). The last command lists the real names.

### Install the backup timer

Copy deploy/learnwords-backup.service and deploy/learnwords-backup.timer to /etc/systemd/system/, the same way as learnwords.service. Then run:

> sudo systemctl daemon-reload && sudo systemctl enable --now learnwords-backup.timer

Run a backup straight away and check its log:

> sudo systemctl start learnwords-backup.service
> journalctl -u learnwords-backup -n 30 --no-pager

Check when it runs next:

> systemctl list-timers learnwords-backup.timer

02:00 is in the Pi's time zone. Check it with timedatectl, and fix it with sudo timedatectl set-timezone <Region/City> if needed. If the Pi is off at 02:00, the backup runs at the next boot.

If an older cron entry for backup-db exists, remove it so snapshots aren't taken twice (delete the line):

> sudo crontab -u learnwords -e

### Restore from Google Drive

List the backups and download one:

> sudo -u learnwords rclone --config /etc/learnwords/rclone.conf ls backup:
> sudo -u learnwords rclone --config /etc/learnwords/rclone.conf copy backup:learnwords-<date>.db /tmp/restore/

Then restore it as described in the README (Backup and restore). On a new Pi, copy rclone.conf back to /etc/learnwords first, or set up the gdrive and backup remotes again with the same crypt passwords.

### If the uploads stop

Look at the log with journalctl -u learnwords-backup --since yesterday. An invalid_grant error means the Google token has expired. Check that the app is still In production in the Google Cloud Console, then authorize again:

> sudo -u learnwords rclone --config /etc/learnwords/rclone.conf config reconnect gdrive:
