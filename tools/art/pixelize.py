#!/usr/bin/env python3
"""Pixel-consistency pass for the illustrated sprites (ships, bosses) of Type-R 198X.

The backdrops are pixel art drawn at about one art pixel per two logical pixels; the ships and bosses are smooth
cel-shaded illustrations. This tool resamples a sprite master to the backdrop's pixel density, quantises it to a
small palette (k-means on the opaque pixels), hardens the alpha, and writes it back at the master's size with a
nearest-neighbour upscale, so the asset pipeline (tools/build-web-assets.sh) needs no change.

Usage: pixelize.py <in.png> <out.png> --display-w <logical px the sprite is drawn at> [--art-px 2] [--colors 32]
       [--preview <preview.png>]
"""
import argparse
import numpy as np
from PIL import Image, ImageFilter
from scipy.cluster.vq import kmeans2

def bbox(alpha):
    ys, xs = np.where(alpha > 8)
    return xs.min(), ys.min(), xs.max() + 1, ys.max() + 1

def pixelize(im, display_w, art_px=2.0, colors=32, seed=7, alpha_cut=128, sharpen=160, outline=0.55):
    im = im.convert("RGBA")
    a = np.array(im)[:, :, 3]
    x0, y0, x1, y1 = bbox(a)
    crop = im.crop((x0, y0, x1, y1))
    cw, ch = crop.size
    # pre-sharpen so the line work survives the box filter
    if sharpen > 0:
        crop = crop.filter(ImageFilter.UnsharpMask(radius=max(1, int(round(cw / display_w * art_px * 0.9))), percent=int(sharpen), threshold=2))
    # art resolution: the sprite spans display_w logical px on screen; one art pixel = art_px logical px
    aw = max(8, int(round(display_w / art_px)))
    ah = max(8, int(round(aw * ch / cw)))
    # premultiplied box downsample (no fringe), then un-premultiply
    arr = np.asarray(crop).astype(np.float32) / 255.0
    pre = arr.copy(); pre[:, :, :3] *= pre[:, :, 3:4]
    small = np.asarray(Image.fromarray((pre * 255).astype(np.uint8), "RGBA").resize((aw, ah), Image.BOX)).astype(np.float32) / 255.0
    al = small[:, :, 3:4]
    rgb = np.where(al > 1e-3, small[:, :, :3] / np.maximum(al, 1e-3), 0)
    hard = (al[:, :, 0] * 255 >= alpha_cut)
    # k-means palette over the opaque pixels (in a lightly perceptual space)
    pts = rgb[hard]
    w = np.array([0.6, 1.0, 0.8], np.float32)
    rng = np.random.default_rng(seed)
    k = min(colors, max(2, len(pts)))
    cent, lab = kmeans2((pts * w).astype(np.float64), k, minit="++", seed=seed, iter=25)
    pal = (cent / w).clip(0, 1)
    q = np.zeros_like(rgb); q[hard] = pal[lab]
    # silhouette outline: opaque pixels touching transparency darken toward a dark line (pixel-art edge)
    if outline < 1:
        pad = np.pad(hard, 1)
        nbr = pad[:-2, 1:-1] & pad[2:, 1:-1] & pad[1:-1, :-2] & pad[1:-1, 2:]
        edge = hard & ~nbr
        q[edge] = q[edge] * outline
    out = np.zeros((ah, aw, 4), np.uint8)
    out[:, :, :3] = (q * 255).round().astype(np.uint8)
    out[:, :, 3] = np.where(hard, 255, 0).astype(np.uint8)
    art = Image.fromarray(out, "RGBA")
    # back to the master's frame with nearest-neighbour blocks
    up = art.resize((cw, ch), Image.NEAREST)
    canvas = Image.new("RGBA", im.size, (0, 0, 0, 0))
    canvas.paste(up, (x0, y0))
    return canvas, art

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("inp"); ap.add_argument("out")
    ap.add_argument("--display-w", type=float, required=True)
    ap.add_argument("--art-px", type=float, default=2.0)
    ap.add_argument("--colors", type=int, default=32)
    ap.add_argument("--preview")
    ap.add_argument("--preview-scale", type=float, default=2.0)
    ap.add_argument("--sharpen", type=float, default=160)
    ap.add_argument("--outline", type=float, default=0.55)
    a = ap.parse_args()
    im = Image.open(a.inp)
    canvas, art = pixelize(im, a.display_w, a.art_px, a.colors, sharpen=a.sharpen, outline=a.outline)
    canvas.save(a.out, optimize=True)
    if a.preview:
        # side by side at the on-screen size (x preview-scale): original | pixelised
        al = np.array(im.convert("RGBA"))[:, :, 3]; x0, y0, x1, y1 = bbox(al)
        orig = im.convert("RGBA").crop((x0, y0, x1, y1))
        pw = int(round(a.display_w * a.preview_scale)); ph = int(round(pw * orig.height / orig.width))
        o = orig.resize((pw, ph), Image.LANCZOS)
        p = canvas.crop((x0, y0, x1, y1)).resize((pw, ph), Image.NEAREST)
        sheet = Image.new("RGBA", (pw * 2 + 48, ph + 32), (24, 16, 40, 255))
        sheet.alpha_composite(o, (16, 16)); sheet.alpha_composite(p, (pw + 32, 16))
        sheet.convert("RGB").save(a.preview)
    print("wrote", a.out, "art", art.size)

if __name__ == "__main__":
    main()
