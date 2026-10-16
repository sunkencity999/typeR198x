// Type-R 198X — boot. Must be the last script in index.html: instantiates the Game after every core/* and game/* module has loaded.

// ----------------------------- Boot -----------------------------
const game = new Game();
window.game = game;
if (SAVE_STATE.unavailable) game.onPersistUnavailable();

// Ensure menu visible on load
game.setMode("menu");
game.refreshMenu();

// Harness / debugging hooks (CONTRACT §4 + content-HANDOFF). stats() -> { incomingCps, leaksPerMin, deathsBySector, liveChars }.
window.TypeRAssets = Assets;
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
// Pure helpers the content/balance probes read (content-HANDOFF); each is optional until its owner lands.
if (typeof buildBossPlan === "function") window.TypeRDebug.buildBossPlan = buildBossPlan;
if (typeof rankFor === "function") window.TypeRDebug.rankFor = rankFor;
if (typeof comboTier === "function") window.TypeRDebug.comboTier = comboTier;
if (typeof getThemeForLevel === "function") window.TypeRDebug.getThemeForLevel = getThemeForLevel;
window.TypeRDebug.PALETTE = PALETTE;
window.TypeRDebug.FONT = FONT;
if (typeof Game !== "undefined" && Game.CAMERA_HOOKS) window.TypeRDebug.cameraHooks = Game.CAMERA_HOOKS;
if (typeof Game !== "undefined" && Game.ATTRACT_HOOKS) window.TypeRDebug.attractHooks = Game.ATTRACT_HOOKS;
