#!/usr/bin/env bash
set -euo pipefail

###############################################################################
# entrypoint.sh — Boot the headless display, then exec the given command.
#
# Starts:
#   1. Xvfb on $DISPLAY ($SCREEN_WIDTH x $SCREEN_HEIGHT x $SCREEN_DEPTH)
#   2. A D-Bus session (Electron warns loudly without one)
#   3. fluxbox — gives Obsidian a real window so it actually paints
#
# The Python orchestration scripts (bootstrap.py, run_visual_test.py) take it
# from there. Screenshots come from CDP's Page.captureScreenshot, so we don't
# need scrot, imagemagick, or xdotool at runtime — they're kept in the image
# only as fallbacks for ad-hoc debugging.
###############################################################################

echo "[entrypoint] Xvfb on ${DISPLAY} (${SCREEN_WIDTH}x${SCREEN_HEIGHT}x${SCREEN_DEPTH})"
Xvfb "${DISPLAY}" -screen 0 "${SCREEN_WIDTH}x${SCREEN_HEIGHT}x${SCREEN_DEPTH}" \
    -ac +extension GLX +render -noreset &

# Wait for the X server to be reachable
for _ in $(seq 1 30); do
    if xdpyinfo -display "${DISPLAY}" >/dev/null 2>&1; then
        break
    fi
    sleep 0.2
done
xdpyinfo -display "${DISPLAY}" >/dev/null 2>&1 || {
    echo "[entrypoint] ERROR: Xvfb failed to start"
    exit 1
}
echo "[entrypoint] Xvfb ready"

# D-Bus session (Electron complains without it; not strictly required)
eval "$(dbus-launch --sh-syntax 2>/dev/null)" || true

# Lightweight WM so Obsidian gets a properly mapped window
fluxbox &>/dev/null &
sleep 0.3

exec "$@"
