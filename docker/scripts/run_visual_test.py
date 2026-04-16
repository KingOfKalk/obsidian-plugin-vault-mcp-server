#!/usr/bin/env python3
"""
run_visual_test.py — Capture all scenarios into before/, after/, or baseline/.

Usage:
    run_visual_test.py capture <before|after|baseline>
    run_visual_test.py diff [--against before] [--threshold 10]

Examples:
    # Agent workflow:
    run_visual_test.py capture before    # before making changes
    # ...edit code, rebuild plugin...
    run_visual_test.py capture after     # after making changes
    run_visual_test.py diff              # produces docker/screenshots/diff/*.png

    # Long-lived baseline workflow:
    run_visual_test.py capture baseline  # one-time, committed to git
    run_visual_test.py capture after     # in CI or local dev
    run_visual_test.py diff --against baseline

This script assumes:
    - Xvfb is running (entrypoint.sh starts it)
    - The built plugin is at /home/obsidian/plugin
    - The vault is at /home/obsidian/vault (or will be created if --regenerate-vault)
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

from obsidian_cdp import ObsidianCDP, ObsidianCDPError
from scenarios import SCENARIOS

SCREENSHOT_ROOT = Path(os.environ.get("SCREENSHOT_ROOT", "/home/obsidian/screenshots"))
VAULT_DIR = Path(os.environ.get("VAULT_DIR", "/home/obsidian/vault"))
PLUGIN_DIR = Path(os.environ.get("PLUGIN_DIR", "/home/obsidian/plugin"))
CDP_PORT = int(os.environ.get("OBSIDIAN_DEBUG_PORT", "9222"))


def regenerate_vault() -> None:
    """(Re)create the test vault from scratch."""
    print(f"Regenerating vault at {VAULT_DIR}")
    subprocess.run(
        [
            sys.executable,
            "/home/obsidian/scripts/create_vault.py",
            str(VAULT_DIR),
            "--plugin-dir",
            str(PLUGIN_DIR),
            "--enable-plugin",
        ],
        check=True,
    )


def start_obsidian() -> None:
    """Run bootstrap.py — launches Obsidian and dismisses first-run modals."""
    print("Starting Obsidian...")
    result = subprocess.run(
        [sys.executable, "/home/obsidian/scripts/bootstrap.py", "--vault", str(VAULT_DIR)],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        print(result.stdout)
        print(result.stderr, file=sys.stderr)
        raise RuntimeError("Obsidian bootstrap failed")
    print(result.stdout)


def stop_obsidian() -> None:
    subprocess.run(["pkill", "-f", "obsidian"], capture_output=True)
    time.sleep(2)


def capture(target: str) -> int:
    """Capture all scenarios into screenshots/<target>/."""
    valid = ("before", "after", "baseline")
    if target not in valid:
        print(f"ERROR: target must be one of {valid}", file=sys.stderr)
        return 2

    output_dir = SCREENSHOT_ROOT / target
    output_dir.mkdir(parents=True, exist_ok=True)
    print(f"Capturing into {output_dir}")

    # Always start fresh — vault state shouldn't leak between runs
    regenerate_vault()
    stop_obsidian()
    start_obsidian()

    results: list[dict[str, str]] = []
    try:
        with ObsidianCDP(port=CDP_PORT) as cdp:
            for scenario in SCENARIOS:
                print(f"  [{scenario.name}] setting up...")
                try:
                    scenario.setup(cdp)
                    if scenario.wait_for:
                        cdp.wait_for(scenario.wait_for, timeout=8)
                    time.sleep(0.6)  # let CSS animations settle
                    out_path = output_dir / f"{scenario.name}.png"
                    written = cdp.screenshot(str(out_path))
                    print(f"    -> {written}")
                    results.append({"name": scenario.name, "path": written, "status": "ok"})
                    if scenario.teardown:
                        scenario.teardown(cdp)
                except ObsidianCDPError as e:
                    print(f"    !! failed: {e}")
                    results.append({"name": scenario.name, "status": "error", "error": str(e)})
    finally:
        stop_obsidian()

    # Write a summary JSON the agent / CI can read
    summary_path = output_dir / "_summary.json"
    summary_path.write_text(json.dumps(results, indent=2))
    print(f"\nSummary: {summary_path}")
    return 0


def diff(against: str, threshold: int) -> int:
    after_dir = SCREENSHOT_ROOT / "after"
    against_dir = SCREENSHOT_ROOT / against
    diff_dir = SCREENSHOT_ROOT / "diff"
    diff_dir.mkdir(parents=True, exist_ok=True)

    if not after_dir.is_dir():
        print(f"ERROR: no 'after' screenshots at {after_dir}", file=sys.stderr)
        return 2
    if not against_dir.is_dir():
        print(f"ERROR: no '{against}' screenshots at {against_dir}", file=sys.stderr)
        return 2

    results: list[dict[str, object]] = []
    failed = 0
    for after_path in sorted(after_dir.glob("*.png")):
        baseline_path = against_dir / after_path.name
        if not baseline_path.exists():
            print(f"  SKIP {after_path.name} (no {against})")
            continue
        diff_path = diff_dir / after_path.name
        proc = subprocess.run(
            [
                sys.executable,
                "/home/obsidian/scripts/visual_diff.py",
                str(baseline_path),
                str(after_path),
                "--out",
                str(diff_path),
                "--threshold",
                str(threshold),
            ],
            capture_output=True,
            text=True,
        )
        if proc.stdout.strip():
            try:
                summary = json.loads(proc.stdout.strip().splitlines()[-1])
            except json.JSONDecodeError:
                summary = {"raw": proc.stdout}
        else:
            summary = {"error": proc.stderr.strip()}
        summary["status"] = "match" if proc.returncode == 0 else "differ"
        results.append({"name": after_path.name, **summary})
        if proc.returncode == 1:
            failed += 1
        print(
            f"  {after_path.name}: {summary.get('status')} "
            f"({summary.get('changed_pixels', '?')} px, "
            f"{summary.get('percent', '?')}%)"
        )

    summary_path = diff_dir / "_summary.json"
    summary_path.write_text(json.dumps(results, indent=2))
    print(f"\n{len(results)} compared, {failed} differ")
    print(f"Summary: {summary_path}")
    return 1 if failed else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="cmd", required=True)

    cap = sub.add_parser("capture", help="Capture all scenarios")
    cap.add_argument("target", choices=["before", "after", "baseline"])

    df = sub.add_parser("diff", help="Diff after/ against before/ or baseline/")
    df.add_argument("--against", default="before", choices=["before", "baseline"])
    df.add_argument("--threshold", type=int, default=10)

    args = parser.parse_args()

    if args.cmd == "capture":
        return capture(args.target)
    if args.cmd == "diff":
        return diff(args.against, args.threshold)
    parser.print_help()
    return 2


if __name__ == "__main__":
    sys.exit(main())
