# HANDOFF — assets track (A7 loader, build script, loader probe)

Worktree `typeR198x-wt/assets`, branch `wt/assets`. Everything below is either a change in a file this track does
not own (exact text supplied) or an integration note for the phase that wires the loader into the game.

## 1. index.html — two script tags (lead applies; same `?v=` token as the neighbours)

```html
<!-- BEFORE assets/audio/sfx.js -->
<script src="./assets/opt/manifest.js?v=20251130a"></script>
<script src="./assets/audio/sfx.js?v=20251130a"></script>
…
<script src="./assets/js/core/40-save.js?v=20251130a"></script>
<!-- AFTER 40-save.js, BEFORE 60-entities.js -->
<script src="./assets/js/core/50-assets.js?v=20251130a"></script>
<script src="./assets/js/core/60-entities.js?v=20251130a"></script>
```

Per C-9 the four ship-card `<img src>` (index.html lines 114/122/130/138) should point at the static x1 WebP paths
(`./assets/opt/ships/coconut@1x.webp`, `little-dark-one`, `sofrito`, `honeybee`) with `width="350"` and the x1
heights from the manifest (211 / 170 / 166 / 233); A8's `hydrateShipCards()` then sets `img.src = Assets.url('ships/<id>','x1')`
after the critical `loadMany` resolves (a cache hit) — never `srcset` (C-2).

## 2. Globals the loader reads (all at call time, never at script load)

| Global | Owner | Used for | Behaviour when absent |
|---|---|---|---|
| `window.TYPER_ASSET_MANIFEST` | manifest.js (generated) | keys, variants, crop/content boxes, version | orig-only manifest synthesised from the content tables (`stats().bootReason === 'synth'`) |
| `PARALLAX_THEMES`, `BOSS_ARTS`, `SHIP_CONFIGS`, `EXPLOSION_SHEET` | 30-content.js | synthesised manifest; `fgHeight` for fg prepare size | empty tables → no keys |
| `getThemeForLevel(i)` | 30-content.js (content track) | `levelKeys(i)` reads `.art`, falls back to `.id` | raw `PARALLAX_THEMES[i]` |
| `LEVELS` | 20-constants.js | level count for `levelKeys` bounds | 10 |
| `SHAKE_PAD` | 10-tokens.js (A5) | bg prepare height `720 + 2*SHAKE_PAD` | 20 (CONTRACT value) |
| `IS_FILE_ORIGIN`, `IS_NATIVE_SHELL` | 00-util.js | bare-path rule (B-17) | own `file:` / UA detection |
| `ASSET_VERSION`, `withAssetVersion` | game.js (loads later) | `?v=` on PNG masters | manifest version |

Nothing in the loader uses `crossOrigin`, `getImageData`, a WebP probe or random cache busters. Each unique URL is
requested once per page (memoised records + one shared `Image` per URL), which is what C-4's caching server assumes.

## 3. Boot (A8 / integration phase)

```js
// game.js constructor (replaces the shipImages / themeImages / bossArtImages / explosionSheet Image loops,
// registerAsset, checkLoadingOverlay and prepareShipSprite; SKIP_CORS_IMAGES becomes unused)
Assets.init({ renderScale: this.renderScale || 1 });   // after resizeCanvas() has computed renderScale
const CRITICAL_KEYS = ['ships/coconut', 'ships/little-dark-one', 'ships/sofrito', 'ships/honeybee', 'bg/first', 'fg/first', 'fx/explosions'];
this.bootPromise = Assets.loadMany(CRITICAL_KEYS, (p) => this.setLoadingProgress(p)); // p = {loaded, total, key}
this.bootPromise.then(() => {
  ExplosionSprite.sheetScale = Assets.sheetScale('fx/explosions');  // 0.5 at x1, 1 at x2
  this.onAssetsReady();
});
Assets.on('error', (e) => this.noteAssetError(e));   // e = {key, src, message}; fires once per key after the PNG fallback also failed
// Retry button: Assets.retryFailed() re-requests every errored key with `&r=<n>` and resolves like loadMany.
```

Minimal boot until A8 lands (C-9): `Assets.loadMany(CRITICAL_KEYS).then(() => loadingOverlay.classList.add('hidden'))`.
`load()` resolves only after the image is decoded off-thread and its draw-size bitmap exists, so the first frame
after the overlay hides draws bitmaps, not 2816-px PNGs.

## 4. resizeCanvas (A6)

After computing `renderScale`: `Assets.setRenderScale(s)`. Variant flips (`s > 1.25` ⇒ `x2`) re-fetch resident keys
in the background and a >10% scale change re-prepares resident bitmaps; the old drawable stays until the new one is
ready. Then `spriteEpoch++` as planned. Ships are always x1 (C-2), so a flip never re-downloads them.

