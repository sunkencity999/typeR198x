// Type-R 198X — boot. Must be the last script in index.html: instantiates the Game after every core/* and game/* module has loaded.

// ----------------------------- Boot -----------------------------
const game = new Game();
window.game = game;
if (SAVE_STATE.unavailable) game.onPersistUnavailable();

// Ensure menu visible on load
game.setMode("menu");
game.refreshMenu();

// Harness / debugging hooks (CONTRACT §4 + content-HANDOFF). stats() -> { incomingCps, leaksPerMin, deathsBySector, liveChars }.
window.TypeRDebug = {
  LEVELS,
  normalizeKey,
  foldLatin,
  buildBossSegments,
  buildBossPlan,
  rankFor,
  comboTier,
  getThemeForLevel,
  stats: () => game.debugStats()
};
