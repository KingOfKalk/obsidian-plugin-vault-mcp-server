"""release_screenshots.py — Capture the 3 curated shots shown in each GitHub release.

Assumes Obsidian is already running with CDP on port 9222 and the plugin is
bootstrapped (see docs/screenshots-on-host.md and .github/workflows/release.yml).

Outputs to --out-dir:
    release-main.png              Welcome.md open, plugin enabled, server stopped.
    release-plugin-settings.png   Settings dialog on the obsidian-mcp tab, server stopped.
    release-server-running.png    Same tab after starting the server (shows "Running on ...").
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
IS_STOPPED_JS = f"app.plugins.plugins[{PLUGIN_ID!r}]?.httpServer?.isRunning !== true"


def _close_modals(cdp: ObsidianCDP) -> None:
    cdp.eval(
        "if (app.setting && app.setting.containerEl.isShown()) app.setting.close();"
    )


def capture(out_dir: Path, port: int) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    with ObsidianCDP(port=port) as cdp:
        _close_modals(cdp)
        cdp.open_file("Welcome.md")
        cdp.wait_for(
            "document.querySelector('.workspace-leaf-content[data-type=\"markdown\"]')"
        )
        time.sleep(0.5)
        cdp.screenshot(str(out_dir / "release-main.png"))

        cdp.open_settings(tab_id=PLUGIN_ID)
        cdp.wait_for("document.querySelector('.modal.mod-settings')")
        cdp.wait_for(IS_STOPPED_JS)
        time.sleep(0.5)
        cdp.screenshot(str(out_dir / "release-plugin-settings.png"))

        cdp.execute_command(f"{PLUGIN_ID}:start-server")
        if not cdp.wait_for(IS_RUNNING_JS, timeout=15.0):
            raise SystemExit("MCP server did not start within 15s")
        cdp.open_settings(tab_id=PLUGIN_ID)
        time.sleep(0.5)
        cdp.screenshot(str(out_dir / "release-server-running.png"))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out-dir", type=Path, default=Path("/tmp/shots"))
    parser.add_argument("--port", type=int, default=9222)
    args = parser.parse_args()
    capture(args.out_dir, args.port)


if __name__ == "__main__":
    main()
