# Type-R 198X play-test harness (v2)

Headless Playwright driver that boots the web build from a local static server, plays it like a
competent typist, forces the boss / game-over / victory paths, and writes a machine-readable
`report.json` plus numbered screenshots. Every acceptance criterion in the overhaul plan is phrased
so one of these runs (or a screenshot from it) can check it.

```
cd tools/playtest
npm install                                   # once; installs playwright (Chrome channel must be installed)
node play.mjs --root ../.. --out ./out/all --scenario all --dpr 2
bash run-matrix.sh                            # the standard matrix, summary table at the end
```

Exit code `1` when the run recorded a page error, a non-resource console error, or the harness
itself failed; `0` otherwise. Resource-load failures (404s, injected faults) are reported in
`resourceErrors` and never affect the exit code (amendment E-5).

## Flags

| Flag | Default | Meaning |
|---|---|---|
| `--root <dir>` | `.` | Repository root to serve (index.html lives here) |
| `--out <dir>` | `./out` | Output folder; stale `NN-*.png` and `report.json` are removed first |
| `--scenario all\|smoke` | `all` | `smoke` = boot, menu, one typing wave; `all` adds pause, boss, finale, level 2, game over, final boss, victory, menu |
| `--seconds N` | `12` | Length of the first typing wave |
| `--dpr 1\|2` | `1` | `deviceScaleFactor` (matrix runs both) |
| `--wpm N` | `80` | Typist speed: key interval `60000/(wpm*5)` ms with ±20 % uniform jitter (the forced sector-10 boss uses `max(wpm,160)`) |
| `--accuracy A` | `0.93` | Probability a keystroke is the right one; a miss types a random other letter |
| `--reduced-motion` | off | `page.emulateMedia({reducedMotion:'reduce'})` before load; `report.reduceMotion` records what the page did with it |
| `--mobile` | off | iPhone 13 descriptor (390×664, touch, mobile UA). Taps the playfield first; types through `#typeInput` with `keyboard.insertText` when that element exists, else through the keyboard |
| `--ua native` / `--ua "<string>"` | browser default | `native` = `TypeR198X-macOS`, the WKWebView custom UA (exercises `IS_NATIVE_SHELL`) |
| `--cpu N` | off | CDP `Emulation.setCPUThrottlingRate` (4 ≈ integrated-GPU laptop) |
| `--fixture <name>` | none | Writes `fixtures/<name>.json`'s `save` blob into `localStorage[typesmup198x.save.v1]` before the first navigation (`null` removes the key), prints the blob, and checks the fixture's `expect` block after entering play (`report.fixture.check`) |
| `--entry auto\|start\|continue` | `auto` | Which menu button enters play. `auto` presses Continue when the fixture has a run or unlocked sectors (falls back to the matching `.sectorCard`, then Start) |
| `--fail-webp` | off | Routes every `*.webp` request to a 404 (loader fallback acceptance) |
| `--delay-opt <ms>` | off | Delays every `assets/opt/*` response by N ms (loading overlay / watchdog acceptance) |
| `--expect-resource-errors` | off | Documents that resource errors are injected on purpose (`report.config`, summary line) |
| `--ignore-errors <regex>` | none | Page/console errors matching the regex go to `report.ignoredErrors` instead of failing the run |
| `--file` | off | Open `file://<root>/index.html` instead of starting the server (pair with `--ua native` for the synced bundle) |
| `--headed` | off | Show the browser |

All v1 flags keep their meaning; scripts that call `--root/--out/--scenario/--seconds/--dpr/--accuracy/--mobile/--headed` run unchanged.

## What the typist does

`nextKey()` picks, in order (amendment C-14): nothing while `game.levelIntro` or a locked
`bossIntro` is active; the boss's `nextChar` (or the current segment's next character); the current
lock's next character; the nearest targetable **enemy** (`game.isTargetable` when present, else
`x < w-10`), then powerups. `forceBoss()` sets `levelT = duration + 0.01` and waits up to 15 s for
`inBoss && !(bossIntro && bossIntro.locked)` (then calls `beginBossFight()` directly and notes it).
The victory path uses `startSector(9)` when it exists, else `startNewRun(); startLevel(9, {fromMenu:true, fresh:true})` (amendment B-5).

