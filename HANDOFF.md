# HANDOFF — audio track (A9 / D10 / D11)

Everything audio lives in `assets/audio/sfx.js` (plus `tools/measure-loops.sh` and
`tools/playtest/probes/audio-contract.mjs`). The game-side wiring below is NOT done in this
worktree because those files belong to other tracks; the current game keeps working through the
legacy aliases (`laser/hit/explosion/powerup/bossSiren/bossExplosion/playMusic()/stopMusic/setMuted`).
Apply these when merging. Every call is safe before `unlock()` (no-op) and after.

## Measured music facts (D11)

- `MUSIC_LOOP = [[1.3,123.8],[1.02,121.9],[0.01,128.2],[0.37,126.8],[0.47,135.9],[0.18,123.6]]`
  (loopStart = first sample above -50 dBFS, loopEnd = last 100 ms RMS window within 3 dB of the
  body median, i.e. before the trailing fade). Method: `tools/measure-loops.sh` (ffmpeg + node),
  also summarised in the comment above `MUSIC_LOOP` in sfx.js. The WAV masters have identical
  timelines so the table serves the legacy fallback too.
- Tracks 1, 2 and 6 only reach body loudness at 7.2 / 6.3 / 5.2 s (`bodyStart` in the script
  output); the spec'd -50 dBFS rule therefore loops into a quiet lead-in. If the lead prefers the
  loop to land on the body, the alternative table is
  `[[7.2,123.8],[6.3,121.9],[0.1,128.2],[0.6,126.8],[0.5,135.9],[5.2,123.6]]` (one-line change).
- Duplicate song: tracks 1 and 6 (MUSIC indices 0 and 5): detrended 4-band envelope correlation
  r = 0.57 at lag 0 s; every other pair <= 0.40 (runner-up 4/5 at 0.40); waveform check 0.18 vs
  0.04 (same song, different master). This is the pair the contract table already confines to the
  sector 1–2 tier, so `MUSIC_FOR_LEVEL = [0,5,2,2,1,1,4,4,3,3]` is kept: no tier boundary
  (2→3, 4→5, 6→7, 8→9) repeats a song; `MUSIC_FOR_LEVEL[1] === 5`, `trackForLevel(9) === 3`.

## 1. index.html (A10 / A8 owners)

- Load `assets/opt/manifest.js?v=<SHELL>` BEFORE `assets/audio/sfx.js` (contract §1 order).
  sfx.js reads `window.TYPER_ASSET_MANIFEST` at construction and again inside `unlock()`;
  without it the WAV masters stream through the same transport (works, 23 MB each).

## 2. assets/js/game/10-ui.js (C1 / C6 / A4 owners)

- `applySettings()`: add
  ```js
  this.sfx.setMusicVolume(this.save.settings.musicVolume ?? 0.7);
  this.sfx.setSfxVolume(this.save.settings.sfxVolume ?? 0.8);
  ```
  Keep `this.sfx.setMuted(muted)`; it is master-gain only now, music keeps running while muted
  and unmute resumes mid-track (F053).
- window `keydown` (before `handleTyped`) and canvas `pointerdown`:
  ```js
  this.sfx.resumeIfNeeded();
  if (this.sfx.needsGesture && typeof this.showToast === "function") this.showToast("TAP TO RESTORE AUDIO", { key: "audio", kind: "warn" });
  ```
- next to the blur handler:
  ```js
  document.addEventListener("visibilitychange", () => { if (document.hidden) this.sfx.onHidden(); else this.sfx.onVisible(); });
  ```
  (F091 also wants `setMode("paused")` + `saveRun(true)` when hidden.)
- `setMode`: entering `paused` → `this.sfx.setMusicState("pause"); this.sfx.uiTick("pause");`
  leaving `paused` for `playing` → `this.sfx.setMusicState("resume"); this.sfx.uiTick("resume");`
  (`'resume'` restores the state that was active before the pause: wave or boss.)
