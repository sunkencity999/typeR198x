# Balance pass (B10) — typist profiles, method, numbers

Measured on 2026-10-16 on `web-overhaul` (Phase 4 worktree `wt/p4-balance`, base commit 29b2cc7) with the Playwright
harness at DPR 1, 1440 x 900, headless Chrome, one browser per run (three to six runs in parallel). Every run records
play-clock seconds against wall-clock seconds per sector: the loop clamps `dt` to 50 ms, so a starved browser would
silently slow the game and inflate a wall-clock typist's effective WPM. All sector 1-3 runs kept a ratio of 0.95-0.97.
The three `base-*-j10` files show 0.38-0.59 only because that probe version did not treat the `victory` screen (a
sector-10 clear) as the end of the sector and idled there until its wall cap while `playClock` stood still; the game
itself ran at 60 fps / 0.97 during those runs (checked separately: sector 10 with an 80 WPM typist, `out/fpstype`). The
final probe stops on `victory` and paces the typist by `game.playClock`, so its WPM is honest at any frame rate.

## Training update follow-up 2: floor waves and a stale stored acquisition time (lead rulings Z13 / Z14, `wt/pace-acq`)

Measured on 2026-10-25 (20:27-22:55 PDT) on `wt/pace-acq` with the Z13 / Z14 / Z15 commits on `d28653f`, headless
Chrome, DPR 1, 1440 x 900, at most two harness browsers at a time, every typist paced by `game.playClock`. Every run
kept play / wall clock 0.93-0.98 (the S1 row of a seeded `t-pace-balance` run reads 1.01-1.02 because its wall clock
starts after the run start), so **no run was discarded** (threshold 0.9; the queue re-ran nothing). Comparison sets:
live `a0a3845` = this branch's 4 `L-` runs and the review's 6 `V-L-` runs (the Z12 exports) plus 6 new `ZL-` runs
with this branch's `b10.mjs` in a live export's `probes-t/`; `d28653f` = the 24 runs of "this code, all" in the Z12
section below plus 3 + 3 new stored-900 runs (`D-Z14-*`, this probe in a `d28653f` export). JSON: `out/b10/Z-*.json`,
`ZL-*.json`, `ZX-*.json`, `out/t-pace-balance/*-z1.json`, `*-z2.json`, `*-acq300-z1.json`, `*-acq300-z2.json`,
`Z14-*.json`, `D-Z14-*.json`, `X-*.json` (the export runs copied in; the exports were removed).

**What live `a0a3845` does with a wave** (`git show a0a3845:assets/js/game/40-combat.js`, `core/20-constants.js`):
- start, `beginWave` 227-242: waveKills / waveT / waveDmg 0, hungryT 0, spawnAcc = SPAWN_ACC_PRIME .85, phase spawn,
  the wave sting (W1: the GO banner); the quota is the table's `cfg.quota[w]`, the stream the table's;
- during, `tickWaves` 195-199 and `tickSpawner` 140-159: waveT += dt; spawnAcc += dt x waveSpawnRate(cfg, w, kills)
  (ramp .9 -> 1.1 over the quota); an empty field spawns after HUNGRY_SPAWN_S .5 s (20-constants 25) and a plate
  starts 10-90 px past the right edge (`spawnEnemy`); no spawn past the quota (kills + alive) or the pressure cap;
  every plate moves and leaks at the ship in every phase (`update` 662-667). The wave ends when `waveKills >= quota
  || waveT >= cfg.cap` (198): the table cap, 22-40 s, whatever is on the field. The sector clock (levelT >= duration
  = 3 x cap, 174; 20-constants 308) starts the boss approach, which detonates every plate (260-273);
- end, `endWave` 245-258: the clear sting always; PERFECT WAVE when waveDmg 0 and waveKills > 0, at the cap too;
  phase drain;
- leftovers, the drain 201-213: plates up at the end stay in play (typeable and scoring; a leak hurts, after PERFECT
  WAVE was judged) until the field is empty (+ .4 s, DRAIN_MIN_S) or 6 s (DRAIN_MAX_S) pass, then the rest detonate
  (no damage, no score); the `WAVE n / 3` banner for 1.2 s, the next wave at its table quota (wave 3: the approach).
  A mid-wave Continue restarts the wave (`20-run.js` 210-212, levelT = wave x cap).

**Z13 on this branch.** A campaign wave whose paceMul after the step rule (and any back-off, or a probe pin) is
exactly 1.0 with no escaped carry is a floor wave (`waveTuning.floor`, `42-pacing.js`): the table quota, stream and
cap (no Z5 extension), the cap ends it whatever is on the field (`40-combat.js`), PERFECT WAVE and the sting as
live, its plates stay in the drain as live; no WAVE TIMED OUT, escape, carry or back-off. A replayed wave (Continue)
stays a floor wave unless its stored quota holds a carry. Waves above 1.0, carried waves, Cadet (0.75) and the modes
keep D3 / Z5 / Z12. **One interpretation, not a literal copy of live:** D2's stream constants (the 0.1 s empty-field
spawn, the 10-30 px roll-in, both in `tickSpawner` / `spawnEnemy`) stay on at the floor. With a0a3845's .5 s / 10-90 px
on floor waves (an experiment on an export, not shipped) a fresh pilot's S1, which is all floor waves until the
20-interval run gate, read **43 / 48 % idle at 55 WPM and 39 / 40 % at 80** (`X-*`, two S1 runs each; this branch
13-16 % and 27-28 %): Q1's fresh bound is 30 %. Probes: `t-pace-floor` (new, 12 checks), `t-pace-stakes` above the
floor (17 / 17).

### Z13 target: 35 / .90 with `--acquire-ms 300`, S1-3 (b10, 16 fresh + 2 seeded runs, and the latency matrix's 2)

| run set | runs | runs with wave damage | 0-leak timeouts | PERFECT WAVE 3 in S2 / S3 | clock cuts S2 / S3 | deaths | boss damage (runs) | floor cap ends (plates up) | to boss S1 / S2 / S3 s | ranks S1-S3 |
|---|---|---|---|---|---|---|---|---|---|---|
| this branch, b10 fresh `Z-w35-acq-r1..16` | 16 | **2** (r5 50, r13 68) | 0 | 31 of 32 (r13 S3: 2) | 0 of 32 | 0 | 0 | 24 (1-6 up) | 38-53 / 47-66 / 62-83 | A / B mostly |
| this branch, b10 seeded `Z-w35-seed-acq-r1..2` | 2 | 0 | 0 | 4 of 4 | 0 of 4 | 0 | 0 | 1 | 42-49 / 59-66 / 73-74 | ABB ABA |
| this branch, latency matrix z1 / z2 | 2 | **1** (z1 26) | 0 | 4 of 4 | 0 of 4 | 0 | 0 | 2 (5, 4 up) | 45-51 / 58 / 78-84 | AAA AAA |
| **this branch, all** | **20** | **3** | **0** | **39 of 40** | **0** | **0** | **0** | 27 | | |
| live `a0a3845`, `L-` + `V-L-` | 10 | 0 | 0 (none judged) | 19 of 20 | 1 of 20 | 0 | 3 (14 each) | (31 cap ends) | 57-61 / 60-70 / 78-83 | B / C mostly |
| live `a0a3845`, `ZL-` (this b10) | 6 | 0 | 0 (none judged) | 12 of 12 | 0 of 12 | 0 | 3 | 15 (1-6 up) | 56-60 / 61-74 / 76-82 | B / C mostly |
| `d28653f` (Z12 section, all) | 24 | 3 | 6 | 40 of 48 | 3 | 0 | - | (no floor) | | |
| experiment: a0a3845's .5 s / 10-90 px on floor waves `ZX-` | 4 | 0 | 0 | 8 of 8 | 0 of 8 | 0 | 0 | 9 (1-5 up) | 51-59 / 67-70 / 73-83 | A / B |