### Entry fallback

After pressing Start / Continue the harness waits 15 s for `mode === "playing"`. If the click path
stalls (today: `--ua native`, where `sfx.unlock()` never resolves because a media `play()` promise
hangs), it calls `startNewRun()` / `continueRun()` directly, records the note
`entry: Start/Continue did not reach playing within 15 s; forced the run start directly`, and keeps
the true `timings.startToPlayingMs`. Treat that note as a failure of the game's start path, not of
the harness.

## Local server

`play.mjs` serves `--root` on a random 127.0.0.1 port with correct MIME types, `Accept-Ranges`
(single byte ranges, 206), `Last-Modified`, HEAD support, and the cache policy the acceptance tests
assume (amendment C-4): `Cache-Control: no-store` for html/js/css/json, `max-age=3600` for everything
else under `/assets/`. `tools/deploy-check.sh http://127.0.0.1:<port>` can run against it.

## Screenshots (fixed numbering)

`01-boot 02-menu 03-story 04-gameplay-early 05-gameplay-mid 06-paused 07-boss-intro 08-boss-fight
09-boss-finale 10-level-complete 11-level2-start 12-game-over 13-final-boss 14-victory
15-victory-dialogue 16-menu-after`. A shot keeps its number even when earlier ones are skipped
(fixtures with `storySeen` produce no `03-story`); extra shots continue from 17.

## report.json fields

| Field | Meaning |
|---|---|
| `config`, `base`, `root`, `scenario`, `dpr`, `mobile` | The run's parameters |
| `pageErrors[]`, `consoleErrors[]`, `consoleWarnings[]` | Uncaught exceptions; console errors/warnings (text `@ url`) |
| `resourceErrors[]` | Console errors that are resource-load failures (`Failed to load resource`, `net::ERR_*`, or located in a media/font URL). Never fail the exit code |
| `ignoredErrors[]` | Errors matched by `--ignore-errors` |
| `requestFailures[]`, `httpErrors[]` | Network-level failures; responses with status ≥ 400 |
| `timings` | `loadEventMs`, `assetsReadyMs` (loading overlay hidden), `startToPlayingMs`, `firstKeystrokeMs` — all from navigation start |
| `fps.{menu,gameplay,boss,finale}` | rAF frames per second over 1.5 / 2 / 1.5 / 1.2 s windows |
| `perf.{menu,typing,gameplay,boss,finale}` | Per-window canvas counters (below); `typing` covers the whole first wave |
| `maxRenderMs` | Max `game.render()` wall time over the whole run (wrapped once `window.game` exists). `perf.*.maxRenderMs`/`avgRenderMs`/`renderFramesOver16ms`/`maxUpdateMs` per window |
| `shadowBlurPerFrame` | Max per-frame count of `ctx.shadowBlur = v` with `v > 0` across the gameplay/boss/finale/typing windows (budget ≤ 2, target 0). `perf.*.shadowBlurSetsPerFrame` counts every assignment including resets to 0 |
| `perf.*.compositeSetsPerFrame` / `compositeNonDefaultPerFrame` | `globalCompositeOperation` assignments per frame (all / not `source-over`) |
| `fullFrameFillMaxAlpha` | Max effective alpha (`fillStyle` alpha × `globalAlpha`) of a translucent `fillRect` covering ≥ 90 % of the game canvas (contract: ≤ .12 except the 2-frame storm flash). `perf.*.fullFrameFillFramesAbove12` counts offending frames; `fullFrameOpaqueFillsPerFrame` is the base clear; `fullFrameGradientFills` counts gradient/pattern fills whose alpha cannot be parsed |
| `getImageDataCalls` | Total `getImageData` calls (should be 0 after the loader lands) |
| `layoutCountPer5s`, `recalcStyleCountPer5s`, `jsHeapUsedMB` | CDP `Performance.getMetrics` deltas over the first typing wave, normalised to 5 s (DOM HUD write hygiene) |
| `probe` | Whole-run totals plus `longTasks {count,maxMs,totalMs}` from `PerformanceObserver('longtask')` and `wrapped` (render wrap succeeded) |
| `network[]` | Every finished request: `{url, bytes (transfer size incl. headers), start, end (ms from navigation), status, type}` |
| `networkTotals` | `requests`, `overallBytes`, `firstKeystrokeMs`, `bytesStartedBeforeFirstKeystroke`, `bytesFinishedBeforeFirstKeystroke` (the ~2.5 MB budget metric), `byType`, `topUrls` (bytes per URL, ranges summed) |
| `typedWave`, `stateAfterWave`, `stateAfterBoss`, `stateAfterFinale`, `stateLevel2`, `stateFinalBoss`, `finalState` | Game snapshots (`mode levelIndex levelT inBoss bossClear hp score combo enemies powerups particles wave wavePhase levelIntro bossIntroLocked reduceMotion renderScale touchMode`) |
| `saveBlob` | `localStorage[typesmup198x.save.v1]` at the end |
| `debugStats` | `window.TypeRDebug.stats()` when it exists (`incomingCps leaksPerMin deathsBySector liveChars`) |
| `reduceMotion` | `{rootClass, gameFlag, mediaQuery}` — what the page resolved |
| `canvas` | Backing store vs CSS size and DPR (`renderScale` acceptance) |
| `fixture` | `{name, description, entry, expect, save, check:{pass, details[], snapshot}}` |
| `entryUsed`, `notes[]`, `screenshots[]`, `harnessError` | Bookkeeping |