- Buttons: `this.sfx.uiTick("confirm")` on primary actions, `uiTick("back")` on cancel/back;
  `#setSfx` change → `this.sfx.uiTick("tick")`.

## 3. assets/js/game/20-run.js (A2 / A3 / B3 owners)

- `startLevel(i, …)`: replace `if (this.sfx && !this.save.settings.muted) this.sfx.playMusic();` with
  ```js
  this.sfx.playMusic(this.sfx.trackForLevel(this.levelIndex));
  this.sfx.setMusicState("wave");
  ```
  unconditionally (mute is a gain). Replace the trailing `this.sfx.powerup()` with
  `this.sfx.sectorStart()` at level intro t=0 and `this.sfx.lock("go")` when the GO banner fires.
- `restartLevel()` / `advanceLevel()`: delete the duplicate `this.sfx.playMusic()` lines.
  Same track ⇒ no restart (contract no-restart rule), different tier ⇒ 0.6 s crossfade.
- `onLevelComplete()`: `this.sfx.setMusicState("end"); this.sfx.fanfare("levelClear");`
- `onGameOver()`: `this.sfx.setMusicState("end"); this.sfx.fanfare("gameOver");`
  (`'end'` also stops the lowHp beeper and the boss pulse.)
- `onVictory()`: `this.sfx.setMusicState("end"); this.sfx.fanfare("victory");`
- `stopToMenu()`: `this.sfx.setMusicState("end");`
- `prefetchNextSector()` (A8): `this.sfx.prefetchMusic(this.sfx.trackForLevel(this.levelIndex + 1));`
- `retryBoss()` / Continue: `playMusic(trackForLevel(i))` + `setMusicState("wave")` then
  `beginBossFight` sets `'boss'`; a paused-after-`'end'` element resumes in place.
- Ending typewriter (D9): `this.sfx.typeTick(variant)` per glyph, variants `"empress" | "typegrid" | undefined`.

## 4. assets/js/game/30-input.js (B1 / A4 owners)

- `onCorrectKey(ref)`: replace `this.sfx.laser(); this.sfx.hit();` with
  `this.sfx.zap(ref.progress / ref.text.length)` (progress 0..1 across the word; boss char:
  `boss.progress / segment.length`). `hit()` and `laser()` remain as aliases of `zap(1)` / `zap(0)`.
- lock acquired: `this.sfx.lock(kind)` with `"enemy" | "powerup" | "boss"` before `onCorrectKey`;
  `releaseLock("manual")` → `this.sfx.lockRelease()`, `releaseLock("lost")` → `this.sfx.lockLost()`.
- `onHardMiss()`: `const lost = this.stats.combo; lost >= 10 ? this.sfx.comboBreak(lost) : this.sfx.error();`
  `onDryFire()`: `this.sfx.error(0.45)` (never counted, combo untouched).
- boss segment cleared → `this.sfx.segmentDown()`; phase boundary → `this.sfx.bossPhaseClear()`.
- boss kill t=0: `this.sfx.bossCharge(); this.sfx.setMusicState("finale");`
  t=0.4: `this.sfx.bossKill()` (replaces the `explosion()` + `bossExplosion()` pair);
  finale t=2.0: `this.sfx.fanfare("bossDown")`.

## 5. assets/js/game/40-combat.js (B3 / B4 / B5 / B6 owners)

- `killEnemy(en)`: `this.sfx.explosion(clamp((en.text.length - 1) / 11, 0, 1))`; minion kill `explosion(0.15)`.
- contact leak → `this.sfx.impact()`; real HP loss in `takeDamage` → `this.sfx.damage()`;
  shield absorb → `this.sfx.shieldHit()`; shield reaches 0 → `this.sfx.shieldBreak()`;
  `hp/maxHp` crossing .25 (down) → `this.sfx.lowHp(true)`, crossing back up / heal / level start → `lowHp(false)`.
- `collectPowerup(p)`: `this.sfx.pickup(p.type)` (`SHIELD|MULTI|RAPID|SPREAD|PIERCE|REPAIR`);
  any power timer reaching 0 → `this.sfx.powerDown()`; each RAPID chain hit → `this.sfx.chainZap()`.
