"""
scenarios.py — Declarative list of UI states to screenshot.

Each scenario is a tuple: (filename, setup_fn, wait_for_predicate).

Adding a new scenario:
    1. Append a tuple to SCENARIOS below.
    2. The setup_fn receives an ObsidianCDP instance — use it to navigate
       to the state you want to capture (open a file, run a command, etc.).
    3. The wait_for predicate is JS that should return truthy once the
       UI has settled. Keep it specific (a DOM selector) so screenshots
       are deterministic.

This is the file an agent edits to extend the captured screenshots when
adding a new feature.
"""

from __future__ import annotations

from typing import Callable, NamedTuple

from obsidian_cdp import ObsidianCDP


class Scenario(NamedTuple):
    name: str  # Output filename (without extension)
    setup: Callable[[ObsidianCDP], None]  # Drive Obsidian to the desired state
    wait_for: str  # JS predicate; polled until truthy before capture
    teardown: Callable[[ObsidianCDP], None] | None = None  # Optional cleanup


def _close_all_modals(cdp: ObsidianCDP) -> None:
    cdp.eval(
        """
        document.querySelectorAll('.modal-close-button').forEach(b => b.click());
        if (app.setting && app.setting.containerEl.isShown()) app.setting.close();
        """
    )


def _scenario_main_window(cdp: ObsidianCDP) -> None:
    _close_all_modals(cdp)
    cdp.open_file("Welcome.md")


def _scenario_settings_general(cdp: ObsidianCDP) -> None:
    _close_all_modals(cdp)
    cdp.open_settings(tab_id=None)  # default tab is General


def _scenario_plugin_settings(cdp: ObsidianCDP) -> None:
    _close_all_modals(cdp)
    cdp.open_settings(tab_id="obsidian-mcp")


def _scenario_command_palette(cdp: ObsidianCDP) -> None:
    _close_all_modals(cdp)
    cdp.open_file("Welcome.md")
    cdp.open_command_palette()


def _scenario_note_with_table(cdp: ObsidianCDP) -> None:
    _close_all_modals(cdp)
    cdp.open_file("Notes/Project Plan.md")


def _scenario_note_with_tasks(cdp: ObsidianCDP) -> None:
    _close_all_modals(cdp)
    cdp.open_file("Notes/Meeting Notes.md")


SCENARIOS: list[Scenario] = [
    Scenario(
        name="01-main-window",
        setup=_scenario_main_window,
        wait_for="document.querySelector('.workspace-leaf-content[data-type=\"markdown\"]')",
    ),
    Scenario(
        name="02-settings-general",
        setup=_scenario_settings_general,
        wait_for="document.querySelector('.modal.mod-settings')",
    ),
    Scenario(
        name="03-plugin-settings",
        setup=_scenario_plugin_settings,
        wait_for="document.querySelector('.vertical-tab-content-container')",
        teardown=_close_all_modals,
    ),
    Scenario(
        name="04-command-palette",
        setup=_scenario_command_palette,
        wait_for="document.querySelector('.prompt')",
        teardown=_close_all_modals,
    ),
    Scenario(
        name="05-note-with-table",
        setup=_scenario_note_with_table,
        wait_for="document.querySelector('.workspace-leaf-content[data-type=\"markdown\"]')",
    ),
    Scenario(
        name="06-note-with-tasks",
        setup=_scenario_note_with_tasks,
        wait_for="document.querySelector('.workspace-leaf-content[data-type=\"markdown\"]')",
    ),
]
