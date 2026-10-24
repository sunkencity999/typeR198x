# Balance pass (B10) — typist profiles, method, numbers

Measured on 2026-10-16 on `web-overhaul` (Phase 4 worktree `wt/p4-balance`, base commit 29b2cc7) with the Playwright
harness at DPR 1, 1440 x 900, headless Chrome, one browser per run (three to six runs in parallel). Every run records
play-clock seconds against wall-clock seconds per sector: the loop clamps `dt` to 50 ms, so a starved browser would
silently slow the game and inflate a wall-clock typist's effective WPM. All sector 1-3 runs kept a ratio of 0.95-0.97.
The three `base-*-j10` files show 0.38-0.59 only because that probe version did not treat the `victory` screen (a
sector-10 clear) as the end of the sector and idled there until its wall cap while `playClock` stood still; the game
itself ran at 60 fps / 0.97 during those runs (checked separately: sector 10 with an 80 WPM typist, `out/fpstype`). The
final probe stops on `victory` and paces the typist by `game.playClock`, so its WPM is honest at any frame rate.

## Training update: pace (PACE, D2 / D3), measured on `wt/pace` before WORDS / ARCADE

Measured on 2026-10-24 on the PACE worktree (`wt/pace`, base training 0067c1b = scaffold + MEASURE + ONBOARD), headless
Chrome, DPR 1, 1440 x 900, other agents' browsers running on the machine (every typist is paced by `game.playClock`, so
the profiles stay honest; play / wall clock 0.94-0.97). **WORDS (exact cps, two-word plates) and ARCADE (Counter-Signal,
par, surge damage) were not on this tree: the lead's re-pass on the merged tree replaces these numbers** (`t-pace-balance
--matrix`, b10 for the three profiles, the stakes jumps below; every PACE number lives in the `PACE` block of
`assets/js/game/42-pacing.js` plus `HUNGRY_SPAWN_S` / `SPAWN_ROLLIN_PX` in 20-constants.js).

Shipped numbers: spec-pace 1 except one knob, `PACE.hungryMin2AtMul` **1.5 -> 1.35** (spec 14.3 knob 1, after round 3
below): pilot factor 0.85, paceMul 1.0-2.5, step 0.35, run speed from 20 intervals, profile from 60, maxEnemies +
min(3, round(2 (m - 1))), speed x (1 + 0.15 (m - 1)), 2-alive top-up from paceMul 1.35, Cadet 0.75 / 0.75 / 0.8, hull
carry from S4 at 50 %; `HUNGRY_SPAWN_S` 0.1, `SPAWN_ROLLIN_PX` [10, 30].

Probe: `probes/t-pace-balance.mjs` (one profile per run; `--matrix` runs the five; `--set key=value` retunes a `PACE`
knob or `rollin=a-b` in the page). Idle share = time in a spawn phase with nothing targetable / the sector's play time
(mode `playing`, sector card and boss included), the pedagogy probe's definition.

### R26 targets (`t-pace-balance --matrix`): rounds 1-3 at `hungryMin2AtMul` 1.5, round 4 at the shipped 1.35

| profile | S1 idle r1 / r2 / r3 -> r4 (target) | S2 idle | S3 idle | longest idle gap | to S1 boss | deaths / damage S1-3 | rank S1-S3 (r4) | hand WPM | paceMul S1 · S2 · S3 (r4) |
|---|---|---|---|---|---|---|---|---|---|
| 35 / .90 fresh | 15 / 13 / 14 -> **7 %** (not harder) | 6 / 5 / 3 -> 5 % | 6 / 3 / 5 -> 4 % | <= 0.52 s | 36-47 s | 0 / 0 in all four | B A B | 28-33 | 1/1/1.35 · 1.18-1.22 · 1/1/1 |
| 55 / .93 fresh | 18 / 23 / 24 -> **5 %** (<= 30) | 2 / 3 / 7 -> 2 % | 3 / 0 / 1 -> 1 % | <= 0.61 s | 32-43 s | 0 / 0 | A A A | 47-52 | 1/1.35/1.7 · 2.05/2.10/2.10 · 1.75/1.52/1.52 |
| 80 / .97 fresh | 25 / 29 / 28 -> **27 %** (<= 30) | 7 / 4 / 7 -> 6 % | 3 / 7 / 4 -> 2 % | <= 0.52 s | 29-34 s | 0 / 0 | A S S | 70-75 | 1/1/1 · 1.35/1.70/2.05 · 2.26-2.28 |
| 55 / .93 seeded (51) | 6 / 8 / 8 -> **4 %** (<= 15) | 3 / 1 / 2 -> 2 % | 2 / 1 / 1 -> 1 % | <= 0.52 s | 40-46 s | 0 / 0 | A A A | 48-52 | 1.35/1.70/2.05 · 2.06-2.08 · 1.71/1.53/1.52 |
| 80 / .97 seeded (78) | 13 / 14 / **19 FAIL** -> **15 %** (<= 15) | 3 / 5 / 8 -> 4 % | 4 / 3 / 3 -> 1 % | <= 0.52 s | 32-37 s | 0 / 0 | S S S | 72-76 | 1.35/1.70/2.05 · 2.40/2.50/2.50 · 2.27-2.29 |

Knob runs at 1.35 before shipping it (`--set hungryMin2AtMul=1.35`): 80 seeded S1 8 % and 12 %, 55 seeded S1 4 %
(S2 3 %, S3 2 %), 35 fresh S1 10 % / S2 5 % / S3 2 % with 0 damage and ranks A / B / B (its S2 waves stayed at
1.32-1.34). Why this knob: a returning pilot's first wave runs at exactly 1.35 (one step from 1.0), below the old 1.5
top-up, so every kill emptied the field; 1.35 is the lowest value that leaves the 35 WPM pilot's S2 (1.18-1.34 in four
rounds) on the table's empty-field rule. Before PACE (pedagogy baseline): idle 35 / 22 / 12 % (35 WPM), 36 / 34 / 25 %
(55), 50 / 44 / 41 % (80). Extra runs at 1.5: 80 fresh S1 26 / S2 6 / S3 3 %, and with `--set rollin=10-20` S1 26 / S2 4 /
S3 1 % (the roll-in knob barely moves sector 1).

The two margins to watch on the merged tree: **80 fresh S1** (25-29 % against 30 %: a fresh pilot flies S1 at paceMul
1.0 until the 20-interval run gate, R26; the knob only acts from 1.35) and **80 seeded S1** (8-15 % at 1.35 against 15 %).
If either misses there, the next levers are R26's kept-out alternative (the 2-alive top-up from MEASURE's live speed in
S1) for the fresh case and `PACE.profileMinIntervals` / a 1.3 knob (it then reaches the 35 pilot's S2) for the seeded one.
In the round-2 JSON the S1 `minHullPct` reads 66.7 % because that probe version took the max-HP after the clear for the
first sector (fixed before round 3); the damage column is 0 in every sector of every round.

### b10 (three profiles, fresh save, sectors 1-3; pace columns added by PACE; measured at `hungryMin2AtMul` 1.5)

The band is now judged per wave against `targetCps x the applied paceMul`: every wave delivers at least 0.85 x (all
spawns) and the stream alone stays under 1.35 x. Hungry top-ups above it are demand-driven (a typist who clears the
field is fed at their own pace: sector 1 at paceMul 1.0 reads 1.6-3.3 x for 35-80 WPM). The `stream` half of the
80 WPM sector 1 cells is 0: every one of its spawns came from the hungry rule.

### pace-w35-s1-3 — 35 WPM / 0.9 accuracy, minion policy danger, fresh save

| S | outcome | to boss s | boss s | min HP | wave leaks/min | boss leaks/min (per phase) | cps ratio w1/w2/w3 | hungry spawns w1/w2/w3 | idle max s w1/w2/w3 | surges f/c | rank (shipped / level-aware) | WPM (nominal) | acc | dmg | tally | clock | paceMul w1/w2/w3 | quota | cps / (target x mul), all / stream | timed out (escaped) | hull in | throughput |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | clear | 42.6 | 12.2 | 100 % | 0 | 0 (0/0/0) | 1.65/2.11/1.97 | 5/8 8/10 8/16 | 0.52/0.38/0.38 | 0/0 | A / A | 32.0 (14.4) | 94.1 | 0 | 2500 | 0.97 | 1/1/1.35 | 8/10/16 | 1.65/0.58 2.11/0.70 1.46/0.83 | no/no/no | 200/200 | 29 |
| 2 | clear | 50 | 19.9 | 100 % | 0 | 0 (0/0/0) | 1.25/1.46/1.66 | 4/13 10/16 10/18 | 0.47/0.35/0.07 | 0/0 | A / A | 30.5 (20.4) | 90.4 | 0 | 3500 | 0.96 | 1.33/1.32/1.32 | 13/16/18 | 0.94/0.49 1.11/0.52 1.26/0.63 | no/no/no | 300/300 | 30 |
| 3 | clear | 63.6 | 26.6 | 100 % | 0 | 0 (0/0/0) | 0.99/0.98/0.97 | 4/12 6/14 7/16 | 0.27/0.22/0 | 0/1 | A / A | 31.6 (27.6) | 91.7 | 0 | 4500 | 0.97 | 1/1/1 | 12/14/16 | 0.99/0.56 0.98/0.45 0.97/0.49 | no/no/no | 400/400 | 30 |

### pace-w55-s1-3 — 55 WPM / 0.93 accuracy, minion policy danger, fresh save

| S | outcome | to boss s | boss s | min HP | wave leaks/min | boss leaks/min (per phase) | cps ratio w1/w2/w3 | hungry spawns w1/w2/w3 | idle max s w1/w2/w3 | surges f/c | rank (shipped / level-aware) | WPM (nominal) | acc | dmg | tally | clock | paceMul w1/w2/w3 | quota | cps / (target x mul), all / stream | timed out (escaped) | hull in | throughput |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | clear | 36.4 | 6.9 | 100 % | 0 | 0 (0/0/0) | 2.24/2.64/2.46 | 7/8 10/10 13/16 | 0.33/0.30/0.43 | 0/0 | A / A | 47.5 (14.4) | 90.6 | 0 | 2579 | 0.96 | 1/1/1.35 | 8/10/16 | 2.24/0.13 2.64/0 1.82/0.25 | no/no/no | 200/200 | 36 |
| 2 | clear | 48.4 | 12.7 | 100 % | 0 | 0 (0/0/0) | 2.39/3.71/2.91 | 9/17 17/24 13/29 | 0.23/0.18/0.23 | 0/0 | A / A | 50.5 (20.4) | 94.3 | 0 | 3748 | 0.95 | 1.70/2.03/2.04 | 17/24/29 | 1.41/0.45 1.83/0.62 1.43/0.70 | no/no/no | 300/300 | 47 |
| 3 | clear | 66.8 | 16.7 | 100 % | 0 | 0 (0/0/0) | 1.75/1.75/1.82 | 9/20 6/21 5/24 | 0.32/0.33/0.30 | 0/1 | A / A | 49.1 (27.6) | 93 | 0 | 4897 | 0.96 | 1.69/1.52/1.51 | 20/21/24 | 1.04/0.69 1.15/0.76 1.21/0.86 | no/no/yes (0) | 400/400 | 47 |

### pace-w80-s1-3 — 80 WPM / 0.97 accuracy, minion policy danger, fresh save

| S | outcome | to boss s | boss s | min HP | wave leaks/min | boss leaks/min (per phase) | cps ratio w1/w2/w3 | hungry spawns w1/w2/w3 | idle max s w1/w2/w3 | surges f/c | rank (shipped / level-aware) | WPM (nominal) | acc | dmg | tally | clock | paceMul w1/w2/w3 | quota | cps / (target x mul), all / stream | timed out (escaped) | hull in | throughput |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | clear | 25.9 | 4.7 | 100 % | 0 | 0 (0/0/0) | 1.97/2.95/3.36 | 8/8 10/10 12/12 | 0.50/0.33/0.37 | 0/0 | S / S | 74.1 (14.4) | 100 | 0 | 3274 | 0.95 | 1/1/1 | 8/10/12 | 1.97/0 2.95/0 3.36/0 | no/no/no | 200/200 | 40 |
| 2 | clear | 39.8 | 8.8 | 100 % | 0 | 0 (0/0/0) | 2.41/3.05/4.52 | 11/14 14/20 25/29 | 0.45/0.30/0.27 | 0/0 | S / S | 71.8 (20.4) | 95.7 | 0 | 4424 | 0.94 | 1.35/1.70/2.05 | 14/20/29 | 1.78/0.54 1.80/0.29 2.20/0.35 | no/no/no | 300/300 | 57 |
| 3 | clear | 52.9 | 10.8 | 100 % | 0 | 0 (0/0/0) | 2.52/2.66/3.32 | 22/27 11/31 20/36 | 0.23/0.28/0.20 | 0/0 | S / S | 74.4 (27.6) | 97.7 | 0 | 6065 | 0.94 | 2.23/2.23/2.24 | 27/31/36 | 1.13/0.20 1.19/0.90 1.48/0.56 | no/no/no | 400/400 | 67 |

### Stakes (D3), seeded profile, sector jump then consecutive sectors, one retry allowed (none used; every wave ran at paceMul 1.0, so the knob does not apply)

| profile | sector: hull in (card) -> damage, min hull, wave timeouts (escaped), paceMul |
|---|---|
| 25 / .85 from S3 | S3 400/400 -> 14, 96.5 %, W3 (2); S4 500/500 -> 94, 81.2 %, W3 (0); S5 **544/600** -> 302, 40.3 %, W1 (1) W2 (1), carry +1 +1; S6 **491/700** -> 506, **12.9 %**, W2 (2), carry +2; all waves 1.0, rank C / D / D / D |
| 35 / .90 from S4 | S4 500/500 -> 0, 100 %, W3 (0); S5 600/600 -> 118, 80.3 %, W3 (2); S6 **631/700** -> 392, 34.1 %, W1 (0) W2 (0); S7 **597/800** -> 444, **19.1 %**, W1 (0) W2 (2), carry +2; all waves 1.0, rank B / C / C / C |
| 55 / .93 from S7 | S7 800/800 -> 56, 93 %, W3 (0); S8 **869/900** -> 124, 82.8 %; S9 **914/1000** -> 474, 44 %, W1 (1) W2 (0), carry +1; S10 **792/1100** -> 444, 46.6 %, W2 (2), carry +2, victory; all waves 1.0, rank A / A / B / B |

Bold = a hull carried from the previous clear (S5+). Nobody died, so no Cadet offer appeared; the prototype (spec-pace
14.2, same D3 rules, no MEASURE) had the 25 WPM pilot die in S6 and the 35 WPM pilot end S7 at 60 / 800. Every one of
these pilots is below the table from these sectors, so every wave ran at paceMul 1.0 and the numbers isolate D3.
ARCADE's surge damage from S2 and its shorter boss time bonus land on exactly these runs: re-run them on the merged tree.

## Method

* Probe: `tools/playtest/probes/b10.mjs --wpm W --accuracy A [--sectors 3 | --jump 10] [--minions danger|never|always]
  [--expect p35|p55|p80]`; `probes/b10-report.mjs` turns the JSON files in `tools/playtest/out/b10/` into the tables below.
  `probes/b-run.mjs` (B3 smoke, 60 WPM / .95 over two sectors) is unchanged and still passes.
* Typist model: the harness model (amendment C-14) — key interval `60000 / (WPM x 5)` ms with ±20 % jitter, a wrong key with
  probability `1 - accuracy`, nothing typed during the sector card / locked boss intro / finale, the lock first, then the
  nearest targetable enemy, then powerups. In a boss fight the default `danger` policy shoots a minion only once its plate
  has crossed `DANGER_X` (35 % of the width) and otherwise types the boss (`never` is the old harness behaviour where every
  minion leaks; `always` shoots any minion first).
* Profiles: 35 WPM / .90, 55 WPM / .93 (the reference typist), 80 WPM / .97; each from a fresh save through sectors 1-3,
  and sector 10 by `game.startSector(9)` (direct jump, fresh run, 1100 HP). One baseline run and one confirmation run per
  profile and sector set, as the budget asked.
* Measurements per sector (hooks on the live game instance, timestamps on `game.playClock`): seconds to the boss (first
  frame of `inBoss`, play clock), boss duration (intro unlock to kill), min HP, deaths, leaks per minute over the waves
  and over every boss phase separately (phase spans from `endBossIntro` / `onBossPhaseClear` / `onBossKill`),
  `incomingCps` per wave = characters spawned during the wave's `spawn` phase / its length (cross-checked against
  `TypeRDebug.stats().incomingCps` sampled once the trailing 10 s window sits inside the wave; the two agree within ~10 %),
  the share of spawns the hungry rule triggered (a spawn with `hungryT === 0` and fewer than `HUNGRY_MIN_ALIVE` alive),
  surges fired / countered, damage by source, rank (as shipped and with the level-aware speed term), gross WPM, accuracy,
  the tally, and the longest gap in which the 80 WPM typist had nothing targetable inside a spawn phase (idle).
* Band: `incomingCps / LEVELS[i].targetCps` per wave, target 0.85-1.15. Reported twice: all spawns, and stream-only
  (spawns the hungry rule did not trigger). The hungry rule is demand-driven by design — a typist who clears the field
  faster than the stream is fed at their own pace — so the stream-only figure is the one that says whether the table is
  right; the all-spawns figure is what that typist experienced.

## Knobs changed (all in `assets/js/core/20-constants.js`)

| knob | before | after | why |
|---|---|---|---|
| `HUNGRY_SPAWN_S` / `HUNGRY_MIN_ALIVE` | 1.5 s / fewer than 2 alive | 0.5 s / empty field (1) | at 1.5 s the 80 WPM typist's longest idle gap was 1.85-1.99 s (the rest of the timer, which runs while the last plate is still being typed, plus the 0.15-1.4 s a plate needs to roll in from `x = w + plateW/2 + rand(10, 90)`); shortening the timer alone to 1.0 s fixed idle (1.15-1.68 s) but fed every typist faster than the stream 17-22 % above `targetCps` (b3's L5 wave-2 check). Triggering on an empty field lets the base stream pace the wave and bounds idle at 0.5 s + roll-in |
| `WAVE_SPAWN_MUL` | [0.85, 1.0, 1.15] | [0.9, 1.0, 1.1] | the multipliers sat exactly on the ±15 % band edges before the intra-wave ramp (0.9-1.1) was applied |
| `waveSpawnRate()` | `spawnRate x mul x ramp` | `spawnRate x (nominalChars / waveCharsPerEnemy) x mul x ramp` | each wave is paced by its own characters per enemy (letter share after `WAVE_LETTER_MUL`, mean of its length window). Before, enemies per second was the same in every wave while characters per enemy rose from 1.5 to 2.7 (L1) / 7.6 to 9.9 (L10), so wave 3's stream was 1.5-2x the target and wave 1's 0.7x. `cfg.spawnRate` itself is unchanged (CONTRACT 7) |
| `RANK` speed term for L <= 3 | absolute window 20..60 WPM | `rankFor(acc, wpm, hpPts, level)`: for `level <= RANK.speedNormLevels` (3) s = 0 at 0.5x and s = 1 at 1.7x the sector's nominal gross WPM (`targetCps x 12` = 14.4 / 20.4 / 27.6), never wider than the absolute window | in sectors 1-3 the stream caps a perfect typist at 25 / 34 / 44 gross WPM, so S needed 46.7 WPM and was unreachable (an 80 WPM / .97 typist with zero damage got B / A / A). Needs the one-line call-site change in HANDOFF.md 1; without it the rank is exactly as before |
| `DAMAGE.leakCap` | 24 (code) vs 16 (content probe) | 24 | kept: PLAN B4's acceptance and `probes/b4.mjs` require a 12-letter leak to cost 36; `content-tables.mjs` now asserts 24 |

Unchanged on purpose after measuring: per-level `targetCps`, quotas, caps/durations, speeds, word windows, `DRAIN_MIN_S`,
`POWERUP_DROP` / weights, `minionRate` / `minionMax` / `minionSpawnDx`, `surgeEvery`, surge duration, `RANK` thresholds and
weights. The numbers below say why.

## Final confirmation round (shipped constants: empty-field hungry rule 0.5 s, per-wave pacing), sectors 1-3 from a fresh save

Columns: to boss = play-clock seconds from the sector start to the first boss frame; boss s = intro unlock to kill; leaks/min over the waves and over the whole boss (per phase in brackets); cps ratio = incomingCps / targetCps per wave; hungry spawns = spawns the hungry rule triggered / spawns in the wave; idle = longest gap with nothing targetable in a spawn phase (seconds); rank = as shipped / with the level-aware speed term (HANDOFF.md 1); WPM (nominal) = gross WPM (targetCps x 12); tally = clear tally total; clock = play / wall ratio.

### w35-s1-3 — 35 WPM / 0.9 accuracy, minion policy danger, fresh save

| S | outcome | to boss s | boss s | min HP | wave leaks/min | boss leaks/min (per phase) | cps ratio w1/w2/w3 | hungry spawns w1/w2/w3 | idle max s w1/w2/w3 | surges f/c | rank (shipped / level-aware) | WPM (nominal) | acc | dmg | tally | clock |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | clear | 55.6 | 11.3 | 100 % | 0 | 0 (0/0/0) | 0.99/1.11/1.44 | 1/8 4/10 2/12 | 1.55/1.22/1.15 | 0/0 | B / A | 23 (14.4) | 91.8 | 0 | 2500 | 0.97 |
| 2 | clear | 56.7 | 23.5 | 100 % | 0 | 0 (0/0/0) | 0.67/0.76/1.03 | 7/10 6/12 7/14 | 1.35/0.97/0.83 | 0/0 | C / B | 23 (20.4) | 88.7 | 0 | 3200 | 0.97 |
| 3 | clear | 73.9 | 27.4 | 100 % | 0 | 0 (0/0/0) | 0.73/0.87/1.05 | 2/12 3/14 3/16 | 1.02/1.10/0.87 | 0/1 | B / B | 28 (27.6) | 90.9 | 0 | 4500 | 0.97 |

### w55-s1-3 — 55 WPM / 0.93 accuracy, minion policy danger, fresh save

| S | outcome | to boss s | boss s | min HP | wave leaks/min | boss leaks/min (per phase) | cps ratio w1/w2/w3 | hungry spawns w1/w2/w3 | idle max s w1/w2/w3 | surges f/c | rank (shipped / level-aware) | WPM (nominal) | acc | dmg | tally | clock |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | clear | 51.6 | 6.4 | 100 % | 0 | 0 (0/0/0) | 1.42/1.40/1.35 | 2/8 4/10 11/12 | 1.38/1.53/1.25 | 0/0 | B / A | 26 (14.4) | 91.8 | 0 | 2581 | 0.97 |
| 2 | clear | 54.8 | 13 | 100 % | 0 | 0 (0/0/0) | 1.31/0.89/1.24 | 4/10 7/12 6/14 | 0.83/1.18/1.22 | 0/0 | B / A | 30 (20.4) | 93.3 | 0 | 3719 | 0.97 |
| 3 | clear | 61.9 | 16.6 | 100 % | 0 | 0 (0/0/0) | 0.67/1.05/1.07 | 9/12 6/14 8/16 | 1.10/1.10/1.13 | 0/1 | B / A | 34 (27.6) | 94.3 | 0 | 4929 | 0.96 |

### w80-s1-3 — 80 WPM / 0.97 accuracy, minion policy danger, fresh save

| S | outcome | to boss s | boss s | min HP | wave leaks/min | boss leaks/min (per phase) | cps ratio w1/w2/w3 | hungry spawns w1/w2/w3 | idle max s w1/w2/w3 | surges f/c | rank (shipped / level-aware) | WPM (nominal) | acc | dmg | tally | clock |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | clear | 52 | 5 | 100 % | 0 | 0 (0/0/0) | 1.12/1.49/1.95 | 3/8 5/10 7/12 | 1.63/1.45/1.50 | 0/0 | B / S | 29 (14.4) | 95.7 | 0 | 2892 | 0.97 |
| 2 | clear | 54.7 | 8.1 | 100 % | 0 | 0 (0/0/0) | 0.96/1.32/1.43 | 4/10 6/12 7/14 | 1.60/1.35/1.35 | 0/0 | A / S | 36 (20.4) | 97.3 | 0 | 4446 | 0.97 |
| 3 | clear | 64.1 | 11 | 100 % | 0 | 0 (0/0/0) | 1/1.22/1.27 | 4/12 6/14 5/16 | 1.27/1.20/1.20 | 0/0 | A / S | 41 (27.6) | 96.5 | 0 | 6124 | 0.96 |

## Sector 10 by direct jump (per-wave pacing + hungry rule "fewer than 2 alive for 1.0 s"; the hungry share there is 2-25 %, so the final rule changes little)


### w55-j10 — 55 WPM / 0.93 accuracy, minion policy danger, direct jump to sector 10

| S | outcome | to boss s | boss s | min HP | wave leaks/min | boss leaks/min (per phase) | cps ratio w1/w2/w3 | hungry spawns w1/w2/w3 | idle max s w1/w2/w3 | surges f/c | rank (shipped / level-aware) | WPM (nominal) | acc | dmg | tally | clock |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 10 | victory | 124.6 | 68.1 | 29 % | 15.31 | 0 (0/0/0/0) | 0.87/0.96/1.07 | 1/30 1/30 1/18 | 0.65/0.47/0.28 | 0/7 | B / B | 48 (78) | 91.8 | 784 | 14880 | 0.97 |

### w80-j10 — 80 WPM / 0.97 accuracy, minion policy danger, direct jump to sector 10

| S | outcome | to boss s | boss s | min HP | wave leaks/min | boss leaks/min (per phase) | cps ratio w1/w2/w3 | hungry spawns w1/w2/w3 | idle max s w1/w2/w3 | surges f/c | rank (shipped / level-aware) | WPM (nominal) | acc | dmg | tally | clock |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 10 | victory | 106.7 | 44 | 100 % | 0 | 0 (0/0/0/0) | 0.91/0.86/0.96 | 5/20 7/24 4/28 | 0.70/0.48/0.80 | 0/4 | S / S | 70 (78) | 96.9 | 0 | 23657 | 0.95 |

## First confirmation round (per-wave pacing, hungry rule "fewer than 2 alive for 1.0 s"), sectors 1-3


### w35-s1-3 — 35 WPM / 0.9 accuracy, minion policy danger, fresh save

| S | outcome | to boss s | boss s | min HP | wave leaks/min | boss leaks/min (per phase) | cps ratio w1/w2/w3 | hungry spawns w1/w2/w3 | idle max s w1/w2/w3 | surges f/c | rank (shipped / level-aware) | WPM (nominal) | acc | dmg | tally | clock |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | clear | 44.9 | 11.6 | 100 % | 0 | 0 (0/0/0) | 1.21/1.29/1.04 | 6/8 7/10 8/12 | 1.15/1.05/0.89 | 0/0 | C / B | 22 (14.4) | 88.7 | 0 | 2350 | 0.97 |
| 2 | clear | 52.7 | 19.5 | 100 % | 0 | 0 (0/0/0) | 0.81/1.12/1.18 | 8/10 5/12 7/14 | 1.10/1.10/1.15 | 0/0 | C / B | 25 (20.4) | 90.1 | 0 | 3500 | 0.97 |
| 3 | clear | 74.5 | 25.2 | 100 % | 0 | 0 (0/0/0) | 0.92/0.90/1.15 | 3/12 2/14 4/16 | 1.10/0.94/0.99 | 0/1 | B / B | 30 (27.6) | 90 | 0 | 4500 | 0.97 |

### w55-s1-3 — 55 WPM / 0.93 accuracy, minion policy danger, fresh save

| S | outcome | to boss s | boss s | min HP | wave leaks/min | boss leaks/min (per phase) | cps ratio w1/w2/w3 | hungry spawns w1/w2/w3 | idle max s w1/w2/w3 | surges f/c | rank (shipped / level-aware) | WPM (nominal) | acc | dmg | tally | clock |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | clear | 42.7 | 6.1 | 100 % | 0 | 0 (0/0/0) | 0.81/1.06/1.99 | 7/8 9/10 10/12 | 1.31/1.36/1.36 | 0/0 | B / A | 25 (14.4) | 93.5 | 0 | 2596 | 0.96 |
| 2 | clear | 48.5 | 10.5 | 100 % | 0 | 0 (0/0/0) | 0.74/1.14/1.42 | 9/10 7/12 11/14 | 1.41/1.62/1.36 | 0/0 | B / A | 31 (20.4) | 94.9 | 0 | 3773 | 0.96 |
| 3 | clear | 60.8 | 14.6 | 100 % | 0 | 0 (0/0/0) | 1.04/1.19/1.43 | 8/12 6/14 8/16 | 1.25/1.25/1.30 | 0/0 | B / A | 41 (27.6) | 93.0 | 0 | 5105 | 0.96 |

### w80-s1-3 — 80 WPM / 0.97 accuracy, minion policy danger, fresh save

| S | outcome | to boss s | boss s | min HP | wave leaks/min | boss leaks/min (per phase) | cps ratio w1/w2/w3 | hungry spawns w1/w2/w3 | idle max s w1/w2/w3 | surges f/c | rank (shipped / level-aware) | WPM (nominal) | acc | dmg | tally | clock |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | clear | 40.4 | 3.7 | 100 % | 0 | 0 (0/0/0) | 0.82/1.70/2.33 | 7/8 9/10 11/12 | 1.62/1.52/1.25 | 0/0 | A / S | 30 (14.4) | 100 | 0 | 3307 | 0.95 |
| 2 | clear | 46.9 | 7 | 100 % | 0 | 0 (0/0/0) | 0.90/1.20/1.50 | 9/10 9/12 12/14 | 1.67/1.68/1.46 | 0/0 | A / S | 34 (20.4) | 96.8 | 0 | 4501 | 0.96 |
| 3 | clear | 54 | 10.3 | 100 % | 0 | 0 (0/0/0) | 1.47/1.66/1.32 | 6/12 10/14 15/16 | 1.15/1.25/1.30 | 0/0 | A / S | 52 (27.6) | 95.5 | 0 | 6251 | 0.96 |

## Baseline runs (constants before this pass): sectors 1-3 and sector 10

The sector-10 baseline rows are real-time runs; their clock column is the victory-screen artifact described above.

### w35-j10 — 35 WPM / 0.9 accuracy, minion policy danger, direct jump to sector 10

| S | outcome | to boss s | boss s | min HP | wave leaks/min | boss leaks/min (per phase) | cps ratio w1/w2/w3 | hungry spawns w1/w2/w3 | idle max s w1/w2/w3 | surges f/c | rank (shipped / level-aware) | WPM (nominal) | acc | dmg | tally | clock |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 10 | victory | 124.5 | 116.6 | 23 % | 19.14 | 0 (0/0/0/0) | 0.62/0.88/1.10 | 1/25 1/28 0/21 | 0.53/0.58/0.16 | 1/10 | C / - | 32 (78) | 91.2 | 1012 | 6500 | 0.59 |

### w35-s1-3 — 35 WPM / 0.9 accuracy, minion policy danger, fresh save

| S | outcome | to boss s | boss s | min HP | wave leaks/min | boss leaks/min (per phase) | cps ratio w1/w2/w3 | hungry spawns w1/w2/w3 | idle max s w1/w2/w3 | surges f/c | rank (shipped / level-aware) | WPM (nominal) | acc | dmg | tally | clock |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | clear | 47.1 | 9.9 | 100 % | 0 | 0 (0/0/0) | 1.35/1.56/1.60 | - - - | 1.59/1.37/1.31 | 0/0 | B / - | 25 (14.4) | 92.7 | 0 | 2504 | 0.97 |
| 2 | clear | 63.1 | 19.8 | 100 % | 0 | 0 (0/0/0) | 1.05/1.39/1.47 | - - - | 1.52/0.73/1.04 | 0/0 | C / - | 28 (20.4) | 90.1 | 0 | 3500 | 0.96 |
| 3 | clear | 74.1 | 24.4 | 100 % | 0 | 0 (0/0/0) | 0.82/0.82/1.12 | - - - | 1.83/1.67/0.94 | 0/1 | B / - | 28 (27.6) | 90.7 | 0 | 4500 | 0.97 |

### w55-j10 — 55 WPM / 0.93 accuracy, minion policy danger, direct jump to sector 10

| S | outcome | to boss s | boss s | min HP | wave leaks/min | boss leaks/min (per phase) | cps ratio w1/w2/w3 | hungry spawns w1/w2/w3 | idle max s w1/w2/w3 | surges f/c | rank (shipped / level-aware) | WPM (nominal) | acc | dmg | tally | clock |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 10 | victory | 124.5 | 61.5 | 49 % | 10.53 | 0 (0/0/0/0) | 0.65/0.96/1.21 | 2/21 1/30 0/26 | 0.63/0.64/0.68 | 0/6 | B / - | 51 (78) | 93.2 | 558 | 17299 | 0.46 |

### w55-s1-3 — 55 WPM / 0.93 accuracy, minion policy danger, fresh save

| S | outcome | to boss s | boss s | min HP | wave leaks/min | boss leaks/min (per phase) | cps ratio w1/w2/w3 | hungry spawns w1/w2/w3 | idle max s w1/w2/w3 | surges f/c | rank (shipped / level-aware) | WPM (nominal) | acc | dmg | tally | clock |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | clear | 48.2 | 5.7 | 100 % | 0 | 0 (0/0/0) | 1.04/1.27/2.06 | - - - | 1.47/1.67/1.31 | 0/0 | B / - | 27 (14.4) | 91.5 | 0 | 2600 | 0.97 |
| 2 | clear | 52.1 | 11.2 | 100 % | 0 | 0 (0/0/0) | 0.92/1.09/1.56 | - - - | 2.21/1.10/1.09 | 0/0 | B / - | 33 (20.4) | 95.6 | 0 | 4321 | 0.96 |
| 3 | clear | 60.3 | 13.7 | 100 % | 0 | 0 (0/0/0) | 1.12/1.19/1.51 | - - - | 1.52/1.73/1 | 0/0 | A / - | 42 (27.6) | 97.3 | 0 | 5897 | 0.96 |

### w80-j10 — 80 WPM / 0.97 accuracy, minion policy danger, direct jump to sector 10

| S | outcome | to boss s | boss s | min HP | wave leaks/min | boss leaks/min (per phase) | cps ratio w1/w2/w3 | hungry spawns w1/w2/w3 | idle max s w1/w2/w3 | surges f/c | rank (shipped / level-aware) | WPM (nominal) | acc | dmg | tally | clock |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 10 | victory | 117.9 | 36.2 | 82 % | 3.03 | 0 (0/0/0/0) | 0.91/0.98/1.22 | 4/20 3/24 0/33 | 0.52/0.58/0.64 | 0/3 | S / - | 77 (78) | 96.7 | 200 | 25458 | 0.38 |

### w80-s1-3 — 80 WPM / 0.97 accuracy, minion policy danger, fresh save

| S | outcome | to boss s | boss s | min HP | wave leaks/min | boss leaks/min (per phase) | cps ratio w1/w2/w3 | hungry spawns w1/w2/w3 | idle max s w1/w2/w3 | surges f/c | rank (shipped / level-aware) | WPM (nominal) | acc | dmg | tally | clock |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | clear | 47.4 | 4.3 | 100 % | 0 | 0 (0/0/0) | 1.45/0.59/1.63 | - - - | 1.85/1.94/1.42 | 0/0 | B / - | 25 (14.4) | 98.1 | 0 | 3302 | 0.97 |
| 2 | clear | 45.7 | 6.7 | 100 % | 0 | 0 (0/0/0) | 1.12/1.23/1.86 | - - - | 1.99/1.26/1.46 | 0/0 | A / - | 34 (20.4) | 98.7 | 0 | 5313 | 0.96 |
| 3 | clear | 58.3 | 10.2 | 100 % | 0 | 0 (0/0/0) | 0.89/1.17/1.95 | - - - | 1.68/1.31/1.56 | 0/0 | A / - | 44 (27.6) | 95.3 | 0 | 6186 | 0.96 |

## What the numbers say

**Sectors 1-3 are a ramp no profile can lose.** Over twelve sector runs (two per profile per sector) nobody took a single
point of damage: the stream asks for 1.2 / 1.7 / 2.3 cps (14 / 20 / 28 WPM) and even the 35 WPM / .90 typist types ~2.6 cps.
The 35 WPM typist's sector-3 boss takes 25 s; the sector-2 boss is reached at 53-63 s. The target "may die in sector 2-3"
is a may: the first sector where a 35 WPM typist is outpaced is 4 (36 WPM nominal), the 55 WPM typist's is 6-7 (52-59 WPM).

**Seconds to the sector-1 boss are set by the spawner, not the typist.** Every wave spawns exactly its quota and the pace is
the hungry rule's (one plate per `HUNGRY_SPAWN_S` + roll-in once fewer than two are alive), so the 35, 55 and 80 WPM typists
all reach the boss within a few seconds of each other: 47-48 s at `HUNGRY_SPAWN_S` 1.5, 40-45 s at 1.0. The 25-70 s window
holds with margin either way.

**With the contract's hungry rule, the hungry spawner paced sectors 1-3 for everyone faster than ~45 WPM.** Share of spawns
it triggered in the first confirmation round (`tuned-*`, "fewer than 2 alive for 1.0 s"): 80 WPM 75-95 %, 55 WPM 40-90 %,
35 WPM 75 % at sector 1 falling to 20 % at sector 3. That was the mechanism behind the failed band line in that round: the
55 WPM typist's per-wave cps read 0.74-1.99x the target because they were fed at their own kill pace (the quota is fixed,
so the wave just ended sooner; no extra risk). Two things fix it together: the base stream now delivers 0.9 / 1.0 / 1.1x
`targetCps` per wave by construction (`waveSpawnRate`, checked for all ten sectors in a vm), and the hungry rule now fires
only on an empty field, so it fills gaps instead of setting the pace. The `tuned2-*` tables are the result; a typist at the
stream's pace was inside the band already (35 WPM at sector 3: 0.92 / 0.90 / 1.15; 80 WPM at sector 10: 0.93 / 0.98 / 0.94).

**Idle for the 80 WPM typist.** Longest gap with nothing targetable inside a spawn phase: 1.85-1.99 s with the contract's
rule (fewer than 2 alive for 1.5 s), 1.15-1.68 s with that rule at 1.0 s (first confirmation round, `tuned-*`), and the
`tuned2-*` figures below with the empty-field rule at 0.5 s; the gap is the hungry timer plus the 0.15-1.4 s a new plate
needs to roll in from `x = w + plateW/2 + rand(10, 90)` (40-combat.js). If the lead wants more margin, `rand(10, 90)` ->
`rand(10, 40)` in `spawnEnemy` takes ~0.5 s off the worst case (not done: not my file).

**Rank.** As shipped, the 80 WPM / .97 typist with zero damage gets B / A / A in sectors 1-3 (gross 25-30 / 34 / 44-52 WPM
against an absolute S line of 46.7 WPM). With the level-aware speed term (`rankFor(..., level)`, HANDOFF.md 1) the same runs
rank S / S / S, the 55 WPM / .93 typist A / A / A (S when their accuracy roll lands at 97 %), the 35 WPM / .90 typist A-B /
B / B. A perfect typist reaches S at >= 18.7 / 26.5 / 35.9 gross WPM in sectors 1-3 (measured ceilings 30 / 34 / 52), and
from sector 4 the absolute window is untouched: S at >= 46.7 WPM with >= 98 % accuracy and no damage. The pure assertions
`rankFor(99,60,1) === 'S'`, `rankFor(95,35,.5) === 'B'`, `rankFor(80,20,0) === 'D'` (b9, content-tables) still hold because
they pass no level.

**Boss phases (E-8).** With the `danger` minion policy no boss phase leaked a single minion in any valid run (sectors 1-3,
`minionMax` 1-2, `minionRate` .20-.28/s) nor in the sector-10 runs (`minionMax` 4, .55/s, 1.1x speed = 178 px/s, 2.9 s from
`artRect.x - 40` to the ship); the typist spends one key per minion once it crosses `DANGER_X`. The old harness policy
(`--minions never`) is what produced the inflated boss leak figures in the Phase 2 notes. `minionSpawnDx` stays -40: it can
only shorten the minion's travel (the art is the right edge), so it is not a lever for fewer leaks.

**Surges.** None start in sectors 1-2 (`surgeEvery` null), sector 3's 10-25 s fights see 0-1 (`surgeEvery` 16): the 35 WPM
typist countered its only one. A surge lasts 1.5 s + 0.25 s per remaining character of the segment, i.e. it is counterable
without a miss by anyone typing >= 48 WPM, and with the 1.5 s head start by the 35 WPM typist on short segments. Sector 10
numbers are in the table below.

**`DAMAGE.leakCap`.** Kept at 24 (12-letter leak = 36 HP, 5 letters = 22, 1 letter = 14): the first 12-letter words appear in
sector 8 where the hull is 900 HP; in sectors 1-3 a leak costs 14-26 of 200-400 HP and nobody leaked anyway.

## PLAN B10 acceptance lines, as measured

| line | result | evidence |
|---|---|---|
| 40 WPM / .92 reaches L5 alive with <= 1 retry | not run as written; the 35 WPM / .90 profile clears sectors 1-3 at 100 % HP in both runs | tables above |
| 60 WPM / .95 clears L10 with <= 2 retries | plausible: the 55 WPM / .93 profile clears sector 10 from a direct jump without dying (min HP 49 % baseline), B rank; a full 10-sector run was outside the budget | sector-10 table |
| 100 WPM / .97 reaches x5 and S on at least one sector | S reached by the 80 WPM / .97 profile in sectors 1-3 (level-aware) and at sector 10 (as shipped: 77 WPM, 96.7 %, 200 damage) | tables |
| no wave with `incomingCps > targetCps x 1.3` for > 5 s | holds for the stream (0.9 / 1.0 / 1.1 by construction); exceeded only by hungry feeding of typists faster than the stream (sector 1 wave 3 for 55 and 80 WPM) | hungry column |
| `leaksPerMin` at 60 WPM never above 6 | 0 in sectors 1-3 for all profiles; sector 10 is above it for every profile slower than ~80 WPM | tables |

## Recommendations (not applied; data for the lead)

1. Apply HANDOFF.md 1 (`rankFor(acc, wpm, hpPts, L)`): one line, turns on the sector 1-3 rank windows measured above.
2. Sector 10 needs no table change: 80 WPM / .97 clears it at 82-100 % HP with S, 55 WPM / .93 at 49 % with B, and even
   35 WPM / .90 scrapes through at 23 % (C) because the pressure valve and `maxEnemies` bound the leak rate (~19/min).
   If the lead wants sector 10 to be a wall for sub-40 WPM typists, raise `quota[2]` at L10 from 28 to 32 (one more
   cap-length wave) rather than `targetCps`.
3. Phone plates: no change (HANDOFF.md 2); document the phone profile as landscape-only.
4. Spawn roll-in `rand(10, 90)` -> `rand(10, 40)` in `spawnEnemy` (40-combat.js) if more idle margin is wanted for very fast
   typists; the 2 s target holds today without it.

## Regression probes and harness after the tuning

| check | result |
|---|---|
| `probes/content-tables.mjs` | 1725 passed, 0 failed (it asserted `DAMAGE.leakCap` 16 against the code's 24 before this pass; now 24, plus the new hungry / `WAVE_SPAWN_MUL` numbers) |
| `probes/b1 b2 b4 b5 b6 b7 b9 b-run` | all pass, zero page errors |
| `probes/b3` | passes: L5 wave-2 `incomingCps` 4.12 (+11 %, band ±15 %); it read +17 % / +22 % with the interim "fewer than 2 alive for 1.0 s" rule, which is why that rule did not ship |
| `probes/b8` | 1 failure, pre-existing: "levelComplete 5.0 ± .15 s after the kill" reads 5.57 s with HEAD's constants and with mine (same number four times); the finale timer runs through the boss-kill slow-motion. Not a balance constant; flagged in HANDOFF.md 4 |
| harness `all`, DPR 1 | 0 page errors, 0 console errors, fps menu 60 / gameplay 60 / boss 60 / finale 61, maxRenderMs ≤ 4.1, shadowBlur 0, full-frame fill alpha ≤ .12 |
| `node --check` | clean for every touched file |

Output folders: `tools/playtest/out/b10/` (JSON + logs per run), `out/probe-b10-*` (screenshots), `out/b10-harness-all`.