- `onMultTier(newMult)`: `this.sfx.comboTier(newMult)`.
- waves: `beginWave(i)` → `this.sfx.waveStart(i + 1)`; quota reached → `this.sfx.waveClear(i + 1)`;
  `beginBossApproach()` → `this.sfx.bossWarning()`.

## 6. assets/js/game/50-boss.js (B7 / B8 / D6 owners)

- `beginBossFight()`: `this.sfx.bossSiren(3); this.sfx.setMusicState("boss");`
  (3 loops = 2.4 s, matches `BOSS_INTRO_S`; the siren ducks music by itself).
- on each boss hit or segment clear: `this.sfx.bossPulse(true, 1 - this.boss.hpFrac())` (only moves a gain).
- `startSurge(dur)` → `this.sfx.surgeCharge(dur)`; `fireSurge()` → `this.sfx.surgeFire()` (includes `damage()`);
  `cancelSurge()` → `this.sfx.surgeCancel()`.
- finale bursts: `this.sfx.explosion(rand(0.6, 1.0))` per shock; drop the repeating `explosion()` metronome.

## 7. assets/js/game/60-hud.js / 80-fx.js (C3 / C4 / D5 owners)

- results count-up → `this.sfx.tallyTick()` per step; rank reveal → `this.sfx.rankStamp()`;
  banner slam → `this.sfx.bannerSlam()`.

## 8. tools/playtest/play.mjs (A1 owner)

- The static server should answer HTTP Range requests (206 + `Accept-Ranges: bytes`) like
  production nginx: HTMLMediaElement seeks are clamped to the buffered range otherwise, so any
  acceptance that sets `currentTime` cannot pass. `tools/playtest/probes/audio-contract.mjs`
  has a 12-line implementation to copy. Also C-4's `Cache-Control: max-age=3600` for `/assets/`.
- `requestFailures` now contain `net::ERR_ABORTED` for music media loads whenever a slot's `src`
  is replaced (benign Chrome media behaviour, two per `all` run); classify separately.
- Chrome does not advance the automation timeline of a GainNode with no connected input, so
  `sfxGain.gain.value` reads stale while no cue plays. Read it while a cue is sounding, or read
  `musicGain` (always fed). UX-07's slider acceptance should expect `MUSIC_BASE*v*v*0.5` while the
  music state is `pause` (-6 dB lives on `musicGain`).
- Run `node probes/audio-contract.mjs --root ../.. [--legacy]` from `tools/playtest` for the
  full audio acceptance set (37 checks, both MP3 and WAV paths).

## 9. Save / settings (A3 owner)

- Defaults `settings.musicVolume 0.7`, `settings.sfxVolume 0.8` (C§9); sfx.js uses the same
  defaults until `applySettings` passes them in.

## API summary (what sfx.js exposes)

Transport: `unlock()` (memoised promise), `resumeIfNeeded()`, `needsGesture`, `onHidden()`,
`onVisible()`, `setMuted(m)`, `setMusicVolume(v)`, `setSfxVolume(v)`.
Music: `MUSIC_FOR_LEVEL`, `MUSIC_LOOP`, `trackForLevel(i)`, `playMusic(index|src|undefined, {fade})`,
`prefetchMusic(i)`, `stopMusic()`, `fadeOutMusic(sec)`, `duckMusic(level, sec)`,
`setMusicState('wave'|'boss'|'finale'|'end'|'pause'|'resume')`, `bossPulse(on, intensity)`,
fields `currentTrack`, `musicState`, `wantMusic`, `musicEls[{el,gain,index,src,level}]`, `active`,
getter `music` (playing element or null).
Cues: every name in CONTRACT §6 plus the alias table; `lastCue` after each; `laserVoices` (cap 4).
Debug seam: `_buildBus(ctx)` accepts an OfflineAudioContext, `_timeShift` offsets `_now()`.
