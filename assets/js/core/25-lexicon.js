// Type-R 198X — WORDS track (D7 / D8): COMMON_WORDS and PHRASES, the wave-pool mix, two-word plates (Space types the gap),
// the weak-key bias and the THREAT INTEL sector-card line. Classic script: loads after 20-constants.js, before 30-content.js.
// Game does not exist yet when this file runs: runtime behaviour is GAME_HOOKS listeners (this = game) on enemyTextWillPick,
// enemySpawned, waveWillStart, sectorCardWillShow and spaceKey, plus plain lexicon*() functions that 30-content.js (load
// time), 70-canvas.js (per plate) and 75-fx-draw.js call when they exist. Top-level names: COMMON_WORDS, PHRASES, LEXICON*,
// lexicon*. Nothing here allocates per frame or writes the save per key.
