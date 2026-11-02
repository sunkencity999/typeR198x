#!/usr/bin/env python3
"""Procedural mid-depth silhouette strips for Type-R 198X (presentation pass 2026-11, AMBIENT).

A third parallax layer between the painted backdrop and the near foreground: dark structures drifting at a speed
between the two, so the world has depth in motion. Three seamless strips (the sector table in 73-ambient.js picks
one per sector), each 2816 x 640 master px on a 4 px art grid, alpha everywhere except the shapes:

    wreckage   derelict hull sections, torn plating, trailing cables, a cracked dome
    gantry     lattice cranes, antenna masts, a tethered cargo pod, catwalk spans
    asteroids  tumbling rock chunks with a few mining beacons

Silhouettes are a two-tone navy (body + a lighter rim on the top edges) with a handful of 1-2 art px lights (white;
the game tints and blinks nothing here, the bloom pass catches them). Everything stays sparse: the strip is behind
the plates, so coverage is kept under ~22 % and no shape rises above y = 0.2 of the strip height.

Usage: python3 gen_midlayer.py <out_dir> [seed]   -> <out_dir>/<id>.png (+ preview)
"""
import os, sys
import numpy as np
from PIL import Image

OUT = sys.argv[1] if len(sys.argv) > 1 else "."
SEED = int(sys.argv[2]) if len(sys.argv) > 2 else 6
ART = 4
W, H = 2816 // ART, 640 // ART          # 704 x 160 art px
BODY = (14, 17, 38)
RIM = (36, 42, 82)
DEEP = (9, 11, 26)
LIGHT = (246, 247, 255)


def blank():
    return np.zeros((H, W, 4), np.uint8)


def fill(out, mask, color):
    out[mask, :3] = color
    out[mask, 3] = 255


def rect_mask(x0, y0, x1, y1):
    m = np.zeros((H, W), bool)
    xs = np.arange(x0, x1) % W
    y0, y1 = max(0, y0), min(H, y1)
    if y1 > y0:
        m[y0:y1, xs] = True
    return m


def ellipse_mask(cx, cy, rx, ry):
    ys, xs = np.mgrid[0:H, 0:W]
    dx = (xs - cx + W / 2) % W - W / 2
    return ((dx / rx) ** 2 + ((ys - cy) / ry) ** 2) <= 1


