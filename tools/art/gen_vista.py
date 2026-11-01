#!/usr/bin/env python3
"""Procedural pixel-art vistas for Type-R 198X (background + parallax foreground masters, 2816x1504).

Three themes, one per sector that used to reuse another sector's art:
  abyss    sector 6  "Abyssal Relay"  teal   ringed gas giant, relay spires, kelp-like data cables
  foundry  sector 8  "Logic Foundry"  amber  low furnace sun, lava planet, factory skyline, gears and stacks
  engine   sector 9  "Night Engine"   crimson dying red giant, a Dyson-ring fragment, turbine cowlings

Everything is drawn on a 704x376 art grid (one art pixel = 4 master px, the density tools/art/pixelize.py gave the
sprites), upscaled x2 for the fine layer (stars, 2 px highlights, dither), then x2 again. Backgrounds wrap
horizontally (periodic noise, wrapped placement), so the parallax tiling needs no dissolve; foregrounds wrap too.

Usage: gen_vista.py <abyss|foundry|engine> <out_bg.png> <out_fg.png> [--seed N] [--preview p.png]
"""
import argparse, math, os
import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import zoom

BW, BH = 704, 376           # art grid
FW, FH = BW * 2, BH * 2     # fine grid
BAYER = np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]], np.float32) / 16.0

def hexrgb(h):
    h = h.lstrip("#"); return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))

def pnoise(w, h, nx, ny, seed, octaves=3, persistence=0.5):
    """Periodic value noise in [0,1], tileable in x (and y)."""
    rng = np.random.default_rng(seed)
    out = np.zeros((h, w), np.float32); amp = 1.0; tot = 0.0
    for o in range(octaves):
        g = rng.random((ny * 2 ** o, nx * 2 ** o)).astype(np.float32)
        z = zoom(g, (h / g.shape[0], w / g.shape[1]), order=3, mode="grid-wrap", grid_mode=True)
        out += amp * z[:h, :w]; tot += amp; amp *= persistence
    out /= tot
    lo, hi = np.percentile(out, 1), np.percentile(out, 99)
    return np.clip((out - lo) / max(1e-6, hi - lo), 0, 1)

def bands(field, ramp, strength=0.9, bias=0.0):
    """Posterise a [0,1] field into len(ramp) colours with ordered dither. Returns (h,w,3) uint8 and the band index."""
    h, w = field.shape
    d = np.tile(BAYER, (h // 4 + 1, w // 4 + 1))[:h, :w]
    n = len(ramp)
    idx = np.clip(np.floor((field + bias) * n + (d - 0.5) * strength), 0, n - 1).astype(int)
    pal = np.array([hexrgb(c) for c in ramp], np.uint8)
    return pal[idx], idx

class Canvas:
    def __init__(self, w, h, bg=None):
        self.im = Image.new("RGBA", (w, h), bg or (0, 0, 0, 0)); self.w, self.h = w, h
        self.dr = ImageDraw.Draw(self.im)
    def paste_rgb(self, rgb, mask=None, alpha=None):
        a = np.full(rgb.shape[:2], 255, np.uint8) if alpha is None else alpha
        if mask is not None: a = np.where(mask, a, 0).astype(np.uint8)
        layer = Image.fromarray(np.dstack([rgb, a]), "RGBA"); self.im.alpha_composite(layer)
        self.dr = ImageDraw.Draw(self.im)
    # wrapped primitives (x may run past the right edge; the overflow is drawn again at x - w)
    def rect(self, x0, y0, x1, y1, fill, outline=None):
        for dx in (0, -self.w, self.w):
            if x1 + dx < 0 or x0 + dx >= self.w: continue
            self.dr.rectangle([x0 + dx, y0, x1 + dx, y1], fill=fill, outline=outline)
    def poly(self, pts, fill, outline=None):
        xs = [p[0] for p in pts]
        for dx in (0, -self.w, self.w):
            if max(xs) + dx < 0 or min(xs) + dx >= self.w: continue
            self.dr.polygon([(x + dx, y) for x, y in pts], fill=fill, outline=outline)
    def ellipse(self, x0, y0, x1, y1, fill, outline=None, width=1):
        for dx in (0, -self.w, self.w):
            if x1 + dx < 0 or x0 + dx >= self.w: continue
            self.dr.ellipse([x0 + dx, y0, x1 + dx, y1], fill=fill, outline=outline, width=width)
    def line(self, pts, fill, width=1):
        xs = [p[0] for p in pts]
        for dx in (0, -self.w, self.w):
            if max(xs) + dx < 0 or min(xs) + dx >= self.w: continue
            self.dr.line([(x + dx, y) for x, y in pts], fill=fill, width=width)
    def px(self, x, y, fill):
        self.dr.point([(x % self.w, y)], fill=fill)

def shade(hexc, k):
    r, g, b = hexrgb(hexc); return (int(min(255, r * k)), int(min(255, g * k)), int(min(255, b * k)), 255)

def rgba(hexc, a=255):
    return hexrgb(hexc) + (a,)

# ------------------------------------------------------------------ sky elements (art grid)
def sky(c, ramp, seed, band_y=0.4, band_w=0.28, density=1.0):
    f = pnoise(c.w, c.h, 3, 2, seed, 4, 0.55)
    yy = (np.arange(c.h) / c.h)[:, None]
    mask = np.exp(-((yy - band_y) / band_w) ** 2)
    blob = pnoise(c.w, c.h, 2, 1, seed + 11, 2, 0.5)
    field = np.clip((f * 0.75 + blob * 0.45) * mask * density, 0, 1)
    rgb, idx = bands(field, ramp, 0.8)
    c.paste_rgb(rgb, mask=idx > 0)

def stars(c, n, seed, tint, bright):
    rng = np.random.default_rng(seed)
    for i in range(n):
        x, y = int(rng.integers(0, c.w)), int(rng.integers(0, int(c.h * 0.9)))
        r = rng.random()
        col = bright if r < 0.12 else tint if r < 0.5 else shade(tint if isinstance(tint, str) else "#8899aa", 0.6) if isinstance(tint, str) else tint
        if isinstance(col, str): col = rgba(col)
        c.px(x, y, col)
        if r < 0.05:
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)): c.px(x + dx, y + dy, col)

