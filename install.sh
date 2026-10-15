#!/bin/bash

# Install omarchy-container-gapps for the current user. Re-run after pulling;
# it only links files, so it is safe to run again.
#   ./install.sh            everything
#   ./install.sh --no-sudo  skip the Firefox loader (already installed)

set -euo pipefail

APP_ID=omarchy-container-gapps
ROOT=$(cd "$(dirname "$0")" && pwd)
FIREFOX_DIR=/usr/lib/firefox
CONFIG_DIR=${XDG_CONFIG_HOME:-$HOME/.config}/$APP_ID
APPS_DIR=${XDG_DATA_HOME:-$HOME/.local/share}/applications
HYPR_DIR=$HOME/.config/hypr

step() { printf '\033[1m==>\033[0m %s\n' "$*"; }

# 1. Firefox loader: the only part outside $HOME. Firefox runs it in every
#    profile; it returns at once unless the profile is the app's.
if [[ ${1:-} != --no-sudo ]]; then
  step "Installing the Firefox loader into $FIREFOX_DIR (sudo)"
  sudo install -m 644 "$ROOT/system/$APP_ID.js" "$FIREFOX_DIR/defaults/pref/$APP_ID.js"
  sudo install -m 644 "$ROOT/system/$APP_ID.cfg" "$FIREFOX_DIR/$APP_ID.cfg"
fi

step "Linking the launcher into ~/.local/bin"
mkdir -p "$HOME/.local/bin"
ln -sf "$ROOT/bin/$APP_ID" "$HOME/.local/bin/$APP_ID"

step "Installing Mail and Calendar desktop entries"
mkdir -p "$APPS_DIR"
for entry in "$ROOT"/applications/*.desktop; do
  ln -sf "$entry" "$APPS_DIR/$(basename "$entry")"
done
update-desktop-database "$APPS_DIR" 2>/dev/null || true

step "Adding the window rule and keybindings to Hyprland"
ln -sf "$ROOT/hypr/$APP_ID.lua" "$HYPR_DIR/$APP_ID.lua"
if ! grep -q "require(\"hypr.$APP_ID\")" "$HYPR_DIR/hyprland.lua"; then
  printf '\n-- Mail and Calendar apps (%s)\nrequire("hypr.%s")\n' "$ROOT" "$APP_ID" >>"$HYPR_DIR/hyprland.lua"
fi

if [[ ! -f $CONFIG_DIR/accounts ]]; then
  step "Creating $CONFIG_DIR/accounts from the example"
  mkdir -p "$CONFIG_DIR"
  cp "$ROOT/accounts.example" "$CONFIG_DIR/accounts"
fi

cat <<MSG

Done. Next:
  1. List your Google accounts in $CONFIG_DIR/accounts
  2. Super+Shift+E opens Mail, Super+Shift+C opens Calendar.
     Sign in once in each pill; each account has its own container.
  3. For 1Password: $APP_ID addons, then "Add to Firefox".
MSG
