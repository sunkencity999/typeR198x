// Type-R 198X — PACE track (D2 / D3): pace follows the pilot (paceMul per wave into this.waveTuning), PERFECT WAVE by
// quota only, WAVE TIMED OUT with quota carry, hull carry from sector 4, the Cadet assist and the diff() row. Loads after
// 40-combat.js. Hooks consumed: waveWillStart, waveWillEnd, waveDrained, levelWillStart, checkpointRestored,
// clearWillRepair, results, recordWillSave, gameOverWillShow, levelCompleteWillShow, sectorCardWillShow. Top-level names
// PACE* / pace*. No per-frame code, no canvas drawing, no save writes of its own (run.pace rides the existing save points).
