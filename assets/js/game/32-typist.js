// Type-R 198X — MEASURE track (D1 / D4 / D5 / D6): honest hand speed (qualifying intervals), the per-key / bigram pilot
// profile (save.profile, schema 3), weak keys, sessions and bests, the inline typo pair, the rank line / WEAK SIGNAL /
// Game Over cause, the HUD ACC / WPM providers and the Flight Log. Loads after 30-input.js. Hooks consumed: keyCorrect,
// keyMiss, modeChange, sectorStart, sectorEnd, results, resultsRender, leak, hullDamage, menuRender, recordsOpen,
// renderOverlay, saveMigrate, saveStore; emitted: typistInterval. Top-level names TYPIST_* / typist* / SPEED_GAP_MAX_MS.
// Per key and per frame: typed arrays, reused objects, no allocation, no save write.
