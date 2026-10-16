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
| `--no-music` | off | Perf-only runs: `SFX.prototype.playMusic/prefetchMusic` are stubbed the moment `sfx.js` publishes the class (a `window.SFX` setter trap), so no media element ever streams. Cues and the bus are untouched; `sfx.noMusicCalls` lists what the game asked for; `report.config.noMusic` records the flag |
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
stalls, it calls `startNewRun()` / `continueRun()` directly, records the note
`entry: Start/Continue did not reach playing within 15 s; forced the run start directly`, and keeps
the true `timings.startToPlayingMs`. Treat that note as a failure of the game's start path, not of
the harness. (`--ua native` over HTTP used to trip this when a media `play()` promise never settled
inside `sfx.unlock()`; `unlock()` now races its media primes and `ctx.resume()` against 1.5 s, and the
native-UA row enters play in ~0.4 s.)

## Local server

`play.mjs` serves `--root` on a random 127.0.0.1 port with correct MIME types, `Accept-Ranges`
(single byte ranges, 206 + `Content-Range`, 416 past the end), `Last-Modified`, HEAD support, and
the cache policy the acceptance tests assume (amendment C-4): `Cache-Control: no-store` for
html/js/css/json, `max-age=3600` for everything else under `/assets/`. Media elements seek with
Range requests, so every acceptance that sets `currentTime` depends on the 206 path; the hour of
cache is what lets the second music element (the loop lead at `loopEnd - 3 s`) hit the cache instead
of re-downloading the track. `tools/deploy-check.sh http://127.0.0.1:<port> --local` can run against it (any static server of the repo root works too, e.g. `python3 -m http.server`).

### Media traffic in the report

A playing media element streams its whole 3 MB track in a few milliseconds on the local server, which
says nothing about what the first keystroke waited for. The report therefore splits network bytes
into *media* (`resourceType === "media"`, i.e. HTMLMediaElement traffic, plus any music file URL) and
everything else:

- `networkTotals.bytesFinishedBeforeFirstKeystrokeNonMedia` is the ~2.5 MB budget figure (scripts,
  css, font, critical art, the two one-shot WAVs fetched by `unlock()`); `...Media` is the rest, and
  the two sum to `bytesFinishedBeforeFirstKeystroke`.
- `networkTotals.mediaBytes` is the media total over the whole run (C-4: each `.mp3` ≤ 1.25× its size
  per level; the summary prints it as `networkMB.media`).
