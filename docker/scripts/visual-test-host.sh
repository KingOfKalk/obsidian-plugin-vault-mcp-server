#!/usr/bin/env bash
set -euo pipefail

###############################################################################
# visual-test-host.sh — Run the Docker visual-test pipeline from the host.
#
# Usage:
#   ./docker/scripts/visual-test-host.sh <command>
#
# Commands:
#   before       Build plugin, capture into docker/screenshots/before/
#   after        Build plugin, capture into docker/screenshots/after/, then diff
#   baseline     Build plugin, capture into docker/screenshots/baseline/
#   diff         Diff after/ against before/ (no capture)
#   diff-baseline  Diff after/ against baseline/
#   shell        Interactive shell in the container
#   build        Just (re)build the Docker image
#
# Output paths the agent can read:
#   docker/screenshots/before/*.png   — pre-change snapshots
#   docker/screenshots/after/*.png    — post-change snapshots
#   docker/screenshots/baseline/*.png — long-lived references (committed)
#   docker/screenshots/diff/*.png     — red-overlay diffs of changed pixels
#   docker/screenshots/{before,after,diff}/_summary.json  — machine-readable
###############################################################################

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
DOCKER_DIR="${PROJECT_ROOT}/docker"
COMPOSE="docker compose -f ${DOCKER_DIR}/docker-compose.yml"

cd "${PROJECT_ROOT}"

build_plugin() {
    echo "=== Building plugin ==="
    npm run build
    [[ -f "${PROJECT_ROOT}/styles.css" ]] || touch "${PROJECT_ROOT}/styles.css"
}

ensure_image() {
    if ! docker image inspect docker-visual-test >/dev/null 2>&1 \
        && ! ${COMPOSE} images -q visual-test 2>/dev/null | grep -q .; then
        echo "=== Building Docker image (first run) ==="
        ${COMPOSE} build visual-test
    fi
}

print_paths() {
    local kind="$1"
    local dir="${DOCKER_DIR}/screenshots/${kind}"
    if [[ -d "${dir}" ]]; then
        echo ""
        echo "Screenshots in ${dir}:"
        ls -1 "${dir}"/*.png 2>/dev/null | sed 's|^|  |' || echo "  (none)"
        if [[ -f "${dir}/_summary.json" ]]; then
            echo "  Summary: ${dir}/_summary.json"
        fi
    fi
}

cmd="${1:-}"
case "${cmd}" in
    before)
        build_plugin
        ensure_image
        ${COMPOSE} run --rm capture-before
        print_paths before
        ;;
    after)
        build_plugin
        ensure_image
        ${COMPOSE} run --rm capture-after
        ${COMPOSE} run --rm diff || true
        print_paths after
        print_paths diff
        ;;
    baseline)
        build_plugin
        ensure_image
        ${COMPOSE} run --rm capture-baseline
        print_paths baseline
        ;;
    diff)
        ensure_image
        ${COMPOSE} run --rm diff
        print_paths diff
        ;;
    diff-baseline)
        ensure_image
        ${COMPOSE} run --rm diff-baseline
        print_paths diff
        ;;
    shell)
        build_plugin
        ensure_image
        ${COMPOSE} run --rm shell
        ;;
    build)
        ${COMPOSE} build visual-test
        ;;
    *)
        echo "Usage: $0 {before|after|baseline|diff|diff-baseline|shell|build}"
        echo ""
        echo "Typical agent workflow:"
        echo "  $0 before     # snapshot the current UI"
        echo "  # ...edit code, run tests..."
        echo "  $0 after      # snapshot again, auto-diffs against before/"
        echo ""
        echo "  Then read docker/screenshots/{before,after,diff}/*.png"
        exit 1
        ;;
esac
