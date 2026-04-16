# Screenshots On Host — Caveman Guide

Docker no work here. Docker daemon dead in sandbox (kernel no nftables).
But Obsidian still run on host. Xvfb make fake screen. CDP make Obsidian
do tricks. Python take picture.

This guide for future Claude. Read this. Do steps. Get screenshot. Done.

For Docker way (on real machine with Docker), see `docker/AGENT-GUIDE.md`.
Everything here reuses the Python scripts in `docker/scripts/` — they work
just fine without the container.

---

## Big picture

```
  Xvfb :99        fake screen, no monitor needed
    |
    v
  obsidian --remote-debugging-port=9222
    |
    v
  CDP on :9222    Chrome DevTools Protocol
    |
    v
  docker/scripts/obsidian_cdp.py     Python talks to Obsidian
    |
    v
  PNG file        Page.captureScreenshot dumps pixels
```

No window manager needed. `Page.captureScreenshot` reads Electron's
renderer surface directly (the compositor output), so fluxbox / X11 window
mapping doesn't matter for what ends up in the PNG. Xvfb is still
required because Electron won't initialize its GL context without *some*
display.

Same layers as the Docker setup, just running straight on the host
instead of inside a container. (The Docker image does launch fluxbox,
but only as a carryover — screenshots there are also CDP-based.)

---

## One-time setup

Run **once** per fresh sandbox. Takes ~2 min.

### 1. System packages

Most things are already on Ubuntu 24.04. Fill the gaps:

```bash
apt-get install -y --no-install-recommends \
    xvfb x11-utils \
    dbus dbus-x11 \
    libgtk-3-0 libnotify4 libnss3 libxss1 libasound2t64 \
    libsecret-1-0 xdg-utils libgbm1 libdrm2 libx11-xcb1 \
    libxcb-dri3-0 libxshmfence1 \
    wget ca-certificates
```

### 2. Python websocket client

```bash
pip install websocket-client
```

That's the only Python dep `obsidian_cdp.py` actually needs.

### 3. Obsidian AppImage

FUSE is not usable in the sandbox, so extract the AppImage instead of
running it directly:

```bash
cd /opt
wget -q "https://github.com/obsidianmd/obsidian-releases/releases/download/v1.8.9/Obsidian-1.8.9.AppImage" -O Obsidian.AppImage
chmod +x Obsidian.AppImage
./Obsidian.AppImage --appimage-extract
ln -sf /opt/squashfs-root/obsidian /usr/local/bin/obsidian
```

Done. `obsidian` is now on `$PATH`.

### 4. Build the plugin

```bash
npm install
npm run build       # produces main.js + styles.css at repo root
```

---

## Each run

### 1. Start Xvfb + D-Bus

Xvfb gives a fake 1920x1080 screen on display `:99`. D-Bus stops Electron
complaining about missing session bus. No window manager needed — CDP
captures the renderer surface directly.

```bash
export DISPLAY=:99
Xvfb :99 -screen 0 1920x1080x24 -ac +extension GLX +render -noreset \
    >/tmp/xvfb.log 2>&1 &
eval "$(dbus-launch --sh-syntax)"
sleep 1
DISPLAY=:99 xdpyinfo >/dev/null && echo "X is up"
```

### 2. Build a fresh vault

`create_vault.py` makes a small deterministic vault with notes, tables,
code blocks, tasks — and copies the built plugin in. Regenerate every run
so state can't leak between screenshots.

```bash
rm -rf /tmp/vault
python3 docker/scripts/create_vault.py /tmp/vault \
    --plugin-dir "$(pwd)" --enable-plugin
```

Point Obsidian at that vault (skips the first-run vault picker):

```bash
mkdir -p /root/.config/obsidian
cat > /root/.config/obsidian/obsidian.json <<'EOF'
{"vaults":{"v1":{"path":"/tmp/vault","ts":1700000000000,"open":true}}}
EOF
```

### 3. Launch Obsidian with CDP

```bash
DISPLAY=:99 nohup obsidian \
    --no-sandbox --disable-gpu --disable-software-rasterizer \
    --remote-debugging-port=9222 --remote-allow-origins='*' \
    "obsidian://open?path=/tmp/vault" \
    > /tmp/obsidian.log 2>&1 &
```

Verify CDP is live (should return JSON with a `webSocketDebuggerUrl`):

```bash
sleep 4
curl -s http://127.0.0.1:9222/json/version
```

### 4. Bootstrap

Drives `app.*` to dismiss the "Trust author" modal, turn off Restricted
Mode, and enable `obsidian-mcp`. Same script used in the Docker flow.

```bash
DISPLAY=:99 python3 docker/scripts/bootstrap.py \
    --vault /tmp/vault --port 9222 --no-launch
```

`--no-launch` is the key flag — Obsidian is already running, don't start
another copy.

### 5. Take a screenshot