## 5. startLevel / prefetch (A8, PERF-05)

```js
this.levelReady = false;
Assets.gc([...Assets.levelKeys(i), ...Assets.levelKeys(i + 1)]);   // 4 ships + fx/explosions are pinned
Assets.loadLevel(i).then(() => { this.levelReady = true; });       // ['bg/'+art,'fg/'+art,'bosses/'+(i+1)] at high priority
// at levelT >= 0.25*duration and during the finale (idempotent): Assets.prefetchLevel(i + 1)  (low priority, ≤6 in flight)
// Level Complete bar: Assets.on('progress', ({key, ok, loaded, total}) => …)
```

`levelKeys(i)` returns `[]` outside 0..9, so `prefetchLevel(10)` after the final sector is a no-op.

## 6. Drawing (70-render.js, 60-entities.js)

Prepared bitmaps are in DEVICE pixels (`logical × renderScale`); always draw them at the LOGICAL size under the
`setTransform(renderScale, …)` the renderer already applies. Read drawables through `Assets.get()` / `Assets.sprite()`
every frame — never cache them across frames (a re-prepare or `release()` closes the previous ImageBitmap).

```js
// drawBackground — bg is prepared (720 + 2*SHAKE_PAD) tall, anchored y = -SHAKE_PAD
const bg = Assets.get('bg/' + art);                       // null → existing procedural fallback
if (bg) { const h = 720 + 2 * SHAKE_PAD, w = Math.round(meta.orig.w * h / meta.orig.h); /* tile w×h at integer x, y=-SHAKE_PAD */ }

// drawForegroundParallax — fg is prepared round(orig.w*720*fgHeight/orig.h) × round(720*fgHeight)

// drawShip — same numbers as today, plus the sprite() offsets (B-1)
const key = 'ships/' + id, s = Assets.sprite(key, 150 /* 168 in D4 */), orig = Assets.meta(key).orig;
const dw = 150, dh = dw * orig.h / orig.w;                // == natW/natH maths of the untrimmed PNG
const ox = x - dw * 0.38, oy = y - dh / 2;                // where the untrimmed top-left used to go
if (s.img) ctx.drawImage(s.img, ox + s.x, oy + s.y, s.w, s.h); else { /* procedural ship */ }

// drawBoss / drawBossClearBackdrop
const key = 'bosses/' + boss.artLevel, m = Assets.meta(key);
if (m && Assets.get(key)) {
  const scale = Math.min(this.h * 0.65 / m.orig.h, 0.7), artW = m.orig.w * scale, artH = m.orig.h * scale;
  const ox = x - artW * 0.35, oy = y - artH * 0.45, s = Assets.sprite(key, artW);
  ctx.drawImage(s.img, ox + s.x, oy + s.y, s.w, s.h);
  // D6: Assets.contentRect(key, artW) is the opaque box in the same frame (for boss.x/y and the fit);
  // Boss.artRect pre-D6 = {x: ox + s.x, y: oy + s.y, w: s.w, h: s.h}.
}
// bosses are auto-prepared into 576 × (720-24-112-8); once hudSafeTop is known call
// Assets.prepare('bosses/'+L, {w, h}) with the real fit box (re-prepares only if it differs by >10%).

// ExplosionSprite — the sheet is an ImageBitmap (no .complete / .naturalWidth): ready = !!sheet
const k = ExplosionSprite.sheetScale;                     // = Assets.sheetScale('fx/explosions'); re-read after setRenderScale
ctx.drawImage(sheet, f.x * k, f.y * k, f.w * k, f.h * k, dx, dy, dw, dh);
```

When the drawable is the untrimmed PNG master (WebP 404 → fallback, or the synthesised manifest), `sprite()` returns
the full box (`x = y = 0`, `w = targetOrigW`), so the same call sites place the art correctly in every path.

## 7. Prepare sizes (CONTRACT §5) — built in as defaults, overridable with `Assets.prepare(key, {w, h, scale?})`

| Key | Logical size | Device size |
|---|---|---|
| `bg/*` | `(720 + 2*SHAKE_PAD)` tall, width from orig aspect (1423×760 at 16:9) | × renderScale |
| `fg/*` | `round(orig.w*720*fgHeight/orig.h) × round(720*fgHeight)` | × renderScale |
| `ships/*` | `sprite(key,168)` box × 1.5 (≈197×118 for coconut) | × renderScale, from the x1 file |
| `bosses/*` | crop box fitted into `576 × (720-24-hudSafeTop-8)`, hudSafeTop 112 by default | × renderScale |
| `fx/explosions` | full 2816×1536 at x2, half 1408×768 at x1 (`sheetScale` 1 / 0.5) | scale 1 (not × renderScale) |