def line_mask(x0, y0, x1, y1, t=1):
    m = np.zeros((H, W), bool)
    n = int(max(abs(x1 - x0), abs(y1 - y0)) * 2) + 1
    for i in range(n):
        u = i / max(1, n - 1)
        x, y = x0 + (x1 - x0) * u, y0 + (y1 - y0) * u
        for dy in range(-t // 2, t // 2 + 1):
            for dx in range(-t // 2, t // 2 + 1):
                yy, xx = int(y) + dy, int(x + dx) % W
                if 0 <= yy < H:
                    m[yy, xx] = True
    return m


def rim(out, mask):
    """Lighter top edge: a shape pixel whose upper neighbour is empty."""
    up = np.zeros_like(mask)
    up[1:] = mask[1:] & ~mask[:-1]
    out[up, :3] = RIM
    out[up, 3] = 255


def lights(out, mask, rng, n):
    ys, xs = np.nonzero(mask)
    if not len(ys):
        return
    for _ in range(n):
        i = rng.integers(len(ys))
        y, x = ys[i], xs[i]
        out[y, x, :3] = LIGHT
        out[y, x, 3] = 255


def wreckage(rng):
    out = blank()
    shape = np.zeros((H, W), bool)
    for _ in range(5):
        cx = rng.integers(0, W)
        cy = rng.integers(int(H * 0.45), int(H * 0.85))
        w, h = rng.integers(60, 140), rng.integers(14, 30)
        hull = rect_mask(cx - w // 2, cy - h // 2, cx + w // 2, cy + h // 2)
        # tear a bite out of one end
        bite = ellipse_mask(cx + (w // 2) * rng.choice([-1, 1]), cy + rng.integers(-h // 2, h // 2), rng.integers(10, 22), rng.integers(8, 16))
        hull &= ~bite
        # a ragged top: knock out a few columns
        for _ in range(rng.integers(3, 7)):
            x = rng.integers(cx - w // 2, cx + w // 2)
            hull &= ~rect_mask(x, cy - h // 2, x + rng.integers(2, 6), cy - h // 2 + rng.integers(2, 6))
        shape |= hull
        # trailing cables
        for _ in range(rng.integers(1, 3)):
            x0 = rng.integers(cx - w // 2, cx + w // 2)
            shape |= line_mask(x0, cy + h // 2, x0 + rng.integers(-30, 30), min(H - 1, cy + h // 2 + rng.integers(20, 45)), 1)
    # a cracked dome
    cx, cy = rng.integers(0, W), int(H * 0.78)
    dome = ellipse_mask(cx, cy, 44, 30) & ~rect_mask(0, cy, W, H)
    dome &= ~line_mask(cx - 10, cy - 30, cx + 6, cy, 2)
    shape |= dome
    fill(out, shape, BODY)
    rim(out, shape)
    lights(out, shape, rng, 9)
    return out


def gantry(rng):
    out = blank()
    shape = np.zeros((H, W), bool)
    for _ in range(4):
        x = rng.integers(0, W)
        top = rng.integers(int(H * 0.25), int(H * 0.5))
        # lattice mast: two rails + diagonals
        shape |= rect_mask(x, top, x + 2, H)
        shape |= rect_mask(x + 10, top, x + 12, H)
        y = top
        flip = False
        while y < H - 8:
            shape |= line_mask(x, y, x + 11, y + 8, 1) if flip else line_mask(x + 11, y, x, y + 8, 1)
            flip = not flip
            y += 8
        # jib
        arm = rng.integers(40, 90)
        d = rng.choice([-1, 1])
        shape |= rect_mask(min(x, x + d * arm), top, max(x, x + d * arm) + 12, top + 3)
        # hanging pod
        px = x + d * rng.integers(arm // 2, arm)
        shape |= line_mask(px, top + 3, px, top + 3 + rng.integers(10, 30), 1)
        shape |= rect_mask(px - 6, top + 3 + 20, px + 6, top + 3 + 34)
    # antenna masts
    for _ in range(3):
        x = rng.integers(0, W)
        top = rng.integers(int(H * 0.3), int(H * 0.6))
        shape |= rect_mask(x, top, x + 1, H)
        for k in range(3):
            yy = top + 6 + k * 9
            shape |= rect_mask(x - 4 - k * 2, yy, x + 5 + k * 2, yy + 1)
    # catwalk span near the bottom
    y = int(H * 0.86)
    shape |= rect_mask(0, y, W, y + 2)
    for x in range(0, W, 12):
        shape |= rect_mask(x, y - 4, x + 1, y)
    fill(out, shape, BODY)
    rim(out, shape)
    lights(out, shape, rng, 12)
    return out


def asteroids(rng):
    out = blank()
    shape = np.zeros((H, W), bool)
    for _ in range(9):
        cx = rng.integers(0, W)
        cy = rng.integers(int(H * 0.35), int(H * 0.9))
        r = rng.integers(8, 26)
        rock = np.zeros((H, W), bool)
        for _ in range(rng.integers(3, 6)):
            rock |= ellipse_mask(cx + rng.integers(-r // 2, r // 2), cy + rng.integers(-r // 3, r // 3), rng.integers(r // 2, r), rng.integers(r // 3, int(r * 0.8)))
        shape |= rock
    fill(out, shape, BODY)
    rim(out, shape)
    # mining beacons: a short mast + light on three rocks
    ys, xs = np.nonzero(shape)
    for _ in range(3):
        i = rng.integers(len(ys))
        y, x = ys[i], xs[i]
        top = max(0, y - rng.integers(6, 12))
        m = line_mask(x, top, x, y, 1)
        fill(out, m, RIM)
        out[top, x, :3] = LIGHT
        out[top, x, 3] = 255
    return out


def main():
    rng = np.random.default_rng(SEED)
    gens = {"wreckage": wreckage, "gantry": gantry, "asteroids": asteroids}
    previews = []
    for name, fn in gens.items():
        art = fn(rng)
        cover = (art[..., 3] > 0).mean()
        big = np.repeat(np.repeat(art, ART, 0), ART, 1)
        Image.fromarray(big, "RGBA").save(os.path.join(OUT, f"{name}.png"))
        ground = np.array([30, 36, 70], np.float32)
        a = art[..., 3:4].astype(np.float32) / 255
        comp = art[..., :3].astype(np.float32) * a + ground * (1 - a)
        previews.append(comp.astype(np.uint8))
        print(f"{name}.png {big.shape[1]}x{big.shape[0]} coverage {cover * 100:.1f}%")
    Image.fromarray(np.concatenate(previews, 0), "RGB").save(os.path.join(OUT, "midlayer-preview.png"))


if __name__ == "__main__":
    main()
