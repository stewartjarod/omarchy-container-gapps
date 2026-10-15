#!/bin/bash

# Remove omarchy-container-gapps. Keeps the accounts file and the Firefox
# profile (your sign-ins) unless --purge is given.

set -euo pipefail

APP_ID=omarchy-container-gapps
CONFIG_DIR=${XDG_CONFIG_HOME:-$HOME/.config}/$APP_ID
DATA_DIR=${XDG_DATA_HOME:-$HOME/.local/share}/$APP_ID
APPS_DIR=${XDG_DATA_HOME:-$HOME/.local/share}/applications
HYPR_DIR=$HOME/.config/hypr

sudo rm -f "/usr/lib/firefox/defaults/pref/$APP_ID.js" "/usr/lib/firefox/$APP_ID.cfg"
rm -f "$HOME/.local/bin/$APP_ID" "$APPS_DIR/$APP_ID-"*.desktop "$HYPR_DIR/$APP_ID.lua"
sed -i "/^-- Mail and Calendar apps (/d; /^require(\"hypr.$APP_ID\")$/d" "$HYPR_DIR/hyprland.lua"

if [[ ${1:-} == --purge ]]; then
  rm -rf "$CONFIG_DIR" "$DATA_DIR"
fi
echo "Removed $APP_ID. Restore your own Super+Shift+E/C bindings in $HYPR_DIR/bindings.lua if you want them back."
