#!/usr/bin/env bash
set -euo pipefail

###############################################################################
# entrypoint.sh — Start Xvfb + Fluxbox, then run the given command
###############################################################################

echo "[entrypoint] Starting Xvfb on display ${DISPLAY} (${SCREEN_WIDTH}x${SCREEN_HEIGHT}x${SCREEN_DEPTH})"
Xvfb "${DISPLAY}" -screen 0 "${SCREEN_WIDTH}x${SCREEN_HEIGHT}x${SCREEN_DEPTH}" -ac +extension GLX +render -noreset &
XVFB_PID=$!

# Wait for Xvfb to be ready
for i in $(seq 1 30); do
    if xdpyinfo -display "${DISPLAY}" >/dev/null 2>&1; then
        break
    fi
    sleep 0.2
done

if ! xdpyinfo -display "${DISPLAY}" >/dev/null 2>&1; then
    echo "[entrypoint] ERROR: Xvfb failed to start"
    exit 1
fi
echo "[entrypoint] Xvfb is ready"

# Start D-Bus session (required by Electron)
eval "$(dbus-launch --sh-syntax)" || true

# Start a lightweight window manager so windows get proper frames/placement
fluxbox &>/dev/null &
sleep 0.5

echo "[entrypoint] Display environment ready"

# Run whatever command was passed
exec "$@"
