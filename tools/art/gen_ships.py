#!/usr/bin/env python3
"""Procedural pixel-art player ships for Type-R 198X (Career pass 2026-11: the three unlockable hulls).

The four original ships are pixelised illustrations (tools/art/pixelize.py: 94 art pixels across the trimmed hull,
one art pixel per 1.4 logical px at the game's 168 px draw box, ~36 colours, darkened silhouette edge). These three
are generated to sit in the same family: built from parts (fuselage, nose, canopy, wings, fins, engine nacelles,
panel seams, stripes, nav lights) on a 96 x 56 art grid, shaded the way gen_drones.py shades its hulls (lit top,
cel highlight band, shadowed belly, panel seams, a dark outline around every part so the seams read), on the
steel / neon palette of the drones generator plus one signature hue per ship, and written back as 2816 x 1536
masters with 22 master px per art pixel (nearest-neighbour blocks). The hull fills ~2090 px of the frame, between
the Little Dark One (1971) and the Coconut (2125), so the game's 168 px draw box gives the same on-screen size.
No painted exhaust: the game draws the plume at the nozzles (75-fx-draw.js THRUSTER_OFFSET).

    paprika   The S.S. Paprika   hot-rod racer: red/orange hull, cream stripes, long nose, twin rear engines, bubble canopy
    nightjar  The S.S. Nightjar  stealth wedge: near-black navy, violet edge lights, swept wings, one wide engine slot, slit canopy
    moonpie   The S.S. Moonpie   white-and-gold cruiser: rounded, chrome trim, three small engines in a row, greenhouse canopy, a fin

Writes S_S_Paprika.png, S_S_Nightjar.png, S_S_Moonpie.png (masters for assets/ships/), ships-preview.png (the three
beside the four existing ships at the game's draw size, 1x and 3x rows, dark ground) and prints one JSON line per
ship the way deflame.py does: the hull's rear-most x at each nozzle row and the nose tip as fractions of the
TRIMMED box (the asset pipeline's crop: alpha box + 24 px pad), ready for THRUSTER_OFFSET.

Usage: python3 gen_ships.py <out_dir> [seed] [--colors 44] [--ships-dir assets/ships]
"""
import json, os, sys
import numpy as np
from PIL import Image, ImageDraw

OUT = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("--") else "."
SEED = int(sys.argv[2]) if len(sys.argv) > 2 and sys.argv[2].isdigit() else 198
SHIPS_DIR = None
if "--ships-dir" in sys.argv:
    SHIPS_DIR = sys.argv[sys.argv.index("--ships-dir") + 1]
COLORS = int(sys.argv[sys.argv.index("--colors") + 1]) if "--colors" in sys.argv else 44   # 0 = no palette step

MASTER_W, MASTER_H = 2816, 1536     # the existing masters' frame
ART_PX = 22                         # master px per art pixel (Coconut 22.6, Little Dark One 21, Sofrito 22.6, HoneyBee 18)
AW, AH = 96, 56                     # art grid (the hull spans ~95 of the 96 columns)
PAD = 24                            # tools/build-web-assets.sh trim pad (the crop box the game's fractions refer to)
GAME_DRAW_W = 168                   # SHIP_DRAW_W: logical px of the untrimmed master frame
GROUND = (11, 16, 48)

# ---------------------------------------------------------------- palette
# Materials: (hi, light, mid, dark, belly). STEEL is gen_drones.py's hull palette.
MAT = {
    "steel":  ((228, 234, 252), (166, 178, 216), (106, 116, 158), (58, 62, 94), (34, 36, 58)),
    "gun":    ((178, 186, 214), (118, 128, 168), (72, 78, 112), (44, 48, 76), (26, 28, 46)),
    "navy":   ((126, 138, 196), (78, 88, 140), (42, 48, 90), (22, 25, 50), (10, 11, 26)),
    "red":    ((255, 176, 136), (255, 102, 66), (226, 50, 42), (154, 24, 36), (90, 12, 28)),
    "orange": ((255, 226, 166), (255, 176, 74), (242, 124, 32), (172, 74, 22), (102, 42, 16)),
    "cream":  ((255, 255, 246), (255, 246, 218), (242, 226, 180), (202, 178, 130), (142, 118, 82)),
    "white":  ((255, 255, 255), (246, 248, 254), (216, 222, 238), (162, 172, 206), (102, 110, 152)),
    "gold":   ((255, 242, 186), (255, 216, 112), (238, 172, 54), (172, 114, 30), (106, 68, 18)),
    "violet": ((240, 216, 255), (210, 160, 255), (184, 107, 255), (120, 64, 180), (70, 36, 110)),
    "glassA": ((255, 255, 232), (255, 232, 124), (255, 193, 74), (192, 122, 32), (112, 70, 20)),   # amber canopy (the originals' yellow glass)
    "glassC": ((240, 255, 255), (150, 240, 255), (57, 200, 230), (24, 110, 150), (14, 40, 80)),    # cyan canopy
    "glassD": ((120, 200, 230), (60, 120, 170), (22, 30, 56), (14, 18, 38), (8, 10, 24)),          # dark slit glass
}
OUTLINE = (16, 14, 30)
CORE = (246, 247, 255)
CYAN = (57, 245, 255)
MAGENTA = (255, 57, 209)
LIME = (168, 255, 58)
AMBER = (255, 193, 74)
VIOLET = (184, 107, 255)
DANGER = (255, 77, 109)


