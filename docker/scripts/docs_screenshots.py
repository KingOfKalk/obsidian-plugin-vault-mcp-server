"""docs_screenshots.py — Capture localized settings-tab screenshots for the manual.

Iterates the locale list declared in `.supported-locales.yml` at the repo root
(see NFR35). For each locale:

  1. Sets `window.localStorage.setItem('language', <locale>)` and reloads
     Obsidian so the UI reinitializes in that language (the same key Obsidian
     itself reads, per src/lang/helpers.ts).
  2. Waits for `app.workspace` to come back.
  3. Opens the plugin settings tab (`obsidian-mcp`) with the server stopped.
  4. Writes `<out-dir>/<locale>/settings.png`.

Emits a JSON summary on stdout describing the captured version and paths, so
the GitHub Actions workflow can use it to patch the manual's caption/alt-text.

Assumes Obsidian is already running with CDP on port 9222 and the plugin is
bootstrapped (see docs/screenshots-on-host.md and
.github/workflows/docs-screenshots.yml).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from obsidian_cdp import ObsidianCDP  # noqa: E402


PLUGIN_ID = "obsidian-mcp"
IS_STOPPED_JS = f"app.plugins.plugins[{PLUGIN_ID!r}]?.httpServer?.isRunning !== true"
APP_READY_JS = "typeof app !== 'undefined' && !!app.workspace"
MODAL_JS = "document.querySelector('.modal.mod-settings')"


def _close_modals(cdp: ObsidianCDP) -> None:
    cdp.eval("if (app.setting && app.setting.containerEl.isShown()) app.setting.close();")


def _read_locales(config_path: Path) -> list[str]:
    """Parse the `locales:` list from .supported-locales.yml without a YAML dep.

    Accepts only the narrow shape documented in the file:
        locales:
          - en
          - de
    """
    text = config_path.read_text(encoding="utf-8")
    locales: list[str] = []
    in_list = False
    for raw in text.splitlines():
        line = raw.split("#", 1)[0].rstrip()
        if not line.strip():
            continue
        if not in_list:
            if re.match(r"^locales\s*:\s*$", line):
                in_list = True
            continue
        m = re.match(r"^\s+-\s+([A-Za-z][A-Za-z0-9_-]*)\s*$", line)
        if m:
            locales.append(m.group(1))
            continue
        # Dedent (back to column 0, non-list) ends the block.
        if line[:1] not in (" ", "\t"):
            break
    if not locales:
        raise SystemExit(f"No locales found in {config_path}")
    return locales


def _read_version(manifest_path: Path) -> str:
    data = json.loads(manifest_path.read_text(encoding="utf-8"))
    return str(data["version"])


def _capture_locale(cdp: ObsidianCDP, locale: str, out_path: Path) -> None:
    _close_modals(cdp)
    # Set the language key Obsidian reads on init, then reload the renderer so
    # every label is re-resolved. The CDP target survives the reload.
    cdp.eval(
        f"window.localStorage.setItem('language', {json.dumps(locale)});"
        " window.location.reload();"
    )
    # Give the renderer a moment to tear down before we poll.
    time.sleep(1.0)
    if not cdp.wait_for(APP_READY_JS, timeout=30.0):
        raise SystemExit(f"Obsidian did not re-initialize for locale {locale!r}")
    _close_modals(cdp)

    cdp.open_settings(tab_id=PLUGIN_ID)
    if not cdp.wait_for(MODAL_JS, timeout=10.0):
        raise SystemExit(f"Settings modal never appeared for locale {locale!r}")
    if not cdp.wait_for(IS_STOPPED_JS, timeout=5.0):
        # Server was running from a previous iteration — stop it so every shot
        # is taken under identical conditions.
        cdp.execute_command(f"{PLUGIN_ID}:stop-server")
        cdp.wait_for(IS_STOPPED_JS, timeout=10.0)
    time.sleep(0.5)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    cdp.screenshot(str(out_path))


def capture(out_dir: Path, port: int, config_path: Path, manifest_path: Path) -> dict[str, object]:
    locales = _read_locales(config_path)
    version = _read_version(manifest_path)
    shots: dict[str, str] = {}
    with ObsidianCDP(port=port) as cdp:
        for locale in locales:
            target = out_dir / locale / "settings.png"
            _capture_locale(cdp, locale, target)
            shots[locale] = str(target)
    return {"version": version, "locales": locales, "shots": shots}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out-dir", type=Path, default=Path("docs/screenshots"))
    parser.add_argument("--port", type=int, default=9222)
    parser.add_argument("--config", type=Path, default=Path(".supported-locales.yml"))
    parser.add_argument("--manifest", type=Path, default=Path("manifest.json"))
    args = parser.parse_args()
    summary = capture(args.out_dir, args.port, args.config, args.manifest)
    json.dump(summary, sys.stdout)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
