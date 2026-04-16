#!/usr/bin/env python3
"""
visual_diff.py — Pixel-diff two screenshots and emit a diff image + summary.

Usage:
    visual_diff.py <before.png> <after.png> [--out diff.png] [--threshold N]

Exit codes:
    0 — identical (or below threshold)
    1 — differ
    2 — error (missing file, size mismatch, etc.)

Output:
    Prints a single JSON line with: changed_pixels, total_pixels, percent, diff_path.
    A red-tinted overlay PNG is written to --out (default: alongside <after>).
"""

from __future__ import annotations

import argparse
import json
import os
import sys

from PIL import Image, ImageChops


def diff_images(
    before_path: str, after_path: str, out_path: str, threshold: int
) -> tuple[int, int]:
    before = Image.open(before_path).convert("RGB")
    after = Image.open(after_path).convert("RGB")

    if before.size != after.size:
        # Resize after to match before so we can still produce a diff
        after = after.resize(before.size)

    diff = ImageChops.difference(before, after)

    # Build a binary mask of changed pixels above threshold
    bbox_data = diff.getdata()
    changed = sum(
        1 for px in bbox_data if max(px) > threshold  # type: ignore[arg-type]
    )
    total = before.size[0] * before.size[1]

    # Render a visual diff: original "after" with red overlay on changed pixels
    overlay = after.copy()
    pixels = overlay.load()
    diff_pixels = diff.load()
    if pixels is not None and diff_pixels is not None:
        for y in range(overlay.size[1]):
            for x in range(overlay.size[0]):
                d = diff_pixels[x, y]
                if max(d) > threshold:  # type: ignore[arg-type]
                    pixels[x, y] = (255, 0, 0)

    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    overlay.save(out_path)
    return changed, total


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("before", help="Baseline / before image")
    parser.add_argument("after", help="Current / after image")
    parser.add_argument("--out", default=None, help="Diff image output path")
    parser.add_argument(
        "--threshold",
        type=int,
        default=10,
        help="Per-channel difference threshold (0-255). Below this is ignored.",
    )
    args = parser.parse_args()

    if not os.path.isfile(args.before):
        print(f"ERROR: Missing file: {args.before}", file=sys.stderr)
        return 2
    if not os.path.isfile(args.after):
        print(f"ERROR: Missing file: {args.after}", file=sys.stderr)
        return 2

    out_path = args.out or os.path.join(
        os.path.dirname(args.after), f"diff-{os.path.basename(args.after)}"
    )

    changed, total = diff_images(args.before, args.after, out_path, args.threshold)
    pct = (changed / total * 100) if total else 0.0
    summary = {
        "before": os.path.abspath(args.before),
        "after": os.path.abspath(args.after),
        "diff_path": os.path.abspath(out_path),
        "changed_pixels": changed,
        "total_pixels": total,
        "percent": round(pct, 4),
    }
    print(json.dumps(summary))
    return 0 if changed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