# ---------------------------------------------------------------- mask primitives (art px)
def blank():
    return np.zeros((AH, AW), bool)


def poly(points):
    im = Image.new("1", (AW, AH), 0)
    ImageDraw.Draw(im).polygon([(float(x), float(y)) for x, y in points], fill=1)
    return np.array(im, bool)


def ellipse(cx, cy, rx, ry):
    ys, xs = np.mgrid[0:AH, 0:AW]
    return (((xs + 0.5 - cx) / rx) ** 2 + ((ys + 0.5 - cy) / ry) ** 2) <= 1.0


def rect(x0, y0, x1, y1):
    m = blank()
    x0, x1 = max(0, int(round(x0))), min(AW, int(round(x1)))
    y0, y1 = max(0, int(round(y0))), min(AH, int(round(y1)))
    if x1 > x0 and y1 > y0:
        m[y0:y1, x0:x1] = True
    return m


def rrect(x0, y0, x1, y1, r):
    """Rounded rectangle (capsule when r = half height)."""
    im = Image.new("1", (AW, AH), 0)
    ImageDraw.Draw(im).rounded_rectangle([x0, y0, x1 - 1, y1 - 1], radius=r, fill=1)
    return np.array(im, bool)


def dilate(m):
    pad = np.pad(m, 1)
    return pad[:-2, 1:-1] | pad[2:, 1:-1] | pad[1:-1, :-2] | pad[1:-1, 2:] | m


def mix(a, b, t):
    return tuple(int(round(a[i] * (1 - t) + b[i] * t)) for i in range(3))


# ---------------------------------------------------------------- shading
def column_v(mask):
    """0 at the top of each column of the mask .. 1 at its bottom (the drones generator's shading coordinate)."""
    h, w = mask.shape
    ys = np.arange(h)[:, None].repeat(w, 1)
    top = np.where(mask.any(0), mask.argmax(0), 0)
    bot = np.where(mask.any(0), h - mask[::-1].argmax(0), 0)
    span = np.maximum(1, bot - top)
    return (ys - top[None, :] + 0.5) / span[None, :]


def shade(mask, mat, spec=True, seams=(), hseams=(), bands=(0.09, 0.34, 0.66, 0.88), spec_band=(0.17, 0.26), vents=(), rivets=False, seam_light=False):
    """Cel shading for one part: rim highlight, light, cel highlight band, mid, dark, belly; vertical / horizontal
    panel seams (dark, or light on dark hulls) with sparse rivet dots; small dark vents with a lit lip. Returns an
    RGB float array (0-255)."""
    hi, light, mid, dark, belly = MAT[mat]
    v = column_v(mask)
    tone = np.zeros((AH, AW, 3), np.float32)
    tone[:] = mid
    tone[v < bands[1]] = light
    tone[v < bands[0]] = hi
    tone[v > bands[2]] = dark
    tone[v > bands[3]] = belly
    if spec:
        tone[(v >= spec_band[0]) & (v < spec_band[1])] = hi
    seam_d = 26 if seam_light else -34
    for x in seams:
        x = int(x)
        if 0 <= x < AW:
            col = mask[:, x]
            tone[col, x] = np.clip(tone[col, x] + seam_d, 0, 255)
            if rivets:
                ys = np.where(col)[0]
                for y in ys[2:-2:6]:
                    if 0 <= x + 1 < AW and mask[y, x + 1]:
                        tone[y, x + 1] = np.clip(tone[y, x + 1] - 16, 0, 255)
    for y in hseams:
        y = int(y)
        if 0 <= y < AH:
            row = mask[y, :]
            tone[y, row] = np.clip(tone[y, row] - 28, 0, 255)
    for (x0, y0, x1, y1) in vents:
        r = rect(x0, y0, x1, y1) & mask
        tone[r] = np.clip(tone[r] * 0.5, 0, 255)
        lip = rect(x0, y0 - 1, x1, y0) & mask
        tone[lip] = np.clip(tone[lip] + 30, 0, 255)
    return tone