**Z13's targets, as measured:** 0-leak timeouts **met** (0, as live: a floor wave's cap end is no timeout, and every
wave of this typist runs at the floor); PERFECT WAVE in S2 / S3 **met** (39 of 40 sectors at 3, live 31 of 32); S1-3
wave damage **not met**: 3 of 20 runs took wave damage against 0 of 16 on live (Fisher's exact p ~ .24, so not a
demonstrated difference, but the target is "no worse than live's 0"). All three are the same event in S3 W3: a floor
wave reached its 26 s cap with 5-6 plates up (r5: 6 up, a 15-plate wave averaging 5.5 characters a plate, the heaviest
S3 W3 measured; z1: 5 up; r13: 5 up after one leak inside the wave, hence its PERFECT WAVE 2) and its oldest plates
reached the ship during the 6 s drain, as a0a3845's drain allows (2, 1 and 2 drain leaks; 50, 26 and 68 damage). Live
has the same cap ends with as many plates up (ZL r5: 6 up, r6: 5 up, both full 6 s drains) and none of its 16 runs
leaked. What still differs in a floor wave: the content (WORDS' S3 W3 plates average 4.0 characters here, 3.8 on live;
the stream is calibrated to the same characters per second) and D2's spawner: with a 10-30 px roll-in each plate
reaches the ship ~.3 s (up to .65 s) sooner after its spawn than with 10-90 px, while the cap and the 6 s drain run on
the spawn clock, so a leftover has a little less drain before it arrives. The 4 experiment runs with live's spawner
had no wave damage either (live spawner 0 of 20 runs, this branch 3 of 20), too few to separate that from chance. Next
to live the pilot reaches each boss sooner (S1 10-15 s, S2 5-10 s) and ranks about one letter higher; next to
`d28653f` the 0-leak timeouts (6) and the lost PERFECT WAVEs (8 sectors) are gone. For the lead: (a) accept (live's
rule, variance); (b) floor waves also take a0a3845's 10-90 px roll-in (untested against the fresh S1 idle bound: S1's
plates are slow, so about +.4 s per refill of an empty field); (c) the full a0a3845 spawner at the floor (measured
above: it breaks Q1's fresh S1 idle bound).

### Z14 target: stored `profile.acqEma` 900, no latency, seeded R26 fixture (`t-pace-balance --seed-profile auto --seed-acq 900`)

| tree | profile | run | S1 idle (<= 15 %) | S2 idle (<= 15 %) | S3 idle | acq PACE used S1 W1/W2/W3 · S2 W1 | paceMul S1 · S2 | pass |
|---|---|---|---|---|---|---|---|---|
| this branch | 55 / .93 | r1 | **24 %** | 7 % | 10 % | 900/900/900 · 651 | 1.08 x3 · 1.0-1.38 | no |
| this branch | 55 / .93 | r2 | 11 % | 6 % | 9 % | 900/715/531 · 297 | 1.08-1.41 · 1.36-1.39 | yes |
| this branch | 55 / .93 | r3 | **23 %** | **17 %** | 7 % | 900/900/769 · 574 | 1.08-1.23 · 1.08-1.37 | no |
| this branch | 55 / .93 | r4 | 7 % | 2 % | 7 % | 900/426/259 · 272 | 1.08-1.78 · 1.36-1.43 | yes |
| this branch | 55 / .93 | r5 | **23 %** | 15 % | 14 % | 900/900/773 · 773 | 1.08-1.17 · 1.0-1.33 | no |
| this branch | 80 / .97 | r1 | **28 %** | **19 %** | 3 % | 900/900/900 · 642 | 1.23 x3 · 1.21-1.47 | no |
| this branch | 80 / .97 | r2 | 15 % | 12 % | 2 % | 900/765/230 · 209 | 1.23-1.73 · 2.01-2.1 | yes |
| this branch | 80 / .97 | r3 | **29 %** | **18 %** | 2 % | 900/900/900 · 635 | 1.23 x3 · 1.22-1.36 | no |
| this branch | 80 / .97 | r4 | **31 %** | **24 %** | 2 % | 900/900/900 · 761 | 1.23 x3 · 1.09-1.21 | no |
| this branch | 80 / .97 | r5 | **23 %** | 4 % | 4 % | 900/900/632 · 180 | 1.23-1.54 · 1.89-2.15 | no |
| `d28653f` | 55 / .93 | r1-r3 | **23 / 17 / 22 %** | **21** / 4 / **24 %** | 11 / 7 / 13 % | 900/840/783, 900/900/783, 900/900/773 | | 0 of 3 |
| `d28653f` | 80 / .97 | r1-r3 | **17** / 14 / **22 %** | 8 / 7 / 8 % | 4 / 4 / 5 % | 900/758/567, 900/716/228, 900/833/765 | | 1 of 3 |

**Z14 is implemented as ruled and its target is not met:** the first three runs of each profile pass 1 of 3 (55: r2;
80: r2), all five 2 of 5 and 1 of 5 (`d28653f`: 0 of 3 and 1 of 3; the review's runs of that rule 1 of 4 and 0 of 2).
The blend works whenever samples arrive (55 r4: S1 W2 426 ms after five or six samples, where the lifetime value alone
would still read ~600-630;
`t-measure-api` 9d, `t-measure-profile` 16), but in the failing runs S1 produced **no sample at all** for two or
three waves (the PACE value stays exactly 900; one sample under 900 would already lower it): at a stored 900 the
returning pilot's S1 runs at paceMul 1.08 (55) / 1.23 (80), under 1.35, so the field holds one plate at a time and a
kill never leaves another lockable target up, which is what the unchanged sampling rule needs. With n = 0 the blend is
the lifetime value, so the run stays at 900 until S2 brings the first samples. The lever the ruling did not take is
the review's option (2): also sample the spawn-to-first-key gap when a plate arrives on an empty field (or blend
toward 300 rather than the stored value while n = 0); a lead decision.

### Q1 / R26 matrix without latency (`t-pace-balance`, the five profiles, rounds z1 / z2: 20 pass / 0 fail each)

| profile | S1 idle z1 / z2 (target) | S2 idle | S3 idle | longest idle gap | to S1 boss | deaths / damage | ranks z1; z2 | paceMul S1 · S2 · S3 (z1) | `d28653f` p1 / p2 (S1 · S2 · S3) |
|---|---|---|---|---|---|---|---|---|---|
| 35 / .90 fresh | 15 / 12 % (not harder) | 11 / 9 % | 6 / 2 % | <= 0.57 s | 38 / 42 s | 0 / 0 | A A B; B A B | 1/1/1.35 · 1/1/1 · 1/1/1 | 10 / 11 · 14 / 9 · 3 / 3 % |
| 55 / .93 fresh | 16 / 13 % (<= 30) | 5 / 4 % | 12 / 7 % | <= 0.51 s | 35 / 36 s | 0 / 0 | A A A; S A B | 1/1/1.35 · 1.35/1.4/1.39 · 1.07/1.08/1.08 | 26 / 25 · 4 / 4 · 13 / 7 % |
| 80 / .97 fresh | 27 / 28 % (<= 30) | 12 / 8 % | 6 / 3 % | <= 0.55 s | 29 / 31 s | 0 / 0 | S S S; S S S | 1/1/1 · 1.35/1.7/1.97 · 1.62/1.59/1.63 | 29 / 26 · 9 / 6 · 2 / 5 % |
| 55 / .93 seeded | 7 / 3 % (<= 15) | 3 / 3 % | 12 / 11 % | <= 0.42 s | 38 / 47 s | 0 / 0 | S A A; A A S | 1.35/1.7/1.99 · 1.64/1.47/1.46 · 1.12/1.13/1.14 | 7 / 7 · 3 / 2 · 13 / 8 % |
| 80 / .97 seeded | 10 / 13 % (<= 15) | 6 / 4 % | 5 / 2 % | <= 0.42 s | 35 / 33 s | 0 / 0 | S S S; S S S | 1.35/1.7/2.05 · 2/1.99/2 · 1.65/1.61/1.61 | 6 / 13 · 8 / 5 · 4 / 5 % |

Every Q1 / R26 target holds in both rounds; no wave timed out, no wave damage. The 35 / .90 typist flies every S2 / S3
wave at the floor (one S3 W3 cap end, no leak); the 80 fresh S1 margin stays 27-28 % against 30 %.

### Z12 targets with `--acquire-ms 300` (latency matrix rounds acq300-z1 / z2: 21 pass / 1 fail, 22 pass / 0 fail)

| profile | S2-3 idle z1 / z2 | S2-3 waves timed out with 0 leaks | clock cuts S2-3 | PERFECT WAVE S2-3 | deaths | paceMul S2 · S3 | `d28653f` acq300 p1 / p2 S2-3 idle |
|---|---|---|---|---|---|---|---|
| 55 / .93 fresh | 8 / 4 %, 11 / 1 % | 0 | 0 of 4 | 3 3 3 3 | 0 | 1-1.04 · 1 (floor) | 9 / 7, 7 / 1 % |
| 55 / .93 seeded | 6 / 4 %, 6 / 2 % | 0 | 0 of 4 | 3 3 3 3 | 0 | 1-1.07 · 1 (floor) | 11 / 6, 9 / 6 % |
| 80 / .97 fresh | 8 / 11 %, 1 / 6 % | 0 | 0 of 4 | 3 3 3 3 | 0 | 1.25-1.37 · 1.07-1.16 | 3 / 6, 7 / 8 % |
| 80 / .97 seeded | 5 / 7 %, 6 / 9 % | 0 | 0 of 4 | 3 3 3 3 | 0 | 1.28-1.42 · 1.1-1.15 | 2 / 9, 9 / 7 % |
| 35 / .90 fresh | 7 / 1 %, 6 / 0 % | 0 | 0 of 4 | 3 3 3 3 | 0 | 1 (floor) · 1 (floor) | (Z13 table) |

The one failure is the 35 / .90 z1 run's Z13 line (S3 W3, 26 wave damage, above). Every Z12 target for 55 / 80 holds
in these 8 runs (2 per profile; the b10 latency runs of the Z12 section were not repeated): no S2 / S3 wave timed out
with 0 leaks, no clock cut, S2-3 idle 1-11 %, 0 deaths, PERFECT WAVE 3 everywhere.

## Training update follow-up: pace counts target acquisition (lead ruling Z12, `wt/pace-acq`)

Measured on 2026-10-25 on `wt/pace-acq` (training `fa540d0` = release `20261024b` plus the Z12 commits), headless
Chrome, DPR 1, 1440 x 900, two to six harness browsers at once (every typist paced by `game.playClock`; play / wall
clock 0.93-0.97 in every run below). The comparison rows ran the same probes (this branch's `b10.mjs`, copied into
`probes-t/` of an export) on `fa540d0` (release `20261024b`, "B-") and on live `a0a3845` (release `20261016a`,
"L-") in the same session. JSON: `out/b10/T-*.json` (this branch), `out/t-pace-balance/*-p1.json`, `*-p2.json`
(matrix rounds), `*-acq300-p1.json`, `*-acq300-p2.json` (latency matrix rounds); logs `out/acqlogs/`.

**What changed (BAL-2).** D2 paced from hand speed alone (intervals inside a target), so a typist that also spends
~330 ms finding each new target got a stream faster than it could clear: on `20261024b` the 300 ms typists at 55 / 80
WPM ran S2 at paceMul 1.35-2.5 and S3 at 1.5-2.3, the field filled to its caps and the sector clock cut the waves.
Z12: MEASURE (`32-typist.js`) measures the acquisition gap (from the moment the pilot's target ends by a kill, a
manual / lost release or a leak, while another lockable target is on the field, to the first correct key of the next
lock; 10 ms to 1.5 s; never in boss fights or the Flight Check), keeps a run EMA (alpha .1) and a lifetime EMA
(`profile.acqEma`, from the first run with 10 samples) and serves `typistAcquireMs()` = run EMA from 10 samples, else
lifetime, else 300 ms, clamped 120-900 ms. PACE (`42-pacing.js`) targets `clamp(0.85 x pilotCpsEff / targetCps, 1.0,
2.5)` with `pilotCpsEff = L / (L / pilotCps + acq / 1000)`, L = the sector's mean target length (`paceMeanLen`: the
quota-weighted chars per spawn of WORDS' mix, letters 1): S1 2.13, S2 2.56, S3 3.27, S4 4.25, S5 5.13, S6 5.51,
S7 6.57, S8 7.01, S9 7.92, S10 8.28. Safety net: a wave that times out with no leak lowers the next wave's target to
0.35 under the slower of that target and the timed-out wave's paceMul (floor 1.0; cleared at sector entry and on a
checkpoint restore), so under the step rule it runs 0.35 slower than the wave that timed out (review fix Z12-B3,
below). **No Z12 number changed**: alpha .1, 10 samples, default 300 ms and clamp 120-900 ms ship as ruled. With them
every Z12 target for the 55 / 80 profiles holds; the 35 / .90 latency target does **not** (review finding Z12-B1, open
for the lead: no Z12 number reaches it), and a stale high stored acquisition time slows a fast returning pilot for one
to two sectors (Z12-B2, open for the lead).

