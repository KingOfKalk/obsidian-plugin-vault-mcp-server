"""
obsidian_cdp.py — Control Obsidian via the Chrome DevTools Protocol.

Why CDP and not xdotool / scrot?
    Obsidian is an Electron app. Electron exposes CDP whenever you launch it
    with `--remote-debugging-port=<N>`. CDP gives us three things in one channel:

      1. Renderer JS evaluation (Runtime.evaluate)        — drive Obsidian via `app.*`
      2. Pixel-perfect screenshots (Page.captureScreenshot) — same call obsidian-cli's
                                                              `dev:screenshot` uses
      3. DOM querying / waiting                            — verify UI state before snapping

    This means a single Python process can launch Obsidian, wait for it to load,
    dismiss the trust dialog, enable the plugin, navigate to settings, and capture
    deterministic PNGs — without xdotool, scrot, or window-manager hacks.

Public surface used by orchestration scripts:
    ObsidianCDP(port=9222)
        .eval(js, await_promise=False)       — eval JS, return the JSON value
        .wait_for(predicate_js, timeout)     — poll a JS predicate
        .screenshot(path)                    — write a PNG of the renderer
        .click_button_by_text(text)
        .accept_trust_dialog()               — first-run "trust author" modal
        .enable_community_plugins()          — turn off Restricted Mode
        .enable_plugin(plugin_id)
        .open_settings(tab_id=None)
        .close_settings()
        .open_command_palette()
        .execute_command(command_id)         — any Obsidian command by ID
        .open_file(path)
        .close()

The Obsidian `app` object is its official plugin API:
https://docs.obsidian.md/Reference/TypeScript+API. Anything a plugin can do, a
script using ObsidianCDP can do too.
"""

from __future__ import annotations

import base64
import json
import os
import time
import urllib.request
import urllib.error
from typing import Any, Optional

import websocket  # type: ignore[import-untyped]


class ObsidianCDPError(RuntimeError):
    """Raised when a CDP command fails or Obsidian is not reachable."""


