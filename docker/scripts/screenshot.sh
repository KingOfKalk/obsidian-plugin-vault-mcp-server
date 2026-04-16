#!/usr/bin/env bash
set -euo pipefail

###############################################################################
# screenshot.sh — Capture a screenshot of the virtual display
#
# Usage:
#   ./screenshot.sh <output-path> [--delay <seconds>] [--window <name>]
#
# Examples:
#   ./screenshot.sh ./screenshots/current/settings.png
#   ./screenshot.sh ./screenshots/current/main.png --delay 3
#   ./screenshot.sh ./screenshots/current/modal.png --window "Obsidian"
###############################################################################

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT=""
DELAY=0
WINDOW_NAME=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --delay)
            DELAY="$2"
            shift 2
            ;;
        --window)
            WINDOW_NAME="$2"
            shift 2
            ;;
        *)
            OUTPUT="$1"
            shift
            ;;
    esac
done

if [[ -z "${OUTPUT}" ]]; then
    echo "Usage: screenshot.sh <output-path> [--delay <seconds>] [--window <name>]"
    exit 1
fi

# Ensure output directory exists
mkdir -p "$(dirname "${OUTPUT}")"

if [[ "${DELAY}" -gt 0 ]]; then
    echo "[screenshot] Waiting ${DELAY}s before capture..."
    sleep "${DELAY}"
fi

if [[ -n "${WINDOW_NAME}" ]]; then
    # Capture a specific window by name
    WINDOW_ID=$(xdotool search --name "${WINDOW_NAME}" 2>/dev/null | head -1 || true)
    if [[ -n "${WINDOW_ID}" ]]; then
        echo "[screenshot] Capturing window '${WINDOW_NAME}' (id: ${WINDOW_ID})"
        import -window "${WINDOW_ID}" "${OUTPUT}"
    else
        echo "[screenshot] Window '${WINDOW_NAME}' not found, capturing full screen"
        scrot --overwrite "${OUTPUT}"
    fi
else
    # Full-screen capture
    echo "[screenshot] Capturing full screen"
    scrot --overwrite "${OUTPUT}"
fi

echo "[screenshot] Saved to ${OUTPUT}"