What the harness typists measure as acquisition (the gap includes the typist's own key interval, so a typist with no
latency still reads one interval plus the loop's few ms): no latency 196-218 ms at 80 WPM, 255-350 ms at 55, 400-455
ms at 35; with `--acquire-ms 300` (300 ms, 600 ms with probability .1, mean ~330) 510-590 ms at 80, 585-675 ms at 55,
690-860 ms at 35. A fresh pilot keeps the 300 ms default through most of S1 (the field is often empty when a plate
dies there, so samples are few: 7 in 45 s at 80 WPM) and reaches 10 samples early in S2.

### Release review of this branch (`b1712c1`): findings Z12-B1 / B2 / B3

Re-checked on 2026-10-25 on `wt/pace-acq`; each finding was reproduced on an export of `b1712c1` before any change
(play / wall 0.97 in every reproduction run).

- **Z12-B3 (low): fixed.** The safety net lowered the next wave's own target by 0.35, but the step rule then moved from
  the timed-out wave's paceMul toward that lowered target, so while the pace was still ramping (own target - 0.35 above
  the previous paceMul) the wave after a clean timeout ran faster than the one that timed out, with the escaped plates
  carried in. Reproduced with the review's probe (seeded 100 WPM lifetime, no stored acquisition, W1's cap forced with
  2 plates up and no leak): S2 W1 1.35 -> W2 1.70, S3 W1 1.35 -> W2 1.40. `paceBackoffTarget(target, prev)` now takes
  the 0.35 off the slower of the own target and the timed-out wave's pace (floor 1.0), so the unchanged step rule runs
  the back-off wave at prev - 0.35 (floor 1.0); the same probe now reads S2 1.35 -> 1.0 and S3 1.35 -> 1.0. New checks:
  `t-pace-math` 13 (961 prev / target pairs), `t-pace-stakes` 7a (S4 W1 1.35 -> W2 1.0, was 1.23) and 7d (a ramp
  above the floor: W1 1.70 -> W2 1.35, where the old rule gave 2.05). **The fix moves no balance number below**: in
  the 171 b10 / t-pace-balance result files of this branch's `out/`, the review's export and the reproductions, the
  back-off fired 5 times, each time after a wave at paceMul 1.0 with the lowered target at the floor, where the old
  and the new rule both give 1.0 (every back-off wave's recorded paceMul equals max(1, previous - 0.35)); a run without
  a back-off is untouched by the change.
- **Z12-B1 (medium): open, a lead decision.** "35 / .90 with latency: 0 damage S1-3 and not harder than live" is not
  met, and this file no longer claims it. Data, cause and the options are in the 35 / .90 section below.
- **Z12-B2 (low): open, a lead decision.** A stale high stored acquisition time (`profile.acqEma` 750-900 ms: a shared
  save, a slow earlier session) keeps a fast returning pilot's pace low for one to two sectors and misses the R26
  returning-pilot idle bounds. Data and the options are in "Stored acquisition time from another pilot" below.

### Z12 targets with `--acquire-ms 300` (55 / 80, fresh and seeded): b10 x 4 + latency matrix x 2 = 6 runs per profile

| profile | runs | S2-3 clock cuts | S2-3 waves timed out with 0 leaks | S2-3 idle (matrix) | deaths | PERFECT WAVE S2-3 | vs `20261024b` (B-, 2 runs) | vs live `a0a3845` (L-, 4 runs) |
|---|---|---|---|---|---|---|---|---|
| 55 / .93 fresh | 6 | 0 of 12 | 0 | 9 / 7 %, 7 / 1 % | 0 | 12 x 3 | cuts 2 of 4, 0-leak timeouts 2, PW 2 2 2 2 | cuts 0 of 8, PW 8 x 3 |
| 55 / .93 seeded | 6 | 0 of 12 | 0 | 11 / 6 %, 9 / 6 % | 0 | 12 x 3 | cuts 2 of 4, 0-leak timeouts 1, PW 1 3 2 3 | (live has no profile: the fresh runs) |
| 80 / .97 fresh | 6 | 0 of 12 | 0 | 3 / 6 %, 7 / 8 % | 0 | 12 x 3 | cuts 2 of 4, 0-leak timeouts 2, PW 3 1 3 1 | cuts 0 of 8, PW 8 x 3 |
| 80 / .97 seeded | 6 | 0 of 12 | 0 | 2 / 9 %, 9 / 7 % | 0 | 12 x 3 | cuts 3 of 4, 0-leak timeouts 0, PW 3 2 2 2 | (live: the fresh runs) |

Every Z12 target for the 55 / 80 profiles holds: no S2 / S3 wave timed out with 0 leaks (20261024b: 5 in 16 sectors), clock cuts 0 % of the 48
S2 / S3 sectors (target <= 15 %; 20261024b 9 of 16 = 56 %), S2-3 idle 1-11 % (<= 15 %), 0 deaths, and PERFECT WAVE 3 in
every S2 / S3 sector, the same as live (whose waves end at the table cap and, before D3, paid PERFECT WAVE on a timeout
too). The 300 ms typists now run S2 at paceMul 1.0-1.47 and S3 at 1.0-1.17 (they reach the S2 / S3 boss 10-30 s sooner
than on 20261024b, whose waves ran to the sector clock, and 5-20 s sooner than on live).

b10 with the latency (this branch "T-", 20261024b "B-", live "L-"; live's ranks come from its own gross-WPM rank):

| run set | runs | paceMul S2 | paceMul S3 | acq ms S2-3 | to boss S1 / S2 / S3 s | clock cuts S2-3 | timeouts S2-3 (0 leaks) | PERFECT WAVE S2-3 | deaths | damage per run | ranks S1-S3 per run | play / wall |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| T-w55-acq | 4 | 1.01-1.35 | 1 | 300-668 | 35-39 / 45-49 / 53-66 | 0 of 8 | 0 (0) | 3 3 3 3 3 3 3 3 | 0 | 0 0 0 0 | SAASSAAAAAAA | 0.96 |
| T-w55-seed-acq | 4 | 1-1.06 | 1 | 583-675 | 36-43 / 47-49 / 51-56 | 0 of 8 | 0 (0) | 3 3 3 3 3 3 3 3 | 0 | 0 0 0 0 | ASASAAASSASS | 0.95-0.96 |
| T-w80-acq | 4 | 1.31-1.39 | 1.09-1.16 | 300-574 | 33-37 / 41-51 / 52-55 | 0 of 8 | 0 (0) | 3 3 3 3 3 3 3 3 | 0 | 0 0 0 0 | SSSSSSSSSSSS | 0.95-0.96 |
| T-w80-seed-acq | 4 | 1.28-1.47 | 1.11-1.16 | 513-590 | 36-41 / 44-51 / 50-56 | 0 of 8 | 0 (0) | 3 3 3 3 3 3 3 3 | 0 | 0 0 0 0 | SSSSSSSSSSSS | 0.95 |
| B-w55-acq | 2 | 1.35-2.05 | 1.48-1.7 | - | 37-38 / 69-73 / 83 | 2 of 4 | 2 (2) | 2 2 2 2 | 0 | 0 0 | SASAAA | 0.96 |
| B-w55-seed-acq | 2 | 2.03-2.1 | 1.5-1.71 | - | 50-51 / 77 / 77-80 | 2 of 4 | 1 (1) | 1 3 2 3 | 0 | 0 0 | AASAAS | 0.95-0.96 |
| B-w80-acq | 2 | 1.35-2.4 | 2.21-2.34 | - | 31-39 / 50-68 / 83 | 2 of 4 | 2 (2) | 3 1 3 1 | 0 | 0 0 | SSSASS | 0.95-0.96 |
| B-w80-seed-acq | 2 | 2.4-2.5 | 2.19-2.3 | - | 45-46 / 76-77 / 83 | 3 of 4 | 0 (0) | 3 2 2 2 | 0 | 0 0 | SSSSSS | 0.95 |
| L-w55-acq | 4 | 1 | 1 | - | 53-58 / 59-63 / 70-73 | 0 of 8 | 0 (0) | 3 3 3 3 3 3 3 3 | 0 | 0 0 0 0 | AAAAABABBAAA | 0.97 |
| L-w80-acq | 4 | 1 | 1 | - | 53-58 / 59-61 / 67-69 | 0 of 8 | 0 (0) | 3 3 3 3 3 3 3 3 | 0 | 0 0 0 0 | ASASSASSASAA | 0.97 |

### 35 / .90 with `--acquire-ms 300` (Z12: 0 damage S1-3, not harder than live): not met (review Z12-B1; the lead ruled Z13, measured above)

| run set | runs | paceMul S2 | paceMul S3 | acq ms S2-3 | to boss S1 / S2 / S3 s | clock cuts S2-3 | timeouts S2-3 (0 leaks) | PERFECT WAVE S2-3 | deaths | damage per run | ranks S1-S3 per run | play / wall |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| T-w35-acq | 4 | 1 | 1 | 693-853 | 40-47 / 48-65 / 67-82 | 0 of 8 | 1 (1) | 3 2 3 3 3 3 3 3 | 0 | 0 0 0 0 | BABAAAAABABA | 0.97 |
| T-w35-seed-acq | 4 | 1 | 1 | 688-856 | 41-44 / 50-57 / 72-76 | 0 of 8 | 0 (0) | 3 3 3 3 3 3 3 3 | 0 | 0 0 0 0 | AABABBABABAB | 0.96-0.97 |
| B-w35-acq | 2 | 1.27-1.34 | 1 | - | 45 / 71-76 / 75-83 | 1 of 4 | 0 (0) | 3 2 3 3 | 0 | 0 0 | AAAAAA | 0.97 |
| L-w35-acq | 4 | 1 | 1 | - | 57-61 / 60-70 / 80-83 | 0 of 8 | 0 (0) | 3 3 3 3 3 3 3 3 | 0 | 0 14 14 0 | BBCBBCBCCABB | 0.97-0.98 |

**Not met; this branch does not claim it.** The profile's latency runs on this code (the Z12-B3 fix leaves every one
of them unchanged), S2 / S3 only (S1 had no damage, no timeout and PERFECT WAVE 3 in every run):

| run set | runs | S2 / S3 sectors | runs with wave damage | waves timed out with 0 leaks | clock cuts | PERFECT WAVE < 3 | deaths | paceMul |
|---|---|---|---|---|---|---|---|---|
| this branch, b10 fresh + seeded (table above) | 8 | 16 | 0 | 1 (S2 W3) | 0 | 1 | 0 | 1.0 |
| this branch, matrix p1 / p2 | 2 | 4 | 1 (p1 S3: 22) | 1 (p1 S3 W2) | 1 | 1 | 0 | 1.0 |
| review, b10 fresh r1-r6 | 6 | 12 | 1 (r6 S3: 24) | 1 (r1 S2 W3) | 1 | 2 | 0 | 1.0 |
| review, b10 seeded r1-r2 | 2 | 4 | 0 | 1 (r1 S3 W2) | 1 | 1 | 0 | 1.0 |
| review, matrix v1-v4 | 4 | 8 | 1 (v4 S3: 64) | 1 (v1 S3 W2) | 0 | 2 | 0 | 1.0 |
| reproduction `R-T-w35-acq300` r1-r2 (`b1712c1`) | 2 | 4 | 0 | 1 (r2 S3 W3) | 0 | 1 | 0 | 1.0 |
| **this code, all** | **24** | **48** | **3** | **6** | **3** | **8** | **0** | **1.0** |
| live `a0a3845` (this branch's 4 + the review's 6) | 10 | 20 | 0 | 0 | 1 | 1 | 0 | 1.0 |

The three damaging runs, all in S3 waves at paceMul 1.0: matrix p1 22 (W2 timed out with 1 escaped and no leak, W3
took it as +1 and leaked a word, the sector clock cut W3); review b10 r6 24 (W3 leaked 1, clock cut, PERFECT WAVE 2);
review matrix v4 64 (W3 timed out with 2 escaped after 3 leaks; no carry was involved). Live's only damage with this
typist is the S3 boss (14 in 2 of this branch's 4 L- runs; the review's r4 a 14-point surge), which is ARCADE, not the
waves. `20261024b` (S2 at paceMul 1.27-1.34): 0 damage in 2 runs, and the review's `V-B-w35-acq300-r2` had a 0-leak
timeout in S3 W3 (PERFECT WAVE 2). Without the latency the mechanism showed once too: the review's
`V-T-w35-nolat-r1` S3 W3 timed out with 1 escaped after 1 leak, 26 damage at paceMul 1.0 (1 of 6 runs of this code;
`20261024b` 0 of 3, live 0 of 2); this branch's 4 no-latency runs had none. The pilot reaches the bosses sooner than
on live (the S1 boss ~15 s, S2 / S3 up to 15 s), but in the waves this code is harder than live for this typist: wave
damage in 3 of 24 runs against 0 of 10, and "WAVE TIMED OUT · N ESCAPED" for a pilot who missed nothing in 6 of 48
sectors, where live's waves end silently at the table cap.

Why no Z12 number reaches it: with the latency this typist clears 1.45-1.66 cps (acquisition 716-900 ms) against a
floor stream (paceMul 1.0) of about 1.9-2.5 cps in S2 W3 and S3 (its target there is 0.85 x 1.6 / 2.3 = 0.6). Every S2 /
S3 wave of the profile runs at the 1.0 floor on this branch, as on live, and D2 never paces below 1.0, so neither the
formula nor the back-off (floor 1.0) has anything to lower. The difference from live is D3 / Z5: live's waves end at
the table cap and drop their backlog; here a floor wave is quota-boxed with the longer Z5 cap, so the backlog stays on
the field (leaks, damage) or leaves at the cap as a clean timeout and is carried into the next wave. The lead's
options (review Z12-B1):
(a) let D2 pace below 1.0 when pilotCpsEff < targetCps, limited to S2-3 and the campaign (changes D2's "never below
    1.0"; at 0.75 the S3 floor stream drops to about 1.4-1.9 cps);
(b) for floor-paced waves only, keep live's table cap as the wave length (no Z5 extension) and drop the carry (changes
    Z5 and the D3 carry for those waves);
(c) restate the target, e.g. "no wave damage in S1-2, S3 not worse than live".
Until one is decided, the 20261025a release notes and this file make no claim for the 35 / .90 latency target.

### Stored acquisition time from another pilot (review finding Z12-B2; the lead ruled Z14, measured above)

`typistAcquireMs()` serves the stored lifetime value (`profile.acqEma`) until the run has 10 acquisition samples, and a
sample exists only when another lockable target is up as the previous one ends (`typistAcqArm`). At paceMul 1.0-1.26
the S1 / S2 field is sparse, so a run collects 1-2 samples in S1 and about 5 in S2, and the stored value moves only
alpha .1 per sample. A stored value that is too high (750-900 ms: a shared save whose other pilot is slower, or a slow
earlier session; a slow pilot stores 740-900 in these runs) therefore holds a fast pilot's pace low for one to two
sectors. One that is too low corrects within a wave, because an over-paced field produces samples quickly.

Measured with the review's probe (`t-pace-balance` plus `--seed-acq`, which writes `profile.acqEma` into the R26
seeded fixture; no latency). Without a stored value the same fixture reads S1 7 %, S2 2-3 % idle (matrix above).

