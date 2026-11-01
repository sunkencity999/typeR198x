#!/usr/bin/env python3
"""Procedural neon pixel-art explosion sheet for Type-R 198X.

Writes a 2816x1536 RGBA sheet laid out for the EXPLOSION_FRAMES indices in assets/js/core/30-content.js
(small set 2,1,0; medium 9,7,6,5,4,3,8; large 15,14,12,11,13,19,17; 16 = debris chunk; 10, 18, 20 unused)
plus frames.json with the rects, and a preview on a dark ground.

Palette: the game's tokens (white core, cyan, magenta, violet, indigo smoke). Every frame is drawn on a coarse
art grid (ART_PX screen pixels per art pixel) and upscaled with nearest-neighbour, so the sprites read as the
same chunky pixel art as the backdrops. Flash frames are drawn additively by the game; the rest source-over.

Usage: python3 gen_explosions.py <out_dir> [seed]
"""
import json, sys, os
import numpy as np
from PIL import Image
from scipy.ndimage import zoom

OUT = sys.argv[1] if len(sys.argv) > 1 else "."
SEED = int(sys.argv[2]) if len(sys.argv) > 2 else 198
ART_PX = 4
SHEET_W, SHEET_H = 2816, 1536
PAL = {
    "white": (246, 247, 255), "cyan": (57, 245, 255), "magenta": (255, 57, 209), "violet": (184, 107, 255),
    "indigo": (52, 24, 84), "smoke": (28, 14, 46), "deep": (14, 8, 24), "lime": (168, 255, 58), "amber": (255, 193, 74),
}

def noise(n, cells, seed):
    rng = np.random.default_rng(seed)
    g = rng.random((cells, cells))
    z = zoom(g, (n / cells, n / cells), order=3)
    z = (z - z.min()) / max(1e-6, (z.max() - z.min()))
    return z[:n, :n]

def paint(out, mask, color, alpha=1.0):
    r, g, b = color
    out[mask, 0] = r; out[mask, 1] = g; out[mask, 2] = b; out[mask, 3] = int(round(255 * alpha))

def frame(size_px, kind, t, seed):
    n = size_px // ART_PX
    yy, xx = np.mgrid[0:n, 0:n]
    c = (n - 1) / 2
    dx, dy = xx - c, yy - c
    d = np.hypot(dx, dy) / (n / 2)            # 0 at centre, 1 at the inscribed circle
    ang = np.arctan2(dy, dx)
    nz = noise(n, 6, seed)
    nz2 = noise(n, 11, seed + 7)
    out = np.zeros((n, n, 4), np.uint8)
    rng = np.random.default_rng(seed + 3)

    if kind == "flash":
        r0 = 0.14 + 0.16 * t
        lobes = 8 if t < 0.5 else 12
        spike = np.abs(np.cos(lobes * ang / 2 + rng.random() * 3.0)) ** 14
        r_sp = r0 + (0.26 + 0.16 * t) * spike * (0.85 + 0.3 * nz)
        core = d < r0 * (0.9 + 0.2 * nz2)
        rays = (d < r_sp) & ~core
        paint(out, rays, PAL["cyan"])
        thin = rays & (spike > 0.6) & (d > r0 * 1.6)
        paint(out, thin, PAL["white"])
        paint(out, core, PAL["white"])
        ring = (d > r0 * 1.25) & (d < r0 * 1.42) & (nz2 > 0.35)
        paint(out, ring & ~rays, PAL["magenta"])
        return out

    if kind == "fire":
        R = 0.30 + 0.66 * t
        r_e = R * (0.80 + 0.40 * nz)
        hollow = max(0.0, (t - 0.32)) / 0.68
        r_in = hollow * R * 0.78 * (0.78 + 0.35 * nz2)
        mask = (d < r_e) & (d > r_in)
        s = np.clip((d - r_in) / np.maximum(1e-3, (r_e - r_in)), 0, 1)     # 0 inner edge, 1 outer edge
        s = np.clip(s + 0.22 * (nz2 - 0.5), 0, 0.999)                       # jagged band borders
        streak = np.abs(np.sin(ang * 7 + nz * 4.0)) ** 8 > 0.45              # radial streaks lift a band
        s = np.where(streak, np.clip(s - 0.25, 0, 0.999), s)
        band = np.floor(s * 4).astype(int)                                  # 4 posterised bands
        if t < 0.45:
            cols = [PAL["white"], PAL["cyan"], PAL["magenta"], PAL["violet"]]
        elif t < 0.7:
            cols = [PAL["cyan"], PAL["magenta"], PAL["violet"], PAL["indigo"]]
        else:
            cols = [PAL["magenta"], PAL["violet"], PAL["indigo"], PAL["smoke"]]
        for i in range(4):
            paint(out, mask & (band == i), cols[i])
        # sparkle pixels inside the shell
        spark = mask & (nz2 > 0.82) & (t < 0.6)
        paint(out, spark, PAL["white"])
        # shards flying ahead of the shell
        k = 10 + int(6 * t)
        for i in range(k):
            a = rng.random() * 2 * np.pi
            rr = R * (1.02 + 0.38 * rng.random())
            px, py = c + np.cos(a) * rr * (n / 2), c + np.sin(a) * rr * (n / 2)
            sz = 1 if rng.random() < 0.6 else 2
            x0, y0 = int(round(px)), int(round(py))
            if 0 <= x0 < n - sz and 0 <= y0 < n - sz:
                col = PAL["cyan"] if rng.random() < 0.6 else (PAL["white"] if t < 0.5 else PAL["magenta"])
                out[y0:y0 + sz, x0:x0 + sz, :3] = col
                out[y0:y0 + sz, x0:x0 + sz, 3] = 255
        return out

    if kind == "smoke":
        R = 0.92
        fade = 1.0 - max(0.0, (t - 0.72)) / 0.3
        alpha = max(0.0, min(1.0, 0.9 * fade))
        puffs = np.zeros((n, n), bool)
        k = 8
        for i in range(k):
            a = (i / k) * 2 * np.pi + rng.random() * 0.4
            rr = (0.28 + 0.22 * rng.random()) * R
            px, py = c + np.cos(a) * rr * (n / 2), c + np.sin(a) * rr * (n / 2)
            pr = (0.26 + 0.14 * rng.random()) * R * (n / 2)
            puffs |= np.hypot(xx - px, yy - py) < pr * (0.86 + 0.28 * nz2)
        puffs |= d < 0.3 * R * (0.9 + 0.2 * nz)
        hole = d < (0.18 + 0.5 * max(0.0, t - 0.75) / 0.25) * R * (0.8 + 0.4 * nz2) if t > 0.75 else np.zeros_like(puffs)
        body = puffs & ~hole
        paint(out, body, PAL["indigo"], alpha)
        inner = body & (nz2 < 0.45)
        paint(out, inner, PAL["smoke"], alpha)
        # lit rim (two art pixels) facing the player ship on the left, and embers in the folds
        shifted = np.roll(np.roll(body, 2, axis=1), -1, axis=0)
        rim = body & ~shifted
        paint(out, rim, PAL["violet"], alpha)
        ember = body & (nz > 0.8) & (t < 0.9)
        paint(out, ember, PAL["magenta"], alpha)
        return out

    if kind == "debris":
        pts = [(0.15, 0.35), (0.45, 0.1), (0.85, 0.3), (0.9, 0.7), (0.55, 0.92), (0.2, 0.75)]
        from PIL import ImageDraw
        im = Image.new("RGBA", (n, n), (0, 0, 0, 0))
        dr = ImageDraw.Draw(im)
        poly = [(x * (n - 1), y * (n - 1)) for x, y in pts]
        dr.polygon(poly, fill=PAL["deep"] + (255,), outline=PAL["cyan"] + (255,))
        dr.line([poly[1], poly[4]], fill=PAL["violet"] + (255,), width=1)
        return np.array(im)
    raise ValueError(kind)

