-- omarchy-container-gapps: window rule and keybindings for the Mail and
-- Calendar apps. install.sh links this into ~/.config/hypr/ and requires it
-- from hyprland.lua after the user's bindings.

-- Opaque like other browsers; Omarchy's default opacity lets the wallpaper
-- show through the page.
o.window("^omarchy-container-gapps$", { tag = "-default-opacity", opacity = "1.0 0.985" })

-- Replace the HEY / Chromium webapp bindings for email and calendar.
hl.unbind("SUPER + SHIFT + E")
hl.unbind("SUPER + SHIFT + ALT + E")
hl.unbind("SUPER + SHIFT + C")
o.bind("SUPER + SHIFT + E", "Email", "omarchy-container-gapps mail")
o.bind("SUPER + SHIFT + ALT + E", "New email", "omarchy-container-gapps mail --compose")
o.bind("SUPER + SHIFT + C", "Calendar", "omarchy-container-gapps calendar")
