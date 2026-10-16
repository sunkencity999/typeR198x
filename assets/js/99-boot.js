// Type-R 198X — boot. Must be the last script in index.html: instantiates the Game after every core/* and game/* module has loaded.

// ----------------------------- Boot -----------------------------
const game = new Game();
window.game = game;

// Ensure menu visible on load
game.setMode("menu");
game.refreshMenu();

// Harness / debugging hooks (CONTRACT §4). stats() reports partial telemetry until B3/B9 land.
window.TypeRDebug = {
  LEVELS,
  normalizeKey,
  foldLatin: (typeof foldLatin === "function") ? foldLatin : null,
  buildBossSegments,
  stats: () => game.debugStats()
};
