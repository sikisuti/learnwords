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