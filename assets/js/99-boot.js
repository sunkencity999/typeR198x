// Type-R 198X — boot. Must be the last script in index.html: instantiates the Game after every core/* and game/* module has loaded.

// ----------------------------- Boot -----------------------------
const game = new Game();
window.game = game;
if (SAVE_STATE.unavailable) game.onPersistUnavailable();

// Ensure menu visible on load
game.setMode("menu");
game.refreshMenu();

// Harness / debugging hooks (CONTRACT §4). stats() reports partial telemetry until B3/B9 land.
window.TypeRAssets = Assets;
window.TypeRDebug = {
  LEVELS,
  normalizeKey,
  foldLatin,
  buildBossSegments,
  stats: () => game.debugStats()
};
// Pure helpers the content/balance probes read (content-HANDOFF); each is optional until its owner lands.
if (typeof buildBossPlan === "function") window.TypeRDebug.buildBossPlan = buildBossPlan;
if (typeof rankFor === "function") window.TypeRDebug.rankFor = rankFor;
if (typeof comboTier === "function") window.TypeRDebug.comboTier = comboTier;
if (typeof getThemeForLevel === "function") window.TypeRDebug.getThemeForLevel = getThemeForLevel;
window.TypeRDebug.PALETTE = PALETTE;
window.TypeRDebug.FONT = FONT;