def quantize(rgb, alpha, colors=44, seed=7):
    """pixelize.py's palette step: k-means over the opaque pixels in a lightly perceptual space, so the generated
    hulls carry the same ~40-colour posterised look as the four pixelised originals."""
    from scipy.cluster.vq import kmeans2
    pts = rgb[alpha].astype(np.float64) / 255.0
    w = np.array([0.6, 1.0, 0.8])
    k = min(colors, max(2, len(pts)))
    cent, lab = kmeans2(pts * w, k, minit="++", seed=seed, iter=30)
    pal = (cent / w).clip(0, 1)
    out = rgb.copy()
    out[alpha] = pal[lab] * 255.0
    return out


class Canvas:
    def __init__(self):
        self.rgb = np.zeros((AH, AW, 3), np.float32)
        self.a = blank()

    def part(self, mask, mat, outline=True, ol_mix=0.6, **kw):
        """Paste a shaded part. Its outline (one art px around the part) darkens whatever it covers, so the
        silhouette gets the pixelize pass's darkened edge and the overlaps read as seams."""
        tone = shade(mask, mat, **kw)
        if outline:
            ring = dilate(mask) & ~mask
            dark = MAT[mat][3]
            ol = np.array(mix(dark, OUTLINE, ol_mix), np.float32)
            over = ring & self.a
            self.rgb[over] = np.clip(self.rgb[over] * 0.30 + ol * 0.30, 0, 255)
            fresh = ring & ~self.a
            self.rgb[fresh] = ol
            self.a |= ring
        self.rgb[mask] = tone[mask]
        self.a |= mask

    def paint(self, mask, color, alpha=1.0):
        """Flat colour over existing pixels (stripes, lights, trim)."""
        m = mask & self.a
        c = np.array(color, np.float32)
        self.rgb[m] = self.rgb[m] * (1 - alpha) + c * alpha

    def dot(self, x, y, color):
        if 0 <= x < AW and 0 <= y < AH:
            self.rgb[int(y), int(x)] = color
            self.a[int(y), int(x)] = True

    def nozzle(self, cx, cy, rx, ry, rim="gun"):
        """A cold engine opening on the rear face: metal rim, dark throat, a cyan hot ring and a white core.
        Static: the game draws the animated plume here."""
        outer = ellipse(cx, cy, rx, ry)
        self.part(outer, rim, spec=False, bands=(0.14, 0.40, 0.66, 0.90))
        throat = ellipse(cx, cy, max(0.8, rx - 1.1), max(0.8, ry - 1.1))
        self.paint(throat, (14, 12, 30))
        ring = throat & ~ellipse(cx, cy, max(0.5, rx - 2.1), max(0.5, ry - 2.1))
        self.paint(ring, CYAN, 0.9)
        core = ellipse(cx, cy, max(0.5, rx - 2.6), max(0.5, ry - 2.6))
        self.paint(core, mix(CORE, CYAN, 0.25))


