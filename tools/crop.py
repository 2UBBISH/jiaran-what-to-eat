#!/usr/bin/env python3
"""Zoom-crop helper for verifying small text in the source screenshots.

Only used while reading the screenshots (to double-check characters such as
清青 vs 清清 and the price badges); it is not needed to build or validate the
dataset. Requires Pillow:  python3 -m pip install --target ./tools/pylib pillow
then run with  PYTHONPATH=./tools/pylib

Usage: crop.py SRC OUT X Y W H [SCALE]
"""
import sys

from PIL import Image


def main() -> None:
    src, out = sys.argv[1], sys.argv[2]
    x, y, w, h = (int(v) for v in sys.argv[3:7])
    scale = float(sys.argv[7]) if len(sys.argv) > 7 else 2.0
    with Image.open(src) as im:
        crop = im.crop((x, y, x + w, y + h))
        crop = crop.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
        crop.save(out, quality=95)


if __name__ == "__main__":
    main()