Measured on the probe at renderScale 1: level-1 set + 4 ships + fx = 2.9 Mpx decoded; renderScale 2 with the full sheet
≈ 7.2 Mpx (budget 12 Mpx).

## 8. Requests to other tracks

- **30-content.js (content track):** `LEVEL_THEMES` + `getThemeForLevel(i)` returning `{...theme, art, storm, accent}` per
  CONTRACT §7 — the loader reads `.art`. `EXPLOSION_SHEET.width/height` are 2048×1117 but the sheet is 2816×1536 (only the
  synthesised-manifest path sees them; the loader prefers the decoded image's natural size, so nothing breaks either way).
  The manifest no longer has `bg|fg/seventh|eighth|ninth` keys; a request for them resolves `null` and emits one `error`.
- **10-tokens.js (A5):** `SHAKE_PAD = 20` (the loader defaults to 20 when the token is absent).
- **60-entities.js:** `ExplosionSprite.sheetScale` static (default 1) multiplying the source rect; readiness check `!!sheet`.
- **game.js / 10-ui.js:** delete `prepareShipSprite`, `registerAsset`, `checkLoadingOverlay`, the constructor Image loops and
  the `SKIP_CORS_IMAGES` uses; boot per §3. `getBossArtForLevel` → `Assets.get('bosses/' + level)`.
- **tools/playtest/play.mjs (A1):** send `Cache-Control: public, max-age=3600` for `/assets/` (C-4) and classify
  "Failed to load resource" console errors into `report.resourceErrors` (E-5); the loader probe's own server already does both.
- **native/sync-web.sh (E1):** nothing required — `Assets.url()` returns bare paths under `file://` and the native UA — but
  rsync now carries `assets/opt` (29 MB, was 32 MB) into the bundles; list it in E1's unreferenced-assets note.
- **assets/ui (UI track / C9):** `OG_ONLY=1 tools/build-web-assets.sh` renders `assets/ui/og-card.jpg` (1200×630, 124 KB at
  q=82) from `assets/screenshot.png`; this track did not commit the JPEG.

## 9. Tooling

- `tools/build-web-assets.sh` — full build; `MANIFEST_ONLY=1` regenerates manifest.js/json (+ og-card) from the existing
  `assets/opt` files in ~7 s and bumps the version token; `OG_ONLY=1` renders only the social card; `SKIP_OG=1` skips it.
  The manifest step now refuses to emit a key for a missing file or a duplicate theme.
- `cd tools/playtest && node probes/assets-loader.mjs [--root ../..] [--out ./out/assets-loader]` — 38 checks (HEAD on every
  manifest URL, fallback / error paths, B-1 sprite math, loadLevel, gc + pins, stats shape, prepare at renderScale 2 incl. the
  canvas fallback, levelKeys under the LEVEL_THEMES mapping, native-UA bare paths, synthesised manifest); writes
  `report.json` and `preview.png`. Exit 1 on any failure.

## 10. README section draft (for E1)

### Web asset pipeline

The browser build never downloads the PNG/WAV masters. `tools/build-web-assets.sh` encodes them into `assets/opt/`
(WebP art at 1x/2x, trimmed ships and bosses, MP3 music, compact mono SFX) and writes `assets/opt/manifest.js`, which
sets `window.TYPER_ASSET_MANIFEST` with every file's size, the trim box (`crop`) and the opaque box (`content`) of each
sprite in original pixels, and a version token used for cache busting. `assets/js/core/50-assets.js` (`Assets`,
also `window.TypeRAssets`) reads the manifest and loads images on demand: the loading screen waits only for the four
ships, sector 1 and the explosion sheet; each sector's art and boss load when the sector starts and the next sector is
prefetched during play; images are decoded off the main thread into bitmaps at the size they are drawn (`x2` files
above renderScale 1.25, `x1` otherwise; `Save-Data` forces `x1`); a WebP that fails to load falls back to its PNG
master. Ten sectors share seven art sets, so `seventh/eighth/ninth` are neither encoded nor requested. Rebuild after
changing a master with `tools/build-web-assets.sh` (needs ImageMagick 7, cwebp, ffmpeg); `MANIFEST_ONLY=1` refreshes
the manifest without re-encoding; `OG_ONLY=1` renders `assets/ui/og-card.jpg`. Check the loader with
`cd tools/playtest && node probes/assets-loader.mjs`.