# ---------------------------------------------------------------- the ships
def draw_paprika():
    """Hot-rod racer: fat teardrop body, long cream nose, big bubble canopy, twin stacked engine pods with chrome
    headers, cream racing stripes, a tall tail fin, a racing roundel."""
    c = Canvas()
    # tail fin (behind everything), red with a cream leading edge and a beacon
    fin = poly([(10, 3), (22, 3), (31, 19), (14, 19)])
    c.part(fin, "red", spec=False, seams=(17, 23), bands=(0.10, 0.38, 0.72, 0.92))
    c.paint(poly([(21, 3), (23, 3), (31, 19), (29, 19)]) & fin, MAT["cream"][1])
    c.dot(22, 3, CORE); c.dot(21, 3, DANGER)
    # upper engine pod (behind the body): orange capsule, steel collar, chrome header pipe along its top
    pod_u = rrect(0, 11, 38, 23, 6)
    c.part(pod_u, "orange", seams=(14, 24), vents=((26, 13, 32, 15),))
    c.paint(rect(30, 11, 33, 23) & pod_u, MAT["steel"][2], 0.95)
    c.paint(rect(30, 11, 33, 15) & pod_u, MAT["steel"][1], 0.9)
    c.paint(rect(8, 16, 30, 17) & pod_u, MAT["cream"][2], 0.9)
    pipe = rrect(10, 9, 30, 12, 1)
    c.part(pipe, "steel", spec=False, bands=(0.3, 0.6, 0.85, 0.95))
    # body: a fat cigar with the nose pulled right
    body = poly([(8, 20), (26, 16), (52, 14), (74, 17), (88, 22), (95, 28), (88, 34), (74, 38), (52, 40), (26, 40), (8, 37)]) | ellipse(12, 28, 7, 8.5)
    c.part(body, "red", seams=(24, 36, 48, 66, 80), vents=((28, 35, 34, 37), (40, 35, 46, 37), (68, 33, 74, 35)))
    v = column_v(body)
    # cream racing stripes (the canopy and pods cover them where they cross)
    c.paint(body & (v >= 0.42) & (v < 0.54), MAT["cream"][1], 0.95)
    c.paint(body & (v >= 0.42) & (v < 0.46), MAT["cream"][0], 0.9)
    c.paint(body & (v >= 0.68) & (v < 0.73), MAT["cream"][2], 0.85)
    # racing roundel on the flank
    c.paint(ellipse(40, 28.5, 3.6, 3.6) & body, MAT["cream"][0])
    c.paint(ellipse(40, 28.5, 2.2, 2.2) & body, MAT["red"][2])
    c.paint(rect(39, 27, 41, 30) & body, MAT["red"][3], 0.8)
    # nose cone in cream with a dark collar and a chrome intake scoop on top
    nose = rect(82, 0, AW, AH) & body
    c.paint(nose, MAT["cream"][1]); c.paint(nose & (v < 0.34), MAT["cream"][0]); c.paint(nose & (v > 0.66), MAT["cream"][3]); c.paint(nose & (v > 0.88), MAT["cream"][4])
    c.paint(rect(82, 0, 83, AH) & body, MAT["red"][4], 0.9)
    c.paint(rect(83, 0, 84, AH) & body, MAT["steel"][1], 0.9)
    c.dot(94, 28, CORE)
    scoop = rrect(64, 13, 74, 18, 2)
    c.part(scoop, "steel", spec=False, vents=((66, 14, 72, 16),))
    # lower (near) wing swept back toward the viewer, cream stripe, lime tip light
    wing = poly([(44, 38), (70, 37), (56, 52), (22, 52)])
    c.part(wing, "red", spec=False, seams=(34, 50), bands=(0.10, 0.40, 0.72, 0.92))
    c.paint(poly([(42, 41), (67, 40), (63, 44), (38, 45)]) & wing, MAT["cream"][1], 0.95)
    c.paint(poly([(42, 41), (67, 40), (66, 41), (41, 42)]) & wing, MAT["cream"][0], 0.9)
    c.dot(23, 51, LIME); c.dot(22, 51, CORE)
    # chassis strip (chrome) between the belly and the lower pod, then the lower pod in front
    strip = rrect(10, 36, 34, 39, 1)
    c.part(strip, "steel", spec=False, bands=(0.3, 0.6, 0.85, 0.95))
    pod_l = rrect(0, 38, 36, 53, 7)
    c.part(pod_l, "orange", seams=(12, 22), vents=((26, 48, 32, 50),))
    c.paint(rect(28, 38, 31, 53) & pod_l, MAT["steel"][2], 0.95)
    c.paint(rect(28, 38, 31, 43) & pod_l, MAT["steel"][1], 0.9)
    c.paint(rect(6, 44, 28, 45) & pod_l, MAT["cream"][2], 0.9)
    # canopy: a big bubble, gun-metal frame, amber glass, white specular, a dashboard shadow
    frame = ellipse(58, 17, 13, 9.2) & ~rect(0, 24, AW, AH)
    c.part(frame, "gun", spec=False)
    glass = ellipse(58, 17.4, 11.6, 7.8) & ~rect(0, 24, AW, AH)
    c.part(glass, "glassA", outline=False, bands=(0.12, 0.42, 0.72, 0.92), spec_band=(0.18, 0.30))
    c.paint(rect(50, 11, 56, 13) & glass, MAT["glassA"][0])
    c.paint(rect(52, 22, 68, 24) & glass, MAT["glassA"][4], 0.8)
    c.paint(rect(58, 8, 59, 24) & frame, OUTLINE, 0.6)
    # cold nozzles on the rear faces of both pods
    c.nozzle(6.0, 17.0, 4.6, 5.0)
    c.nozzle(5.0, 45.5, 5.2, 5.8)
    # spine light
    c.dot(50, 14, AMBER); c.dot(51, 14, CORE)
    return c, {"nozzles_y": [17.0, 45.5], "nose": (95, 28)}


