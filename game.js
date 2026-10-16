// Type-R 198X — game.js
//
// The browser build is split into load-ordered classic scripts (no bundler, no ES modules).
// Top-level const/class/function declarations in one script are visible to every later script
// through the shared global scope, so index.html must load them in exactly this order:
//
//   assets/audio/sfx.js              window.SFX
//   assets/js/core/00-util.js        clamp/lerp/rand/... helpers, environment flags (SKIP_CORS_IMAGES)
//   assets/js/core/20-constants.js   balance constants, getHpBonusForLevel, buildBossSegments, LEVELS
//   assets/js/core/30-content.js     word pools, boss tables, ship/boss/theme art, explosion sheet, victory script
//   assets/js/core/40-save.js        LS_KEY, defaultSave/loadSave/storeSave, resume-run helpers
//   assets/js/core/60-entities.js    Enemy, Powerup, Bullet, ExplosionSprite, Particle, Boss
//   assets/js/core/70-canvas.js      roundRect, bracketRect
//   game.js (this file)              ASSET_VERSION/withAssetVersion + class Game { constructor, loop }
//   assets/js/game/10-ui.js          Game.prototype: bindUI, menus, modals, settings, asset loading overlay
//   assets/js/game/20-run.js         Game.prototype: run/level lifecycle, end screens, saveRun
//   assets/js/game/30-input.js       Game.prototype: handleTyped, onCorrectKey/onWrongKey, lock helpers
//   assets/js/game/40-combat.js      Game.prototype: spawning, combat resolution, update(dt)
//   assets/js/game/50-boss.js        Game.prototype: boss fight logic (intro/finale)
//   assets/js/game/60-hud.js         Game.prototype: updateHUD, getAccuracyPct
//   assets/js/game/70-render.js      Game.prototype: render(dt) and all draw* methods
//   assets/js/game/80-fx.js          Game.prototype: lasers, sparks, explosions, screen shake
//   assets/js/99-boot.js             const game = new Game(); window.game = game
//
// Every game/*.js file is an Object.assign(Game.prototype, { ... }) mixin. Methods are only called at
// runtime (after all scripts have loaded), so a method may live in any file; only top-level code
// has to respect the order above.
//
// native/sync-web.sh patches the withAssetVersion return line below by sed; keep it byte-identical.