```bash
mkdir -p /tmp/shots
DISPLAY=:99 python3 - <<'PY'
from docker.scripts.obsidian_cdp import ObsidianCDP
import time

with ObsidianCDP(port=9222) as cdp:
    # Navigate / open settings / whatever you want
    cdp.open_settings(tab_id="obsidian-mcp")
    time.sleep(1)                         # let the panel render
    cdp.screenshot("/tmp/shots/settings.png")
PY
```

Read the PNG with the `Read` tool — it renders inline.

---

## Full copy-paste script

Starting from a clean sandbox where packages and the plugin build exist:

```bash
# 1. display
export DISPLAY=:99
pgrep -f 'Xvfb :99' >/dev/null || \
    Xvfb :99 -screen 0 1920x1080x24 -ac +extension GLX +render -noreset \
        >/tmp/xvfb.log 2>&1 &
eval "$(dbus-launch --sh-syntax)"
sleep 1

# 2. vault
rm -rf /tmp/vault
python3 docker/scripts/create_vault.py /tmp/vault \
    --plugin-dir "$(pwd)" --enable-plugin
mkdir -p /root/.config/obsidian
echo '{"vaults":{"v1":{"path":"/tmp/vault","ts":1,"open":true}}}' \
    > /root/.config/obsidian/obsidian.json

# 3. launch
DISPLAY=:99 nohup obsidian --no-sandbox --disable-gpu \
    --disable-software-rasterizer \
    --remote-debugging-port=9222 --remote-allow-origins='*' \
    "obsidian://open?path=/tmp/vault" \
    >/tmp/obsidian.log 2>&1 &
sleep 4

# 4. bootstrap
DISPLAY=:99 python3 docker/scripts/bootstrap.py \
    --vault /tmp/vault --port 9222 --no-launch

# 5. screenshot
DISPLAY=:99 python3 -c "
from docker.scripts.obsidian_cdp import ObsidianCDP
import time
with ObsidianCDP(port=9222) as cdp:
    cdp.open_settings(tab_id='obsidian-mcp')
    time.sleep(1)
    cdp.screenshot('/tmp/shots/settings.png')
"
```

---

## Driving Obsidian from Python

Same `ObsidianCDP` API described in `docker/AGENT-GUIDE.md` — full
Obsidian `app.*` API is reachable through `cdp.eval(js)`:

```python
from docker.scripts.obsidian_cdp import ObsidianCDP

with ObsidianCDP(port=9222) as cdp:
    cdp.open_file("Welcome.md")
    cdp.execute_command("obsidian-mcp:start-server")
    cdp.open_settings(tab_id="obsidian-mcp")
    cdp.wait_for("document.querySelector('.mcp-server-status')")
    cdp.screenshot("/tmp/shots/server-running.png")

    running = cdp.eval(
        "app.plugins.plugins['obsidian-mcp'].server?.isRunning ?? false"
    )
```

---

## Running the full visual-regression pipeline

`run_visual_test.py` orchestrates bootstrap + scenarios + screenshots +
diff. It was written to shell out to `docker compose`, so on the host
invoke the individual scripts directly:

```bash
# Bootstrap once (assumes Obsidian already launched as above)
python3 docker/scripts/bootstrap.py --no-launch --port 9222

# Then run each scenario from docker/scripts/scenarios.py yourself,
# capturing to docker/screenshots/{before,after}/ then:
python3 docker/scripts/visual_diff.py \
    docker/screenshots/before docker/screenshots/after \
    --diff-dir docker/screenshots/diff
```

For most UI tasks, a single ad-hoc screenshot is enough — only reach for
the full before/after/diff pipeline when verifying a visual regression
across many scenarios.

---

## Gotchas

**Xvfb dies silently**
Re-run the Xvfb command. Check `/tmp/xvfb.log`. The xkbcomp warnings
about `XF86CameraAccessEnable` etc. are harmless.

**CDP never answers on 9222**
Obsidian crashed before printing the debugger URL. `cat /tmp/obsidian.log`.
Almost always missing Electron lib — install from the package list above.

**Trust-author dialog never disappears**
First run only. Bootstrap clicks it. If bootstrap reports "Accepted trust
dialog" but the dialog is still in the screenshot, the click landed before
the dialog was mounted — rerun bootstrap or `sleep 2` before screenshotting.

**Screenshot is black**
Obsidian crashed or Xvfb died before the renderer warmed up. Check
`pgrep -f squashfs-root/obsidian` and `cat /tmp/obsidian.log`. CDP returns
a black bitmap if the page never finished loading.

**Shell state resets between turns**
Background processes persist across turns for the same shell, but a fresh
sandbox (new session) starts from nothing — redo the one-time setup.

---

## Don't

- Don't commit screenshots — only attach to GitHub issues/PRs.
- Don't add `time.sleep` as a fix for flakiness — use `cdp.wait_for(<selector>)`.
- Don't edit `docker/scripts/*.py` to "fix" host paths — they're already
  path-agnostic. If something breaks, fix the invocation, not the script.