def up(arr):
    im = Image.fromarray(arr, "RGBA")
    return im.resize((im.width * ART_PX, im.height * ART_PX), Image.NEAREST)

# Sets: (kind, t) in the play order of EXPLOSION_SETS; indices as the content table expects.
SMALL = [("flash", 0.3), ("fire", 0.5), ("smoke", 0.95)]                                   # indices 2, 1, 0
MEDIUM = [("flash", 0.0), ("flash", 0.6), ("fire", 0.28), ("fire", 0.48), ("fire", 0.68), ("smoke", 0.8), ("smoke", 0.98)]   # 9,7,6,5,4,3,8
LARGE = [("flash", 0.1), ("flash", 0.8), ("fire", 0.25), ("fire", 0.45), ("fire", 0.62), ("smoke", 0.78), ("smoke", 0.97)]  # 15,14,12,11,13,19,17

frames = {}
def put(idx, size, kind, t, seed):
    frames[idx] = up(frame(size, kind, t, seed))

for i, (k, t) in zip([2, 1, 0], SMALL): put(i, 160, k, t, SEED + i)
for i, (k, t) in zip([9, 7, 6, 5, 4, 3, 8], MEDIUM): put(i, 300, k, t, SEED + 20 + i)
for i, (k, t) in zip([15, 14, 12, 11, 13, 19, 17], LARGE): put(i, 520, k, t, SEED + 40 + i)
frames[16] = up(frame(96, "debris", 0, SEED + 99))
for i in (10, 18, 20): frames[i] = Image.new("RGBA", (16, 16), (0, 0, 0, 0))

# Layout rows: large 0-3 | small x3 + debris ; large 4-6 | medium 0-3 ; medium 4-6 ; blanks
sheet = Image.new("RGBA", (SHEET_W, SHEET_H), (0, 0, 0, 0))
rects = {}
def place(idx, x, y):
    im = frames[idx]; sheet.alpha_composite(im, (x, y)); rects[idx] = {"x": x, "y": y, "w": im.width, "h": im.height}
x = 0
for idx in [15, 14, 12, 11]: place(idx, x, 0); x += 520
for idx in [2, 1, 0]: place(idx, x, 0); x += 160
place(16, x, 0)
x = 0
for idx in [13, 19, 17]: place(idx, x, 520); x += 520
for idx in [9, 7, 6, 5]: place(idx, x, 520); x += 300
x = 0
for idx in [4, 3, 8]: place(idx, x, 1040); x += 300
for idx in [10, 18, 20]: place(idx, x, 1040); x += 16

os.makedirs(OUT, exist_ok=True)
sheet.save(os.path.join(OUT, "explosions.png"), optimize=True)
json.dump([rects[i] for i in range(21)], open(os.path.join(OUT, "frames.json"), "w"), indent=0)
prev = Image.new("RGBA", (SHEET_W, 1360), (18, 12, 30, 255)); prev.alpha_composite(sheet.crop((0, 0, SHEET_W, 1360)))
prev.convert("RGB").resize((1408, 680), Image.NEAREST).save(os.path.join(OUT, "explosions_preview.png"))
print("wrote", os.path.join(OUT, "explosions.png"), "rects", len(rects))