- `report.mediaAborts[]` holds `net::ERR_ABORTED` media requests. Chrome aborts a media element's open
  range request whenever its `src` is replaced or it has read enough for `preload="metadata"` (the
  next sector's track is prefetched that way, ~130 KB); that is transport behaviour, so it is kept out
  of `requestFailures` (which stays at 0 on a clean run).

## Screenshots (fixed numbering)

`01-boot 02-menu 03-story 04-gameplay-early 05-gameplay-mid 06-paused 07-boss-intro 08-boss-fight
09-boss-finale 10-level-complete 11-level2-start 12-game-over 13-final-boss 14-victory
15-victory-dialogue 16-menu-after`. A shot keeps its number even when earlier ones are skipped
(fixtures with `storySeen` produce no `03-story`); extra shots continue from 17. `03-story` is taken once the
modal has settled (400 ms), `05-gameplay-mid` waits up to 4 s for at least three enemies on screen, and
`07-boss-intro` captures the intro ceremony at ~1.2 s before the hand-off.

## report.json fields

| Field | Meaning |
|---|---|
| `config`, `base`, `root`, `scenario`, `dpr`, `mobile` | The run's parameters |
| `pageErrors[]`, `consoleErrors[]`, `consoleWarnings[]` | Uncaught exceptions; console errors/warnings (text `@ url`) |
| `resourceErrors[]` | Console errors that are resource-load failures (`Failed to load resource`, `net::ERR_*`, or located in a media/font URL). Never fail the exit code |
| `ignoredErrors[]` | Errors matched by `--ignore-errors` |
| `requestFailures[]`, `httpErrors[]` | Network-level failures (never music aborts); responses with status ≥ 400 |
| `mediaAborts[]` | `net::ERR_ABORTED` on media-element / music requests (src replaced, `preload="metadata"` satisfied). Informational, see *Media traffic in the report* |
| `timings` | `loadEventMs`, `assetsReadyMs` (loading overlay hidden), `startToPlayingMs`, `firstKeystrokeMs` — all from navigation start |
| `fps.{menu,gameplay,boss,finale}` | rAF frames per second over 1.5 / 2 / 1.5 / 1.2 s windows |
| `perf.{menu,typing,gameplay,boss,finale}` | Per-window canvas counters (below); `typing` covers the whole first wave |
| `maxRenderMs` | Max `game.render()` wall time over the whole run (wrapped once `window.game` exists). `perf.*.maxRenderMs`/`avgRenderMs`/`renderFramesOver16ms`/`maxUpdateMs` per window |
| `shadowBlurPerFrame` | Max per-frame count of `ctx.shadowBlur = v` with `v > 0` across the gameplay/boss/finale/typing windows (budget ≤ 2, target 0). `perf.*.shadowBlurSetsPerFrame` counts every assignment including resets to 0 |
| `perf.*.compositeSetsPerFrame` / `compositeNonDefaultPerFrame` | `globalCompositeOperation` assignments per frame (all / not `source-over`) |
| `fullFrameFillMaxAlpha` | Max effective alpha (`fillStyle` alpha × `globalAlpha`) of a translucent `fillRect` covering ≥ 90 % of the game canvas (contract: ≤ .12 except the 2-frame storm flash). `perf.*.fullFrameFillFramesAbove12` counts offending frames; `fullFrameOpaqueFillsPerFrame` is the base clear; `fullFrameGradientFills` counts gradient/pattern fills whose alpha cannot be parsed |
| `getImageDataCalls` | Total `getImageData` calls (should be 0 after the loader lands) |
| `layoutCountPer5s`, `recalcStyleCountPer5s`, `jsHeapUsedMB` | CDP `Performance.getMetrics` deltas over the first typing wave, normalised to 5 s (DOM HUD write hygiene) |
| `layoutCountPer5sIdle` | The same LayoutCount delta over the first 5 s of play before any typing (the PLAN A11 idle target, <= 10) |
| `probe` | Whole-run totals plus `longTasks {count,maxMs,totalMs}` from `PerformanceObserver('longtask')` and `wrapped` (render wrap succeeded) |
| `network[]` | Every finished request: `{url, bytes (transfer size incl. headers), start, end (ms from navigation), status, type}` |
| `networkTotals` | `requests`, `overallBytes`, `mediaBytes`, `firstKeystrokeMs`, `bytesStartedBeforeFirstKeystroke`, `bytesFinishedBeforeFirstKeystroke`, `bytesFinishedBeforeFirstKeystrokeNonMedia` (the ~2.5 MB budget metric), `bytesFinishedBeforeFirstKeystrokeMedia`, `byType`, `topUrls` (bytes per URL, ranges summed) |
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

Rows: `dpr1`, `dpr2`, `reduced-motion` (`all` at DPR 2 with `prefers-reduced-motion: reduce`),
`mobile` (smoke), `native-ua` (the WKWebView user agent served over HTTP, `all`), `no-music` (smoke,
DPR 2, media transport stubbed: the perf-only row) and `fixture-<name>` (smoke) for the five fixtures.
Output goes to `out/matrix/<name>/` with a log beside each folder and a `summary.tsv`; the table
printed at the end has exit codes, error counts, `reqFail`/`mediaAbort`, fps, `maxRenderMs`,
`shadowBlurPerFrame`, `fullFrameFillMaxAlpha`, `layoutCountPer5s`, the non-media MB before the first
keystroke, media MB and the fixture verdict. `--quick` runs everything as `smoke`; `--only a,b`
selects rows; `PLAY_ARGS="--cpu 4"` is appended to every row.

## Probes

Extra one-off scripts live in `probes/` (shipped) or `out/` (ignored). They can import nothing from
`play.mjs`; copy the `installProbe` function if they need the canvas counters. Shipped:

- `probes/harness-report-check.mjs <report.json> [--all] [--budget-mb 2.5]` — asserts every v2 report
  field is present (including `mediaAborts`, `networkTotals.mediaBytes`,
  `bytesFinishedBeforeFirstKeystrokeNonMedia/Media`, `config.noMusic`), checks their shapes
  (non-media + media = total, no music `ERR_ABORTED` left in `requestFailures`), optionally fails
  when the non-media figure exceeds the budget, and prints the headline numbers.
- `probes/harness-native-audio.mjs --root ../.. [--ua native] [--wait ms]` — clicks Start under a
  user agent and dumps every media element's load state plus a `play()`/`pause()` trace, for the
  audio unlock path.
- `probes/audio-contract.mjs --root ../.. [--legacy]` — the 37-check CONTRACT §6 set against `sfx.js`
  directly (registry, bus, offline peaks, loop crossfade, states, mute/volume curves, voice cap,
  hidden/visible, laser 404, native UA). `--legacy` serves a manifest without `music`/`sfx` so the
  WAV masters are the transport under test.
- `probes/audio-lifecycle.mjs --root ../..` — the PLAN D10/D11 acceptance lines through the GAME
  paths: muted save → Start (sector-1 music rolling within 1 s, master 0) → `#btnMute` (playing within
  .2 s) → Escape pause/resume (filter < 700 Hz, -6 dB, restored) → `#btnRestart` (same element,
  `currentTime` continuous) → forced boss (`bossWarning`, `bossSiren`, `'boss'`, filter < 1 kHz) →
  kill (`bossCharge`, `'finale'`, filter > 15 kHz after 2 s) → level complete (`'end'`, gain < .01 in
  1 s) → Next (track 5 on the other element) → game over (`fanfare:gameOver`, gain < .01, paused) →
  Try Again (playing within 1 s, same element) → hidden/visible. A ScriptProcessor on `musicGain`
  records the loop boundary on tracks 0 and 5 (`currentTime = loopEnd - 1.5`) and the report gives the
  longest dropout (5 ms RMS windows 30 dB under the pre-seek median; must be ≤ 20 ms), the energy
  drop after the boundary (≤ 6 dB: the loop lands on the body, not the lead-in) and the alignment
  error between the outgoing fade point and the incoming `loopStart` (≤ 60 ms).

- `probes/b-run.mjs --root ../.. [--wpm N] [--accuracy A] [--sectors 1-3]` — the typist-profile runs behind
  the balance pass (PLAN B10): time to the sector-1 boss, deaths per sector, `incomingCps` vs `targetCps` per wave,
  boss-phase `leaksPerMin`, rank reached. The measured numbers and the knobs they drove live in
  [`balance.md`](./balance.md).
- `probes/d8.mjs [--dpr 2]` — attract-mode acceptance (PLAN D8, `assets/js/game/85-attract.js`): attract active
  on the title screen, canvas changes, save blob byte-identical over 15 s on the legacy-midwave menu, no
  `game.enemies` on the menu, frameCount ≥ 58/s fresh and ≤ 22/s after `attract.idleT > 90`, no
  `assets/ships/*.png` before the first keystroke, silent / stat-free, ship-radio swap flash, Start / pause-quit
  round trip, story modal + Reset Save still work, reduce-motion context, legacy-midwave Continue and
  legacy-postvictory sector tile.

- `probes/e2-layout.mjs [--dpr 2]` — CDP LayoutCount over 5 s idle play, 5 s idle with three chips and 5 s typing (targets idle <= 10, typing <= 30 per 5 s).
- `probes/e2-hitch.mjs [--dpr 2]` — max render() ms over the 3 s after a direct `startSector(i)` jump (S3/S5/S7/S10), target <= 16 ms.
- `probes/e2-portrait.mjs` — 390x844 portrait with three chips: HUD height <= 22 % of the playfield (reports the boss-bar case).
- `probes/e2-budget.mjs [--dpr 2] [--sector 10]` — combined budget: 14 plates, 3 chips, toast + banner, CRT on: fps >= 58, maxRenderMs <= 16, shadowBlur 0, composite sets <= 6. Run it alone (fps-sensitive).
- `probes/e2-vision.mjs` — six scenes under normal / deuteranopia / achromatopsia vision (`Emulation.setEmulatedVisionDeficiency`), 15 PNGs under `out/e2-vision/`, plus DOM/state assertions on the shape cues.
- `probes/e2-menu.mjs` — CRT top-bar toggle (label, aria-pressed, dot, data-crt), NEW RUN + confirm, Enter -> Continue, Escape restores focus.

## Music loop points (`tools/measure-loops.sh`)

`MUSIC_LOOP` in `assets/audio/sfx.js` is measured, not guessed. `tools/measure-loops.sh` (ffmpeg +
node, ~1 min) decodes the six MP3s and prints two paste-ready tables; sfx.js carries the *adopted*
one. The method, also summarised above the constant:

1. `firstAudio` = first sample above -50 dBFS; a 100 ms RMS envelope gives the body median and
   `bodyStart`, the first window within 6 dB of it whose following 2 s and 8 s medians are too (a
   single hit inside a build-up does not count). Tracks 1, 2 and 6 only reach that sustained body at
   17.3 / 15.2 / 16.9 s (intro, then a build-up 8–10 dB under the body); tracks 3 and 4 have 2–3 s
   intros 6–7 dB under; track 5 starts on the body. A loop into a lead-in was a 10–40 dB energy hole
   every two minutes (the first version of this table looped into track 6's build-up and
   `audio-lifecycle.mjs` measured a 10.6 dB drop; the sustained rule removed it).
2. `loopStart` = the strongest onset within ±150 ms of `bodyStart` when the lead-in is ≥ 0.5 s, else
   `firstAudio`. Starting a sector on the body also means the music is at full energy within a second
   of Start.
3. `rawEnd` = the last 100 ms window within 3 dB of the body median (before the trailing fade).
4. sfx.js starts the incoming element at `loopStart` the moment the outgoing one reaches
   `loopEnd - 0.6` and crossfades for 0.6 s, so that point `X` is what must be beat-aligned with
   `loopStart`. An onset envelope (20 ms band energies, 5 ms hop, half-wave-rectified dB increases;
   gain-invariant) gives `b0`, the first beat after `loopStart`, and the beat peaks in the last two bars
   before `rawEnd - 0.6`; `X = bEnd - (b0 - loopStart)` and `loopEnd = X + 0.6`.
5. Which end beat: the beat period from the onset autocorrelation (60–200 BPM, refined at 16 beats).
   When the pulse is steady (r ≥ 0.3: tracks 2–5 at 126/115/70/167 BPM) the strongest candidate a
   whole number of bars from `b0` wins (phase error ≤ .19 beat); tracks 1 and 6 (the same song, weak
   pulse) take the strongest onset in the last two bars. The script prints the beat count, its phase
   error and a fingerprint section-match r so the choice can be audited.
6. The duplicate-song test (detrended 4-band envelope correlation, r = 0.57 for tracks 1/6 vs ≤ 0.40
   elsewhere) is unchanged and keeps `MUSIC_FOR_LEVEL = [0,5,2,2,1,1,4,4,3,3]`.

The transport then keeps the join tight: inside the last 3 s the idle element gets the same `src`
with `preload="auto"` and is parked at `loopStart`; inside the last 250 ms a one-shot timer fires the
crossfade at the exact moment instead of up to a 100 ms poll late, and however late it was caught is
added to the incoming start position. `audio-lifecycle.mjs` measures the result (dropout, energy
drop, alignment) on two tracks.
