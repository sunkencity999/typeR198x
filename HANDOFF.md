# HANDOFF — tools track (A1 harness v2, A10 versioning tools, E1 deploy tooling)

Requests for files this track does not own. Everything below is already tolerated by the tooling
(guards / fallbacks in place); applying the change makes the corresponding check meaningful.

## index.html + secondary pages owner (A10 html half, C9, E1 pages)
1. Add the shell token to the two stylesheet links and a meta tag in `<head>`:
   ```html
   <meta name="asset-version" content="20251130a" />
   <link rel="stylesheet" href="./assets/style/tokens.css?v=20251130a" />
   <link rel="stylesheet" href="./style.css?v=20251130a" />
   ```
   (same on `info.html`, `support.html`, `privacy-policy.html`; `privacy.html` only links `style.css`).
   `tools/bump-version.sh <token>` rewrites tokens that already exist; it never adds one unless run with
   `--add-missing` (which appends `?v=` to stylesheet/preload links and script tags). The lead can use
   `tools/bump-version.sh --add-missing` once after the merge instead of editing by hand.
2. The `assets/opt/manifest.js` script tag takes the SHELL token (`?v=<SHELL>`, per contract). Any other
   `assets/opt/...` URL in a `<link>` (should there be one) is rewritten to the ART token from
   `assets/opt/manifest.json` by `bump-version.sh`.
3. Keep `#loadingOverlay` with `id` as its first attribute and no `class` attribute in source;
   `tools/deploy-check.sh --local` fails otherwise (amendment B-17).

## B3 owner (wave state machine)
`forceBoss()` sets `game.levelT = LEVELS[levelIndex].duration + 0.01` and waits up to 15 s for
`inBoss && !(bossIntro && bossIntro.locked)`. Keep `levelT >= duration` a valid path into the boss
(drain timeout → approach → boss is fine). Otherwise the harness falls back to `game.beginBossFight()`
and records a note, and the approach/intro acceptances in B3/D6 are not exercised by the `all` scenario.

## A3 owner (save model v2)
The harness checks three legacy fixtures after Continue and prints `[fixture] check PASS/FAIL`
(stored in `report.fixture.check`, not part of the exit code — cite it in your acceptance evidence):
- `legacy-levelcomplete` (today's F003 shape, `levelT 119.6 > 114`): `levelT < duration` and not
  `inBoss` for 3 s after entering play. FAILS on the current build (it re-enters the boss), as expected.
- `legacy-inboss` (`inBoss:true`, no `run.boss`): `inBoss` within 6 s of playing (amendment B-10).
- `legacy-midwave`: levelIndex 2, score ≥ 6000, highScore 8800 kept as the headline.

## C5 owner (title screen)
For fixture runs whose `#btnContinue` is hidden (resume card absent, e.g. `legacy-postvictory` with
`run:null`), the harness clicks `.sectorCard[data-level="10"]` (1-based `data-level`), then falls
back to Start. Keep `data-level` 1-based and the card clickable when unlocked.

## C7 owner (mobile input)
`--mobile` taps `#game`, calls `typeInput.focus()` when the active element is not already
`#typeInput`, then sends each character with Playwright `keyboard.insertText(ch)` — this arrives as
`beforeinput`/`input` with `inputType === "insertText"` and NO keydown. Handle that path (read the
character, clear the field). The keyboard fallback is only used when `#typeInput` does not exist.

## A9 owner (audio transport) — measured stall under the native UA
`node play.mjs --ua native` (and `probes/harness-native-audio.mjs`) shows Start never reaching play on
the current build: `sfx.unlock()` → `_setupHtmlAudioElements()` primes seven media elements with
`audio.play()`; the six music elements' promises resolve, the `bigexplosion.wav` element's `play()`
promise never settles in headless Chrome, so `Promise.all(primes)` and therefore `unlock()` never
resolve and `btnStart`'s handler stops before `handleLaunchRequest()`. The contract already requires
`unlock()` to await only the laser/bigexplosion buffers (never media elements) and to memoise
`_unlockPromise`; please also give any remaining media prime a timeout (`Promise.race` with ~1.5 s).
Acceptance you can cite: `node play.mjs --root . --out out/native --scenario smoke --ua native` →
`timings.startToPlayingMs < 5000` and no "forced the run start" note. Until then the harness forces
the run start after 15 s and records that note. Nuance: the same build served from `file://`
(`--file --ua native`, the real shell's situation) enters play in ~0.4 s with no stall, so this is
an HTTP-served-under-Chrome media quirk rather than a shipped-app bug; the timeout guard is cheap
insurance either way.

## A2 / C5 owner (victory path)
The harness enters the ending via `startSector(9)` when it exists, else
`startNewRun(); startLevel(9, {fromMenu:true, fresh:true})` (amendment B-5), then tops the hull up to
`getHpBonusForLevel(10)` when `player.maxHp` is lower (mirrors a real sector-10 run on today's build;
a no-op once `startSector` sets per-sector HP). The forced sector-10 typist runs at ≥ 160 wpm.

## E1 docs owner (README)
Please document: `tools/bump-version.sh [token] [--root] [--dry-run] [--add-missing]`,
`tools/deploy-check.sh <url> [--strict] [--local]`, `tools/unreferenced-assets.sh [--out file]`,
`tools/nginx-cache.conf` (server-block include; the G025 go/no-go), and point at
`tools/playtest/README.md` for the harness flags and report fields.

## native/sync-web.sh owner (out of scope for this release, F105 / amendment E-4b)
`tools/unreferenced-assets.sh` shows the `rsync -a --delete assets/` step copies `assets/opt`
(31.5 MB) plus the 341 MB masters into both native bundles. `--exclude opt/` on that rsync (or
syncing from a built set) would halve the bundles; no code change needed for this release.

## Lead (merge-time)
- `tools/playtest/out/` and `node_modules/` are git-ignored; `tools/playtest/package.json` gained
  `reduced-motion`, `native`, `fixture`, `matrix`, `matrix:quick` scripts.
- The finished harness is also copied to the scratchpad harness path
  (`scratchpad/harness/play.mjs`) as PLAN A1 asks.
