# HANDOFF — content / balance tables (wt/content)

Requests for files this track does not own. Everything below is additive; the game runs without it.

## assets/js/99-boot.js — expose the new pure helpers on `window.TypeRDebug`
Where: the `window.TypeRDebug = {...}` literal.
Add (CONTRACT section 4 lists LEVELS/buildBossSegments/rankFor/comboTier; buildBossPlan and getThemeForLevel help the harness probes):
```js
window.TypeRDebug = Object.assign(window.TypeRDebug || {}, {
  LEVELS, buildBossSegments, buildBossPlan, rankFor, comboTier, getThemeForLevel
});
```

## For the lead — one number to decide (no file change needed from me)
`DAMAGE.leak(len)` in `assets/js/core/20-constants.js` follows CONTRACT 7 literally: `12 + min(16, 2*len)` (a 12-letter
leak costs 28). PLAN B4's acceptance line ("leak a 12-letter word at L5 → hp -36 exactly") and SYS-10's example
("12-letter 36") only hold with a cap of 24. The cap is the single constant `DAMAGE.leakCap` (16 today); set it to 24
if the acceptance line is the intended number.

## Notes for the gameplay tracks (no action for the lead)
- `buildBossSegments(L)` still returns the plain array the current `Boss` constructor expects; the same array also
  carries non-enumerable `.segments` / `.phaseStarts` so `buildBossSegments(L).segments.length` already works.
  B7 should construct from `buildBossPlan(L)` (`{segments, phaseStarts, coreCount, themedCount}`) and can then turn
  `buildBossSegments` into `return buildBossPlan(level)` per CONTRACT 4.
- `LEVELS[i].words`, `waveWords[w]`, `letterSet`, `waveLetterSets[w]` are attached at the end of `30-content.js`
  (`attachLevelContent`), because `20-constants.js` loads before the word lists. Helpers: `wordsForWave(cfg, w)`,
  `letterSetForWave(cfg, w)`, `waveLengthWindow(cfg, w)`, `waveSpawnRate/waveSpeed/waveLetterRatio/waveMaxEnemies(cfg, w)`,
  `pressureCap(cfg)`, `surgeDuration(remaining)`, `powerupWeightsFor(hpFrac, inBoss)`.
- `getThemeForLevel(i)` now returns a frozen merged object (`id/bg/fg/bgSpeed/fgSpeed/fgHeight/tileFg` + `art/storm/accent/speedMul`).
  `speedMul` (1.25 on storm sectors) is NOT pre-applied to `bgSpeed/fgSpeed`; D7 applies it.