def planet(c, cx, cy, r, ramp, seed, light=(-0.6, -0.5), gas=True, ring=None, craters=0, cracks=None):
    h, w = c.h, c.w
    yy, xx = np.mgrid[0:h, 0:w]
    dx, dy = (xx - cx), (yy - cy)
    # wrapped x distance
    dx = (dx + w / 2) % w - w / 2
    d = np.hypot(dx, dy) / r
    inside = d <= 1.0
    nz = pnoise(w, h, 6 if gas else 4, 1 if gas else 4, seed, 3, 0.5)
    if gas:
        # horizontal bands with a little turbulence
        band_f = ((yy - cy) / r * 2.2 + nz * 0.6) % 1.0
        f = 0.5 + 0.5 * np.sin(band_f * 2 * np.pi) * 0.9
        f = f * 0.7 + nz * 0.3
    else:
        f = nz
    lx, ly = light
    nxn = np.where(inside, dx / r, 0); nyn = np.where(inside, dy / r, 0)
    nzn = np.sqrt(np.clip(1 - nxn ** 2 - nyn ** 2, 0, 1))
    lz = math.sqrt(max(0.0, 1 - lx * lx - ly * ly))
    lit = np.clip(nxn * (-lx) * -1 + nyn * (-ly) * -1 + nzn * lz, 0, 1)   # light vector points from the light toward the planet
    lit = np.clip((nxn * lx + nyn * ly) * -1 + nzn * lz, 0, 1)
    shade_f = np.clip(f * 0.55 + lit * 0.55 - 0.15, 0, 1)
    rgb, idx = bands(shade_f, ramp, 0.9)
    if ring is not None:
        ra, rb, tilt = ring   # semi-axes as multiples of r, tilt radians
        ca, sa = math.cos(tilt), math.sin(tilt)
        ux = dx * ca + dy * sa; uy = -dx * sa + dy * ca
        e = np.hypot(ux / (ra * r), uy / (rb * r))
        ring_m = (e > 0.78) & (e < 1.0)
        ring_col = np.array(hexrgb(ramp[-2]), np.uint8)
        ring_rgb = np.zeros_like(rgb); ring_rgb[:] = ring_col
        gap = (e > 0.86) & (e < 0.9)
        ring_rgb[gap] = hexrgb(ramp[1])
        back = ring_m & (uy < 0) & ~inside
        front = ring_m & (uy >= 0)
        c.paste_rgb(ring_rgb, mask=back)
        c.paste_rgb(rgb, mask=inside)
        c.paste_rgb(ring_rgb, mask=front)
    else:
        c.paste_rgb(rgb, mask=inside)
    if craters:
        rng = np.random.default_rng(seed + 5)
        for i in range(craters):
            a = rng.random() * 2 * math.pi; rr = rng.random() ** 0.5 * r * 0.85
            px_, py_ = cx + math.cos(a) * rr, cy + math.sin(a) * rr
            cr = r * (0.05 + rng.random() * 0.12)
            c.ellipse(px_ - cr, py_ - cr, px_ + cr, py_ + cr, fill=rgba(ramp[0]))
            c.ellipse(px_ - cr + 1, py_ - cr + 1, px_ + cr - 1, py_ + cr - 1, fill=rgba(ramp[1]))
    if cracks is not None:
        col, n = cracks
        rng = np.random.default_rng(seed + 9)
        for i in range(n):
            a = rng.random() * 2 * math.pi; rr = rng.random() * r * 0.7
            x, y = cx + math.cos(a) * rr, cy + math.sin(a) * rr; ang = rng.random() * 2 * math.pi
            pts = [(x, y)]
            for k in range(5 + int(rng.integers(0, 5))):
                ang += (rng.random() - 0.5) * 1.5; ln = r * (0.05 + rng.random() * 0.12)
                x += math.cos(ang) * ln; y += math.sin(ang) * ln
                if math.hypot(x - cx, y - cy) > r * 0.95: break
                pts.append((x, y))
            if len(pts) > 1: c.line(pts, rgba(col), 1)
    # limb: 1 px lit edge toward the light
    edge = inside & (d > 0.94) & (((nxn * lx + nyn * ly) * -1) > 0.2)
    lim = np.zeros_like(rgb); lim[:] = hexrgb(ramp[-1])
    c.paste_rgb(lim, mask=edge)

