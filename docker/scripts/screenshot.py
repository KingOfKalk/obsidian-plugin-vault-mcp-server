#!/usr/bin/env python3
"""
screenshot.py — Take a screenshot of the running Obsidian instance.

Usage:
    screenshot.py <output-path> [--port PORT] [--wait-for JS] [--delay SECS]

Examples:
    screenshot.py /home/obsidian/screenshots/before/main.png
    screenshot.py out.png --wait-for "document.querySelector('.modal')" --delay 1

Requirements:
    Obsidian must be running with --remote-debugging-port=$OBSIDIAN_DEBUG_PORT
    (default 9222). The bootstrap.py script handles launching it.
"""

from __future__ import annotations

import argparse
import os
import sys
import time

from obsidian_cdp import ObsidianCDP, ObsidianCDPError


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", help="Path to write the PNG to")
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("OBSIDIAN_DEBUG_PORT", "9222")),
        help="Obsidian CDP port",
    )
    parser.add_argument(
        "--wait-for",
        default=None,
        help="JS expression to poll until truthy before capturing",
    )
    parser.add_argument(
        "--wait-timeout",
        type=float,
        default=10.0,
        help="Seconds to wait for --wait-for predicate",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=0.5,
        help="Extra seconds to sleep before capture (lets animations settle)",
    )
    args = parser.parse_args()

    try:
        with ObsidianCDP(port=args.port) as cdp:
            if args.wait_for:
                if not cdp.wait_for(args.wait_for, timeout=args.wait_timeout):
                    print(
                        f"WARNING: --wait-for predicate did not become truthy "
                        f"within {args.wait_timeout}s",
                        file=sys.stderr,
                    )
            if args.delay > 0:
                time.sleep(args.delay)
            written = cdp.screenshot(args.output)
        print(written)
        return 0
    except ObsidianCDPError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
