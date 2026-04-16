# Docker Visual Regression Testing

Take screenshots of Obsidian (with this plugin loaded) before and after a code
change, then diff them. Runs headlessly via Xvfb in a container, drives Obsidian
through the Chrome DevTools Protocol — no flaky `xdotool` clicks, no manual
window-management.

For a focused, agent-oriented guide see **[AGENT-GUIDE.md](./AGENT-GUIDE.md)**.

---

## Quick Start

```bash
# One-time: build the image (~3 min — downloads Obsidian AppImage)
npm run visual:build

# Capture how the UI looks RIGHT NOW (before any changes)
npm run visual:before

# ...edit src/, plugin behavior, settings UI, etc...

# Capture again and auto-diff against the "before" set
npm run visual:after

# Inspect the results
ls docker/screenshots/before/   # original snapshots
ls docker/screenshots/after/    # post-change snapshots
ls docker/screenshots/diff/     # red-overlay diffs
cat docker/screenshots/diff/_summary.json
```

That's it. Anything you want to script can be scripted — every step is a Python
or shell command, see [Scripting](#scripting-everything-is-a-cli) below.

---

## How It Works

```
┌─ host ───────────────────────────────────────────────────────────┐
│  npm run visual:before                                           │
│    → docker/scripts/visual-test-host.sh                          │
│        → npm run build  (esbuild → main.js)                      │
│        → docker compose run capture-before                       │
└────────────────────────────────────┬─────────────────────────────┘
                                     │
┌─ container ─────────────────────────▼────────────────────────────┐
│  entrypoint.sh                                                   │
│    → Xvfb :99 1920x1080x24                                       │
│    → fluxbox (window manager)                                    │
│    → exec python3 run_visual_test.py capture before              │
│                                                                  │
│  run_visual_test.py                                              │
│    → create_vault.py (regenerate fresh vault with sample notes)  │
│    → bootstrap.py:                                               │
│        - launch obsidian --remote-debugging-port=9222            │
│        - connect via CDP                                         │
│        - dismiss "Trust author" modal                            │
│        - disable Restricted Mode                                 │
│        - enable obsidian-mcp plugin                              │
│    → for each scenario in scenarios.py:                          │
│        - drive Obsidian (open file, run command, open settings)  │
│        - wait for DOM predicate                                  │
│        - CDP Page.captureScreenshot → PNG                        │
│    → write _summary.json                                         │
└──────────────────────────────────────────────────────────────────┘
                                     │
                          docker/screenshots/before/*.png  (host-visible)
```

**Key design choices:**

| Choice | Why |
|---|---|
| Chrome DevTools Protocol (CDP) for everything | Deterministic. We talk to Obsidian via its real `app.*` JS API instead of guessing at pixel coordinates. |
| `Page.captureScreenshot` for screenshots | Same call `obsidian dev:screenshot` uses internally. No `scrot`/`xdotool` flakiness. |
| Vault regenerated every run | No state leaks between runs — visual diffs reflect *only* code changes. |
| Single container, single tool | Python is the only orchestration language. `xdotool`/`scrot`/`imagemagick` are fallbacks for ad-hoc debugging. |

---

## Directory Layout

```
docker/
├── Dockerfile               Ubuntu 24.04 + Xvfb + Node + Obsidian + Python
├── docker-compose.yml       Services: capture-before, capture-after, baseline, diff, shell
├── entrypoint.sh            Boots Xvfb + fluxbox, then exec's the command
├── README.md                You are here
├── AGENT-GUIDE.md           Focused workflow for AI agents
├── scripts/
│   ├── obsidian_cdp.py        Library: CDP client + Obsidian helpers
│   ├── bootstrap.py           Launch Obsidian, dismiss modals, enable plugin
│   ├── create_vault.py        Generate a fresh test vault with sample notes
│   ├── scenarios.py           Declarative list of UI states to capture
│   ├── screenshot.py          One-off screenshot CLI (uses bootstrap port)
│   ├── visual_diff.py         PIL-based pixel diff
│   ├── run_visual_test.py     Top-level: capture <kind> | diff
│   └── visual-test-host.sh    Host wrapper invoked by npm scripts
└── screenshots/
    ├── before/                Pre-change snapshots (gitignored)
    ├── after/                 Post-change snapshots (gitignored)
    ├── baseline/              Long-lived references (committed)
    ├── diff/                  Red-overlay diffs (gitignored)
    └── <each>/_summary.json   Machine-readable run summary
```

---

## Scripting: everything is a CLI

Every step is exposed as a script. Compose them however you want.

### Inside the container

```bash
# Generate a vault with sample notes and the built plugin installed
python3 /home/obsidian/scripts/create_vault.py /tmp/vault \
    --plugin-dir /home/obsidian/plugin --enable-plugin

# Boot Obsidian and prep it (trust + enable plugin) — leaves it running
python3 /home/obsidian/scripts/bootstrap.py --vault /tmp/vault

# Take a single screenshot
python3 /home/obsidian/scripts/screenshot.py /tmp/shot.png \
    --wait-for "document.querySelector('.workspace-leaf')"

# Diff two PNGs (returns JSON, exit 0=match, 1=differ, 2=error)
python3 /home/obsidian/scripts/visual_diff.py before.png after.png \
    --out diff.png --threshold 10

# Run the full sweep
python3 /home/obsidian/scripts/run_visual_test.py capture before
python3 /home/obsidian/scripts/run_visual_test.py capture after
python3 /home/obsidian/scripts/run_visual_test.py diff --against before
```

### From the host

| npm script | What it does |
|---|---|
| `npm run visual:build` | (Re)build the Docker image |
| `npm run visual:before` | Build plugin → snapshot into `before/` |
| `npm run visual:after` | Build plugin → snapshot into `after/` → diff against `before/` |
| `npm run visual:baseline` | Build plugin → snapshot into `baseline/` (commit these) |
| `npm run visual:diff` | Diff `after/` against `before/` (no recapture) |
| `npm run visual:diff-baseline` | Diff `after/` against `baseline/` |
| `npm run visual:shell` | Interactive shell in the container |

### Programmatic use (Python library)

```python
from obsidian_cdp import ObsidianCDP

with ObsidianCDP(port=9222) as cdp:
    cdp.open_settings(tab_id="obsidian-mcp")
    cdp.wait_for("document.querySelector('.modal.mod-settings')")
    cdp.screenshot("/tmp/plugin-settings.png")

    # Run any Obsidian command
    cdp.execute_command("editor:toggle-source")

    # Eval arbitrary JS against the renderer
    leaf_count = cdp.eval("app.workspace.getLeavesOfType('markdown').length")
```

---

## Adding a New Scenario

Edit `docker/scripts/scenarios.py`:

```python
def _scenario_my_new_view(cdp: ObsidianCDP) -> None:
    cdp.open_file("Welcome.md")
    cdp.execute_command("my-plugin:do-thing")

SCENARIOS.append(
    Scenario(
        name="07-my-new-view",
        setup=_scenario_my_new_view,
        wait_for="document.querySelector('.my-plugin-output')",
    )
)
```

Next `npm run visual:before` / `:after` will include it. No Dockerfile rebuild needed
(the scripts are mounted via the bind mount in `docker-compose.yml`).

---

## Customization

### Resolution

```yaml
# docker-compose.yml
environment:
  - SCREEN_WIDTH=2560
  - SCREEN_HEIGHT=1440
```

### Obsidian Version

```yaml
# docker-compose.yml
build:
  args:
    OBSIDIAN_VERSION: "1.8.9"   # bump as needed
```

### Diff Sensitivity

`run_visual_test.py diff --threshold N` — per-channel difference (0-255) below which a
pixel counts as unchanged. Default 10 absorbs minor anti-aliasing jitter.

### Vault Contents

Edit the `NOTES` dict in `create_vault.py` — generated each run, no state to clean up.

---

## Troubleshooting

**"Could not connect to Obsidian CDP"**
The Obsidian process died before opening the debugger. Check `/tmp/obsidian-bootstrap.log`
inside the container (open a `npm run visual:shell` and `cat /tmp/obsidian-bootstrap.log`).

**Screenshots are black**
Xvfb didn't start, or Obsidian crashed. From inside the container:
```bash
xdpyinfo -display :99    # confirms Xvfb is up
ps aux | grep obsidian   # confirms Obsidian is running
```

**`wait_for` predicate timing out**
The DOM selector you used doesn't match. Open `npm run visual:shell`, run
`bootstrap.py`, then `python3` and use `cdp.eval("document.querySelector(...).outerHTML")`
to find the right selector.

**Trust dialog never goes away**
Obsidian only shows it on first vault-open. The vault is regenerated each run, so
this *should* always trigger. If `accept_trust_dialog()` returns `False` consistently,
inspect the DOM via `npm run visual:shell` to see what changed in the Obsidian UI.

---

## Future: official Obsidian CLI

Obsidian 1.12.7+ ships an [official CLI](https://help.obsidian.md/extending-obsidian/obsidian-cli)
with `obsidian dev:screenshot path=...` and command execution from the terminal.
Adopting it would simplify *some* of this stack but would require:

- Bumping `OBSIDIAN_VERSION` to ≥ 1.12.7
- Pre-registering the CLI binary (the GUI registration step doesn't run in headless setups)
- Re-implementing the bootstrap / trust-dialog handling, since the CLI requires
  Obsidian to already be running

The CDP approach used here works on every Obsidian version that supports
`--remote-debugging-port` (effectively all of them) and uses the same underlying
mechanism, so the migration would be primarily ergonomic.