def sun(c, cx, cy, r, ramp, seed, rays=True):
    h, w = c.h, c.w
    yy, xx = np.mgrid[0:h, 0:w]
    dx = (xx - cx + w / 2) % w - w / 2; dy = yy - cy
    d = np.hypot(dx, dy) / r
    nz = pnoise(w, h, 8, 8, seed, 3)
    corona = np.clip(1.35 - d, 0, 1) ** 2.2 * (0.7 + 0.5 * nz)
    disc = 0.72 + 0.26 * np.clip(1 - d / 0.8, 0, 1) ** 1.5 + 0.06 * nz      # 2nd-brightest band, brighter dithered core
    corona = np.where(d < 1.0, disc, corona * 0.72)
    rgb, idx = bands(np.clip(corona, 0, 1), ramp, 1.0)
    c.paste_rgb(rgb, mask=idx > 0)
    # spots
    rng = np.random.default_rng(seed + 3)
    for i in range(7):
        a = rng.random() * 2 * math.pi; rr = rng.random() * r * 0.8
        sx, sy = cx + math.cos(a) * rr, cy + math.sin(a) * rr; sr = r * (0.04 + rng.random() * 0.09)
        c.ellipse(sx - sr, sy - sr * 0.7, sx + sr, sy + sr * 0.7, fill=rgba(ramp[1]))