const ASSET_VERSION = "20251130b";
const withAssetVersion = (path) => {
  if (!path) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}v=${ASSET_VERSION}`;
};

// ----------------------------- Game Core -----------------------------
class Game {
  constructor() {
    this.canvas = document.getElementById("game");
    this.ctx = this.canvas.getContext("2d");

    this.w = this.canvas.width;
    this.h = this.canvas.height;

    // UI refs
    this.ui = {
      menu: document.getElementById("screenMenu"),
      paused: document.getElementById("screenPaused"),
      levelComplete: document.getElementById("screenLevelComplete"),
      gameOver: document.getElementById("screenGameOver"),
      victory: document.getElementById("screenVictory"),
      playerName: document.getElementById("playerName"),
      hudName: document.getElementById("hudName"),
      hudLevel: document.getElementById("hudLevel"),
      hudScore: document.getElementById("hudScore"),
      hudCombo: document.getElementById("hudCombo"),
      hudAcc: document.getElementById("hudAcc"),
      hudHP: document.getElementById("hudHP"),
      bossBar: document.getElementById("bossBar"),
      bossFill: document.getElementById("bossFill"),
      bossName: document.getElementById("bossName"),
      bossSegment: document.getElementById("bossSegment"),
      statHigh: document.getElementById("statHigh"),
      statUnlocked: document.getElementById("statUnlocked"),
      levelCompleteText: document.getElementById("levelCompleteText"),
      gameOverText: document.getElementById("gameOverText"),
      victoryText: document.getElementById("victoryText"),
      endingStage: document.getElementById("endingStage"),
      endingSpeaker: document.getElementById("endingSpeaker"),
      endingLine: document.getElementById("endingLine"),
      endingNext: document.getElementById("btnEndingNext"),
      creditsLine: document.getElementById("creditsLine"),
      keyboardHint: document.getElementById("keyboardHint"),
      crtOverlay: document.getElementById("crtOverlay"),
      loading: document.getElementById("loadingOverlay"),
      storyModal: document.getElementById("storyModal"),
      storyLaunch: document.getElementById("btnStoryLaunch"),
      keyboardHintDismiss: document.getElementById("btnKeyboardHint"),
      shipChoices: document.querySelectorAll("input[name='shipChoice']")
    };

    this.shipInputs = Array.from(this.ui.shipChoices);

    // buttons
    this.btnStart = document.getElementById("btnStart");
    this.btnContinue = document.getElementById("btnContinue");
    this.btnResetSave = document.getElementById("btnResetSave");
    this.btnPause = document.getElementById("btnPause");
    this.btnStop = document.getElementById("btnStop");
    this.btnMute = document.getElementById("btnMute");
    this.btnCRT = document.getElementById("btnCRT");
    this.btnResume = document.getElementById("btnResume");
    this.btnRestart = document.getElementById("btnRestart");
    this.btnNextLevel = document.getElementById("btnNextLevel");
    this.btnBackToMenu1 = document.getElementById("btnBackToMenu1");
    this.btnBackToMenu2 = document.getElementById("btnBackToMenu2");
    this.btnBackToMenu3 = document.getElementById("btnBackToMenu3");
    this.btnTryAgain = document.getElementById("btnTryAgain");
    this.btnNewRun = document.getElementById("btnNewRun");

    // audio
    this.sfx = new SFX();
    this.audioUnavailable = false;

    this.loadingOverlay = this.ui.loading;
    this.storyModal = this.ui.storyModal;
    this.storyLaunchBtn = this.ui.storyLaunch;
    this.keyboardHintModal = this.ui.keyboardHint;
    this.keyboardHintBtn = this.ui.keyboardHintDismiss;
    this.pendingAssets = 0;
    this.assetsReady = false;
    this.endingScript = getVictoryScript();
    this.endingIndex = 0;

    this.shipImages = {};
    Object.entries(SHIP_CONFIGS).forEach(([id, cfg]) => {
      const img = new Image();
      if (!SKIP_CORS_IMAGES) img.crossOrigin = "anonymous";
      this.registerAsset(img, () => {
        this.shipImages[id] = this.prepareShipSprite(img);
      });
      img.src = withAssetVersion(cfg.src);
      this.shipImages[id] = img;
    });

    this.themeImages = {};
    PARALLAX_THEMES.forEach((theme) => {
      const bg = new Image();
      if (!SKIP_CORS_IMAGES) bg.crossOrigin = "anonymous";
       this.registerAsset(bg);
      bg.src = withAssetVersion(theme.bg);
      const fg = new Image();
      if (!SKIP_CORS_IMAGES) fg.crossOrigin = "anonymous";
       this.registerAsset(fg);
      fg.src = withAssetVersion(theme.fg);
      this.themeImages[theme.id] = { bg, fg };
    });

    this.bossArtImages = {};
    BOSS_ARTS.forEach((art) => {
      const img = new Image();
      if (!SKIP_CORS_IMAGES) img.crossOrigin = "anonymous";
      this.registerAsset(img);
      img.src = withAssetVersion(art.src);
      this.bossArtImages[art.level] = img;
    });

    // Save
    this.save = loadSave();
    this.applySettings();

    // state
    this.mode = "menu"; // menu, playing, paused, levelComplete, gameOver, victory
    this.levelIndex = 0;
    this.levelT = 0;
    this.inBoss = false;
    this.bossClear = null;
    this.bossFinaleBursts = [];
    this.bossFinaleOrigin = null;
    this.bossIntro = null;

    this.player = {
      x: 160,
      y: 360,
      hp: BASE_PLAYER_HP,
      maxHp: BASE_PLAYER_HP,
      shield: 0, // seconds
      shipId: this.save.selectedShip || "coconut"
    };

    this.stats = {
      score: 0,
      combo: 0,
      mult: 1,
      correct: 0,
      total: 0
    };

    this.power = {
      spread: 0, // seconds
      pierce: 0,
      rapid: 0,
      multiplier: 0
    };

    this.enemies = [];
    this.powerups = [];
    this.particles = [];
    this.bullets = [];
    this.explosions = [];
    this.boss = null;

    this.lock = null; // { kind: "enemy"|"powerup"|"boss", id: objectRef }
    this.shake = 0;
    this.flash = 0;
    this.damagePulse = 0;

    // background parallax
    this.stars = this.makeStars(180);
    this.starT = 0;

    this.currentTheme = getThemeForLevel(0);
    this.parallax = { bgOffset: 0, fgOffset: 0 };

    this.explosionSheet = new Image();
    if (!SKIP_CORS_IMAGES) this.explosionSheet.crossOrigin = "anonymous";
    this.registerAsset(this.explosionSheet);
    this.explosionSheet.src = withAssetVersion(EXPLOSION_SHEET.src);

    // spawn timers
    this.spawnAcc = 0;
    this.powerAcc = 0;
    this.minionAcc = 0;
    this.hazardAcc = 0;

    // autosave
    this.lastSaveAt = 0;

    this.bindUI();
    this.refreshMenu();
    this.checkLoadingOverlay();
    this.maybeShowKeyboardHint();

    // focus
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute("role", "application");
    this.canvas.addEventListener("pointerdown", () => this.canvas.focus());

    // resize (for crispness keep internal fixed; scale via CSS)
    window.addEventListener("resize", () => { /* canvas scales via css */ });
    window.addEventListener("focus", () => {
      if (this.mode === "playing") this.focusGameCanvas();
    });

    // main loop
    this.prev = nowMs();
    requestAnimationFrame(this.loop.bind(this));
  }

  // ------------------------- Loop -------------------------
  loop(t) {
    const dt = clamp((t - this.prev) / 1000, 0, 0.05);
    this.prev = t;

    if (this.mode === "playing") {
      this.update(dt);
    }
    this.render(dt);

    requestAnimationFrame(this.loop.bind(this));
  }
}
