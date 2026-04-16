#!/usr/bin/env bash
set -euo pipefail

###############################################################################
# visual-test-host.sh — Run visual regression tests from the host machine
#
# Usage:
#   ./docker/scripts/visual-test-host.sh [baseline|compare|shell]
#
# Commands:
#   baseline  — Build plugin, launch Obsidian in Docker, save baseline screenshots
#   compare   — Build plugin, launch Obsidian in Docker, compare against baseline
#   shell     — Build plugin, open an interactive shell in the container
#
# This script should be run from the project root directory.
###############################################################################

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
DOCKER_DIR="${PROJECT_ROOT}/docker"

COMMAND="${1:-compare}"

# Ensure we're in the project root
cd "${PROJECT_ROOT}"

###############################################################################
# Step 1: Build the plugin
###############################################################################
echo "=== Building plugin ==="
npm run build

# Ensure styles.css exists (may be empty)
if [[ ! -f "${PROJECT_ROOT}/styles.css" ]]; then
    touch "${PROJECT_ROOT}/styles.css"
fi

###############################################################################
# Step 2: Build Docker image (if needed)
###############################################################################
echo ""
echo "=== Building Docker image ==="
docker compose -f "${DOCKER_DIR}/docker-compose.yml" build visual-test

###############################################################################
# Step 3: Run the requested command
###############################################################################
echo ""
case "${COMMAND}" in
    baseline)
        echo "=== Capturing baseline screenshots ==="
        docker compose -f "${DOCKER_DIR}/docker-compose.yml" run --rm update-baseline
        echo ""
        echo "Baseline screenshots saved to docker/screenshots/baseline/"
        echo "Commit these to track visual changes over time."
        ;;
    compare)
        echo "=== Running visual comparison ==="
        docker compose -f "${DOCKER_DIR}/docker-compose.yml" run --rm compare
        ;;
    shell)
        echo "=== Opening interactive shell ==="
        echo "Tips:"
        echo "  - Run 'obsidian --no-sandbox --disable-gpu &' to start Obsidian"
        echo "  - Run './scripts/screenshot.sh /tmp/test.png' to take a screenshot"
        echo "  - Screenshots are available at docker/screenshots/ on the host"
        echo ""
        docker compose -f "${DOCKER_DIR}/docker-compose.yml" run --rm shell
        ;;
    *)
        echo "Unknown command: ${COMMAND}"
        echo "Usage: $0 [baseline|compare|shell]"
        exit 1
        ;;
esac
