#!/usr/bin/env bash
# Reactor Control station setup for Raspberry Pi OS (64-bit, Desktop, Bookworm/Trixie, labwc/Wayland)
# Run once as the normal desktop user (not root):   STATION_NAME=hephaestus bash setup-station.sh
# See docs/DESIGN.md: "Station names" (D38) and "Station setup" (D39).
# Re-running is safe; it overwrites its own files.
set -euo pipefail

# ---------- settings (edit or override via env vars) ----------
APP_URL="${APP_URL:-https://polynicolaas.github.io/reactor-control/}"
STATION_NAME="${STATION_NAME:-}"            # a forge name from docs/DESIGN.md "Station names", e.g. hephaestus ; blank = keep current hostname
WINDOW_MODE="${WINDOW_MODE:-app}"           # app = borderless window users can still leave; kiosk = full lock-down
HEADLESS_RES="${HEADLESS_RES:-1920x1080}"   # resolution forced when no monitor is attached ("" to skip)

if [[ $EUID -eq 0 ]]; then echo "Run as your desktop user, not root."; exit 1; fi
USER_HOME="$HOME"

echo "==> Station: ${STATION_NAME:-$(hostname)}  URL: $APP_URL"

# ---------- hostname ----------
if [[ -n "$STATION_NAME" ]]; then
  sudo raspi-config nonint do_hostname "$STATION_NAME"
fi

# ---------- Wi-Fi (optional, interactive) ----------
read -rp "Add a Wi-Fi network now? [y/N] " addwifi
if [[ "${addwifi,,}" == "y" ]]; then
  read -rp "SSID: " SSID
  read -rp "Enterprise (username+password, e.g. eduroam)? [y/N] " ent
  if [[ "${ent,,}" == "y" ]]; then
    read -rp "Identity (username): " WID
    read -rsp "Password: " WPW; echo
    sudo nmcli connection delete "$SSID" >/dev/null 2>&1 || true
    sudo nmcli connection add type wifi con-name "$SSID" ifname wlan0 ssid "$SSID" \
      wifi-sec.key-mgmt wpa-eap 802-1x.eap peap 802-1x.phase2-auth mschapv2 \
      802-1x.identity "$WID" 802-1x.password "$WPW" connection.autoconnect yes
  else
    read -rsp "Password: " WPW; echo
    sudo nmcli connection delete "$SSID" >/dev/null 2>&1 || true
    sudo nmcli connection add type wifi con-name "$SSID" ifname wlan0 ssid "$SSID" \
      wifi-sec.key-mgmt wpa-psk wifi-sec.psk "$WPW" connection.autoconnect yes
  fi
  sudo nmcli connection up "$SSID" || echo "   (couldn't connect yet; it will retry on boot)"
fi

# ---------- desktop autologin, VNC, no screen blanking ----------
echo "==> Enabling desktop autologin, VNC, disabling blanking"
sudo raspi-config nonint do_boot_behaviour B4   # desktop, auto-login
sudo raspi-config nonint do_vnc 0               # wayvnc on Wayland
sudo raspi-config nonint do_blanking 1          # 1 = disable blanking

# ---------- serial port access for Web Serial ----------
sudo usermod -aG dialout "$USER"

# ---------- force a display when headless (VNC needs one to exist) ----------
if [[ -n "$HEADLESS_RES" ]]; then
  CMDLINE=/boot/firmware/cmdline.txt
  if ! grep -q "video=HDMI-A-1:" "$CMDLINE"; then
    echo "==> Forcing HDMI-A-1 at ${HEADLESS_RES} for headless VNC"
    sudo sed -i "1 s|\$| video=HDMI-A-1:${HEADLESS_RES}@60D|" "$CMDLINE"
  fi
fi

# ---------- browser launcher ----------
BROWSER="$(command -v chromium || command -v chromium-browser || true)"
if [[ -z "$BROWSER" ]]; then
  sudo apt-get update && sudo apt-get install -y chromium
  BROWSER="$(command -v chromium)"
fi

mkdir -p "$USER_HOME/.local/bin" "$USER_HOME/.config/labwc"
LAUNCHER="$USER_HOME/.local/bin/reactor-control-launch.sh"

FINAL_NAME="${STATION_NAME:-$(hostname)}"
SEP="?"; [[ "$APP_URL" == *\?* ]] && SEP="&"
STATION_URL="${APP_URL}${SEP}station=${FINAL_NAME}"

cat > "$LAUNCHER" <<EOF
#!/usr/bin/env bash
# Opens Reactor Control and reopens it if the window is closed.
URL="$STATION_URL"
BROWSER="$BROWSER"
MODE="$WINDOW_MODE"
PROFILE="\$HOME/.config/reactor-control-browser"
LOG="\$HOME/.cache/reactor-control-launch.log"
mkdir -p "\$PROFILE" "\$(dirname "\$LOG")"

# wait for the network (up to ~2 min), then open anyway so the page can show its own error
for i in \$(seq 1 60); do
  curl -fsI --max-time 3 "\$URL" >/dev/null 2>&1 && break
  sleep 2
done

while true; do
  # clean up after power cuts so Chromium doesn't complain or show the "restore" bar
  rm -f "\$PROFILE"/Singleton* 2>/dev/null
  sed -i 's/"exit_type":"Crashed"/"exit_type":"Normal"/; s/"exited_cleanly":false/"exited_cleanly":true/' \
    "\$PROFILE/Default/Preferences" 2>/dev/null

  if [[ "\$MODE" == "kiosk" ]]; then WIN=(--kiosk "\$URL"); else WIN=(--app="\$URL" --start-maximized); fi

  "\$BROWSER" --user-data-dir="\$PROFILE" \\
    --noerrdialogs --disable-session-crashed-bubble --disable-infobars \\
    --no-first-run --password-store=basic --ozone-platform=wayland \\
    "\${WIN[@]}" >>"\$LOG" 2>&1

  echo "\$(date) browser exited; relaunching in 3 s" >>"\$LOG"
  sleep 3
done
EOF
chmod +x "$LAUNCHER"

# ---------- autostart in the labwc session ----------
AUTOSTART="$USER_HOME/.config/labwc/autostart"
touch "$AUTOSTART"
sed -i '/reactor-control-launch.sh/d' "$AUTOSTART"
echo "$LAUNCHER &" >> "$AUTOSTART"

echo
echo "==> Done. Reboot with:  sudo reboot"
echo "    VNC: connect to $( [[ -n "$STATION_NAME" ]] && echo "$STATION_NAME" || hostname ).local with this user's login."
echo "    Log: ~/.cache/reactor-control-launch.log"
