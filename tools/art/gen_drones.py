#!/usr/bin/env python3
"""Procedural pixel-art enemy drone sheet for Type-R 198X (presentation pass 2026-11, DRONES).

Every word plate in the game gets a body: a small drone that trails the plate (the plate is its call-sign
tag). Four classes, keyed by what the plate carries, three silhouette variants each and two animation frames
(engine flicker + nav-light blink):

    scout        single-letter chips      24 x 14 art px   (saucer / dart)
    interceptor  2-4 letter words         34 x 16 art px   (needle fighter)
    hauler       5+ letter words          44 x 22 art px   (blocky freighter)
    pod          boss minions             22 x 22 art px   (spiked spore)

The sheet has two bands of the same cell grid: the HULL band (neutral steel, dark outline, white engine core)
and the ACCENT band (white RGB, alpha = where the sector accent colour goes: stripes, canopy rim, engine glow).
At sector start the game bakes hull + tinted accent into one canvas per sector (74-drones.js), so the same
sheet serves every sector's colour. Drawn at half size on a DPR 1 canvas (2 logical px per art pixel).

Writes drones.png (the sheet), drones.json (cell rects + class table) and drones-preview.png on a dark ground.
Usage: python3 gen_drones.py <out_dir> [seed]
"""
import json, os, sys
import numpy as np
from PIL import Image

OUT = sys.argv[1] if len(sys.argv) > 1 else "."
SEED = int(sys.argv[2]) if len(sys.argv) > 2 else 198
ART_PX = 4                       # master pixels per art pixel (the game draws at ART_PX/2 on DPR 1)
CELL_W, CELL_H = 48, 28          # art px per cell (largest class + margin)
COLS = 6
CLASSES = [
    # id, (w, h) art px, variants, frames
    ("scout", (24, 14)),
    ("interceptor", (34, 16)),
    ("hauler", (44, 22)),
    ("pod", (22, 22)),
]
VARIANTS = 3
FRAMES = 2

STEEL = {
    "outline": (16, 14, 30),
    "dark": (58, 62, 94),
    "mid": (106, 116, 158),
    "light": (166, 178, 216),
    "hi": (228, 234, 252),
    "belly": (34, 36, 58),
    "glass": (22, 30, 56),
    "glassHi": (120, 200, 230),
    "core": (246, 247, 255),
    "warn": (255, 193, 74),
}


def ellipse(mask, cx, cy, rx, ry):
    h, w = mask.shape
    ys, xs = np.mgrid[0:h, 0:w]
    mask |= (((xs + 0.5 - cx) / rx) ** 2 + ((ys + 0.5 - cy) / ry) ** 2) <= 1.0


def rect(mask, x0, y0, x1, y1):
    h, w = mask.shape
    x0, x1 = max(0, int(x0)), min(w, int(x1))
    y0, y1 = max(0, int(y0)), min(h, int(y1))
    if x1 > x0 and y1 > y0:
        mask[y0:y1, x0:x1] = True


def wedge(mask, x0, x1, cy, h0, h1):
    """Horizontal wedge from x0 (half-height h0) to x1 (half-height h1)."""
    for x in range(int(min(x0, x1)), int(max(x0, x1))):
        t = (x - x0) / max(1e-6, (x1 - x0))
        hh = h0 + (h1 - h0) * t
        y0, y1 = int(round(cy - hh)), int(round(cy + hh))
        rect(mask, x, y0, x + 1, max(y1, y0 + 1))


def outline_of(mask):
    pad = np.pad(mask, 1)
    nb = pad[:-2, 1:-1] | pad[2:, 1:-1] | pad[1:-1, :-2] | pad[1:-1, 2:]
    return nb & ~mask