def skyline(c, base_y, pal, seed, hmin, hmax, wmin, wmax, light, spires=True, dishes=False, stacks=False, fins=False, density=0.75):
    """Periodic row of dark structures standing on base_y. pal: (dark, mid, light, window)."""
    rng = np.random.default_rng(seed)
    dark, mid, lightc, win = pal
    x = 0
    while x < c.w:
        bw = int(rng.integers(wmin, wmax)); bh = int(rng.integers(hmin, hmax))
        if rng.random() < density:
            y0 = base_y - bh
            c.rect(x, y0, x + bw, base_y, fill=rgba(mid))
            c.rect(x, y0, x + bw, y0, fill=rgba(lightc))                 # top edge
            c.rect(x + bw - 1, y0, x + bw, base_y, fill=rgba(dark))      # right shade
            # windows
            for wy in range(y0 + 3, base_y - 2, 4):
                for wx in range(x + 2, x + bw - 2, 4):
                    if rng.random() < light: c.px(wx, wy, rgba(win))
            if spires and rng.random() < 0.45:
                sx = x + bw // 2; sh = int(rng.integers(8, 30))
                c.line([(sx, y0), (sx, y0 - sh)], rgba(mid), 1); c.px(sx, y0 - sh - 1, rgba(win))
                if dishes:
                    dr_ = int(rng.integers(3, 7)); c.ellipse(sx - dr_, y0 - sh - dr_, sx + dr_, y0 - sh + dr_, fill=rgba(dark), outline=rgba(lightc))
            if stacks and rng.random() < 0.5:
                for k in range(int(rng.integers(1, 4))):
                    sx = x + 3 + int(rng.random() * max(1, bw - 8)); sw = int(rng.integers(3, 6)); sh = int(rng.integers(10, 40))
                    c.rect(sx, y0 - sh, sx + sw, y0, fill=rgba(dark)); c.rect(sx - 1, y0 - sh, sx + sw + 1, y0 - sh + 2, fill=rgba(lightc))
                    c.px(sx + sw // 2, y0 - sh - 1, rgba(win))
            if fins and rng.random() < 0.6:
                for fx in range(x + 2, x + bw - 2, 6):
                    c.rect(fx, y0 - int(rng.integers(4, 14)), fx + 2, y0, fill=rgba(dark))
        x += bw + int(rng.integers(0, 6))

def haze(c, y0, y1, hexc, a_top=0.0, a_bot=0.55):
    h, w = c.h, c.w
    yy = np.arange(h)[:, None].astype(np.float32)
    t = np.clip((yy - y0) / max(1, y1 - y0), 0, 1)
    a = (a_top + (a_bot - a_top) * t) * np.ones((h, w), np.float32)
    d = np.tile(BAYER, (h // 4 + 1, w // 4 + 1))[:h, :w]
    aq = np.clip(np.floor(a * 6 + (d - 0.5) * 0.9), 0, 6) / 6.0
    rgb = np.zeros((h, w, 3), np.uint8); rgb[:] = hexrgb(hexc)
    c.paste_rgb(rgb, mask=aq > 0, alpha=(aq * 255).astype(np.uint8))

def horizon_grid(c, y0, hexc, vanish_x, rows=9, cols=18, a=200):
    col = rgba(hexc, a); h = c.h
    for i in range(rows):
        t = (i / rows) ** 2.0; y = int(y0 + (h - y0) * t)
        c.line([(0, y), (c.w, y)], col, 1)
    for i in range(cols + 1):
        x_bottom = i * c.w / cols
        c.line([(vanish_x, y0), (x_bottom, h)], col, 1)

# ------------------------------------------------------------------ foreground elements (art grid, transparent canvas)
def bevel_poly(c, pts, pal):
    dark, mid, lightc = pal
    c.poly(pts, fill=rgba(mid), outline=rgba(dark))
    # top-left highlight: edges whose normal points up-left
    for (x0, y0), (x1, y1) in zip(pts, pts[1:] + pts[:1]):
        if y1 < y0 or (y1 == y0 and x1 < x0):
            c.line([(x0, y0), (x1, y1)], rgba(lightc), 1)

def ground(c, y0, pal, seed, panels=True):
    dark, mid, lightc, win = pal
    c.rect(0, y0, c.w, c.h, fill=rgba(mid)); c.rect(0, y0, c.w, y0 + 1, fill=rgba(lightc))
    rng = np.random.default_rng(seed)
    if panels:
        x = 0
        while x < c.w:
            pw = int(rng.integers(18, 48)); c.line([(x, y0 + 2), (x, c.h)], rgba(dark), 1)
            if rng.random() < 0.4: c.rect(x + 3, y0 + 5, x + 3 + int(rng.integers(3, 9)), y0 + 6, fill=rgba(win))
            x += pw
        c.rect(0, y0 + 10, c.w, y0 + 11, fill=rgba(dark))

def cables(c, pal, seed, n, y_top_frac, y_base):
    dark, mid, lightc, win = pal
    rng = np.random.default_rng(seed)
    for i in range(n):
        x = int(i * c.w / n + rng.integers(0, int(c.w / n)))
        top = int(c.h * (y_top_frac + rng.random() * 0.2))
        wdt = int(rng.integers(5, 12)); amp = rng.random() * 18 + 6; ph = rng.random() * 6
        pts = []
        for y in range(y_base, top, -3):
            t = (y_base - y) / max(1, y_base - top)
            pts.append((x + math.sin(t * 5 + ph) * amp * t, y))
        c.line(pts, rgba(dark), wdt + 2); c.line(pts, rgba(mid), wdt)
        c.line([(px - wdt * 0.3, py) for px, py in pts], rgba(lightc), 1)
        # nodes
        for k in range(2, len(pts), 9):
            px_, py_ = pts[k]; c.rect(px_ - wdt * 0.6, py_ - 2, px_ + wdt * 0.6, py_ + 2, fill=rgba(dark)); c.rect(px_ - 1, py_ - 1, px_ + 1, py_, fill=rgba(win))
        # bulb at the top
        px_, py_ = pts[-1]; c.ellipse(px_ - wdt, py_ - wdt * 1.4, px_ + wdt, py_ + wdt * 0.6, fill=rgba(mid), outline=rgba(dark)); c.ellipse(px_ - 2, py_ - wdt * 0.6, px_ + 2, py_ - wdt * 0.6 + 4, fill=rgba(win))

def monoliths(c, pal, seed, n, y_base):
    dark, mid, lightc, win = pal
    rng = np.random.default_rng(seed)
    for i in range(n):
        x = int(i * c.w / n + rng.integers(0, int(c.w / n * 0.6))); w = int(rng.integers(26, 70)); h = int(rng.integers(60, 150))
        bevel_poly(c, [(x, y_base), (x, y_base - h), (x + w, y_base - h), (x + w, y_base)], (dark, mid, lightc))
        for sy in range(y_base - h + 6, y_base - 6, 7):
            if rng.random() < 0.7: c.rect(x + 4, sy, x + w - 4, sy, fill=rgba(dark))
            if rng.random() < 0.35: c.rect(x + 5, sy + 2, x + 5 + int(rng.integers(3, w - 10)), sy + 2, fill=rgba(win))

def gear(c, cx, cy, r, teeth, pal, seed_rot=0.0):
    dark, mid, lightc = pal
    pts = []
    for i in range(teeth * 2):
        a = seed_rot + i * math.pi / teeth; rr = r if i % 2 == 0 else r * 0.82
        pts.append((cx + math.cos(a) * rr, cy + math.sin(a) * rr))
    bevel_poly(c, pts, pal)
    c.ellipse(cx - r * 0.55, cy - r * 0.55, cx + r * 0.55, cy + r * 0.55, fill=rgba(dark))
    c.ellipse(cx - r * 0.42, cy - r * 0.42, cx + r * 0.42, cy + r * 0.42, fill=rgba(mid), outline=rgba(lightc))
    for i in range(6):
        a = seed_rot + i * math.pi / 3
        c.ellipse(cx + math.cos(a) * r * 0.3 - 2, cy + math.sin(a) * r * 0.3 - 2, cx + math.cos(a) * r * 0.3 + 2, cy + math.sin(a) * r * 0.3 + 2, fill=rgba(dark))

def pipe(c, x0, x1, y, w, pal, win, joints=3):
    dark, mid, lightc = pal
    c.rect(x0, y, x1, y + w, fill=rgba(mid)); c.rect(x0, y, x1, y + 1, fill=rgba(lightc)); c.rect(x0, y + w - 1, x1, y + w, fill=rgba(dark))
    for j in range(joints):
        jx = x0 + (x1 - x0) * (j + 0.5) / joints
        c.rect(jx - 3, y - 2, jx + 3, y + w + 2, fill=rgba(dark)); c.rect(jx - 2, y - 1, jx + 2, y + w + 1, fill=rgba(mid)); c.px(int(jx), y - 1, rgba(win))

def stack(c, x, y_base, w, h, pal, win):
    dark, mid, lightc = pal
    bevel_poly(c, [(x, y_base), (x + 2, y_base - h), (x + w - 2, y_base - h), (x + w, y_base)], pal)
    c.rect(x - 2, y_base - h, x + w + 2, y_base - h + 3, fill=rgba(dark)); c.rect(x - 2, y_base - h, x + w + 2, y_base - h, fill=rgba(lightc))
    for k in range(3): c.rect(x + 2, y_base - h + 8 + k * 7, x + w - 2, y_base - h + 8 + k * 7, fill=rgba(dark))
    c.rect(x + w // 2 - 1, y_base - h - 2, x + w // 2 + 1, y_base - h - 1, fill=rgba(win))

def turbine(c, cx, cy, r, pal, win, blades=9):
    dark, mid, lightc = pal
    c.ellipse(cx - r, cy - r, cx + r, cy + r, fill=rgba(mid), outline=rgba(dark), width=2)
    c.ellipse(cx - r + 3, cy - r + 3, cx + r - 3, cy + r - 3, fill=rgba(dark))
    for i in range(blades):
        a = i * 2 * math.pi / blades
        pts = [(cx + math.cos(a) * r * 0.2, cy + math.sin(a) * r * 0.2), (cx + math.cos(a + 0.25) * r * 0.88, cy + math.sin(a + 0.25) * r * 0.88), (cx + math.cos(a + 0.42) * r * 0.88, cy + math.sin(a + 0.42) * r * 0.88)]
        c.poly(pts, fill=rgba(mid), outline=rgba(lightc))
    c.ellipse(cx - r * 0.22, cy - r * 0.22, cx + r * 0.22, cy + r * 0.22, fill=rgba(lightc))
    c.ellipse(cx - r * 0.1, cy - r * 0.1, cx + r * 0.1, cy + r * 0.1, fill=rgba(win))
    # rim lights
    for i in range(12):
        a = i * 2 * math.pi / 12; c.px(int(cx + math.cos(a) * (r - 1.5)), int(cy + math.sin(a) * (r - 1.5)), rgba(win))

def cone(c, x, y, w, h, pal, win):
    dark, mid, lightc = pal
    bevel_poly(c, [(x, y), (x + w, y - h * 0.3), (x + w, y + h * 0.3), (x, y + h * 0.6)], pal)
    c.rect(x + w - 3, y - h * 0.3, x + w, y + h * 0.3, fill=rgba(dark)); c.rect(x + w - 2, y - h * 0.1, x + w - 1, y + h * 0.1, fill=rgba(win))

def strut(c, pts, pal, w=4):
    dark, mid, lightc = pal
    c.line(pts, rgba(dark), w + 2); c.line(pts, rgba(mid), w); c.line([(x, y - 1) for x, y in pts], rgba(lightc), 1)

def asteroids(c, seed, n, y0, y1, pal):
    dark, mid, lightc = pal
    rng = np.random.default_rng(seed)
    for i in range(n):
        x, y = rng.integers(0, c.w), rng.integers(y0, y1); r = rng.integers(2, 9)
        pts = [(x + math.cos(a) * r * (0.7 + 0.5 * rng.random()), y + math.sin(a) * r * (0.7 + 0.5 * rng.random())) for a in np.linspace(0, 2 * math.pi, 7, endpoint=False)]
        bevel_poly(c, pts, (dark, mid, lightc))

def ring_fragment(c, cx, cy, r_out, r_in, a0, a1, pal, win, seed):
    dark, mid, lightc = pal
    steps = 48
    outer = [(cx + math.cos(a) * r_out, cy + math.sin(a) * r_out) for a in np.linspace(a0, a1, steps)]
    inner = [(cx + math.cos(a) * r_in, cy + math.sin(a) * r_in) for a in np.linspace(a1, a0, steps)]
    c.poly(outer + inner, fill=rgba(mid), outline=rgba(dark))
    rng = np.random.default_rng(seed)
    for a in np.linspace(a0, a1, 40):
        rr = (r_out + r_in) / 2
        if rng.random() < 0.6: c.px(int(cx + math.cos(a) * rr), int(cy + math.sin(a) * rr), rgba(win))
    # segment lines
    for a in np.linspace(a0, a1, 14):
        c.line([(cx + math.cos(a) * r_in, cy + math.sin(a) * r_in), (cx + math.cos(a) * r_out, cy + math.sin(a) * r_out)], rgba(dark), 1)
    c.line(outer, rgba(lightc), 1)

# ------------------------------------------------------------------ themes
THEMES = {
    "abyss": dict(
        sky=["#04070f", "#071526", "#0b2a3c", "#0f4a4e", "#15806e", "#19d9b0"], base="#04070f",
        star_tint="#6fd8e0", star_bright="#e6fffb",
        planet=["#07111c", "#0d2a3a", "#145a5a", "#1c8f7a", "#3ad3b0", "#b6fff0"],
        structure=("#06101a", "#0c1d2b", "#1b3a4a", "#19d9b0"), fg=("#04080f", "#0a1826", "#1a3d4d", "#19d9b0"), haze="#0b2a3c"),
    "foundry": dict(
        sky=["#0b0507", "#1c0a0c", "#3a1410", "#6a2a12", "#b85a18", "#ffc14a"], base="#0b0507",
        star_tint="#c9a070", star_bright="#fff0d0",
        planet=["#0e0806", "#241410", "#3a2018", "#5a3020", "#8a4a28", "#ffb070"],
        structure=("#0c0908", "#1c1512", "#3a2d24", "#ffc14a"), fg=("#0a0706", "#1a1310", "#3f2f24", "#ffc14a"), haze="#3a1410",
        sun=["#3a1410", "#6a2a12", "#b85a18", "#ff8a2a", "#ffc14a", "#ffe8a0"]),
    "engine": dict(
        sky=["#06030a", "#140716", "#2a0b22", "#4a1030", "#8a1a3a", "#ff3366"], base="#06030a",
        star_tint="#d08aa0", star_bright="#ffe0ea",
        planet=["#0a0408", "#1e0a12", "#3a1020", "#6a1a30", "#a82848", "#ff6a8a"],
        structure=("#0a0510", "#160d1c", "#2e1a30", "#ff3366"), fg=("#08040c", "#160c1a", "#301a34", "#ff3366"), haze="#2a0b22",
        sun=["#2a0b22", "#5a1030", "#9a1a3a", "#d8203c", "#ff4a40", "#ffb070"]),   # dying red giant: red to a hot orange core
}

def build(theme, seed):
    T = THEMES[theme]
    bg = Canvas(BW, BH, rgba(T["base"]))
    fg = Canvas(BW, BH)
    S = T["structure"]; F = T["fg"]
    if theme == "abyss":
        sky(bg, T["sky"], seed, band_y=0.38, band_w=0.26, density=1.05)
        stars(bg, 420, seed + 1, T["star_tint"], T["star_bright"])
        planet(bg, 112, 96, 34, T["planet"], seed + 2, light=(0.7, -0.4), gas=False, craters=6)
        planet(bg, 520, 150, 92, T["planet"], seed + 3, light=(-0.7, -0.35), gas=True, ring=(1.9, 0.42, -0.35))
        haze(bg, 200, 300, T["haze"], 0.0, 0.5)
        skyline(bg, 300, S, seed + 4, 20, 90, 10, 34, 0.18, spires=True, dishes=True, density=0.7)
        skyline(bg, 318, (S[0], S[0], S[1], S[3]), seed + 5, 10, 40, 16, 50, 0.08, spires=False, density=0.9)
        ground(bg, 318, (S[0], S[0], S[1], S[3]), seed + 6, panels=False)
        # foreground: cables and monoliths over a plated floor
        monoliths(fg, F, seed + 7, 7, 332)
        cables(fg, F, seed + 8, 9, 0.28, 346)
        ground(fg, 340, F, seed + 9)
    elif theme == "foundry":
        sky(bg, T["sky"][:4] + [T["sky"][3]], seed, band_y=0.55, band_w=0.3, density=0.9)
        stars(bg, 260, seed + 1, T["star_tint"], T["star_bright"])
        sun(bg, 150, 236, 70, T["sun"], seed + 2)
        planet(bg, 560, 92, 52, T["planet"], seed + 3, light=(-0.6, 0.5), gas=False, craters=4, cracks=("#ffc14a", 14))
        haze(bg, 150, 240, T["haze"], 0.0, 0.35)
        skyline(bg, 262, S, seed + 4, 20, 70, 24, 70, 0.3, spires=False, stacks=True, density=0.85)
        horizon_grid(bg, 262, "#ff8a2a", 352, rows=10, cols=16, a=150)
        # foreground: gears, stacks, pipes, molten pools
        gear(fg, 110, 350, 70, 14, F[:3], 0.1)
        gear(fg, 560, 372, 95, 18, F[:3], 0.25)
        gear(fg, 330, 362, 44, 11, F[:3], 0.0)
        for x in (40, 250, 440, 640): stack(fg, x, 330, 18, int(60 + (x % 7) * 9), F[:3], F[3])
        pipe(fg, 0, BW, 300, 10, F[:3], F[3], joints=9)
        pipe(fg, 150, 520, 284, 7, F[:3], F[3], joints=4)
        ground(fg, 330, F, seed + 9)
        rng = np.random.default_rng(seed + 10)
        for i in range(8):
            x = rng.integers(0, BW); w = rng.integers(16, 50)
            fg.ellipse(x, 348, x + w, 358, fill=rgba("#ff8a2a")); fg.ellipse(x + 3, 350, x + w - 3, 356, fill=rgba(F[3]))
    else:  # engine
        sky(bg, T["sky"], seed, band_y=0.45, band_w=0.3, density=0.95)
        stars(bg, 360, seed + 1, T["star_tint"], T["star_bright"])
        sun(bg, 548, 112, 96, T["sun"], seed + 2)
        ring_fragment(bg, 548, 112, 160, 146, math.radians(150), math.radians(300), S[:3], S[3], seed + 3)
        asteroids(bg, seed + 4, 60, 120, 260, S[:3])
        haze(bg, 190, 290, T["haze"], 0.0, 0.45)
        skyline(bg, 296, S, seed + 5, 30, 110, 14, 40, 0.22, spires=True, fins=True, density=0.8)
        ground(bg, 312, (S[0], S[0], S[1], S[3]), seed + 6, panels=False)
        # foreground: turbines, cones, struts
        turbine(fg, 120, 352, 86, F[:3], F[3], 9)
        turbine(fg, 470, 376, 112, F[:3], F[3], 11)
        cone(fg, 230, 300, 90, 70, F[:3], F[3])
        cone(fg, 600, 320, 80, 60, F[:3], F[3])
        strut(fg, [(0, 330), (120, 266), (240, 330)], F[:3], 4)
        strut(fg, [(300, 376), (380, 290), (470, 264)], F[:3], 4)
        ground(fg, 340, F, seed + 9)
    return bg.im, fg.im

def finish(im, fine_fn=None):
    """x2 nearest, optional fine-detail pass at 1408x752, x2 nearest to 2816x1504."""
    f = im.resize((FW, FH), Image.NEAREST)
    if fine_fn: fine_fn(f)
    return f.resize((FW * 2, FH * 2), Image.NEAREST)

def fine_stars(theme, seed):
    T = THEMES[theme]
    def fn(f):
        dr = ImageDraw.Draw(f); rng = np.random.default_rng(seed + 77)
        for i in range(700):
            x, y = int(rng.integers(0, FW)), int(rng.integers(0, int(FH * 0.75)))
            if f.getpixel((x, y))[:3] == hexrgb(T["base"]) or rng.random() < 0.1:
                dr.point([(x, y)], fill=rgba(T["star_tint"]) if rng.random() < 0.7 else rgba(T["star_bright"]))
    return fn

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("theme", choices=list(THEMES)); ap.add_argument("out_bg"); ap.add_argument("out_fg")
    ap.add_argument("--seed", type=int, default=6); ap.add_argument("--preview"); ap.add_argument("--fg-height", type=float, default=0.7)
    a = ap.parse_args()
    bg, fg = build(a.theme, a.seed)
    BG = finish(bg, fine_stars(a.theme, a.seed)); FG = finish(fg)
    BG.save(a.out_bg, optimize=True); FG.save(a.out_fg, optimize=True)
    if a.preview:
        # as the game lays it: bg fills 720 tall; fg drawn fgHeight*720 tall, anchored at the bottom; shown at 1280x720
        W, H = 1280, 720
        tile_h = H; tile_w = int(tile_h * 2816 / 1504)
        prev = Image.new("RGBA", (W, H))
        b = BG.resize((tile_w, tile_h), Image.BILINEAR)
        for x in range(0, W, tile_w): prev.alpha_composite(b, (x, 0))
        fh = int(H * a.fg_height); fw = int(fh * 2816 / 1504)
        f = FG.resize((fw, fh), Image.BILINEAR)
        for x in range(0, W, fw): prev.alpha_composite(f, (x, H - fh))
        prev.convert("RGB").save(a.preview)
    print("wrote", a.out_bg, a.out_fg)

if __name__ == "__main__":
    main()