| profile | stored acqEma | run | S1 idle (returning <= 15 %) | S2 idle (<= 15 %) | S3 idle | acq ms PACE used S1 · S2 · S3 | paceMul S1 · S2 |
|---|---|---|---|---|---|---|---|
| 55 / .93 | 900 | review r1 | **27 %** | **19 %** | 10 % | 900/900/900 · 833/771/633 · 633/268/289 | 1.08 x3 · 1.0-1.01 |
| 55 / .93 | 900 | review r2 | **21 %** | **23 %** | 7 % | 900/776/776 · 634/634/561 · 561/248/268 | 1.08-1.2 · 1.01-1.07 |
| 55 / .93 | 900 | reproduction r1 (`b1712c1`) | **22 %** | **18 %** | 9 % | 900/900/900 · 637/568/568 · 267/279/283 | 1.08 x3 · 1.0-1.04 |
| 55 / .93 | 900 | reproduction r2 (`b1712c1`) | 10 % | 5 % | 8 % | 900/714/497 · 267/275/264 · 289/273/289 | 1.08-1.53 · 1.39-1.42 |
| 55 / .93 | 840 | review r1 | 12 % | 3 % | 7 % | 840/726/622 · ~290 · ~280 | 1.12-1.35 · 1.39-1.41 |
| 55 / .93 | 750 | review r1 / r2 | 12 % / **22 %** | 3 % / **20 %** | 8 % / 7 % | r2: 750/698/698 · 486/486/449 · ~260 | r2: 1.21-1.26 · 1.13-1.17 |
| 55 / .93 | 620 | review r1 / r2 | 4 % / 9 % | 3 % / 4 % | 9 % / 11 % | 620/458/264 · ~260 · ~280 | 1.35-1.92 · 1.43-1.57 |
| 80 / .97 | 900 | review r1 / r2 | **23 %** / **16 %** | 6 % / 10 % | 5 % / 5 % | 900/829/761 · ~200 · ~220 | 1.23-1.82 · 1.74-2.11 |
| 80 / .97 | 540 | review r1 / r2 | 14 % / 8 % | 6 % / 5 % | 3 % / 3 % | 540/446/337 · ~210 · ~210 | 1.35-2.05 · 2.04-2.1 |

Controls (review): a stored value that is too low, 120 ms, with `--acquire-ms 300` at 80 / .97 and `--acquire-ms 500` at
55 / .93, was corrected by S1 W2 (acq 531 / 869), with no timeout. No deaths, no damage in any of these runs; two more
reproduction runs (r3 / r4) were discarded because the machine slept under them (play / wall far below 0.9). Every
option changes a ruled Z12 rule or number, so none is applied here; the lead's options (review Z12-B2):
(1) before 10 samples, blend the run EMA into the lifetime value in proportion to the run's sample count instead of
    switching at 10;
(2) also sample the spawn-to-first-key gap when a plate arrives on an empty field (the gap's clock runs only while a
    lockable target is up), so the sparse S1 / S2 field still yields samples;
(3) cap the lifetime fallback's influence until 10 samples, e.g. min(lifetime, 300 + the run-sample-weighted run EMA).

### R26 / Q1 targets without latency (`t-pace-balance --matrix --parallel 2`, rounds p1 / p2, 20 pass / 0 fail each)

| profile | S1 idle p1 / p2 (target) | S2 idle | S3 idle | longest idle gap | to S1 boss | deaths / damage S1-3 | ranks S1-S3 p1; p2 | paceMul S1 · S2 · S3 (p1) | 20261024b g1 / g2 (S1 · S2 · S3 idle) |
|---|---|---|---|---|---|---|---|---|---|
| 35 / .90 fresh | 10 / 11 % (not harder) | 14 / 9 % | 3 / 3 % | <= 0.54 s | 40 / 41 s | 0 / 0 | A B B; A A B | 1/1/1.35 · 1/1/1 · 1/1/1 | 18 / 12 · 8 / 8 · 5 / 2 % |
| 55 / .93 fresh | 26 / 25 % (<= 30) | 4 / 4 % | 13 / 7 % | <= 0.55 s | 33 / 32 s | 0 / 0 | S A S; S A A | 1/1/1 · 1.35/1.45/1.44 · 1.11/1.12/1.14 | 28 / 24 · 6 / 2 · 1 / 3 % |
| 80 / .97 fresh | 29 / 26 % (<= 30) | 9 / 6 % | 2 / 5 % | <= 0.52 s | 26 / 29 s | 0 / 0 | S S S; S S S | 1/1/1 · 1.35/1.7/2.05 · 1.7/1.65/1.67 | 28 / 27 · 13 / 6 · 4 / 1 % |
| 55 / .93 seeded (51) | 7 / 7 % (<= 15) | 3 / 2 % | 13 / 8 % | <= 0.50 s | 43 / 40 s | 0 / 0 | A S S; A A A | 1.35/1.7/1.98 · 1.63/1.41/1.45 · 1.15/1.17/1.18 | 6 / 7 · 2 / 2 · 2 / 1 % |
| 80 / .97 seeded (78) | 6 / 13 % (<= 15) | 8 / 5 % | 4 / 5 % | <= 0.48 s | 41 / 33 s | 0 / 0 | S A S; S S S | 1.35/1.7/2.05 · 2.06/2.08/2.02 · 1.67/1.6/1.62 | 11 / 11 · 4 / 4 · 4 / 2 % |

Both rounds hold every R26 target with no timeout in any of the 30 sectors. The cost of Z12 for the no-latency
typists: S3 paceMul drops (55: 1.5-1.7 -> 1.1-1.18; 80: 2.2 -> 1.6-1.7) and **55 / .93 S3 idle rises to 7-13 %**
(20261024b 1-3 %), inside the 15 % target but the thinnest margin of the matrix. The formula counts one key interval
twice for a typist with no latency (its measured gap is one interval, and L / pilotCps already counts L of them for a
target that has L - 1), so pilotCpsEff reads the 55 WPM harness typist ~23 % below its real S3 throughput. None of the
Z12 numbers moves that (the gap is above the 120 ms clamp; alpha and the default do not change a converged EMA); if a
round misses, the lever is the formula (acq = gap - one interval), a lead decision. 35 / .90 runs S2 at 1.0 (was
1.23-1.35): easier than 20261024b. The 80 fresh S1 margin (26-29 % vs 30) is unchanged (paceMul 1.0 until the
20-interval run gate).