class ObsidianCDP:
    """Lightweight Chrome DevTools Protocol client for Obsidian."""

    def __init__(self, port: int = 9222, connect_timeout: float = 30.0) -> None:
        self.port = port
        self._msg_id = 0
        self._ws: Optional[websocket.WebSocket] = None
        self._connect(connect_timeout)

    def _connect(self, timeout: float) -> None:
        deadline = time.time() + timeout
        last_err: Optional[Exception] = None
        while time.time() < deadline:
            try:
                targets = json.loads(
                    urllib.request.urlopen(
                        f"http://localhost:{self.port}/json", timeout=2
                    ).read()
                )
                pages = [t for t in targets if t.get("type") == "page"]
                if pages:
                    self._ws = websocket.create_connection(
                        pages[0]["webSocketDebuggerUrl"], timeout=10
                    )
                    return
            except (urllib.error.URLError, ConnectionError, OSError) as e:
                last_err = e
            time.sleep(0.5)
        raise ObsidianCDPError(
            f"Could not connect to Obsidian CDP on port {self.port}: {last_err}"
        )

    def _send(self, method: str, params: Optional[dict[str, Any]] = None) -> dict[str, Any]:
        if self._ws is None:
            raise ObsidianCDPError("Not connected")
        self._msg_id += 1
        msg: dict[str, Any] = {"id": self._msg_id, "method": method}
        if params:
            msg["params"] = params
        self._ws.send(json.dumps(msg))
        # Drain until we see the matching response (skip Page.* events etc.)
        while True:
            raw = self._ws.recv()
            data = json.loads(raw)
            if data.get("id") == self._msg_id:
                if "error" in data:
                    raise ObsidianCDPError(f"{method} failed: {data['error']}")
                return data.get("result", {})

    def eval(self, expression: str, await_promise: bool = False) -> Any:
        """Evaluate JS in the renderer. Returns the unwrapped JSON value."""
        result = self._send(
            "Runtime.evaluate",
            {
                "expression": expression,
                "returnByValue": True,
                "awaitPromise": await_promise,
            },
        )
        inner = result.get("result", {})
        if inner.get("subtype") == "error":
            raise ObsidianCDPError(f"JS error: {inner.get('description')}")
        return inner.get("value")

    def wait_for(
        self,
        predicate_js: str,
        timeout: float = 10.0,
        interval: float = 0.2,
    ) -> bool:
        """Poll a JS expression until truthy or timeout. Returns True on success."""
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                if self.eval(f"!!({predicate_js})"):
                    return True
            except ObsidianCDPError:
                pass
            time.sleep(interval)
        return False

    def click_button_by_text(self, text: str) -> bool:
        """Click the first <button> whose text content contains the given string."""
        js = f"""
        (() => {{
            const target = {json.dumps(text)};
            for (const btn of document.querySelectorAll('button')) {{
                if (btn.textContent && btn.textContent.includes(target)) {{
                    btn.click();
                    return true;
                }}
            }}
            return false;
        }})()
        """
        return bool(self.eval(js))

    def accept_trust_dialog(self) -> bool:
        """Dismiss the first-run "Do you trust the author?" modal, if present."""
        return self.click_button_by_text("Trust author")

    def enable_community_plugins(self) -> None:
        """Turn off Restricted Mode so community plugins can run."""
        self.eval(
            """
            (async () => {
                if (app.plugins && typeof app.plugins.disableRestricted === 'function') {
                    app.plugins.disableRestricted();
                }
                await new Promise(r => setTimeout(r, 500));
            })()
            """,
            await_promise=True,
        )

    def enable_plugin(self, plugin_id: str) -> list[str]:
        """Enable a specific community plugin. Returns the list of enabled plugins."""
        return self.eval(
            f"""
            (async () => {{
                await app.plugins.enablePlugin({json.dumps(plugin_id)});
                await new Promise(r => setTimeout(r, 500));
                return Object.keys(app.plugins.plugins);
            }})()
            """,
            await_promise=True,
        )

    def open_settings(self, tab_id: Optional[str] = None) -> None:
        """Open the settings modal, optionally navigating to a specific tab."""
        tab_arg = json.dumps(tab_id) if tab_id else "null"
        self.eval(
            f"""
            (async () => {{
                app.setting.open();
                await new Promise(r => setTimeout(r, 300));
                const tab = {tab_arg};
                if (tab) {{
                    app.setting.openTabById(tab);
                    await new Promise(r => setTimeout(r, 500));
                }}
            }})()
            """,
            await_promise=True,
        )

    def close_settings(self) -> None:
        self.eval("app.setting.close()")

    def open_command_palette(self) -> None:
        """Open the command palette (Ctrl+P equivalent)."""
        self.eval(
            """app.commands.executeCommandById('command-palette:open')"""
        )

    def execute_command(self, command_id: str) -> bool:
        """Execute any command by its ID. Returns success boolean."""
        return bool(
            self.eval(f"app.commands.executeCommandById({json.dumps(command_id)})")
        )

    def screenshot(
        self,
        output_path: str,
        fmt: str = "png",
        capture_beyond_viewport: bool = False,
    ) -> str:
        """Capture the renderer surface to a PNG. Returns the absolute path written.

        Uses CDP `Page.captureScreenshot`, the same call obsidian-cli's
        `dev:screenshot` uses internally. No external screenshot tool needed.

        Set `capture_beyond_viewport=True` to render the full document when a
        modal or settings tab overflows the viewport — useful for capturing the
        full Obsidian MCP settings tab in a single uncropped image.
        """
        result = self._send(
            "Page.captureScreenshot",
            {"format": fmt, "captureBeyondViewport": capture_beyond_viewport},
        )
        data = base64.b64decode(result["data"])
        os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
        with open(output_path, "wb") as f:
            f.write(data)
        return os.path.abspath(output_path)

    def set_color_scheme(self, scheme: str) -> None:
        """Flip Obsidian's base color scheme at runtime.

        `scheme` must be either `"moonstone"` (light) or `"obsidian"` (dark).
        Uses the same JS sequence as the official `obsidian-system-dark-mode`
        plugin: flip the in-memory theme, persist it, and trigger `css-change`
        so all CSS variables re-evaluate.
        """
        if scheme not in ("moonstone", "obsidian"):
            raise ValueError(
                f"Unknown color scheme {scheme!r}; expected 'moonstone' or 'obsidian'"
            )
        self.eval(
            f"""
            (() => {{
                const scheme = {json.dumps(scheme)};
                app.setTheme(scheme);
                app.vault.setConfig('theme', scheme);
                app.workspace.trigger('css-change');
            }})()
            """
        )

    def open_file(self, path: str) -> None:
        """Open a markdown file in the active leaf."""
        self.eval(
            f"""
            (async () => {{
                const file = app.vault.getAbstractFileByPath({json.dumps(path)});
                if (file) {{
                    await app.workspace.getLeaf().openFile(file);
                }}
            }})()
            """,
            await_promise=True,
        )

    def close(self) -> None:
        if self._ws is not None:
            try:
                self._ws.close()
            finally:
                self._ws = None

    def __enter__(self) -> "ObsidianCDP":
        return self

    def __exit__(self, *_: object) -> None:
        self.close()