def shade(hull, rng, cy):
    """Flat steel with a lit top, a shadowed belly, panel seams and a dark outline. Returns RGBA art array."""
    h, w = hull.shape
    out = np.zeros((h, w, 4), np.uint8)
    ys = np.arange(h)[:, None].repeat(w, 1)
    # vertical position inside the hull column (0 top .. 1 bottom)
    col_top = np.where(hull.any(0), hull.argmax(0), 0)
    col_bot = np.where(hull.any(0), h - hull[::-1].argmax(0), 0)
    span = np.maximum(1, col_bot - col_top)
    v = (ys - col_top[None, :]) / span[None, :]
    tone = np.full((h, w, 3), STEEL["mid"], np.uint8)
    tone[v < 0.30] = STEEL["light"]
    tone[v < 0.10] = STEEL["hi"]
    tone[v > 0.62] = STEEL["dark"]
    tone[v > 0.86] = STEEL["belly"]
    # panel seams every 5-7 columns
    seam_x = np.arange(rng.integers(2, 5), w, int(rng.integers(5, 8)))
    for x in seam_x:
        if 0 <= x < w:
            col = hull[:, x]
            tone[col, x] = np.minimum(tone[col, x].astype(int) - 22, 255).clip(0).astype(np.uint8)
    out[hull, :3] = tone[hull]
    out[hull, 3] = 255
    ol = outline_of(hull)
    out[ol, :3] = STEEL["outline"]
    out[ol, 3] = 255
    return out


def put(out, x, y, color, a=255):
    h, w = out.shape[:2]
    if 0 <= x < w and 0 <= y < h:
        out[y, x, :3] = color
        out[y, x, 3] = a


def engine(out, acc, x, cy, r, frame, strong=1.0):
    """White core at (x, cy) with an accent glow halo to the right; frame 1 flickers larger."""
    rr = r + (0.6 if frame else 0.0)
    h, w = out.shape[:2]
    for yy in range(h):
        for xx in range(w):
            dx, dy = xx + 0.5 - x, yy + 0.5 - cy
            d = (dx * dx + (dy * dy) * 1.6) ** 0.5
            if d <= rr * 0.55:
                put(out, xx, yy, STEEL["core"])
                put(acc, xx, yy, (255, 255, 255), 90)
            elif d <= rr and dx >= -0.5:
                a = int(255 * strong * (1 - (d - rr * 0.55) / max(1e-6, rr * 0.45)) ** 0.8)
                if out[yy, xx, 3] == 0:
                    put(acc, xx, yy, (255, 255, 255), max(acc[yy, xx, 3], a))
                    put(out, xx, yy, STEEL["core"], max(out[yy, xx, 3], int(a * 0.55)))
    # exhaust streak (two short rows), frame-dependent length
    L = 3 + (2 if frame else 0)
    for i in range(L):
        a = int(170 * (1 - i / L))
        xx = int(x + rr * 0.6) + i
        put(acc, xx, int(cy), (255, 255, 255), max(acc[int(cy), min(w - 1, xx)][3] if 0 <= xx < w else 0, a))
        put(out, xx, int(cy), STEEL["core"], max(out[int(cy), min(w - 1, xx)][3] if 0 <= xx < w else 0, int(a * 0.5)))


def canopy(out, acc, x0, x1, cy, up=True):
    y = cy - 2 if up else cy
    for x in range(int(x0), int(x1)):
        put(out, x, y, STEEL["glass"])
        put(out, x, y + 1, STEEL["glass"])
    put(out, int(x0), y, STEEL["glassHi"])
    for x in range(int(x0), int(x1)):
        put(acc, x, y - 1, (255, 255, 255), 150)   # canopy rim in the accent


def stripe(acc, hull, x, ys=None, a=210):
    h, w = hull.shape
    if 0 <= x < w:
        for y in range(h):
            if hull[y, x] and (ys is None or y in ys):
                acc[y, x, :3] = 255
                acc[y, x, 3] = a


def nav_light(out, acc, x, y, frame):
    if frame:
        put(out, x, y, STEEL["warn"])
        put(acc, x, y, (255, 255, 255), 0)
    else:
        put(out, x, y, STEEL["dark"])


def draw_scout(w, h, var, frame, rng):
    hull = np.zeros((h, w), bool)
    cy = h / 2
    if var == 0:      # saucer
        ellipse(hull, w * 0.42, cy, w * 0.36, h * 0.30)
        rect(hull, w * 0.30, cy - 1, w * 0.72, cy + 1)
    elif var == 1:    # dart
        wedge(hull, 2, w * 0.72, cy, 0.8, h * 0.34)
        rect(hull, w * 0.55, cy - h * 0.46, w * 0.62, cy + h * 0.46)   # fin
    else:             # twin-pod
        ellipse(hull, w * 0.40, cy - 2.2, w * 0.30, 2.2)
        ellipse(hull, w * 0.40, cy + 2.2, w * 0.30, 2.2)
        rect(hull, w * 0.30, cy - 1, w * 0.70, cy + 1)
    out = shade(hull, rng, cy)
    acc = np.zeros_like(out)
    canopy(out, acc, w * 0.22, w * 0.36, int(cy), up=True) if var != 2 else None
    stripe(acc, hull, int(w * 0.50))
    engine(out, acc, w * 0.74, cy, 2.2, frame)
    nav_light(out, acc, int(w * 0.46), int(cy - h * 0.32) if var != 1 else int(cy - h * 0.46), frame)
    return out, acc


