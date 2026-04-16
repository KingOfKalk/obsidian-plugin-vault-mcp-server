# Docker Visual Regression Testing

Run Obsidian in a Docker container with a virtual framebuffer (Xvfb) to capture screenshots before and after code changes.

## Prerequisites

- Docker and Docker Compose v2+
- Node.js 20+ (for building the plugin)

## Quick Start

```bash
# 1. Build the Docker image (first time only, or after Dockerfile changes)
npm run visual:build

# 2. Capture baseline screenshots (before your changes)
npm run visual:baseline

# 3. Make your code changes, then compare
npm run visual:compare

# 4. Debug interactively if needed
npm run visual:shell
```

## How It Works

```
┌─────────────────────────────────────────────────┐
│  Docker Container                               │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
│  │   Xvfb   │──│ Fluxbox  │──│   Obsidian   │  │
│  │ (display) │  │  (WM)    │  │ (with plugin)│  │
│  └──────────┘  └──────────┘  └──────────────┘  │
│       │                                         │
│  ┌──────────────────────────────────────────┐   │
│  │  scrot / ImageMagick                     │   │
│  │  (screenshot capture & diff)             │   │
│  └──────────────────────────────────────────┘   │
└──────────────────┬──────────────────────────────┘
                   │ volume mount
        ┌──────────┴──────────┐
        │ docker/screenshots/ │
        │  ├── baseline/      │  ← committed to git
        │  ├── current/       │  ← generated each run
        │  └── diff/          │  ← pixel diff images
        └─────────────────────┘
```

1. **Xvfb** creates a virtual display (1920x1080 by default)
2. **Fluxbox** provides a lightweight window manager
3. **Obsidian** launches with the test vault and built plugin
4. **scrot** captures full-screen or per-window screenshots
5. **ImageMagick `compare`** produces pixel-level diffs

## Workflow: Before/After Feature Screenshots

```bash
# Before implementing a feature:
git checkout main
npm run visual:baseline
git checkout -b my-feature

# Implement your feature...

# After implementing:
npm run visual:compare
# → Produces diff images showing exactly what changed

# If the changes are intentional, update the baseline:
npm run visual:baseline
git add docker/screenshots/baseline/
git commit -m "chore: update visual baseline for my-feature"
```

## Services (docker-compose)

| Service | Description |
|---------|-------------|
| `visual-test` | Base service — builds the image |
| `update-baseline` | Captures new baseline screenshots |
| `compare` | Compares current state against baseline |
| `shell` | Interactive shell for debugging |

## Directory Structure

```
docker/
├── Dockerfile              # Ubuntu 24.04 + Xvfb + Node + Obsidian
├── docker-compose.yml      # Service definitions
├── entrypoint.sh           # Starts Xvfb + Fluxbox
├── .dockerignore
├── README.md               # This file
├── scripts/
│   ├── screenshot.sh       # Capture a single screenshot
│   ├── visual-diff.sh      # Compare two images
│   ├── run-visual-test.sh  # Full test orchestration (runs inside container)
│   └── visual-test-host.sh # Host-side entry point
├── screenshots/
│   ├── baseline/           # Reference screenshots (committed)
│   ├── current/            # Current run (gitignored)
│   └── diff/               # Diff output (gitignored)
└── test-vault/             # Minimal Obsidian vault fixture
    ├── .obsidian/
    │   ├── app.json
    │   ├── appearance.json
    │   └── community-plugins.json
    ├── Welcome.md
    ├── Note A.md
    └── Note B.md
```

## Screenshots Captured

The test run captures these screenshots:

| # | Name | Description |
|---|------|-------------|
| 1 | `01-main-window.png` | Main Obsidian window after startup |
| 2 | `02-settings-open.png` | Settings dialog |
| 3 | `03-community-plugins.png` | Community plugins panel |
| 4 | `04-plugin-settings.png` | Plugin-specific settings |
| 5 | `05-command-palette.png` | Command palette |

## Customization

### Resolution

Set in `docker-compose.yml` via environment variables:

```yaml
environment:
  - SCREEN_WIDTH=2560
  - SCREEN_HEIGHT=1440
```

### Obsidian Version

Change the build arg in `docker-compose.yml`:

```yaml
build:
  args:
    OBSIDIAN_VERSION: "1.8.9"
```

### Adding Screenshots

Edit `docker/scripts/run-visual-test.sh` to add new screenshot steps. Each step is a sequence of UI interactions (via `xdotool`) followed by a screenshot capture.

### Diff Threshold

The visual diff uses a 2% fuzz factor by default (to ignore anti-aliasing). Adjust in `run-visual-test.sh` or pass `--threshold` to `visual-diff.sh`.

## Troubleshooting

### Interactive Debugging

```bash
npm run visual:shell
# Inside the container:
obsidian --no-sandbox --disable-gpu &
sleep 10
./scripts/screenshot.sh /home/obsidian/screenshots/debug.png
# Screenshot appears at docker/screenshots/debug.png on host
```

### Obsidian Won't Start

- Check logs: `cat /tmp/obsidian.log`
- Ensure `--no-sandbox` is used (required in Docker)
- Verify shared memory: container needs `shm_size: 2gb`

### Screenshots Are Black

- Xvfb might not have started — check `xdpyinfo -display :99`
- Fluxbox might be missing — verify it's running with `ps aux | grep flux`
- Obsidian might need more time — increase `--timeout` in the test script
