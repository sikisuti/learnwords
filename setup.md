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

## Upload database

PI=pi@raspberrypi.local ./deploy/push-db.sh [path/to/learnwords.db]

It uses server/data/learnwords.db by default, or you can pass a different file as the first argument.