b10 without latency (fresh and seeded, `--expect` on the fresh runs: 35 / .90 4 pass / 0 fail, 55 / .93 7 / 0, 80 / .97
6 / 0):

| run set | runs | paceMul S2 | paceMul S3 | acq ms S2-3 | to boss S1 / S2 / S3 s | clock cuts S2-3 | timeouts S2-3 (0 leaks) | PERFECT WAVE S2-3 | deaths | damage per run | ranks S1-S3 per run | play / wall |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| T-w35-nolat | 1 | 1-1.03 | 1 | 300-440 | 35 / 44 / 61 | 0 of 2 | 0 (0) | 3 3 | 0 | 0 | AAA | 0.96 |
| T-w35-seed-nolat | 1 | 1 | 1 | 417-453 | 38 / 43 / 59 | 0 of 2 | 0 (0) | 3 3 | 0 | 0 | ASA | 0.96 |
| T-w55-nolat | 1 | 1.41-1.46 | 1.12-1.14 | 269-299 | 33 / 37 / 56 | 0 of 2 | 0 (0) | 3 3 | 0 | 0 | ASS | 0.95 |
| T-w55-seed-nolat | 1 | 1.4-1.51 | 1.11-1.14 | 282-350 | 33 / 38 / 55 | 0 of 2 | 0 (0) | 3 3 | 0 | 0 | AAA | 0.94-0.96 |
| T-w80-nolat | 1 | 1.35-2.03 | 1.62-1.68 | 207-300 | 26 / 38 / 42 | 0 of 2 | 0 (0) | 3 3 | 0 | 0 | ASS | 0.93-0.95 |
| T-w80-seed-nolat | 1 | 2.04-2.08 | 1.64-1.69 | 196-208 | 28 / 46 / 47 | 0 of 2 | 0 (0) | 3 3 | 0 | 0 | SSS | 0.93 |

### Other balance probes on this branch

- `b3`: 14 pass / 0 fail (55 / .93 reaches the S1 boss at 29.2 s; L5 W2 incomingCps at a pinned 1.0 = 1.37 x 3.7, inside
  -15 % / +50 %; alive never 0 for > 1.7 s in a spawn phase).
- `t-arcade-balance --parallel 2`: 16 pass / 0 fail (35 / .90 0 surge damage in S1-3, S2 / S3 windows 5.2 / 4.27 s vs
  table 2.88 / 2.38; 55 / .93 S10 jump victory, min hull 28.9 %, 7 / 7 surges countered; 80 / .97 S8-10 2 / 3 / 4 surges
  started, all countered, S10 time bonus 0 <= accuracy 4,000). In those S8-10 jumps the 55 / 80 profiles were already at
  the 1.0 floor before Z12 (0.85 x pilotCps under the table) and stay there; the 25 / 35 / 55 stakes runs of the rulings
  section flew every wave at 1.0 too, so neither moves. The 80 WPM pilot in S4-7 was above the floor (S5 ~1.4 before)
  and now reads lower: `b10 --wpm 80 --accuracy .97 --jump 4 --sectors 3` (fresh save) runs S4 1 / 1.23 / 1.39, S5
  1.12-1.14, S6 1.0-1.01 (acquisition 181-217 ms), every wave by quota, PERFECT WAVE 3 / 3 / 3, 0 damage, rank S x3;
  with `--acquire-ms 300` every wave at 1.0 (acquisition 523-604 ms), the same 3 / 3 / 3, 0 damage, rank S x3, no
  clock cut (`out/b10/T-w80-j4*.json`).

## Training update: lead rulings Z1-Z9 (`wt/rulings`), re-pass on the rulings tree

Release `20261024b` ships exactly these constants: training merges `wt/rulings` at `1068fd6` and nothing after it
changes a balance number (the Z11 prefetch deferral and the copy pass touch no tuning).

Measured on 2026-10-24 on `wt/rulings` (training `f02b983` + the ruling commits; the constants are final from `5d111f6`),
headless Chrome, DPR 1, 1440 x 900, two to eight harness browsers at once plus other agents' browsers (load average
4-17 on 16 cores; every typist is paced by `game.playClock`, b10 play / wall clock 0.93-0.97). These are the reference
numbers; the merged-tree re-pass below is their history. JSON: `out/t-pace-balance/*-g1.json`, `*-g2.json` (matrix),
`*-acq300-g.json` (latency matrix), `stakes-*.json`; `out/b10/final-*.json`, `lat-*.json`; `out/t-arcade-balance/
summary.json`; the earlier rounds at the two intermediate `fairMul` values in `out/pre-fairmul-1.5/`, `pre-fairmul-1.75/`.

What changed for balance (no PACE knob changed; one ARCADE constant from the rulings retuned twice):
- **Z5 wave caps** (`42-pacing.js`): a paced wave's cap = max(table cap, stream delivery of its quota at the applied
  spawn rate x 1.25 + 4 s). W1 stays at the table everywhere, W2 gains 0-1.5 s, W3 6-13 s (S1 W3 22 -> 32.7 s, S5 W3
  30 -> 43.1 s, S10 W3 40 -> 48.5 s at paceMul 1; delivery barely moves with paceMul because quota and rate scale
  together). The cap times a wave out only with plates alive (an empty field lifts it) and a timeout's N plates leave
  the field. A sector's three deliveries stay >= 12 s under its duration at every paceMul, so the sector clock never
  cuts a pilot who keeps up.
- **Z6 surge windows** (`50-boss.js`, `COUNTER_SIGNAL.fairMul` / `fairWpm`): a surge charges for max(table window,
  fairMul x chars x 12 / hand WPM), hand = run speed, else lifetime, else 30 WPM. **fairMul 2.25** (the ruling's floor
  is 1.5; retune below).
