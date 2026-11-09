#!/usr/bin/env bash
# System packages for the headless Obsidian E2E tests (#441): Xvfb plus the
# Electron runtime libraries. Idempotent; run by the CI e2e job and by hand.
# Package names (t64) need Debian trixie or Ubuntu 24.04 or newer.
set -euo pipefail

packages=(
  xvfb xauth
  libnss3 libgtk-3-0t64 libgbm1 libasound2t64 libxss1 libxtst6 libsecret-1-0
  libdrm2 libxkbcommon0 libatk-bridge2.0-0t64 libcups2t64
)

if dpkg -s "${packages[@]}" >/dev/null 2>&1; then
  echo "E2E dependencies already installed"
  exit 0
fi

# As root (e.g. in a container) run apt-get directly: sudo may not exist.
sudo=()
if [ "$(id -u)" -ne 0 ]; then
  sudo=(sudo)
fi

"${sudo[@]}" apt-get update -qq
"${sudo[@]}" env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "${packages[@]}"
