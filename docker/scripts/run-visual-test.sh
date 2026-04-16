#!/usr/bin/env bash
set -euo pipefail

###############################################################################
# run-visual-test.sh — Full visual regression test workflow
#
# Usage:
#   ./run-visual-test.sh [--update-baseline] [--timeout <seconds>]
#
# This script:
#   1. Installs the built plugin into the test vault
#   2. Launches Obsidian with the test vault
#   3. Waits for Obsidian to fully render
#   4. Takes screenshots of key UI states
#   5. Compares against baseline (unless --update-baseline is set)
#   6. Produces a summary report
###############################################################################

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="/home/obsidian/plugin"
VAULT_DIR="/home/obsidian/vault"
SCREENSHOTS_DIR="/home/obsidian/screenshots"
UPDATE_BASELINE=false
OBSIDIAN_TIMEOUT=30

while [[ $# -gt 0 ]]; do
    case "$1" in
        --update-baseline)
            UPDATE_BASELINE=true
            shift
            ;;
        --timeout)
            OBSIDIAN_TIMEOUT="$2"
            shift 2
            ;;
        *)
            shift
            ;;
    esac
done

VAULT_PLUGIN_DIR="${VAULT_DIR}/.obsidian/plugins/obsidian-mcp"

###############################################################################
# Step 1: Install plugin into vault
###############################################################################
echo "=== Step 1: Installing plugin into test vault ==="
mkdir -p "${VAULT_PLUGIN_DIR}"

for file in main.js manifest.json styles.css; do
    if [[ -f "${PLUGIN_DIR}/${file}" ]]; then
        cp "${PLUGIN_DIR}/${file}" "${VAULT_PLUGIN_DIR}/"
        echo "  Copied ${file}"
    fi
done

# Enable the plugin in Obsidian config
COMMUNITY_PLUGINS="${VAULT_DIR}/.obsidian/community-plugins.json"
if [[ ! -f "${COMMUNITY_PLUGINS}" ]] || ! grep -q "obsidian-mcp" "${COMMUNITY_PLUGINS}" 2>/dev/null; then
    echo '["obsidian-mcp"]' > "${COMMUNITY_PLUGINS}"
    echo "  Enabled obsidian-mcp in community-plugins.json"
fi

###############################################################################
# Step 2: Launch Obsidian
###############################################################################
echo ""
echo "=== Step 2: Launching Obsidian ==="

# Launch Obsidian with the test vault, disable GPU (needed in Docker)
obsidian --no-sandbox --disable-gpu --disable-software-rasterizer \
    "obsidian://open?path=${VAULT_DIR}" &>/tmp/obsidian.log &
OBSIDIAN_PID=$!

echo "  Obsidian PID: ${OBSIDIAN_PID}"

###############################################################################
# Step 3: Wait for Obsidian to render
###############################################################################
echo ""
echo "=== Step 3: Waiting for Obsidian to start ==="

STARTED=false
for i in $(seq 1 "${OBSIDIAN_TIMEOUT}"); do
    if xdotool search --name "Obsidian" >/dev/null 2>&1; then
        STARTED=true
        echo "  Obsidian window detected after ${i}s"
        break
    fi
    sleep 1
done

if [[ "${STARTED}" != "true" ]]; then
    echo "  WARNING: Obsidian window not detected within ${OBSIDIAN_TIMEOUT}s"
    echo "  Continuing anyway (Obsidian may use a different window title)..."
fi

# Give the UI extra time to fully render
echo "  Waiting 5s for UI to settle..."
sleep 5

###############################################################################
# Step 4: Capture screenshots
###############################################################################
echo ""
echo "=== Step 4: Capturing screenshots ==="

TARGET_DIR="${SCREENSHOTS_DIR}/current"
if [[ "${UPDATE_BASELINE}" == "true" ]]; then
    TARGET_DIR="${SCREENSHOTS_DIR}/baseline"
    echo "  Mode: UPDATING BASELINE"
else
    echo "  Mode: CAPTURING CURRENT (for comparison)"