def draw_interceptor(w, h, var, frame, rng):
    hull = np.zeros((h, w), bool)
    cy = h / 2
    if var == 0:      # needle with swept wings
        wedge(hull, 1, w * 0.74, cy, 0.6, h * 0.26)
        wedge(hull, w * 0.46, w * 0.78, cy, h * 0.20, h * 0.48)
    elif var == 1:    # forked
        wedge(hull, 3, w * 0.72, cy, 1.0, h * 0.22)
        rect(hull, w * 0.52, cy - h * 0.48, w * 0.60, cy + h * 0.48)
        rect(hull, w * 0.30, cy - h * 0.46, w * 0.80, cy - h * 0.46 + 2)
        rect(hull, w * 0.30, cy + h * 0.46 - 2, w * 0.80, cy + h * 0.46)
    else:             # gunship
        rect(hull, w * 0.12, cy - h * 0.22, w * 0.76, cy + h * 0.22)
        wedge(hull, 1, w * 0.14, cy, 0.8, h * 0.22)
        rect(hull, w * 0.40, cy - h * 0.46, w * 0.52, cy + h * 0.46)
        rect(hull, w * 0.04, cy - 1, w * 0.16, cy + 1)   # cannon
    out = shade(hull, rng, cy)
    acc = np.zeros_like(out)
    canopy(out, acc, w * 0.30, w * 0.44, int(cy), up=True)
    stripe(acc, hull, int(w * 0.62))
    stripe(acc, hull, int(w * 0.64), a=120)
    engine(out, acc, w * 0.77, cy, 2.6, frame)
    if var == 1:
        engine(out, acc, w * 0.80, cy - h * 0.46 + 1, 1.6, frame, 0.8)
        engine(out, acc, w * 0.80, cy + h * 0.46 - 1, 1.6, frame, 0.8)
    nav_light(out, acc, int(w * 0.50), int(cy - h * 0.46), frame)
    return out, acc


def draw_hauler(w, h, var, frame, rng):
    hull = np.zeros((h, w), bool)
    cy = h / 2
    if var == 0:      # container barge
        rect(hull, w * 0.10, cy - h * 0.30, w * 0.80, cy + h * 0.30)
        wedge(hull, 1, w * 0.12, cy, h * 0.10, h * 0.30)
        rect(hull, w * 0.24, cy - h * 0.46, w * 0.70, cy - h * 0.30)
        rect(hull, w * 0.24, cy + h * 0.30, w * 0.70, cy + h * 0.46)
    elif var == 1:    # tanker with spine
        ellipse(hull, w * 0.46, cy, w * 0.40, h * 0.30)
        rect(hull, w * 0.20, cy - h * 0.48, w * 0.74, cy - h * 0.34)
        rect(hull, w * 0.60, cy - h * 0.48, w * 0.64, cy + h * 0.48)
    else:             # cargo frame with bays
        rect(hull, w * 0.08, cy - h * 0.14, w * 0.84, cy + h * 0.14)
        for i in range(3):
            x0 = w * (0.18 + i * 0.20)
            rect(hull, x0, cy - h * 0.44, x0 + w * 0.14, cy + h * 0.44)
        wedge(hull, 1, w * 0.10, cy, h * 0.08, h * 0.14)
    out = shade(hull, rng, cy)
    acc = np.zeros_like(out)
    canopy(out, acc, w * 0.12, w * 0.22, int(cy), up=True)
    for x in (int(w * 0.34), int(w * 0.52), int(w * 0.70)):
        stripe(acc, hull, x, a=170)
    engine(out, acc, w * 0.84, cy - h * 0.18, 2.4, frame, 0.9)
    engine(out, acc, w * 0.84, cy + h * 0.18, 2.4, frame, 0.9)
    nav_light(out, acc, int(w * 0.44), int(cy - h * 0.46), frame)
    nav_light(out, acc, int(w * 0.44), int(cy + h * 0.46) - 1, 1 - frame)
    return out, acc