- **Z2 Overdrive** (a fresh pilot's provisional 25 WPM threshold refreshes with charge / in Overdrive): score only.
- **Z7 harness**: an optional target-acquisition latency (section "Acquisition latency" below); default typists unchanged.

### R26 / Q1 targets (`t-pace-balance --matrix --parallel 2`, rounds g1 / g2 on the final tree, 20 pass / 0 fail each)

| profile | S1 idle g1 / g2 (target) | S2 idle | S3 idle | longest idle gap | to S1 boss | deaths / damage S1-3 | min hull S1-3 | rank S1-S3 g1; g2 | hand WPM | timeouts | paceMul S1 · S2 · S3 (g1) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 35 / .90 fresh | 18 / 12 % (not harder) | 8 / 8 % | 5 / 2 % | <= 0.53 s | 39 / 42 s | 0 / 0; 0 / 0 | 100 % | B B B; A A B | 29-33 | none | 1/1/1 · 1.23/1.25/1.24 · 1/1/1 |
| 55 / .93 fresh | 28 / 24 % (<= 30) | 6 / 2 % | 1 / 3 % | <= 0.55 s | 30 / 32 s | 0 / 0; 0 / 0 | 100 % | S A S; A S A | 49-52 | none | 1/1/1 · 1.35/1.7/2.05 · 1.7/1.52/1.52 |
| 80 / .97 fresh | 28 / 27 % (<= 30) | 13 / 6 % | 4 / 1 % | <= 0.58 s | 29 / 31 s | 0 / 0; 0 / 0 | 100 % | S S S; S S S | 73-76 | none | 1/1/1 · 1.35/1.7/2.05 · 2.25/2.25/2.25 |
| 55 / .93 seeded (51) | 6 / 7 % (<= 15) | 2 / 2 % | 2 / 1 % | <= 0.50 s | 42 / 39 s | 0 / 0; 0 / 0 | 100 % | A A A; S S A | 49-50 | none | 1.35/1.7/2.05 · 2.06/2.04/2.07 · 1.72/1.51/1.51 |
| 80 / .97 seeded (78) | 11 / 11 % (<= 15) | 4 / 4 % | 4 / 2 % | <= 0.58 s | 34 / 32 s | 0 / 0; 0 / 0 | 100 % | S S S; S S S | 70-74 | none | 1.35/1.7/2.05 · 2.4/2.5/2.5 · 2.19/2.2/2.21 |

All six matrix rounds on this branch (r1 / r2 at fairMul 1.5, f1 / f2 at 1.75, g1 / g2 at 2.25) held every target and
**no wave timed out in any of the 90 sector runs** (the merged-tree re-pass had four 0-escaped wave-3 timeouts). S1 idle
over the six rounds: 35 fresh 9-18 %, 55 fresh 15-28 %, 80 fresh 20-28 %, 55 seeded 5-8 %, 80 seeded 7-12 %; S2-3 at
most 13 % for every 55 / 80 run. The thin margins are unchanged in kind: **80 fresh S1** (20-28 % vs 30; paceMul 1.0
until the 20-interval run gate) and now also **55 fresh S1** (15-28 % vs 30).

### Z6 surge fairness: the fairMul retune (one constant, two steps)

| fairMul | 35 / .90 S1-3 surge damage (runs) | 35 / .90 with 300 ms latency | 55 / .93 S10 jump | 80 / .97 S8-10 jump (started / countered, window / table, window / own time) |
|---|---|---|---|---|
| 1.5 (ruling floor) | 14 in 1 of 4 runs (t-arcade-balance S3: 5 chars, window 2.96 s for a 1.98 s segment, a minion and misses inside) | not run | 7 / 4 / 3 fired, 84 surge damage, min hull 45.5 % | 10 / 10, 1.06, 1.61 |
| 1.75 | 0 in 4 runs (matrix f1 / f2, b10, t-arcade-balance) | **14 (an S3 surge) in 2 of 2 runs** | 7 / 7 / 0, min hull 40 % | 10 / 10, 1.25, 1.75 |
| **2.25 (shipped)** | **0 in 4 runs** (matrix g1 / g2, b10, t-arcade-balance) | 0 surge damage in 2 of 2 runs (b10 lat took 14 from a wave leak, below) | **7 / 7 / 0, min hull 30.7 %** | **11 / 11, 1.46, 2.25** |

Scratch S3 boss-fight runs of the 35 / .90 typist (window function overridden in the page; `out/z6exp`, git-ignored):
no latency 1.5: 1 of 12 surges fired (slack down to 0 s), 1.75: 0 of 13 (slack >= 1.23 s); with the 300 ms latency
1.75: 3 of 24, 2.0: 3 of 24, 2.25: 0 of 24. Every fired surge had a minion on the field (the typist shoots minions past
the danger line first), 1-4 misses and the re-acquisition of the boss word. Z6 targets on the final tree
(`t-arcade-balance`, 16 pass / 0 fail): 35 / .90 0 surge damage S1-3; 55 / .93 S10 min hull 30.7 % (>= 15); 80 / .97
meets real surges in S8-10 (3 / 3 / 5 started, all countered). **For the lead:** at 2.25 a fast pilot's windows are
1.2-1.6 x the table (the 80 WPM pilot needs ~45 % of its own speed to counter), so S8-10 surges are real but easy for
it; the ruling's 1.5 keeps them near the table (1.06) but fails the 35 WPM targets. A boss-word-first typist policy
during a surge (what the tip asks for) would likely pass at a lower fairMul; not changed (harness realism, not a knob).

### Counter-Signal on the final tree (`t-arcade-balance`, 16 pass / 0 fail, `out/t-arcade-balance/summary.json`)

| profile | S | outcome | boss s | surges started / countered / fired | surge dmg | min HP | mean window / table / own time s | rank | WPM |
|---|---|---|---|---|---|---|---|---|---|
| 35 / .90 | 1 | clear | 11.9 | 0 / 0 / 0 | 0 | 100 % | - | A | 32 |
| 35 / .90 | 2 | clear | 22.2 | 1 / 1 / 0 | 0 | 100 % | 5.16 / 2.88 / 2.29 | B | 31 |
| 35 / .90 | 3 | clear | 31.1 | 1 / 1 / 0 | 0 | 100 % | 4.29 / 2.38 / 1.90 | A | 31 |
| 55 / .93 | 1 | clear | 6.7 | 0 / 0 / 0 | 0 | 100 % | - | S | 52 |
| 55 / .93 | 2 | clear | 12.8 | 1 / 1 / 0 | 0 | 100 % | 2.72 / 2.10 / 1.21 | A | 49 |
| 55 / .93 | 3 | clear | 17.2 | 1 / 1 / 0 | 0 | 100 % | 2.69 / 1.99 / 1.20 | A | 51 |
| 80 / .97 | 1 | clear | 5.3 | 0 / 0 / 0 | 0 | 100 % | - | S | 74 |
| 80 / .97 | 2 | clear | 9.0 | 1 / 1 / 0 | 0 | 100 % | 1.80 / 1.80 / 0.67 | S | 71 |
| 80 / .97 | 3 | clear | 11.6 | 1 / 1 / 0 | 0 | 100 % | 2.26 / 2.26 / 0.99 | S | 72 |
| 55 / .93 | 10 (jump) | victory | 72.1 | 7 / 7 / 0 | 0 | 30.7 % | 3.79 / 1.41 / 1.68 | B | 48 |
| 80 / .97 | 10 (jump) | victory | 45.2 | 5 / 5 / 0 | 0 | 100 % | 2.24 / 1.32 / 0.99 | S | 72 |
| 80 / .97 | 8 (jump, 3 sectors) | clear | 30.8 | 3 / 3 / 0 | 0 | 100 % | 2.11 / 1.53 / 0.94 | S | 72 |
| 80 / .97 | 9 | clear | 33.2 | 3 / 3 / 0 | 0 | 100 % | 2.33 / 1.50 / 1.03 | S | 75 |
| 80 / .97 | 10 | victory | 44.3 | 5 / 5 / 0 | 0 | 97.3 % | 1.76 / 1.18 / 0.78 | S | 74 |

Every S2-3 fight starts exactly one surge (Z1: a phase clear keeps the cadence), S1 never surges, no fight fires more
than 2 per phase, 80 / .97 S10 counters 5 / 5 with the time bonus 0 <= accuracy 4,000 (par). The 55 / .93 S10 min hull
moved 45.5 -> 40 -> 30.7 % across the three runs while its surge damage went 84 -> 0 -> 0: the rest is minion and wave
damage, run-to-run variance (merged tree 8 %, ARCADE branch 20-41 %).

### b10 on the final tree (fresh save, sectors 1-3, `--expect`; `out/b10/final-*.json`)

`--expect`: 35 / .90 4 pass / 0 fail, 55 / .93 7 / 0 (S1 boss at 32.2 s, band, counters 2 / 2), 80 / .97 6 / 0 (longest
idle gap 0.5 s, rank S x3). b3 on the final tree: 14 / 0 (55 / .93 reaches the S1 boss at 30.1 s; L5 W2 incomingCps at a
pinned 1.0 = 1.36 x 3.7, inside -15 % / +50 %; alive never 0 for > 1.7 s in a spawn phase).

| profile | S | outcome | to boss s | boss s | min HP | dmg | idle max s w1/w2/w3 | surges s/c/f | window / table s | rank | WPM | acc | paceMul w1/w2/w3 | timed out | clock |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 35 / .90 | 1 | clear | 40.7 | 12.1 | 100 % | 0 | 0.28/0.40/0 | 0/0/0 | - | A | 32 | 90.8 | 1/1/1.35 | no/no/no | 0.96 |
| 35 / .90 | 2 | clear | 61.8 | 18.0 | 100 % | 0 | 0.43/0.37/0.28 | 1/1/0 | 3.48 / 2.16 | A | 31 | 91.0 | 1.32/1.29/1.31 | no/no/no | 0.96 |
| 35 / .90 | 3 | clear | 69.6 | 29.6 | 100 % | 0 | 0.40/0.07/0 | 1/1/0 | 6.04 / 3.05 | A | 32 | 90.2 | 1/1/1 | no/no/no | 0.97 |
| 55 / .93 | 1 | clear | 32.2 | 7.7 | 100 % | 0 | 0.32/0.40/0.38 | 0/0/0 | - | S | 50 | 95.8 | 1/1/1 | no/no/no | 0.95 |
| 55 / .93 | 2 | clear | 53.0 | 12.0 | 100 % | 0 | 0.42/0.27/0.28 | 1/1/0 | 3.24 / 2.40 | S | 51 | 95.1 | 1.35/1.7/2.05 | no/no/no | 0.94 |
| 55 / .93 | 3 | clear | 61.7 | 18.5 | 100 % | 0 | 0.38/0.35/0 | 1/1/0 | 3.79 / 2.54 | A | 49 | 90.8 | 1.7/1.55/1.56 | no/no/no | 0.95 |
| 80 / .97 | 1 | clear | 27.4 | 4.6 | 100 % | 0 | 0.50/0.42/0.40 | 0/0/0 | - | S | 74 | 99.0 | 1/1/1 | no/no/no | 0.95 |
| 80 / .97 | 2 | clear | 34.6 | 8.6 | 100 % | 0 | 0.33/0.27/0.33 | 1/1/0 | 2.40 / 2.40 | S | 73 | 96.6 | 1.35/1.7/2.05 | no/no/no | 0.94 |
| 80 / .97 | 3 | clear | 58.7 | 11.3 | 100 % | 0 | 0.30/0.23/0.33 | 1/1/0 | 2.55 / 2.54 | S | 75 | 98.5 | 2.26/2.27/2.28 | no/no/no | 0.93 |

### Acquisition latency (lead ruling Z7; `--acquire-ms 300`: 300 ms, 600 ms with probability .1, before the first key of every new target)

The harness typists key every interval with no time to find the next plate, while D2 sets the stream from hand speed
(intervals inside a target only), so the numbers above are optimistic for humans. With the latency the typist waited
before the first key of 39-107 targets per sector (mean 314-340 ms; plates, capsules, minions and boss words, on top of
the key interval). Z7: idle is reported only; deaths and damage targets still apply.

`t-pace-balance --matrix --acquire-ms 300 --tag g` (fairMul 2.25), 5 / 5 profiles exit 0:

| profile | S1 / S2 / S3 idle | longest idle gap | to S1 boss | deaths / damage S1-3 | min hull | rank | hand WPM | timeouts (escaped) |
|---|---|---|---|---|---|---|---|---|
| 35 / .90 fresh | 8 / 1 / 1 % | 0.53 s | 57 s | 0 / 0 | 100 % | A A A | 31-33 | none |
| 55 / .93 fresh | 8 / 1 / 1 % | 0.49 s | 47 s | 0 / 0 | 100 % | A A A | 47-49 | none |
| 80 / .97 fresh | 14 / 1 / 0 % | 0.52 s | 39 s | 0 / 0 | 100 % | S S S | 71-74 | none |
| 55 / .93 seeded | 3 / 1 / 1 % | 0.43 s | 55 s | 0 / 0 | 100 % | A A S | 48-51 | S2 W2 (3) |
| 80 / .97 seeded | 2 / 2 / 1 % | 0.38 s | 43 s | 0 / 0 | 100 % | S S S | 71-73 | none |

b10 with the latency (`out/b10/lat-*.json`):

| profile | S | outcome | to boss s | boss s | min HP | dmg | surges s/c/f | rank | WPM | acc | paceMul w1/w2/w3 | timed out (escaped) | delivery / (target x mul) w1/w2/w3 | acquisitions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 35 / .90 | 1 | clear | 47.7 | 14.4 | 100 % | 0 | 0/0/0 | B | 30 | 88.1 | 1/1/1 | no/no/no | 1.31/1.35/1.54 | 42 |
| 35 / .90 | 2 | clear | 69.3 | 30.2 | 100 % | 0 | 1/1/0 | B | 29 | 87.4 | 1.27/1.27/1.23 | no/no/no | 0.75/0.85/0.89 | 63 |
| 35 / .90 | 3 | clear | 71.7 | 33.5 | 96.5 % | **14 (wave leak)** | 2/2/0 | B | 30 | 89.7 | 1/1/1 | W3 (3) | 0.70/0.79/1.01 | 63 |
| 55 / .93 | 1 | clear | 37.6 | 9.9 | 100 % | 0 | 0/0/0 | A | 51 | 91.9 | 1/1/1 | no/no/no | 1.29/1.50/1.66 | 39 |
| 55 / .93 | 2 | clear | 64.3 | 16.0 | 100 % | 0 | 1/1/0 | A | 49 | 93.2 | 1.35/1.7/2.05 | W3 (2) | 0.93/1.09/0.90 | 67 |
| 55 / .93 | 3 | clear | 82.6 | 23.0 | 100 % | 0 | 1/1/0 | A | 50 | 93.8 | 1.7/1.54/1.55 | W2 (1) | 0.68/0.89/1.07 | 83 |
| 80 / .97 | 1 | clear | 37.3 | 7.1 | 100 % | 0 | 0/0/0 | S | 73 | 95.3 | 1/1/1.35 | no/no/no | 1.58/1.50/1.78 | 44 |
| 80 / .97 | 2 | clear | 71.7 | 12.6 | 100 % | 0 | 1/1/0 | S | 73 | 97.3 | 1.7/2.05/2.4 | no/no/no | 1.01/1.07/0.93 | 87 |
| 80 / .97 | 3 | clear | 82.6 | 17.6 | 100 % | 0 | 1/1/0 | S | 70 | 95.7 | 2.24/2.23/2.2 | W2 (4) | 0.60/0.84/0.91 | 107 |

`--expect` with latency: 35 / .90 4 / 0, 80 / .97 6 / 0, 55 / .93 6 / 1 (b10's delivery band: S3 W1 delivered 0.68 x
target x paceMul; not a Q1 target). What the latency shows:
- **Idle drops** (S1 2-14 %, S2-3 0-2 %): the typist spends the acquisition on screen time instead of an empty field.
- **Deaths: 0 in all 8 latency runs. Damage: 0 except the b10 35 / .90 S3 run (14, one letter leak)** in wave 3 at
  paceMul 1.0, which then timed out with 3 escaped: with the latency that pilot's throughput (hand 30 WPM, ~25 WPM with
  the acquisitions) is below sector 3's table stream (W3 = 1.1 x 27.6 WPM). The lever is not a ruling constant: D2
  never paces below 1.0 and Z5's caps are binding (the longer wave-3 cap keeps the backlog on the field longer). The
  latency matrix's 35 / .90 run took 0 damage. At fairMul 1.75 both latency runs lost an S3 surge instead (retune above).