def draw_nightjar():
    """Stealth wedge: faceted near-black navy body with a dorsal hump, big swept wings with violet leading-edge
    lights, canted twin fins, intakes, one wide engine slot, a slit canopy."""
    c = Canvas()
    nv = dict(ol_mix=0.85, seam_light=True)
    # far (upper) wing: its top surface faces the viewer, so it stays in the light tone
    far = poly([(92, 22), (20, 5), (8, 8), (9, 13), (48, 25)])
    c.part(far, "navy", spec=False, seams=(24, 38, 54, 70), bands=(0.15, 0.70, 0.90, 0.97), **nv)
    c.paint(poly([(92, 22), (20, 5), (21, 6.6), (91, 23)]) & far, VIOLET, 0.95)
    c.paint(poly([(8, 8), (9, 13), (10.5, 13), (9.5, 8)]) & far, MAT["violet"][3], 0.9)
    c.dot(8, 8, MAT["violet"][0]); c.dot(9, 9, VIOLET)
    # canted tail fins (behind the body)
    for (x0, x1) in ((13, 22), (24, 33)):
        fin = poly([(x0, 8), (x0 + 6, 8), (x1 + 5, 22), (x0 + 2, 22)])
        c.part(fin, "navy", spec=False, bands=(0.14, 0.5, 0.8, 0.95), seams=(x0 + 5,), **nv)
        c.paint(poly([(x0 + 5, 8), (x0 + 6, 8), (x1 + 5, 22), (x1 + 4, 22)]) & fin, MAT["violet"][3], 0.9)
        c.dot(x0 + 5, 8, VIOLET); c.dot(x0 + 6, 8, MAT["violet"][0])
    # body: a faceted lens with a dorsal hump; hard tone bands read as facets
    body = poly([(95, 28), (76, 17), (40, 14), (10, 18), (2, 28), (10, 40), (40, 42), (76, 38)]) | (ellipse(52, 15, 18, 4.5) & ~rect(0, 18, AW, AH))
    c.part(body, "navy", spec=False, seams=(18, 30, 42, 56, 70, 84), bands=(0.08, 0.42, 0.70, 0.90), vents=((30, 29, 40, 33), (56, 29, 66, 33)), **nv)
    v = column_v(body)
    c.paint(body & (v >= 0.40) & (v < 0.44), MAT["navy"][4], 0.7)        # chine shadow line between the facets
    c.paint(body & (v < 0.08), MAT["navy"][0])                          # dorsal rim light, so the hull separates from the backdrops
    c.paint(body & rect(38, 0, 66, AH) & (v < 0.08), MAT["steel"][1])   # steel spine panel on the hump
    c.paint(body & rect(38, 0, 66, AH) & (v >= 0.08) & (v < 0.14), MAT["steel"][3])
    # intake lips (light edge over the dark vents)
    for x0 in (30, 56):
        c.paint(rect(x0, 29, x0 + 10, 30) & body, MAT["steel"][2])
    # violet edge light along the lower facet, one continuous strip
    c.paint(body & (v >= 0.90) & (v < 0.95) & rect(10, 0, 86, AH), VIOLET)
    # near (lower) wing swept back toward the viewer
    near = poly([(90, 32), (44, 38), (8, 54), (22, 54), (58, 44)])
    c.part(near, "navy", spec=False, seams=(28, 42, 56), bands=(0.10, 0.42, 0.74, 0.92), **nv)
    c.paint(poly([(90, 32), (44, 38), (8, 54), (10, 54), (45, 39.6), (89, 33)]) & near, VIOLET, 0.95)
    c.paint(poly([(8, 54), (22, 54), (22, 53), (9, 53)]) & near, MAT["violet"][3], 0.85)
    c.dot(8, 53, MAT["violet"][0]); c.dot(9, 53, VIOLET)
    # slit canopy: dark glass, one bright cyan slit
    slit_frame = rrect(62, 18, 82, 25, 2) & body
    c.part(slit_frame, "glassD", outline=True, spec=False, bands=(0.2, 0.5, 0.8, 0.95), ol_mix=0.85)
    c.paint(rect(64, 20, 80, 22) & slit_frame, mix(CYAN, CORE, 0.3))
    c.paint(rect(65, 22, 79, 23) & slit_frame, MAT["glassD"][1])
    # single wide engine slot on the rear face: steel lip, dark throat, violet hot ring, white core
    slot = rrect(1, 21, 14, 35, 5)
    c.part(slot, "gun", spec=False, bands=(0.14, 0.40, 0.66, 0.90))
    c.paint(rrect(2, 22, 13, 34, 4), (14, 12, 30))
    c.paint(rrect(2, 22, 13, 34, 4) & ~rrect(3, 23, 12, 33, 3), VIOLET, 0.9)
    c.paint(rrect(4, 26, 10, 30, 2), mix(CORE, VIOLET, 0.3))
    # nose and spine lights
    c.dot(94, 28, mix(CYAN, CORE, 0.5)); c.dot(46, 13, VIOLET); c.dot(47, 13, MAT["violet"][0])
    return c, {"nozzles_y": [28.0], "nose": (95, 28)}


