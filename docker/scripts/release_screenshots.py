"""release_screenshots.py — Capture the single shot shown in each GitHub release.

Assumes Obsidian is already running with CDP on port 9222 and the plugin is
bootstrapped (see docs/screenshots-on-host.md and .github/workflows/release.yml).

Outputs to --out-dir:
    release-settings.png   Obsidian MCP settings tab, MCP server running,
                           Obsidian default theme in light (moonstone) color
                           scheme. Uncropped — captured with
                           `captureBeyondViewport=True` so the full tab is
                           visible even when it overflows the Xvfb viewport.
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from obsidian_cdp import ObsidianCDP  # noqa: E402


PLUGIN_ID = "obsidian-mcp"
IS_RUNNING_JS = f"app.plugins.plugins[{PLUGIN_ID!r}]?.httpServer?.isRunning === true"


def _close_modals(cdp: ObsidianCDP) -> None:
    cdp.eval(
        "if (app.setting && app.setting.containerEl.isShown()) app.setting.close();"
    )


def capture(out_dir: Path, port: int) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    with ObsidianCDP(port=port) as cdp:
        _close_modals(cdp)

        # Flip to Obsidian's default theme in light (moonstone) color scheme.
        cdp.set_color_scheme("moonstone")
        time.sleep(0.5)

        # Start the MCP server before opening settings so the tab renders the
        # "Running on …" URL.
        cdp.execute_command(f"{PLUGIN_ID}:start-server")
        if not cdp.wait_for(IS_RUNNING_JS, timeout=15.0):
            raise SystemExit("MCP server did not start within 15s")

        cdp.open_settings(tab_id=PLUGIN_ID)
        cdp.wait_for("document.querySelector('.modal.mod-settings')")

        # Confirm the settings tab renders the running-server URL before we snap.
        cdp.wait_for(
            "Array.from(document.querySelectorAll('.modal.mod-settings *'))"
            ".some(el => /Running on/i.test(el.textContent || ''))",
            timeout=5.0,
        )
        time.sleep(0.5)

        cdp.screenshot(
            str(out_dir / "release-settings.png"),
            capture_beyond_viewport=True,
        )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out-dir", type=Path, default=Path("/tmp/shots"))
    parser.add_argument("--port", type=int, default=9222)
    args = parser.parse_args()
    capture(args.out_dir, args.port)


if __name__ == "__main__":
    main()