def draw_pod(w, h, var, frame, rng):
    hull = np.zeros((h, w), bool)
    cx, cy = w * 0.46, h / 2
    r = w * 0.30
    ellipse(hull, cx, cy, r, r)
    n = 6 + var * 2
    for i in range(n):
        a = i / n * 2 * np.pi + (0.35 if frame else 0.0) * 0 + var * 0.3
        tx, ty = cx + np.cos(a) * r * 1.45, cy + np.sin(a) * r * 1.45
        for t in np.linspace(0, 1, 8):
            put_m = hull
            x, y = int(cx + (tx - cx) * t), int(cy + (ty - cy) * t)
            if 0 <= x < w and 0 <= y < h:
                put_m[y, x] = True
    out = shade(hull, rng, cy)
    acc = np.zeros_like(out)
    # inner eye: accent ring + core
    for yy in range(h):
        for xx in range(w):
            d = ((xx + 0.5 - cx) ** 2 + (yy + 0.5 - cy) ** 2) ** 0.5
            if d <= r * 0.42:
                put(out, xx, yy, STEEL["glass"])
                if d <= r * 0.18 + (0.3 if frame else 0):
                    put(out, xx, yy, STEEL["core"])
                    put(acc, xx, yy, (255, 255, 255), 220)
                elif d >= r * 0.30:
                    put(acc, xx, yy, (255, 255, 255), 200)
    engine(out, acc, w * 0.80, cy, 1.8, frame, 0.7)
    return out, acc


DRAW = {"scout": draw_scout, "interceptor": draw_interceptor, "hauler": draw_hauler, "pod": draw_pod}


def upscale(a, k):
    return np.repeat(np.repeat(a, k, 0), k, 1)


def main():
    rng = np.random.default_rng(SEED)
    cells = len(CLASSES) * VARIANTS * FRAMES
    rows = (cells + COLS - 1) // COLS
    band_h = rows * CELL_H
    sheet = np.zeros((band_h * 2, COLS * CELL_W, 4), np.uint8)
    meta = {"artPx": ART_PX, "cell": {"w": CELL_W * ART_PX, "h": CELL_H * ART_PX}, "bandH": band_h * ART_PX,
            "frames": FRAMES, "variants": VARIANTS, "classes": {}}
    i = 0
    for cid, (w, h) in CLASSES:
        meta["classes"][cid] = {"w": w * ART_PX, "h": h * ART_PX, "cells": []}
        for var in range(VARIANTS):
            for fr in range(FRAMES):
                out, acc = DRAW[cid](w, h, var, fr, rng)
                cx, cy = (i % COLS) * CELL_W, (i // COLS) * CELL_H
                ox, oy = cx + (CELL_W - w) // 2, cy + (CELL_H - h) // 2
                sheet[oy:oy + h, ox:ox + w] = out
                sheet[band_h + oy:band_h + oy + h, ox:ox + w] = acc
                meta["classes"][cid]["cells"].append({"v": var, "f": fr, "x": ox * ART_PX, "y": oy * ART_PX, "w": w * ART_PX, "h": h * ART_PX})
                i += 1
    big = upscale(sheet, ART_PX)
    Image.fromarray(big, "RGBA").save(os.path.join(OUT, "drones.png"))
    with open(os.path.join(OUT, "drones.json"), "w") as f:
        json.dump(meta, f, indent=1)
    # preview: hull + cyan-tinted accent on a dark ground, 2x
    hull = big[:band_h * ART_PX].astype(float) / 255
    accm = big[band_h * ART_PX:].astype(float) / 255
    tint = np.array([57, 245, 255]) / 255
    rgb = hull[..., :3] * (1 - accm[..., 3:4]) + tint * accm[..., 3:4]
    a = np.maximum(hull[..., 3], accm[..., 3])
    ground = np.array([11, 16, 48]) / 255
    comp = rgb * a[..., None] + ground * (1 - a[..., None])
    Image.fromarray((comp * 255).astype(np.uint8), "RGB").resize((comp.shape[1] // 2, comp.shape[0] // 2), Image.NEAREST).save(os.path.join(OUT, "drones-preview.png"))
    print(f"drones.png {big.shape[1]}x{big.shape[0]}  cells {cells}  band {band_h * ART_PX}px")


if __name__ == "__main__":
    main()