def draw_moonpie():
    """White-and-gold cruiser: rounded body, gold waterline and chrome strakes, a row of portholes, a greenhouse
    canopy, three small engines in a row on a steel block, a dorsal fin, a cyan sensor dome."""
    c = Canvas()
    # dorsal fin behind the body, gold leading edge, amber beacon
    fin = poly([(16, 3), (26, 3), (37, 21), (20, 21)])
    c.part(fin, "white", spec=False, seams=(24, 30), bands=(0.10, 0.36, 0.70, 0.90))
    c.paint(poly([(25, 3), (27, 3), (37, 21), (35, 21)]) & fin, MAT["gold"][1])
    c.paint(poly([(24, 3), (25, 3), (35, 21), (34, 21)]) & fin, MAT["gold"][2])
    c.dot(26, 3, AMBER); c.dot(25, 3, CORE)
    # far (upper) wing, small, gold edge
    far = poly([(28, 15), (64, 15), (56, 22), (20, 22)])
    c.part(far, "white", spec=False, seams=(36, 48), bands=(0.12, 0.45, 0.78, 0.94))
    c.paint(poly([(28, 15), (64, 15), (63, 16), (28, 16)]) & far, MAT["gold"][2], 0.9)
    # rear engine block (steel) under the fin
    block = rrect(1, 14, 23, 48, 5)
    c.part(block, "steel", seams=(10, 17), bands=(0.10, 0.36, 0.70, 0.90), vents=((14, 17, 20, 19), (14, 43, 20, 45)))
    c.paint(rect(1, 30, 23, 32) & block, MAT["gold"][2], 0.8)
    # belly keel (chrome) before the body
    keel = rrect(30, 41, 72, 45, 1)
    c.part(keel, "steel", spec=False, bands=(0.3, 0.6, 0.85, 0.95))
    # fuselage: rounded body + bulbous nose
    body = ellipse(52, 31, 42, 13.5) | ellipse(72, 31, 24, 12) | ellipse(86, 31, 10, 9) | rect(18, 20, 52, 42)
    body &= ~rect(0, 0, 15, AH)
    c.part(body, "white", seams=(26, 36, 50, 64, 76), bands=(0.09, 0.32, 0.64, 0.88), spec_band=(0.15, 0.24),
           vents=((26, 37, 32, 39), (40, 37, 46, 39)))
    v = column_v(body)
    # chrome / gold trim: upper chrome line, gold waterline band, gold nose ring, chrome belly strake
    c.paint(body & (v >= 0.30) & (v < 0.33), MAT["gold"][2], 0.9)
    c.paint(body & (v >= 0.50) & (v < 0.57), MAT["gold"][2], 0.95)
    c.paint(body & (v >= 0.50) & (v < 0.53), MAT["gold"][1], 0.9)
    c.paint(body & rect(80, 0, 83, AH), MAT["gold"][2], 0.9)
    c.paint(body & rect(80, 0, 81, AH) & (v < 0.5), MAT["gold"][1], 0.9)
    c.paint(body & (v >= 0.80) & (v < 0.86), MAT["steel"][2], 0.7)
    c.paint(body & (v >= 0.80) & (v < 0.82), MAT["steel"][1], 0.7)
    # portholes along the flank
    for x in (30, 38, 46, 54, 62, 70):
        win = ellipse(x + 0.5, 35.5, 1.8, 1.8) & body
        c.part(win, "glassC", outline=True, spec=False, bands=(0.3, 0.55, 0.8, 0.95))
        c.dot(x, 34, MAT["glassC"][0])
    # nose: cyan sensor dome
    dome = ellipse(92, 31, 4, 3.6) & body
    c.part(dome, "glassC", outline=True, bands=(0.14, 0.42, 0.72, 0.92))
    c.dot(91, 29, CORE)
    # near (lower) wing swept back toward the viewer, gold stripes, cyan tip light
    wing = poly([(42, 40), (70, 39), (58, 53), (14, 53)])
    c.part(wing, "white", spec=False, seams=(30, 48), bands=(0.10, 0.40, 0.74, 0.92))
    c.paint(poly([(40, 43), (67, 42), (64, 45), (36, 46)]) & wing, MAT["gold"][2], 0.95)
    c.paint(poly([(40, 43), (67, 42), (66, 43), (39, 44)]) & wing, MAT["gold"][1], 0.9)
    c.paint(poly([(16, 52), (58, 52), (57, 53), (14, 53)]) & wing, MAT["steel"][2], 0.6)
    c.dot(15, 52, CYAN); c.dot(14, 52, CORE)
    # greenhouse canopy: a long glass strip with struts, framed in gun-metal
    frame = (ellipse(60, 22, 24, 7.5) | rect(40, 19, 78, 27)) & ~rect(0, 27, AW, AH)
    c.part(frame, "gun", spec=False)
    glass = (ellipse(60, 22.4, 22.5, 6.2) | rect(42, 20, 76, 27)) & ~rect(0, 27, AW, AH)
    c.part(glass, "glassC", outline=False, bands=(0.12, 0.40, 0.72, 0.92), spec_band=(0.18, 0.30))
    for x in (48, 56, 64, 72):
        c.paint(rect(x, 15, x + 1, 27) & glass, OUTLINE, 0.6)
    c.paint(rect(44, 18, 54, 19) & glass, MAT["glassC"][0])
    c.paint(rect(60, 25, 76, 27) & glass, MAT["glassC"][4], 0.7)
    # three small engines in a row on the rear face of the block, gold rims
    for y in (20.5, 31.0, 41.5):
        c.nozzle(6.0, y, 4.0, 4.2, rim="gold")
    return c, {"nozzles_y": [20.5, 31.0, 41.5], "nose": (95, 31)}


