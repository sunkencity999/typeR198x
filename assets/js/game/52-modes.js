// Type-R 198X — MODES track (D9): run.mode, the seeded Daily Sortie, Endless Drift, Drill, the title deck and the mode
// results card. Loads after 50-boss.js. Hooks consumed: levelWillStart, waveWillStart, tick, bossWillApproach,
// enemyTextWillPick, powerupWillSpawn, damageWillApply, leak, scoreWillAdd, gameOverWillStart, restartWillRun,
// restartWillAsk, modeChange, pauseScreenFilled, sectorCardWillShow, menuRender, keyEscape, comboTierWillShow; emitted:
// modesRunStart, modesRunEnd. Top-level names MODES_* / modes*. A mode run never touches save.run, the high score,
// sectorBests or unlocks; exactly one storeSave per finished mode run.
