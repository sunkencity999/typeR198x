// Type-R 198X — boot. Must be the last script in index.html: instantiates the Game after every core/* and game/* module has loaded.

// ----------------------------- Boot -----------------------------
const game = new Game();
window.game = game;
if (SAVE_STATE.unavailable) game.onPersistUnavailable();

// Ensure menu visible on load
game.setMode("menu");
game.refreshMenu();

// Harness / debugging hooks (CONTRACT §4). stats() reports partial telemetry until B3/B9 land.
window.TypeRDebug = {
  LEVELS,
  normalizeKey,
  foldLatin,
  buildBossSegments,
  stats: () => game.debugStats()
};