SHIPS = [
    ("paprika", "S_S_Paprika", draw_paprika),
    ("nightjar", "S_S_Nightjar", draw_nightjar),
    ("moonpie", "S_S_Moonpie", draw_moonpie),
]


# ---------------------------------------------------------------- output
def upscale(a, k):
    return np.repeat(np.repeat(a, k, 0), k, 1)


def to_master(canvas, colors=COLORS):
    """Art canvas -> 2816 x 1536 RGBA master with ART_PX blocks, hull centred, palette quantised."""
    rgba = np.zeros((AH, AW, 4), np.uint8)
    rgb = quantize(canvas.rgb, canvas.a, colors, SEED) if colors else canvas.rgb
    rgba[..., :3] = np.clip(rgb, 0, 255).round().astype(np.uint8)
    rgba[..., 3] = np.where(canvas.a, 255, 0).astype(np.uint8)
    big = upscale(rgba, ART_PX)
    ys, xs = np.where(big[..., 3] > 0)
    bw, bh = xs.max() + 1 - xs.min(), ys.max() + 1 - ys.min()
    ox = (MASTER_W - bw) // 2 - xs.min()
    oy = (MASTER_H - bh) // 2 - ys.min()
    master = np.zeros((MASTER_H, MASTER_W, 4), np.uint8)
    master[oy:oy + big.shape[0], ox:ox + big.shape[1]] = big
    return master, (ox, oy)


