# HANDOFF — game-core track (A2, A4, A3, A6)

Everything below is tolerated by the code as it stands (elements are created from JS when missing,
methods are feature-detected). Applying these moves the fallbacks into their owners' files.

## index.html (C1 / C4 / C8 owners)

1. `#toastStack` — add inside `#main`, after `#screenVictory` and before `#crtOverlay`:
   ```html
   <div id="toastStack" class="toastStack" aria-hidden="true"></div>
   ```
   Until then `Game.prototype.ensureToastStack()` (10-ui.js) appends it to `#main` and injects a
   `<style id="toastStyles">` fallback. Remove that style injection once style.css carries the classes.

2. `#screenGameOver` actions — add the Retry boss button and the checkpoint note, and relabel:
   ```html
   <button id="btnTryAgain" class="btn-arcade primary">Retry sector</button>
   <button id="btnRetryBoss" class="btn-arcade hidden" type="button">Retry boss</button>
   <button id="btnBackToMenu2" class="btn-arcade">Sector select</button>
   <p id="retryNote" class="small">Score returns to sector start</p>
   ```
   `ensureGameOverControls()` (10-ui.js) creates `#btnRetryBoss` / `#retryNote` and sets the labels
   when they are missing. `#btnRestart` (pause) label is set to "Restart sector" from JS too.

3. `#pauseReason` (`p#pauseReason.small` under `#pausedTitle`) — `setMode('paused')` writes the copy
   ("Paused" / "Window lost focus" / "Tab hidden" / "Left fullscreen") when the element exists.

4. `#btnEndingSkip` (victory `.endingActions`) — wired to `skipEndingDialogue()` when present.

5. `#srAnnounce` — `showToast` calls `this.announce(text)` when C1 defines it; no-op until then.

## style.css (C1 / C8 owners)

6. Move the toast CSS out of the JS fallback (`ensureToastStack` in assets/js/game/10-ui.js) into
   style.css under the contract names `.toastStack .toast .toast--info .toast--tip .toast--warn
   .toast--success` (mono 13 px uppercase, glass pill, `bottom: 19%` of `#main`, z-index 15,
   160 ms in / 200 ms out, opacity-only under `:root.reduce-motion`). The JS fallback keys on
   `#toastStyles` not existing, so leaving it in place is harmless.

7. Remove the background gradient on `#game` (`background: linear-gradient(...)` in style.css):
   the context is opaque now (`alpha:false`) and the canvas paints its own base colour.

8. `.screen.is-active` — `setMode` already toggles `.is-active` alongside `.hidden`; C1 can key
   transitions off it.

## assets/js/core/20-constants.js (B3 owner)

9. `BOSS_FINALE_S` — the boss-kill block (30-input.js) uses `typeof BOSS_FINALE_S === "number"
   ? BOSS_FINALE_S : 6.3` for `bossClear.duration`. Defining the constant switches the finale to 5.0 s;
   `startBossFinale` still schedules bursts up to 6 s (B8 restyles the finale anyway).

10. `LEVELS[i].quota` — `migrateSave` reads `cfg.quota[2]` for legacy in-boss runs (B-10) when it
    exists; otherwise it keeps the run's own `waveKills`.

## assets/js/core/20-constants.js (B7 owner)

11. `buildBossSegments(level)` may return either a plain array (today) or `{ segments, phaseStarts }`;
    `beginBossFight` handles both. `Boss` instances carry ad-hoc `phase` and `phaseStarts` fields set
    by `beginBossFight`; `run.boss` persists `{ segments, segmentIndex, progress, phase, phaseStarts }`.
    B7's `onBossPhaseClear()` should set `this.boss.phase`, call `this.run.bossCheckpoint =
    this.makeCheckpoint("boss")` and update `this.run.boss.phase/segmentIndex`.

## assets/audio/sfx.js (A9 owner)

12. `onHidden()`, `onVisible()`, `resumeIfNeeded()` are feature-detected from 10-ui.js / 30-input.js.

## Notes for the lead

- Save schema v2 adds `run.legacy: true` on runs migrated from v1 (amendment E-3: their headline
  high score keeps counting even though `startLevel` is `levelIndex + 1`). Additive; not in C§9.
- A saved death is `run.hp === 0` (written by `onGameOver` → `writeRunSave({ dead: true })`);
  `continueRun` restores the boss checkpoint (inBoss + bossCheckpoint + boss) or the level checkpoint
  from it, so menu → Continue converges with Retry boss / Retry sector.
- `startLevel(levelIndex, true[, restoredRun])` boolean shim is still in place (B-5); drop in E2.
- Game Over holds a still frame (no ambient drift) so the A2 pixel-identical acceptance passes;
  pause / level complete / victory keep the 20 fps ambient tick.