## Fixtures (`fixtures/*.json`)

Each file is `{description, entry, expect, save}`; `save` is the exact blob written under the
legacy key (none carries `schema`, `run.id` or `run.checkpoint`):

| Name | Shape | Expectation |
|---|---|---|
| `fresh` | no save | Start, sector 1 |
| `legacy-midwave` | run on sector 3, `levelT 40`, `stats.score 6000` | Continue → levelIndex 2, score ≥ 6000, levelT < duration |
| `legacy-inboss` | run on sector 2 with `inBoss:true`, levelT past duration, no `run.boss` | Continue → `inBoss` within 6 s (amendment B-10) |
| `legacy-postvictory` | `run:null`, `lastUnlockedLevel 10`, `highScore 4200`, muted, CRT off | Continue / sector 10 card → levelIndex 9 |
| `legacy-levelcomplete` | today's F003 shape: sector 3 run with `levelT 119.6 > 114` | Continue → wave play, levelT clamped below duration, not in boss for 3 s |

`expect` keys: `levelIndex`, `scoreMin`, `highScore`, `lastUnlockedLevel`, `playerName`,
`levelTBelowDuration`, `inBossWithinS`, `notInBossForS`. A failed check is printed and stored but
does not change the exit code (the owning task's acceptance decides).

## Matrix (`run-matrix.sh`)

Rows: `dpr1`, `dpr2`, `reduced-motion`, `mobile` (smoke), `native-ua`, and `fixture-<name>` (smoke)
for the five fixtures. Output goes to `out/matrix/<name>/` with a log beside each folder and a
`summary.tsv`; the table printed at the end has exit codes, error counts, fps, `maxRenderMs`,
`shadowBlurPerFrame`, `fullFrameFillMaxAlpha`, `layoutCountPer5s` and the fixture verdict.
`--quick` runs everything as `smoke`; `--only a,b` selects rows; `PLAY_ARGS="--cpu 4"` is appended
to every row.

## Probes

Extra one-off scripts live in `probes/` (shipped) or `out/` (ignored). They can import nothing from
`play.mjs`; copy the `installProbe` function if they need the canvas counters. Shipped:

- `probes/harness-report-check.mjs <report.json> [--all]` — asserts every v2 report field is present
  and prints the headline numbers (exit 1 when something is missing).
- `probes/harness-native-audio.mjs --root ../.. [--ua native] [--wait ms]` — clicks Start under a
  user agent and dumps every media element's load state plus a `play()`/`pause()` trace, for the
  audio unlock path.