- **paceMul overshoots a latency-bound pilot**: pace follows hand speed (intervals inside a target), so at paceMul
  1.5-2.4 the stream outruns a typist that also spends ~330 ms per target: the field fills to its caps (delivery 0.6-0.9
  x the paced target from S2) and waves 2-3 sometimes time out (1-4 escaped), with no damage. If human playtests confirm
  it, D2's pilotCps could subtract a per-target acquisition time (lead decision; not changed here: lead ruling Z12 did
  it, see the follow-up section at the top).

### Stakes (D3 + Z5) on the final tree, seeded profile, sector jump then consecutive sectors, one retry allowed (none used)

| profile | sector: hull in (card) -> damage, min hull, wave timeouts (escaped), carry, rank |
|---|---|
| 25 / .85 from S3 | S3 400/400 -> 0, 100 %; S4 500/500 -> 198, 60.4 %, W2 (4), carry +4; S5 **481/600** -> 268, 35.5 %, W1 (6) W2 (7), carry +6 +7; S6 **474/700** -> 394, **11.4 %**, W1 (3) W2 (8), carry +3 +8; all waves 1.0, rank C / D / D / D, 0 deaths |
| 35 / .90 from S4 | S4 500/500 -> 26, 94.8 %; S5 **584/600** -> 176, 68 %, W2 (1), carry +1; S6 **588/700** -> 292, 42.3 %, W1 (3) W2 (6), carry +3 +6; S7 **629/800** -> 494, **16.9 %**, W1 (5) W2 (7), carry +5 +7; all waves 1.0, rank B / C / C / C, 0 deaths |
| 55 / .93 from S7 | S7 800/800 -> 176, 78 %; S8 **869/900** -> 176, 77 %; S9 **885/1000** -> 454, 43.1 %, W2 (1) W3 (5), carry +1; S10 **787/1100** -> 724, **5.7 %**, W1 (1) W2 (6), carry +1 +6, victory; all waves 1.0, rank B / A / B / B, 0 deaths |

Against the merged tree: the struggling pilots' timeouts now always carry real escapes (1-8 per wave; the merged tree
had several with 0) and the bigger carries plus the longer wave-3 caps lower the low points: 25 / .85 S6 19.9 -> 11.4 %,
35 / .90 S7 27.4 -> 16.9 %, 55 / .93 S10 8.5 -> 5.7 %. Nobody died (no Cadet offer). Not a Q1 / Z target; for the lead:
if S6-7 / S10 become walls in human play, the Cadet offer is the designed release; the escaped carry itself is uncapped
(every escaped plate joins the next wave's quota, waves 1-2 only).

## Training update: pace re-pass on the merged tree (WORDS + ARCADE + PACE)

Superseded by the rulings re-pass above; kept as the merged tree's history.


Measured on 2026-10-24 on `training` at `9b39599` (Merge PACE, on Merge ARCADE `ea12b33` and Merge WORDS `6a0ee81`),
headless Chrome, DPR 1, 1440 x 900, one balance browser at a time with other agents' browsers on the machine (every
typist is paced by `game.playClock`; b10 play / wall clock 0.93-0.96). These are the reference numbers; the `wt/pace`
section below is the branch's history. WORDS' exact cps (W7) and two-word plates and ARCADE's Counter-Signal (surges
from S2), par and surge damage are in every run.

