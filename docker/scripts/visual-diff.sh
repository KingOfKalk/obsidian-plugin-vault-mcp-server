#!/usr/bin/env bash
set -euo pipefail

###############################################################################
# visual-diff.sh — Compare two screenshots and produce a diff image
#
# Usage:
#   ./visual-diff.sh <baseline> <current> [--diff <diff-output>] [--threshold <fuzz%>]
#
# Exit codes:
#   0 — images match (within threshold)
#   1 — images differ
#   2 — error (missing files, etc.)
#
# Examples:
#   ./visual-diff.sh screenshots/baseline/main.png screenshots/current/main.png
#   ./visual-diff.sh before.png after.png --diff diff.png --threshold 5
###############################################################################

BASELINE=""
CURRENT=""
DIFF_OUTPUT=""
THRESHOLD="2"  # fuzz percentage for minor anti-aliasing differences

while [[ $# -gt 0 ]]; do
    case "$1" in
        --diff)
            DIFF_OUTPUT="$2"
            shift 2
            ;;
        --threshold)
            THRESHOLD="$2"
            shift 2
            ;;
        *)
            if [[ -z "${BASELINE}" ]]; then
                BASELINE="$1"
            elif [[ -z "${CURRENT}" ]]; then
                CURRENT="$1"
            fi
            shift
            ;;
    esac
done

if [[ -z "${BASELINE}" || -z "${CURRENT}" ]]; then
    echo "Usage: visual-diff.sh <baseline> <current> [--diff <diff-output>] [--threshold <fuzz%>]"
    exit 2
fi

if [[ ! -f "${BASELINE}" ]]; then
    echo "[visual-diff] ERROR: Baseline not found: ${BASELINE}"
    exit 2
fi

if [[ ! -f "${CURRENT}" ]]; then
    echo "[visual-diff] ERROR: Current not found: ${CURRENT}"
    exit 2
fi

# Default diff output path
if [[ -z "${DIFF_OUTPUT}" ]]; then
    BASENAME="$(basename "${CURRENT}" .png)"
    DIFF_OUTPUT="$(dirname "${CURRENT}")/../diff/${BASENAME}-diff.png"
fi

mkdir -p "$(dirname "${DIFF_OUTPUT}")"

echo "[visual-diff] Comparing:"
echo "  Baseline: ${BASELINE}"
echo "  Current:  ${CURRENT}"
echo "  Threshold: ${THRESHOLD}%"

# ImageMagick compare — outputs the number of differing pixels
# The -metric AE (Absolute Error) counts pixels that differ
PIXEL_DIFF=$(compare -fuzz "${THRESHOLD}%" -metric AE \
    "${BASELINE}" "${CURRENT}" "${DIFF_OUTPUT}" 2>&1 || true)

# Parse pixel count (compare writes it to stderr)
PIXEL_COUNT=$(echo "${PIXEL_DIFF}" | grep -oP '[\d.e+]+' | head -1 || echo "0")

echo "[visual-diff] Pixel difference: ${PIXEL_COUNT}"
echo "[visual-diff] Diff image: ${DIFF_OUTPUT}"

# Check if the difference is zero (or very close)
if [[ "${PIXEL_COUNT}" == "0" ]] || [[ "${PIXEL_COUNT}" == "0.0" ]]; then
    echo "[visual-diff] PASS — images match"
    exit 0
else
    echo "[visual-diff] FAIL — images differ by ${PIXEL_COUNT} pixels"
    exit 1
fi
