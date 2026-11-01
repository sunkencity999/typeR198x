# tools/art — generated and processed art

Python tools behind the 2026-10-31 presentation pass. They need Pillow, NumPy and SciPy:

```
python3 -m venv ~/.venvs/typer-art && ~/.venvs/typer-art/bin/pip install pillow numpy scipy
```

| Tool | What it does |
|---|---|
| `gen_explosions.py <out_dir> [seed]` | Writes the explosion sheet master (`explosions.png`, 2816x1536), `frames.json` (the 21 rects in `EXPLOSION_FRAMES` order) and a preview. Neon pixel art on the game palette, drawn on a 4 px art grid. The sets keep their indices (small 2,1,0; medium 9,7,6,5,4,3,8; large 15,14,12,11,13,19,17; 16 debris; 10/18/20 blank), so `EXPLOSION_SETS` is untouched. After a regeneration: copy the PNG to `assets/explosions/explosions.png`, paste the rects into `assets/js/core/30-content.js` if the layout changed, and re-encode `assets/opt/fx/explosions.webp` (`cwebp -q 86 -alpha_q 92 -m 6 -sharp_yuv -metadata none`) or run `tools/build-web-assets.sh`. |
| `pixelize.py <in.png> <out.png> --display-w <px> [--art-px 2] [--colors 32] [--sharpen 160] [--outline 0.55] [--preview p.png]` | Pixel-consistency pass for an illustrated sprite master: crops to the alpha box, pre-sharpens, box-downsamples to `display-w / art-px` art pixels wide (premultiplied, no fringe), k-means quantises the opaque pixels to `colors`, hardens the alpha, darkens the silhouette edge, and writes the result back at the master's size with nearest-neighbour blocks. The asset pipeline then trims and encodes it as before. |

| `gen_vista.py <abyss\|foundry\|engine> <bg.png> <fg.png> [--seed N] [--preview p.png]` | Generates a sector's backdrop and parallax foreground (2816x1504, horizontally seamless) as pixel art on a 704x376 art grid with a fine 1408x752 star / dither pass: periodic value-noise nebulae posterised with ordered dither, shaded planets (gas bands, craters, lava cracks, rings), a low sun or dying star, periodic skylines with windows / spires / stacks / fins, haze, a synthwave horizon grid, and foreground props per theme (data cables and monoliths; gears, pipes and stacks over molten pools; turbines, cones and struts). `--preview` renders the pair as the game lays them (fg at `--fg-height` of the screen). Themes map to `seventh` (sector 6), `eighth` (sector 8), `ninth` (sector 9). |
| `deflame.py <ship-id> <in.png> <out.png> [--nozzles fy,fy]` | Removes the painted exhaust from a ship master with per-ship rules (`RULES`: box in bbox fractions + `all` / `warm` hue range / `grey` / `hilite`), drops small islands, and prints the hull's rear-most point at the given nozzle rows as fractions of the new trimmed box for `THRUSTER_OFFSET` (75-fx-draw.js). |

Pass applied on 2026-10-31 (the originals are in git history before that commit, tag `v20261025a`):

| Masters | Parameters |
|---|---|
| `assets/ships/*.png` (4) | `deflame.py <id>` on the original, then `pixelize.py --display-w 131 --art-px 1.4 --colors 36` (the ship draws 168 logical px untrimmed, about 131 trimmed; a finer grid than the backdrops keeps the cockpit and pipe detail). Nozzle rows passed: coconut `0.24,0.41`, little-dark-one `0.34,0.64`, sofrito `0.47`, honeybee `0.32,0.73` |
| `assets/backgrounds/{seventh,eighth,ninth}levelbg.png`, `assets/foregrounds/{seventh,eighth,ninth}levelFG.png` | `gen_vista.py abyss` / `foundry` / `engine`, seed 6 (default) |
| `assets/boss_ships/*.png` (10) | `--display-w 565 --art-px 2 --colors 48` (one art pixel per two logical pixels, the backdrops' density) |
| `assets/explosions/explosions.png` | `gen_explosions.py` seed 198 |

To revert a sprite: `git checkout v20261025a -- assets/ships/S_S_Coconut.png` and run `tools/build-web-assets.sh`.
