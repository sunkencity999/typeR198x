#!/usr/bin/env python3
"""Remove the painted exhaust from a ship master so the engine's animated plume is the only exhaust.

Per-ship rules in bbox fractions (x0, y0, x1, y1): `warm` clears saturated orange / yellow pixels (flame cones,
engine-bell glow), `grey` clears desaturated mid-value pixels (painted smoke), `all` clears everything in the box
(spark particles). Islands under 0.2 % of the bbox area are dropped afterwards. Prints the hull's rear-most points
at the requested nozzle rows, as fractions of the NEW trimmed box, for THRUSTER_OFFSET in 75-fx-draw.js.

Usage: deflame.py <ship-id> <in.png> <out.png> [--nozzles fy1,fy2 (old-bbox fractions)]
"""
import argparse, json
import numpy as np
from PIL import Image
from scipy.ndimage import label

RULES = {
    # coconut: the lower bell stands alone (clear the box); the upper bell overlaps the housing (hue rule incl. its red outline)
    "coconut":         [dict(box=(0.0, 0.16, 0.135, 0.58), all=True), dict(box=(0.15, 0.0, 0.365, 0.29), warm=True, hue=(0, 70), sat=0.25), dict(box=(0.15, 0.0, 0.365, 0.29), hilite=True)],
    "little-dark-one": [dict(box=(0.0, 0.0, 0.185, 1.0), all=True)],
    # sofrito: the flame cone (warm) and the painted smoke incl. its dark outlines and white cores (grey, x < .2)
    "sofrito":         [dict(box=(0.0, 0.25, 0.28, 0.78), warm=True, hue=(10, 70), sat=0.3), dict(box=(0.0, 0.25, 0.20, 0.78), grey=True)],
    "honeybee":        [],
}

def hsv(a):
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mx = a.max(-1); mn = a.min(-1); d = mx - mn
    v = mx; s = np.where(mx > 0, d / np.maximum(mx, 1e-6), 0)
    dd = np.maximum(d, 1e-6)
    h = np.where(mx == r, ((g - b) / dd) % 6, np.where(mx == g, (b - r) / dd + 2, (r - g) / dd + 4)) * 60
    h = np.where(d < 1e-6, 0, h)
    return h, s, v

def bbox(alpha):
    ys, xs = np.where(alpha > 8); return xs.min(), ys.min(), xs.max() + 1, ys.max() + 1

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("ship"); ap.add_argument("inp"); ap.add_argument("out"); ap.add_argument("--nozzles", default="")
    a = ap.parse_args()
    im = Image.open(a.inp).convert("RGBA"); arr = np.array(im)
    alpha = arr[:, :, 3]
    x0, y0, x1, y1 = bbox(alpha); bw, bh = x1 - x0, y1 - y0
    h, s, v = hsv(arr[:, :, :3].astype(np.float32) / 255.0)
    yy, xx = np.mgrid[0:arr.shape[0], 0:arr.shape[1]]
    fx = (xx - x0) / bw; fy = (yy - y0) / bh
    kill = np.zeros(alpha.shape, bool)
    for r in RULES[a.ship]:
        bx0, by0, bx1, by1 = r["box"]
        inbox = (fx >= bx0) & (fx < bx1) & (fy >= by0) & (fy < by1) & (alpha > 0)
        if r.get("all"): kill |= inbox
        if r.get("warm"):
            h0, h1 = r.get("hue", (12, 62)); kill |= inbox & (h >= h0) & (h <= h1) & (s > r.get("sat", 0.45)) & (v > 0.35)
        if r.get("hilite"): kill |= inbox & (h >= 20) & (h <= 70) & (s < 0.4) & (v > 0.75)      # yellow-white flame highlights
        if r.get("grey"): kill |= inbox & (s < 0.3) & (v > 0.2)
    arr[kill] = 0
    # drop small islands
    lab, n = label(arr[:, :, 3] > 8)
    if n > 1:
        sizes = np.bincount(lab.ravel()); sizes[0] = 0
        keep = sizes >= 0.002 * bw * bh
        arr[~keep[lab]] = 0
    Image.fromarray(arr, "RGBA").save(a.out, optimize=True)
    nx0, ny0, nx1, ny1 = bbox(arr[:, :, 3]); nw, nh = nx1 - nx0, ny1 - ny0
    out = {"ship": a.ship, "removedPx": int(kill.sum()), "oldBox": [int(x0), int(y0), int(bw), int(bh)], "newBox": [int(nx0), int(ny0), int(nw), int(nh)], "nozzles": []}
    for f in [float(t) for t in a.nozzles.split(",") if t]:
        ay = y0 + f * bh                               # the old nozzle row in master pixels
        band = (np.abs(yy - ay) <= 0.03 * bh) & (arr[:, :, 3] > 8)
        xs = xx[band]
        if xs.size == 0: continue
        xl = xs.min()
        out["nozzles"].append({"fx": round(float((xl - nx0) / nw + 0.012), 3), "fy": round(float((ay - ny0) / nh), 3)})
    print(json.dumps(out))

if __name__ == "__main__":
    main()