**No constant changed in the re-pass.** Shipped: spec-pace 1 with `PACE.hungryMin2AtMul` 1.35 (the PACE branch's knob),
`HUNGRY_SPAWN_S` 0.1, `SPAWN_ROLLIN_PX` [10, 30]. Every R26 / Q1 target held in both matrix rounds and in b10 except one
damage line: in round 1 the 35 / .90 pilot took 12 hull in the S2 boss from one uncountered Counter-Signal surge
(`DAMAGE.surge(2)` = 12, ARCADE D10). No PACE knob reaches a boss fight (D2: boss pressure is ARCADE's) and the D10
window numbers are a lead decision, so it is reported, not retuned. The same profile met 0 deaths / 0 damage / rank >= B
in the other three merged-tree runs (matrix round 2, b10, t-arcade-balance with 2 / 2 surges countered), and ARCADE's own
pre-merge run had the same kind of hit (S3, 14 hull).

### R26 / Q1 targets (`t-pace-balance --matrix --parallel 1`, two rounds; JSON in `out/t-pace-balance/merged-r1/`, `merged-r2/`)

Round 1 exit 1 (19 pass / 1 fail: `w35-fresh: not made harder in S1-3`, S2 dmg 12), round 2 exit 0 (20 pass / 0 fail).

| profile | S1 idle r1 / r2 (target) | S2 idle r1 / r2 | S3 idle r1 / r2 | longest idle gap | to S1 boss r1 / r2 | deaths / damage S1-3 | min hull S1-3 | rank S1-S3 r1; r2 | hand WPM | paceMul S1 · S2 · S3 (r1) |
|---|---|---|---|---|---|---|---|---|---|---|
| 35 / .90 fresh | 6 / 12 % (not harder) | 5 / 3 % | 3 / 4 % | <= 0.50 s | 51 / 42 s | 0 / **12 (r1 S2, one surge)**; r2 0 / 0 | 96 % (r1 S2), else 100 % | A B B; A A A | 30-32 | 1/1/1.35 · 1.31/1.30/1.29 · 1/1/1 |
| 55 / .93 fresh | 12 / 25 % (<= 30) | 4 / 3 % | 1 / 1 % | <= 0.52 s | 39 / 30 s | 0 / 0 | 100 % | A S S; B S A | 44-51 | 1/1/1.35 · 1.70/2.05/2.09 · 1.74/1.53/1.53 |
| 80 / .97 fresh | 28 / 18 % (<= 30) | 9 / 11 % | 1 / 1 % | <= 0.55 s | 30 / 32 s | 0 / 0 | 100 % | S S S; S S S | 72-75 | 1/1/1 · 1.35/1.70/2.05 · 2.27/2.28/2.28 |
| 55 / .93 seeded (51) | 5 / 2 % (<= 15) | 4 / 3 % | 3 / 1 % | <= 0.43 s | 45 / 49 s | 0 / 0 | 100 % | B S A; A S A | 45-51 | 1.35/1.70/2.05 · 1.88/1.92/1.96 · 1.61/1.47/1.47 |
| 80 / .97 seeded (78) | 7 / 12 % (<= 15) | 5 / 8 % | 5 / 1 % | <= 0.43 s | 37 / 33 s | 0 / 0 | 100 % | S S S; S S S | 72-74 | 1.35/1.70/2.05 · 2.40/2.50/2.50 · 2.23/2.24/2.26 |

Against the branch (`wt/pace` round 4 and its knob runs): 80 fresh S1 28 / 18 % (branch 25-29 %), 80 seeded S1 7 / 12 %
(8-15 %), 55 fresh S1 12 / 25 % (5-24 %), S2-3 at most 11 % for every 55 / 80 run. The two thin margins stay where the
branch put them: 80 fresh S1 (bound by the 20-interval run gate at paceMul 1.0) and 80 seeded S1. Wave-3 timeouts with
0 escaped (the cap issue in the PACE hand-off) appeared in r1 35 S2 / S3, r1 55 seeded S2 and r2 55 fresh S3.

### b10 on the merged tree (three profiles, fresh save, sectors 1-3, `--expect`; JSON `out/b10/merged-*.json`)

`--expect` lines: 35 / .90 4 pass / 0 fail (clears S1, reaches the S2 boss in 46.5 s, boss leaks, page errors), 55 / .93
7 / 0 (S1 boss at 31 s, no death, min HP 100 %, delivery / stream band, counters >= 70 %, boss leaks, page errors),
80 / .97 6 / 0 (longest idle gap 0.45 s, rank S in S1-3, boss leaks, page errors). b3 on the merged tree: 14 / 0 (55 / .93
reaches the S1 boss at 28.8 s; L5 W2 incomingCps at a pinned 1.0 = 1.22 x 3.7, inside -15 % / +50 %).

#### merged-w35-s1-3 — 35 WPM / 0.9 accuracy, minion policy danger, fresh save

| S | outcome | to boss s | boss s | min HP | wave leaks/min | boss leaks/min (per phase) | cps ratio w1/w2/w3 | hungry spawns w1/w2/w3 | idle max s w1/w2/w3 | surges f/c | rank (shipped / level-aware) | WPM (nominal) | acc | dmg | tally | clock | paceMul w1/w2/w3 | quota | cps / (target x mul), all / stream | timed out (escaped) | hull in | throughput |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | clear | 40.1 | 11.1 | 100 % | 0 | 0 (0/0/0) | 1.91/1.85/1.51 | 7/8 10/10 9/12 | 0.53/0.38/0.45 | 0/0 | A / A | 32.6 (14.4) | 94.1 | 0 | 2917 | 0.96 | 1/1/1 | 8/10/12 | 1.91/0.17 1.85/0 1.51/0.46 | no/no/no | 200/200 | 27 |
| 2 | clear | 46.5 | 24.7 | 100 % | 0 | 0 (0/0/0) | 1.55/3.90/1.46 | 9/14 14/16 9/19 | 0.42/0.03/0 | 1/0 | A / A | 31.1 (20.4) | 90.2 | 0 | 3966 | 0.96 | 1.35/1.35/1.36 | 14/16/19 | 1.15/0.24 2.89/0.29 1.07/0.63 | no/no/no | 300/300 | 30 |
| 3 | clear | 61.1 | 29.7 | 100 % | 0 | 0 (0/0/0) | 1.17/0.90/1.08 | 3/12 10/14 5/16 | 0.28/0/0.10 | 0/1 | A / A | 32.0 (27.6) | 92.1 | 0 | 4848 | 0.96 | 1.01/1/1 | 12/14/16 | 1.16/0.90 0.90/0.32 1.08/0.66 | no/no/no | 400/400 | 31 |

#### merged-w55-s1-3 — 55 WPM / 0.93 accuracy, minion policy danger, fresh save

| S | outcome | to boss s | boss s | min HP | wave leaks/min | boss leaks/min (per phase) | cps ratio w1/w2/w3 | hungry spawns w1/w2/w3 | idle max s w1/w2/w3 | surges f/c | rank (shipped / level-aware) | WPM (nominal) | acc | dmg | tally | clock | paceMul w1/w2/w3 | quota | cps / (target x mul), all / stream | timed out (escaped) | hull in | throughput |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | clear | 31 | 6.9 | 100 % | 0 | 0 (0/0/0) | 1.66/1.62/2.83 | 7/8 9/10 11/12 | 0.48/0.40/0.42 | 0/0 | B / B | 48.2 (14.4) | 88.2 | 0 | 2825 | 0.95 | 1/1/1 | 8/10/12 | 1.66/0.15 1.62/0.12 2.83/0.33 | no/no/no | 200/200 | 32 |
| 2 | clear | 45 | 13.3 | 100 % | 0 | 0 (0/0/0) | 2.31/2.25/3.22 | 11/14 11/20 12/28 | 0.35/0.33/0.07 | 0/1 | A / A | 49.6 (20.4) | 91.4 | 0 | 4537 | 0.95 | 1.35/1.70/2.02 | 14/20/28 | 1.71/0.63 1.32/0.46 1.59/0.75 | no/no/no | 300/300 | 45 |
| 3 | clear | 61.5 | 15.1 | 100 % | 0 | 0 (0/0/0) | 1.72/1.92/1.74 | 2/20 9/21 10/24 | 0.22/0/0 | 0/1 | S / S | 51.0 (27.6) | 95.4 | 0 | 6547 | 0.95 | 1.67/1.51/1.53 | 20/21/24 | 1.03/0.86 1.27/0.82 1.14/0.70 | no/no/no | 400/400 | 50 |

#### merged-w80-s1-3 — 80 WPM / 0.97 accuracy, minion policy danger, fresh save

| S | outcome | to boss s | boss s | min HP | wave leaks/min | boss leaks/min (per phase) | cps ratio w1/w2/w3 | hungry spawns w1/w2/w3 | idle max s w1/w2/w3 | surges f/c | rank (shipped / level-aware) | WPM (nominal) | acc | dmg | tally | clock | paceMul w1/w2/w3 | quota | cps / (target x mul), all / stream | timed out (escaped) | hull in | throughput |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | clear | 28.2 | 4.7 | 100 % | 0 | 0 (0/0/0) | 2.17/2.89/4.15 | 8/8 10/10 16/16 | 0.45/0.40/0.40 | 0/0 | S / S | 74.0 (14.4) | 99.2 | 0 | 3726 | 0.94 | 1/1/1.35 | 8/10/16 | 2.17/0 2.89/0 3.08/0 | no/no/no | 200/200 | 48 |
| 2 | clear | 46.6 | 8.4 | 100 % | 0 | 0 (0/0/0) | 2.99/3.41/3.57 | 13/17 15/25 18/34 | 0.32/0.27/0.28 | 0/1 | S / S | 74.8 (20.4) | 97.7 | 0 | 5310 | 0.93 | 1.70/2.05/2.40 | 17/25/34 | 1.76/0.67 1.67/0.50 1.49/0.78 | no/no/no | 300/300 | 66 |
| 3 | clear | 59.7 | 11.5 | 100 % | 0 | 0 (0/0/0) | 2.71/2.51/2.55 | 10/28 12/32 12/37 | 0.22/0.38/0 | 0/1 | S / S | 74.6 (27.6) | 97.8 | 0 | 6923 | 0.93 | 2.30/2.30/2.30 | 28/32/37 | 1.18/0.58 1.09/0.65 1.11/0.76 | no/no/no | 400/400 | 70 |

### Counter-Signal on the merged tree (`t-arcade-balance`, 12 pass / 0 fail, `out/t-arcade-balance/summary.json`)

| profile | S | outcome | boss s | surges started / countered / fired | surge dmg | min HP | rank | WPM | tally clear / time / accuracy / flawless |
|---|---|---|---|---|---|---|---|---|---|
| 35 / .90 | 1 | clear | 14.1 | 0 / 0 / 0 | 0 | 100 % | B | 30 | 1850 / 364 / 0 / 500 |
| 35 / .90 | 2 | clear | 21.6 | 1 / 1 / 0 | 0 | 100 % | A | 31 | 2200 / 684 / 0 / 1000 |
| 35 / .90 | 3 | clear | 29.9 | 1 / 1 / 0 | 0 | 100 % | B | 31 | 2550 / 224 / 0 / 1500 |
| 55 / .93 | 1 | clear | 6.9 | 0 / 0 / 0 | 0 | 100 % | A | 51 | 1850 / 521 / 150 / 500 |
| 55 / .93 | 2 | clear | 12.9 | 1 / 1 / 0 | 0 | 100 % | A | 49 | 2200 / 1089 / 300 / 1000 |
| 55 / .93 | 3 | clear | 19.0 | 1 / 0 / 1 | 14 | 96.5 % | A | 49 | 2550 / 1003 / 450 / 0 |
| 80 / .97 | 1 | clear | 5.1 | 0 / 0 / 0 | 0 | 100 % | S | 76 | 1850 / 614 / 800 / 500 |
| 80 / .97 | 2 | clear | 9.2 | 1 / 1 / 0 | 0 | 100 % | S | 75 | 2200 / 1303 / 800 / 1000 |
| 80 / .97 | 3 | clear | 11.6 | 1 / 1 / 0 | 0 | 100 % | S | 73 | 2550 / 1703 / 1200 / 1500 |
| 55 / .93 | 10 (jump) | victory | 73.3 | 7 / 3 / 4 | 112 | **8 %** | B | 50 | 5000 / 0 / 1500 / 0 |
| 80 / .97 | 10 (jump) | victory | 45.0 | 5 / 5 / 0 | 0 | 97.1 % | S | 74 | 5000 / 0 / 4000 / 5000 |

Sector 10 for 55 / .93 is tighter than on either branch: min HP 8 % here and 8.5 % in the stakes run below (ARCADE's
branch 20.5 / 41.3 %, PACE's branch stakes 46.6 %); no death in either run. It is not a Q1 target (S1-3) and every wave
there runs at paceMul 1.0; left for the lead (the Cadet offer is the designed release if it turns into deaths).

### Stakes (D3) on the merged tree, seeded profile, sector jump then consecutive sectors, one retry allowed (none used)

| profile | sector: hull in (card) -> damage, min hull, wave timeouts (escaped), carry, rank |
|---|---|
| 25 / .85 from S3 | S3 400/400 -> 86, 78.5 %, W2 (2), carry +2; S4 500/500 -> 222, 55.6 %, W2 (3), carry +3; S5 **467/600** -> 358, **18.2 %**, W1 (4) W2 (4), carry +4 +4; S6 **414/700** -> 380, 19.9 %, W1 (0) W2 (2), carry +2; all waves 1.0, rank C / D / D / C, 0 deaths |
| 35 / .90 from S4 | S4 500/500 -> 32, 93.6 %, W3 (2); S5 **581/600** -> 114, 77.8 %, W1 (0); S6 **622/700** -> 306, 45.1 %, W2 (0); S7 **581/800** -> 362, **27.4 %**, W2 (0); all waves 1.0, rank B / C / C / C, 0 deaths |
| 55 / .93 from S7 | S7 800/800 -> 0, 100 %, W3 (0); S8 900/900 -> 294, 67.3 %, W3 (0); S9 **837/1000** -> 502, 33.5 %, W2 (0); S10 **734/1100** -> 806, **8.5 %**, W2 (1), carry +1, victory; all waves 1.0, rank A / A / B / B, 0 deaths |

Bold hull in = carried from the previous clear (S5+). Against the branch: the 25 WPM pilot's low point moved from S6
12.9 % to S5 18.2 % / S6 19.9 %, the 35 WPM pilot's S7 from 19.1 % to 27.4 %, the 55 WPM pilot's S10 from 46.6 % to
8.5 % (ARCADE's S10 surges, 4 of 7 fired in the jump run). Nobody died, so the Cadet offer was not seen in natural play
(t-pace-cadet covers it). Labels `merged-stakes-w25-j3`, `merged-stakes-w35-j4`, `merged-stakes-w55-j7`.

## Training update: pace (PACE, D2 / D3), measured on `wt/pace` before WORDS / ARCADE

Superseded by the merged-tree re-pass above; kept as the branch's history.

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
* Acquisition latency (lead ruling Z7, off by default): `b10.mjs` / `t-pace-balance.mjs` `--acquire-ms N
  [--acquire-slow-ms 2N] [--acquire-slow-p .1]` (and `typeFor` / `paceType` `{ acquireMs }` in the probe libraries) make
  the typist wait N ms of play clock (2N with probability .1) before the first key of every target it was not already
  typing: a new plate, capsule, minion or boss word (a surge reset is the same word), on top of the key interval. An idle
  gap ends when a target appears, before the wait. `t-pace-balance --matrix --tag x` suffixes the labels per round, and
  with the latency the idle targets are notes (report only). b10 also records each surge's window, the table window and
  the pilot's time for the segment (`boss.surgeWindows`), and counts a timed-out wave's escaped plates as the plates
  alive at its cap (they leave at once, Z5).
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