fi

mkdir -p "${TARGET_DIR}"

# Screenshot 1: Main window — full application state
"${SCRIPT_DIR}/screenshot.sh" "${TARGET_DIR}/01-main-window.png"

# Screenshot 2: Try to open settings (Ctrl+,)
xdotool key ctrl+comma
sleep 2
"${SCRIPT_DIR}/screenshot.sh" "${TARGET_DIR}/02-settings-open.png"

# Screenshot 3: Navigate to plugin settings (search for MCP)
# Type in the settings search to find our plugin
xdotool key Escape
sleep 0.5

# Open community plugins settings directly via command palette
xdotool key ctrl+p
sleep 1
xdotool type --delay 50 "community plugins"
sleep 1
xdotool key Return
sleep 2
"${SCRIPT_DIR}/screenshot.sh" "${TARGET_DIR}/03-community-plugins.png"

# Screenshot 4: Try to open our plugin's settings
xdotool key Escape
sleep 0.5
xdotool key ctrl+comma
sleep 1
# Click through settings to find plugin config (navigate via keyboard)
"${SCRIPT_DIR}/screenshot.sh" "${TARGET_DIR}/04-plugin-settings.png"

# Close settings
xdotool key Escape
sleep 0.5

# Screenshot 5: Command palette
xdotool key ctrl+p
sleep 1
"${SCRIPT_DIR}/screenshot.sh" "${TARGET_DIR}/05-command-palette.png"
xdotool key Escape
sleep 0.5

echo "  Captured 5 screenshots to ${TARGET_DIR}/"

###############################################################################
# Step 5: Compare against baseline (unless updating)
###############################################################################
echo ""
PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0

if [[ "${UPDATE_BASELINE}" == "true" ]]; then
    echo "=== Step 5: Baseline updated — skipping comparison ==="
    echo "  Screenshots saved to ${SCREENSHOTS_DIR}/baseline/"
else
    echo "=== Step 5: Comparing against baseline ==="
    mkdir -p "${SCREENSHOTS_DIR}/diff"

    for current_file in "${SCREENSHOTS_DIR}/current/"*.png; do
        basename="$(basename "${current_file}")"
        baseline_file="${SCREENSHOTS_DIR}/baseline/${basename}"

        if [[ ! -f "${baseline_file}" ]]; then
            echo "  SKIP: ${basename} (no baseline)"
            SKIP_COUNT=$((SKIP_COUNT + 1))
            continue
        fi

        if "${SCRIPT_DIR}/visual-diff.sh" "${baseline_file}" "${current_file}" \
            --diff "${SCREENSHOTS_DIR}/diff/${basename}"; then
            PASS_COUNT=$((PASS_COUNT + 1))
        else
            FAIL_COUNT=$((FAIL_COUNT + 1))
        fi
    done
fi

###############################################################################
# Step 6: Cleanup
###############################################################################
echo ""
echo "=== Step 6: Cleanup ==="
kill "${OBSIDIAN_PID}" 2>/dev/null || true
wait "${OBSIDIAN_PID}" 2>/dev/null || true
echo "  Obsidian stopped"

###############################################################################
# Summary
###############################################################################
echo ""
echo "==========================================="
echo "  Visual Regression Test Summary"
echo "==========================================="
if [[ "${UPDATE_BASELINE}" == "true" ]]; then
    echo "  Baseline updated with current screenshots"
    TOTAL=$(find "${SCREENSHOTS_DIR}/baseline/" -name "*.png" | wc -l)
    echo "  Total screenshots: ${TOTAL}"
else
    echo "  Passed: ${PASS_COUNT}"
    echo "  Failed: ${FAIL_COUNT}"
    echo "  Skipped: ${SKIP_COUNT}"

    if [[ "${FAIL_COUNT}" -gt 0 ]]; then
        echo ""
        echo "  Diff images saved to ${SCREENSHOTS_DIR}/diff/"
        echo "  Review the diffs to see what changed."
        exit 1
    fi
fi
echo "==========================================="
