#!/usr/bin/env python3
"""
bootstrap.py — Start Obsidian, dismiss first-run modals, enable our plugin.

Usage:
    bootstrap.py [--vault PATH] [--port 9222] [--timeout 60]

What it does:
    1. Verifies Xvfb is running on $DISPLAY
    2. Launches Obsidian with --remote-debugging-port and --no-sandbox
    3. Connects via CDP and waits for the renderer to be ready
    4. Clicks "Trust author and enable plugins" if the dialog is showing
    5. Disables Restricted Mode (community plugins)
    6. Enables the obsidian-mcp plugin
    7. Prints the CDP port on stdout when ready

After this finishes, other scripts (screenshot.py, run_visual_test.py) can
connect to the same CDP port to interact with the running Obsidian.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
import time

from obsidian_cdp import ObsidianCDP, ObsidianCDPError

DEFAULT_VAULT = "/home/obsidian/vault"
DEFAULT_PORT = int(os.environ.get("OBSIDIAN_DEBUG_PORT", "9222"))


def wait_for_xvfb(display: str, timeout: float = 10.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        result = subprocess.run(
            ["xdpyinfo", "-display", display],
            capture_output=True,
        )
        if result.returncode == 0:
            return True
        time.sleep(0.2)
    return False


def launch_obsidian(vault: str, port: int) -> subprocess.Popen[bytes]:
    log = open("/tmp/obsidian-bootstrap.log", "wb")
    return subprocess.Popen(
        [
            "obsidian",
            "--no-sandbox",
            "--disable-gpu",
            "--disable-software-rasterizer",
            f"--remote-debugging-port={port}",
            "--remote-allow-origins=*",
            f"obsidian://open?path={vault}",
        ],
        stdout=log,
        stderr=subprocess.STDOUT,
        env={**os.environ, "DISPLAY": os.environ.get("DISPLAY", ":99")},
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--vault", default=DEFAULT_VAULT)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--timeout", type=float, default=60.0)
    parser.add_argument(
        "--no-launch",
        action="store_true",
        help="Skip launching Obsidian; assume it's already running",
    )
    args = parser.parse_args()

    display = os.environ.get("DISPLAY", ":99")
    if not wait_for_xvfb(display):
        print(f"ERROR: Xvfb not responding on {display}", file=sys.stderr)
        return 1

    if not args.no_launch:
        proc = launch_obsidian(args.vault, args.port)
        print(f"Launched Obsidian (PID {proc.pid}) on CDP port {args.port}")

    # Connect (this retries until Obsidian's debugger is ready)
    try:
        cdp = ObsidianCDP(port=args.port, connect_timeout=args.timeout)
    except ObsidianCDPError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1

    # Wait for the Obsidian renderer to fully initialize the `app` global
    if not cdp.wait_for("typeof app !== 'undefined' && !!app.workspace", timeout=30):
        print("ERROR: Obsidian app object never became available", file=sys.stderr)
        return 1

    print("Obsidian app ready, dismissing first-run dialogs...")
    # First-run trust dialog (only present the first time a vault is opened)
    if cdp.accept_trust_dialog():
        print("  - Accepted trust dialog")
        time.sleep(1.5)

    # Make sure community plugins can run
    try:
        cdp.enable_community_plugins()
        print("  - Restricted Mode disabled")
    except ObsidianCDPError as e:
        print(f"  - Warning: could not disable restricted mode: {e}")

    # Enable our plugin
    try:
        enabled = cdp.enable_plugin("obsidian-mcp")
        print(f"  - Enabled plugins: {enabled}")
    except ObsidianCDPError as e:
        print(f"  - Warning: could not enable obsidian-mcp: {e}")

    cdp.close()
    print(f"READY port={args.port}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
