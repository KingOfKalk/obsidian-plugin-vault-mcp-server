# Agent Guide: Visual Regression for UI Changes

This document is written for an AI coding agent. If you're a human, see
[README.md](./README.md).

---

## When to use this

Use this pipeline whenever your change might affect what Obsidian renders:
plugin settings UI, status bar items, modals, ribbon icons, custom views,
CSS in `styles.css`, or anything in `src/settings.ts` / `src/main.ts` that
manipulates the DOM.

You **don't** need it for pure backend changes (HTTP server internals, tool
handlers that don't touch the UI) — those are covered by `npm test`.

---

## Standard Workflow

```bash
# 1. Snapshot the current UI
npm run visual:before

# 2. Make your code changes
#    (edit src/, run `npm run lint && npm run typecheck && npm test`)

# 3. Snapshot again — this also auto-diffs against `before/`
npm run visual:after

# 4. Read the screenshots to verify your change
#    Files are at predictable paths:
#      docker/screenshots/before/<scenario>.png
#      docker/screenshots/after/<scenario>.png
#      docker/screenshots/diff/<scenario>.png    (red overlay where pixels changed)
#      docker/screenshots/diff/_summary.json     (machine-readable)
```

Use the `Read` tool on individual `.png` files — they render inline. Start
with `_summary.json` to find which scenarios actually changed, then read
the corresponding `diff/*.png` and compare with `before/*.png` and `after/*.png`.

---

## Reading the Output

### `_summary.json`

```json
[
  {
    "name": "01-main-window.png",
    "before": "/home/obsidian/screenshots/before/01-main-window.png",
    "after":  "/home/obsidian/screenshots/after/01-main-window.png",
    "diff_path": "/home/obsidian/screenshots/diff/01-main-window.png",
    "changed_pixels": 0,
    "total_pixels": 2073600,
    "percent": 0.0,
    "status": "match"
  },
  {
    "name": "03-plugin-settings.png",
    "changed_pixels": 14823,
    "percent": 0.7149,
    "status": "differ"
  }
]
```

Triage by `status` and `percent`:
- `status: "match"` (or `percent < ~0.05`) → ignore, no visual change
- `percent` between 0.1 and 5 → likely your intended change (verify with `Read`)
- `percent > 10` → big change. Either intentional (good) or a regression (bad).

### `diff/<name>.png`

The "after" image with **red pixels overlaid wherever something changed**. A
blob of red in an area you didn't touch = unintended regression. A red blob
exactly where your new button/setting/widget appears = intended change.

---

## Adding a Scenario

If your feature adds new UI not covered by the existing scenarios, add one
to `docker/scripts/scenarios.py`. Pattern:

```python
def _scenario_my_feature(cdp: ObsidianCDP) -> None:
    cdp.open_file("Welcome.md")
    cdp.execute_command("obsidian-mcp:show-status-modal")  # whatever your feature does

SCENARIOS.append(
    Scenario(
        name="07-my-feature",
        setup=_scenario_my_feature,
        wait_for="document.querySelector('.my-feature-modal')",
    )
)
```

The `wait_for` is critical — it's a JS predicate polled until truthy before the
screenshot is taken. Use a selector that exists *only* once your feature has
fully rendered.

After editing `scenarios.py`, re-run `npm run visual:after` (the scripts are
bind-mounted into the container, no rebuild needed).

---

## When to Update the Baseline

`baseline/` holds long-lived reference screenshots committed to git. Update
them only when you've **intentionally** changed the UI and the new look is
correct:

```bash
npm run visual:baseline
git add docker/screenshots/baseline/
git commit -m "chore: update visual baseline for <feature>"
```

CI compares against `baseline/`, not `before/` (the latter is per-developer).
Don't update the baseline in the same commit as the code change unless
the visual change is the primary thing being committed.

---

## Driving Obsidian Programmatically

The full power of Obsidian's `app` API is available via the `obsidian_cdp`
library. Inside the container or in a new scenario:

```python
from obsidian_cdp import ObsidianCDP

with ObsidianCDP() as cdp:
    # Run any registered command (find IDs in Obsidian's command palette)
    cdp.execute_command("editor:toggle-source")
    cdp.execute_command("obsidian-mcp:start-server")

    # Open a file
    cdp.open_file("Notes/Project Plan.md")

    # Open settings to a specific tab
    cdp.open_settings(tab_id="obsidian-mcp")

    # Eval arbitrary JS — anything a plugin can do, you can do here
    plugin_state = cdp.eval("app.plugins.plugins['obsidian-mcp'].settings")
    is_running = cdp.eval("app.plugins.plugins['obsidian-mcp'].server?.isRunning ?? false")

    # Wait for state changes
    cdp.wait_for("app.workspace.getActiveFile()?.path === 'Welcome.md'")

    # Take a screenshot at any moment
    cdp.screenshot("/home/obsidian/screenshots/after/custom.png")
```

See `obsidian_cdp.py` for the full API. The Obsidian `app` object is
documented at https://docs.obsidian.md/Reference/TypeScript+API.

---

## Common Pitfalls

**"It worked before, now it returns black screenshots"**
Obsidian probably crashed mid-run. Check `docker compose logs` or open a
shell (`npm run visual:shell`) and `cat /tmp/obsidian-bootstrap.log`.

**"The diff shows changes I didn't make"**
The vault is regenerated every run, but timestamps in displayed dates can
shift. Check the diff visually — if it's just a `Last modified: ...` field,
either tighten the `wait_for` selector or add a teardown that hides the
volatile element.

**"My new scenario times out on `wait_for`"**
Your selector is wrong, or the UI element is rendered in a sub-frame.
Connect interactively:
```bash
npm run visual:shell
# inside container:
python3 /home/obsidian/scripts/bootstrap.py
python3 -c "
from obsidian_cdp import ObsidianCDP
cdp = ObsidianCDP()
cdp.execute_command('your-command-id')
print(cdp.eval('document.body.innerHTML.length'))  # sanity check
"
```

**"I can't tell if a diff is intentional or a regression"**
Read all three: `before/<name>.png`, `after/<name>.png`, `diff/<name>.png`.
The diff highlights *where* the change is; the before/after pair shows
*what* changed. If the change is in your feature area → intentional.
If it's somewhere unrelated → regression.

---

## Don't

- Don't commit `before/`, `after/`, or `diff/` — they're per-run scratch.
- Don't update `baseline/` casually — only when the visual change is intentional and reviewed.
- Don't add `time.sleep` in scenarios — use `cdp.wait_for(<selector>)` instead.
- Don't use `xdotool` / `scrot` for new code — use `obsidian_cdp` (CDP). Those tools are kept in the image only for ad-hoc debugging.