def bbox(alpha):
    ys, xs = np.where(alpha > 8)
    return xs.min(), ys.min(), xs.max() + 1, ys.max() + 1


def anchors(master, origin, info):
    """THRUSTER_OFFSET rows as fractions of the trimmed box (alpha box + PAD, clamped to the frame): the hull's
    rear-most opaque x at each nozzle row (+0.01 so the plume's right edge sits just inside the lip, as deflame.py's
    +0.012 did) and the nose tip (muzzleFx = tip - 0.015, the flash sits just inside the point)."""
    a = master[..., 3]
    x0, y0, x1, y1 = bbox(a)
    cx0, cy0 = max(0, x0 - PAD), max(0, y0 - PAD)
    cx1, cy1 = min(MASTER_W, x1 + PAD), min(MASTER_H, y1 + PAD)
    cw, ch = cx1 - cx0, cy1 - cy0
    ox, oy = origin
    out = []
    for ay in info["nozzles_y"]:
        my = int(oy + ay * ART_PX)
        row = a[my]
        xs = np.where(row > 8)[0]
        xl = xs.min()
        out.append({"fx": round(float((xl - cx0) / cw + 0.01), 3), "fy": round(float((my + 0.5 - cy0) / ch), 3)})
    nx, ny = info["nose"]
    tipx = ox + nx * ART_PX
    tip = (tipx - cx0) / cw
    return {"trimBox": [int(cx0), int(cy0), int(cw), int(ch)], "contentBox": [int(x0), int(y0), int(x1 - x0), int(y1 - y0)],
            "nozzles": out, "noseTipFx": round(float(tip), 3), "muzzleFx": round(float(tip - 0.015), 3)}


def game_tile(master_rgba, k):
    """The trimmed hull at k x the game's draw size (168 logical px for the untrimmed 2816 frame)."""
    a = master_rgba[..., 3]
    x0, y0, x1, y1 = bbox(a)
    crop = Image.fromarray(master_rgba[y0:y1, x0:x1], "RGBA")
    s = GAME_DRAW_W / MASTER_W * k
    return crop.resize((max(1, int(round(crop.width * s))), max(1, int(round(crop.height * s)))), Image.NEAREST)


def preview(masters, existing, path):
    rows = []
    for k in (1, 3):
        tiles = [game_tile(m, k) for m in masters] + [game_tile(e, k) for e in existing]
        rows.append(tiles)
    gap = 12
    W = max(sum(t.width for t in r) + gap * (len(r) + 1) for r in rows)
    H = sum(max(t.height for t in r) + gap for r in rows) + gap
    sheet = Image.new("RGBA", (W, H), GROUND + (255,))
    y = gap
    for r in rows:
        hmax = max(t.height for t in r)
        x = gap
        for t in r:
            sheet.alpha_composite(t, (x, y + (hmax - t.height) // 2))
            x += t.width + gap
        y += hmax + gap
    sheet.convert("RGB").save(path)
    return sheet.size


def main():
    os.makedirs(OUT, exist_ok=True)
    masters = []
    for sid, fname, fn in SHIPS:
        canvas, info = fn()
        master, origin = to_master(canvas)
        Image.fromarray(master, "RGBA").save(os.path.join(OUT, fname + ".png"), optimize=True)
        masters.append(master)
        report = {"ship": sid, "file": fname + ".png", "master": [MASTER_W, MASTER_H], "artPx": ART_PX}
        report.update(anchors(master, origin, info))
        opaque = master[master[..., 3] > 0][:, :3]
        report["colors"] = int(len(np.unique(opaque, axis=0)))
        print(json.dumps(report))
    existing = []
    ships_dir = SHIPS_DIR or os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "assets", "ships")
    for name in ("S_S_Coconut", "S_S_littledarkone", "S_S_Sofrito", "S_S_honeyBee"):
        p = os.path.join(ships_dir, name + ".png")
        if os.path.isfile(p):
            existing.append(np.array(Image.open(p).convert("RGBA")))
    size = preview(masters, existing, os.path.join(OUT, "ships-preview.png"))
    print(f"ships-preview.png {size[0]}x{size[1]}  ({len(masters)} generated + {len(existing)} existing, rows at 1x and 3x of the game's draw size)")


if __name__ == "__main__":
    main()
