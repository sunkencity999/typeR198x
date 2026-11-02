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
| `--flight-check` | off | Plays the first-run Flight Check instead of skipping it: `window.TypeRHarness.flightCheck = "play"` (the default run sets `"skip"`, so every other row measures sector 1 as before). The typist plays it with `--wpm` / `--accuracy`, presses Space when the check asks for the release (`insertText(" ")` on `--mobile`), shots 17-20, `report.flightCheck` |
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

### Flight Check flag (`window.TypeRHarness`)

A fresh save's first Start runs the Flight Check (17-onboarding.js) before the sector card. The game reads
`window.TypeRHarness.flightCheck`: `"skip"` never runs it, `"play"` runs it once per page session whatever the save,
anything else uses the real eligibility rule. play.mjs and `openProbe` install `"skip"` with an init script, so
scenarios, fixtures and the ~45 openProbe probes behave as before. Probes pick it with
`openProbe(name, { flightCheck: "skip" | "play" | "auto" })` (`auto` = the real rule); a probe that builds its own
context calls `await harnessFlags(context, { flightCheck })` from `_lib.mjs`. `P.flightCheck()` returns
`game.flightCheckState()` (null when none runs).

**Service worker flag (PLATFORM).** The same init script sets `window.TypeRHarness.sw = false`, which makes
`registerServiceWorker()` (12-access.js) decline, so no scenario, fixture or probe ever runs against a cached shell and the
byte budgets measure a first visit. `openProbe(name, { sw: true })` / `harnessFlags(context, { sw: true })` opt a context in;
`probes/t-platform.mjs` does, then asserts the precache and a cache-served second load.

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
(fixtures with `storySeen` produce no `03-story`); extra shots continue from 17. `--flight-check` adds
`17-flight-check-1`, `18-flight-check-2`, `19-flight-check-3` (the first frame each step's plate is targetable) and
`20-flight-check-complete`. `03-story` is taken once the
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
| `flightCheck` | `{played:false}` by default; with `--flight-check` `{played, sectorCard, result, reason, ms, keys, correct, misses, releasedBy, steps[]}` (`game.flightCheckLastResult()`) |
| `config.flightCheck` | The `--flight-check` flag |
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
| `legacy-gameover` | main's `onGameOver` stub (`buildResumeRun`): sector 5 run with `levelT 0`, `score 0`, full HP, `highScore 20000` | resume card shown; Continue → levelIndex 4 as a legacy (headline-eligible) run |

`expect` keys: `levelIndex`, `scoreMin`, `highScore`, `lastUnlockedLevel`, `playerName`,
`levelTBelowDuration`, `inBossWithinS`, `notInBossForS`. A failed check is printed and stored but
does not change the exit code (the owning task's acceptance decides).

## Matrix (`run-matrix.sh`)

Rows: `dpr1`, `dpr2`, `reduced-motion` (`all` at DPR 2 with `prefers-reduced-motion: reduce`),
`mobile` (smoke), `native-ua` (the WKWebView user agent served over HTTP, `all`), `no-music` (smoke,
DPR 2, media transport stubbed: the perf-only row), `flight-check` (smoke with `--flight-check`) and
`fixture-<name>` (smoke) for the six fixtures.
Output goes to `out/matrix/<name>/` with a log beside each folder and a `summary.tsv`; the table
printed at the end has exit codes, error counts, `reqFail`/`mediaAbort`, fps, `maxRenderMs`,
`shadowBlurPerFrame`, `fullFrameFillMaxAlpha`, `layoutCountPer5s`, the non-media MB before the first
keystroke, media MB and the fixture verdict. `--quick` runs everything as `smoke`; `--only a,b`
selects rows; `PLAY_ARGS="--cpu 4"` is appended to every row.

## Probes

Extra one-off scripts live in `probes/` (shipped) or `out/` (ignored). They can import nothing from
`play.mjs`; copy the `installProbe` function if they need the canvas counters. Shipped:

- Staged acceptance probes from the build (`probes/a2.mjs`, `a3.mjs`, `a4.mjs`) are kept for history; they are not release gates. `a3.mjs` now checks schema 3 and compares the clear bonus with `game.lastTally.total` (it confirms the Reset save / Abandon-run dialogs added after A3); `a2.mjs` and `a4.mjs` keep their stage expectations (a 40-click budget for the ending, a Cyrillic layout fallback). The gates are the matrix, `e2-*`, `c*`, `d*`, `b-fixtures` and `review-runtime`.
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
  [`balance.md`](./balance.md) (its first sections are the training update's re-passes: the lead rulings tree, then
  the merged tree and PACE's own pass).
- `probes/b10.mjs --wpm W --accuracy A [--sectors N] [--jump L] [--minions danger|never|always] [--expect p35|p55|p80]
  [--acquire-ms N]` — one typist profile through consecutive sectors on the play clock (deaths, min HP, leaks, incoming
  cps, damage by source, surges fired / countered, rank, idle gaps); `b10-report.mjs` renders `out/b10/*.json`. It
  records the paceMul / quota PACE applied per wave, timeouts and the plates that escaped (alive at the cap, lead ruling
  Z5), the carried hull on each sector card, the surge windows (Z6) and the throughput; its band is delivery >= 0.85
  and stream <= 1.35 x targetCps x paceMul. `--acquire-ms N` (lead ruling Z7, off by default) waits N ms of play clock
  before the first key of every new target, 2N with probability .1 (`--acquire-slow-ms`, `--acquire-slow-p`), so the
  typist is not a machine that never looks for the next plate.
- `probes/d8.mjs [--dpr 2]` — attract-mode acceptance (PLAN D8, `assets/js/game/85-attract.js`): attract active
  on the title screen, canvas changes, save blob byte-identical over 15 s on the legacy-midwave menu, no
  `game.enemies` on the menu, frameCount ≥ 58/s fresh and ≤ 22/s after `attract.idleT > 90`, no
  `assets/ships/*.png` before the first keystroke, silent / stat-free, ship-radio swap flash, Start / pause-quit
  round trip, story modal + Reset Save still work, reduce-motion context, legacy-midwave Continue and
  legacy-postvictory sector tile.

- `probes/e2-layout.mjs [--dpr 2]` — CDP LayoutCount over 5 s idle play, 5 s idle with three chips and 5 s typing (targets idle <= 10, typing <= 40 per 5 s: 25 commit layouts at the 5 Hz HUD cadence plus ~10 event-driven writes such as a tip, a chip pickup or a tier change; the arithmetic is in the probe header). A typing window above the gate is measured once more and the lower value is gated; run it alone, another Chrome probe on the machine adds 10-20 layouts to the window.
- `probes/e2-hitch.mjs [--dpr 2]` — max render() ms over the 3 s after a direct `startSector(i)` jump (S3/S5/S7/S10), target <= 16 ms.
- `probes/e2-portrait.mjs` — 390x844 portrait with three chips: HUD height <= 22 % of the playfield (reports the boss-bar case).
- `probes/e2-budget.mjs [--dpr 2] [--sector 10]` — combined budget: 14 plates, 3 chips, toast + banner, CRT on: fps >= 58, maxRenderMs <= 16, shadowBlur 0, composite sets <= 6. Run it alone (fps-sensitive).
- `probes/e2-vision.mjs` — six scenes under normal / deuteranopia / achromatopsia vision (`Emulation.setEmulatedVisionDeficiency`), 15 PNGs under `out/e2-vision/`, plus DOM/state assertions on the shape cues.
- `probes/e2-menu.mjs` — CRT top-bar toggle (label, aria-pressed, dot, data-crt), NEW RUN + confirm, Enter -> Continue, Escape restores focus.
- `probes/t-measure-speed.mjs [--dpr 2]` — D1 hand speed (~4 min): 200 ms/key typing gives 60 WPM in S1 and S5,
  errors cost time, single letters / first keys / pauses / > 1.5 s gaps / bursts add nothing, boss segments and
  capsules, HUD `--` then live speed holding while idle, results / rank / records rows from hand speed, Best WPM
  badge rules, touch `insertText` bursts.
- `probes/t-measure-typo.mjs [--dpr 2]` — D4: the struck pair in the locked plate and the boss slab (pixels + draw
  calls), one pair at a time, gun pop + nearest-plate pulse, the danger-zone guard, HUD ACC `--` / warn / bad /
  `.is-miss` and its restart on a second miss, lead underline, reduced motion, 10 s at 40 % misses inside the frame
  budget. Run alone for the budget.
- `probes/t-measure-rank.mjs [--dpr 2]` — D5 (~5 min, includes a sector-10 run): shortfall copy and a 651k-case
  threshold sweep, the `-- WPM` form when speed was not measured, card line / caption / chips, announcements, Game
  Over causes (leaks, minions, surge), Victory, reduced motion, 844 x 390 and the two-line wrap at 390 x 844.
- `probes/t-measure-profile.mjs` — D6 data: migration fixed point and legacy flags, lazy profile and Reset save,
  key / bigram EMAs, the 200-bigram cap, the 16 KB budget, no extra storage writes while typing, weak key / bigram
  formulas, sessions / speedEma / days (acc null under 10 keys), sector bests, practice sessions and mode bests
  through the `typistEndSession` API (the daily, drill and endless runs call it), goal, blocked storage, a static
  allocation scan of the per-key / per-frame functions. Check 6 counts autosave writes only (an existing tutorial-flag
  save point on the first typed word is not a per-key write).
- `probes/t-measure-flightlog.mjs` — D6 UI: Records tabs by pointer and keyboard, the Flight Log from an injected
  profile, empty state, legacy rows, menu Best WPM / goal, phone portrait / landscape / desktop / 1280 x 800 (stat
  labels inside their tiles, every value on one line, the Drill tile's speed with its accuracy in the caption), the
  note under the sector bests when a cleared sector has no timed WPM, the sparkline legend / lone-point dots / gaps,
  colour-vision luminance of the key buckets (screenshots under `out/t-measure-flightlog/`).
- `probes/t-measure-api.mjs` — the MEASURE API for the later tracks: scopes, reuse, `typistInterval`, keyMiss
  `expected`, shapes, `typistEndSession` mode bests, cost, the null-run (Flight Check) contract.
- `probes/measure_lib.mjs` — helpers for the above: a controlled in-page typist (frozen spawner, scripted static
  plates, `handleTyped` from a `setTimeout` chain scheduled on `performance.now()`), `clearBoss`, `dieByLeak`.
- `probes/t-onboard-flight.mjs [--dpr 2]`, `t-onboard-paths.mjs`, `t-onboard-briefing.mjs`, `t-onboard-finish.mjs`,
  `t-onboard-harness.mjs` — the D13 acceptance: the Flight Check happy path with per-frame no-score / no-powerup /
  no-hull-loss sampling and step-1 budgets, every other path (Esc, Skip, pause, quit, ineligible saves including a
  MEASURE session, sector tile, play flag, reduced motion, phone, external start, blocked storage), the briefing
  summary and disclosure, the FINISH fix, the phone layout (the tap pill and the toasts never overprint Skip or the
  step count at 390x844, 844x390 and 320x568), the step-3 toast following the lock, and the harness default /
  `--flight-check` (runs play.mjs twice into `out/t-onboard-harness/`).
- `probes/t-words-content.mjs [--root ../..] [--dict /usr/share/dict/words]` — WORDS content, no browser (node vm over
  00-util / 20-constants / 25-lexicon / 30-content, plus a context without 25-lexicon for today's pools): list shapes,
  inventions out of the wave pools (C3: `japan` is one, lead ruling Z4), per-wave pools and shares, >= 95 % dictionary
  words, top-100 / bigram / letter coverage of a simulated stream, the cps estimate, the weak-bias formulas and the
  anti-repeat ring for a one- or two-word weak pool (C16), seeded determinism, tuning, copy.
- `probes/t-words-space.mjs` — Space types the gap of a locked two-word plate and releases otherwise, Backspace, a
  letter at the gap, auto-repeat, pause, sector card, boss, the b_lib typist, touch `insertText`, a plate PIERCE or
  RAPID left at its gap (S13), and MEASURE counting the gap as a speed interval but never as a key or bigram.
- `probes/t-words-render.mjs [--dpr 2] [--reduced-motion]` — the gap dot (pixels only inside the gap cell; idle /
  locked / typed), plate width, the warm cache up to `cfg.maxTextLen` (plain and typo-widened), the dots following
  MEASURE's typo pair, a 14-plate frame budget. Screenshot `NN-warp-core-*.png`.
- `probes/t-words-spawn.mjs` — in-page spawn mix per sector-wave, no inventions, the weak bias and THREAT INTEL line +
  speech from a seeded profile through MEASURE's real API, the one-time two-word tip (and again after Reset save), the
  seeded Daily stream, tuning and the endless no-op, live S7 phrases typed by the harness typist, help copy, and WORDS
  staying inert during the real Flight Check.
- `probes/t-arcade-counter.mjs` — D10 Counter-Signal (~2.5 min): table / window / par numbers, the Z6 window floor
  (`surgeWindow` = max(table, 2.25 x the segment's time at the pilot's speed), 1b / 3), sector 1 never surging, the first
  sector-2 surge at 6.0 s at a segment start (whole segment, slow widen), the pending start, the telegraph (charge bar,
  meter, glow and outline draw counters, the glow alpha at or above its 2 Hz pulse trough at the sampled t; the bar's
  position and zero HUD growth at 1440 x 900, 390 x 844 and 844 x 390), fail and counter (exact damage / bonus, bolts at the aim point, scramble), the per-phase cap, pause, Retry boss,
  par, the card-note scopes (sector / Game Over / run), reduced motion, a DPR 2 budget context and `legacy-inboss`.
- `probes/t-arcade-overdrive.mjs` — D11 Overdrive (~2 min, controlled in-page typist on `performance.now()`):
  thresholds (2c: a fresh pilot's provisional 25 WPM threshold refreshes in Overdrive and the first Overdrive ends by
  the slow rule, lead ruling Z2), activation at 100 WPM, the score kinds, beams / floaters / plume / arc, vents (miss,
  leak, slow), holds (pause, empty field), the charge reset, the boss kill, the card note, setItem count, scripted
  input, a real drill blocking it with a daily sortie as the control (15), the Flight Check blocking it, the first
  Overdrive tip stacking beside an S1 tutorial tip, 13b at the 25 WPM floor, heap, reduced motion.
- `probes/t-arcade-readability.mjs` (DPR 2) — D12: the kill explosion set and mapping, draw order (smoke < plates <
  flash), a neighbour plate's text pixels after a kill, rail alpha, ring / hit-stop, a 6 s kill burst budget.
- `probes/t-arcade-budget.mjs` (DPR 2, CRT on; run alone) — sector-10 boss + 4 minions + a charging surge +
  Overdrive: fps, render ms, composite sets, shadowBlur, full-frame fills, layouts, heap.
- `probes/t-arcade-balance.mjs [--reuse] [--only <profile>] [--parallel n]` (~25 min) — runs b10.mjs for 35/.90,
  55/.93, 80/.97 (sectors 1-3), 55/.93 and 80/.97 (sector 10 jump) and 80/.97 (sectors 8-10), asserts the Counter-Signal
  targets (every S2-3 fight surges, S1 never; the Z6 targets: no surge damage for 35/.90 in S1-3, the 55/.93 S10 min
  hull, 80/.97 still meeting real surges in S8-10) and writes `out/t-arcade-balance/summary.json` (surges, surge
  damage, windows, tally per sector).
- `probes/t-pace-math.mjs` — D2 numbers (~15 s, no typing): `PACE` constants, target / step functions, the tuning
  table on S5 W2, the three pilot sources with and without MEASURE's accessors (the 60-interval profile floor), a fresh
  pilot's S1 W1 at 1.0 / quota 8, the 73 WPM ramp across a sector boundary, the `diff()` rows, the hull formula.
- `probes/t-pace-spawner.mjs [--dpr 2]` — the 10-30 px roll-in, the 0.1 s empty-field spawn, a pinned paceMul 2.0
  (alive cap, plate speeds, quota 36, stage bar), the 2-alive top-up just above `PACE.hungryMin2AtMul` and off just
  below it, the stream at a pinned 1.5 under an 80 WPM typist, a fresh S1 W1 at 1.0 with MEASURE.
- `probes/t-pace-stakes.mjs` — perfect wave by quota only; the Z5 wave caps (computed, >= the table, a pilot who
  keeps the field clear is never timed out, an empty field lifts the cap); a timeout with plates alive: they leave at
  once as escaping plates (no detonation, no damage, warping off to the right; a fade under reduced motion) and the
  drain end calls `WAVE TIMED OUT · N ESCAPED` (no sting, no bonus, announced), the quota carry and its limits, the
  sector-clock cut of a wave-3 drain, Retry clearing a carry. Since lead ruling Z13 these scenarios run above the
  floor (`pacePin` 1.05 / 1.1, or the Z12 back-off's stubbed pilot): a campaign wave at exactly 1.0 is a floor wave.
- `probes/t-pace-floor.mjs` (~45 s) — lead ruling Z13, the floor wave: a campaign wave at exactly paceMul 1.0 with no
  carry runs on live `a0a3845`'s wave rule (all 30 sector / wave tunings carry a0a3845's quota and 22-40 s cap with
  the table stream; on all 30 the spawner accumulates a0a3845's spawn rate, its length-window mix without WORDS'
  `waveTextLen`, while a carried 1.0 wave keeps WORDS' rate; a fresh S1 W1; at the cap with plates up it ends into the drain with the clear sting and PERFECT
  WAVE for no damage and a kill, the plates stay and can be typed or leak and hurt, the 6 s drain end detonates the
  rest; an empty field still ends it; no `WAVE TIMED OUT`, no escape, no carry, no back-off; the sector clock cutting
  a floor wave-3 drain), the waves that keep D3 / Z5 (a carried 1.0 wave, a pin at 1.1, Cadet, the Daily Sortie),
  Continue (a replayed floor wave stays one, a replayed carried wave does not) and the help manual naming the carried
  wave among the D3 / Z5 cases (check 9).
- `probes/t-pace-hull.mjs` — S1-3 refill, S4 220/500 -> S5 432/600 with the card / Level Complete copy, flawless
  stays full, Retry refills, quit at Level Complete + Continue keeps the carried hull and shows the line once, legacy
  fixtures, and the `PACE x2.0` results chip with its announcement (none at the table pace).
- `probes/t-pace-cadet.mjs [--dpr 2]` — the second-death offer (focus, Tab order, note, announce), accept (stream /
  damage / score, tags, the results row, records), the next sector standard, the boss path, the count across a
  reload, no Cadet in daily / endless (real MODES runs), the offer hidden again when a mode run starts (8b, lead
  ruling Z9), a phone tap, the stays-on note on a death under Cadet, and the phone records row keeping its CADET chip
  in view (and every column, with 12- and 24-character pilot names).
- `probes/t-pace-save.mjs` — `run.pace` keys / types / < 400 B, a garbage blob normalised, no extra storage writes
  while typing, node --check + check-globals.
- `probes/t-pace-perf.mjs [--dpr 2]` — S10 W3 and S1 W3 pinned at 2.5 with an 80 WPM typist, and S10 with an idle
  pilot: fps, maxRenderMs, shadowBlur, full-frame fills, composite sets, max alive. Run it alone.
- `probes/t-pace-balance.mjs --wpm W --accuracy A [--seed-profile auto|WPM] [--seed-acq MS] [--jump L --sectors N
  --retry N] [--set knob=value,rollin=a-b] [--acquire-ms N]` / `--matrix [--parallel 2]` — the R26 balance targets (idle share
  S1-3, deaths, damage, rank, time to the S1 boss, min hull, longest idle gap) with a play-clock-paced typist; prints
  per sector idle / deaths / hull in / min hull / per-wave paceMul, quota, carry, timeouts and escaped plates; JSON
  under `out/t-pace-balance/`. `--acquire-ms` is the Z7 latency (as b10); with it the p55 / p80 runs judge lead
  ruling Z12's targets (below), S1 idle and the 2 s gap line are reported only, and the death and damage targets stay.
- **Pace and target acquisition (lead ruling Z12).** The pace now accounts for how quickly the pilot finds the next
  target, so the balance probes measure it: `t-pace-balance` and `b10` record per wave the acquisition time PACE
  used (`acq`, from MEASURE's `typistAcquireMs()`), the sector's mean target length, the effective speed, whether
  the clean-timeout back-off lowered it and the wave's leaks, and per sector whether the sector clock cut the waves
  (the boss approach began before wave 3's drain) and its PERFECT WAVE count; `b10.mjs` takes `--seed-profile
  auto|WPM` (a returning pilot, as t-pace-balance). With `--acquire-ms` the p55 / p80 runs of `t-pace-balance` check
  that no S2 / S3 wave times out with 0 leaks, S2-3 idle <= 15 % and 0 deaths, and `--matrix` prints the S2 / S3
  clock-cut share and PERFECT WAVE counts of its 55 / 80 runs (Z12: cuts <= 15 % of those sectors over >= 4 runs per
  profile, PERFECT WAVE no worse than live `a0a3845` with the same typist; the live runs use these probes from an
  export, `probes-t/`). `t-measure-api` 9-11 cover the acquisition gap itself (samples, EMAs, fallbacks, clamp,
  release / lost lock / leak / pause, boss fights and a real Flight Check never feeding it), `t-measure-profile` 1b
  / 5 / 14 the `profile.acqEma` field, `t-pace-math` 7b / 10-12 the formula (35 / 55 / 80 WPM x 120 / 300 / 600 ms x
  L 1 / 5 / 7), the mean length and the wave start, and `t-pace-stakes` 7a-7c the back-off and its clearing.
- **Floor waves and a stale stored acquisition time (lead rulings Z13 / Z14).** `b10` and `t-pace-balance` record per
  wave `floor` (paceMul exactly 1.0, no carry: live `a0a3845`'s wave rule), `capEnd` (its cap ended it) and
  `leftover` (plates up at a floor wave's cap; they stay in the drain); `timedOut`, `escaped` and the 0-leak timeout
  counts cover the D3 / Z5 judgement of the other waves only, and a floor wave's cap end is not a timeout (live has
  none either). `b10` checks that every wave of each cleared sector is recorded (a returning pilot's S1 W1 starts
  while the run start still waits for the story card; it was lost before) and notes per sector which waves ran at
  the floor (`F`) and the paceMul of the others. `t-pace-balance` splits damage into waves and boss and records play / wall per sector; with
  `--acquire-ms` its p35 run judges Z13 (0 deaths, 0 wave damage, no 0-leak timeout in S1-3; boss damage, rank, floor
  cap ends and PERFECT WAVE reported). `--seed-acq MS` writes `profile.acqEma` into the seeded fixture (Z14: a
  returning pilot whose save holds a slower pilot's value). `t-measure-api` 9d and `t-measure-profile` 16 check
  Z14's blend of the run's first samples with the lifetime value.
- `probes/pace_lib.mjs` — helpers: the b10 typist on the play clock (optional acquisition latency), forced clears,
  deaths, the in-place reload, canvas budget counters.
- `probes/t-modes-rng.mjs`, `t-modes-daily.mjs`, `t-modes-endless.mjs [--dpr 2]`, `t-modes-drill.mjs`,
  `t-modes-title.mjs` — the D9 acceptance (~4 min together): seed vectors, the 2026 sector spread, picks routed
  through `game._rng` in a daily run and never in the campaign, identical wave openings on one date; the daily tile,
  start, pause copy and restart confirm, three waves and no boss, card / rating / medal (incl. the SILVER cap on a
  death and the accuracy rounded down), the save record (counted, practice, death, streak copy, midnight, 60-day prune
  <= 8 KB), share line and clipboard copy (and, at 1024 x 600 / 844 x 390, the focused share line and Copy clear of
  the sticky actions), quit keeping the campaign run, a campaign start inside a mode run banking the stored run,
  post-victory sectors, the locked fresh deck with the reason on every tile; the endless start rate, stream tuning,
  steps, delivered-rate calibration, pressure cap, bests, powerups, no damage / boss, 6 cps frame budget; the drill
  clamp, weighting, clock and pause, leaks, no score / powerups, lines vs the profile, bigram line, bests; deck
  placement, Tab order, four layouts, the menu footer reachable with a saved run on six laptop windows (T3c), the
  untouched menu blob, card keys, reduced motion, no tutorial toast, campaign chrome restored after a paused drill. Every one checks the campaign fields stay byte-identical. `probes/modes_lib.mjs` holds the
  fixtures (F5, F5P), `startMode`, `isolation`, `card` and a scripted static-plate typist (`typeWords`). Probe hooks:
  `game.modesDebug()` = `{ setNow, advance, state, plan, finish }`.
- `probes/review-runtime.mjs` — regression checks for the review-fix runtime track (~25 s): explosion sheet factor through a DPR 1 -> 2 flip and back (R1), `PALETTE.rgba` alpha quantisation (R12), dying plates under source-over (R13), the full 450 ms loading fade (R27), plate-cache re-warm after a mid-sector resize (R30), bounded spawn/leak telemetry logs and their reset on a new run (R31).

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
