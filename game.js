// Type-R 198X — game.js
//
// The browser build is split into load-ordered classic scripts (no bundler, no ES modules).
// Top-level const/class/function declarations in one script are visible to every later script
// through the shared global scope, so index.html must load them in exactly this order:
//
//   assets/audio/sfx.js              window.SFX
//   assets/js/core/00-util.js        clamp/lerp/rand/... helpers, normalizeKey/foldLatin, environment flags
//   assets/js/core/20-constants.js   balance constants, getHpBonusForLevel, buildBossSegments, LEVELS
//   assets/js/core/30-content.js     word pools, boss tables, ship/boss/theme art, explosion sheet, victory script
//   assets/js/core/40-save.js        LS_KEY, defaultSave/loadSave/storeSave/migrateSave, checkpoint + resume helpers
//   assets/js/core/60-entities.js    Enemy, Powerup, Bullet, ExplosionSprite, Particle, Boss
//   assets/js/core/70-canvas.js      roundRect, bracketRect
//   game.js (this file)              ASSET_VERSION/withAssetVersion + class Game { constructor, loop }
//   assets/js/game/10-ui.js          Game.prototype: bindUI, menus, modals, settings, toasts, ending dialogue
//   assets/js/game/20-run.js         Game.prototype: run/level lifecycle, checkpoints, end screens, saveRun
//   assets/js/game/30-input.js       Game.prototype: keydown routing, handleTyped, onCorrectKey/onWrongKey
//   assets/js/game/40-combat.js      Game.prototype: spawning, combat resolution, update(dt)
//   assets/js/game/50-boss.js        Game.prototype: boss fight logic (intro/finale)
//   assets/js/game/60-hud.js         Game.prototype: updateHUD, getAccuracyPct
//   assets/js/game/70-render.js      Game.prototype: resizeCanvas, render(dt) and all draw* methods
//   assets/js/game/80-fx.js          Game.prototype: lasers, sparks, explosions, trauma/effects clock
//   assets/js/99-boot.js             const game = new Game(); window.game = game; window.TypeRDebug
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

// Logical playfield size. The backing store scales with renderScale (A6); gameplay maths never changes.
const LOGICAL_W = 1280;
const LOGICAL_H = 720;
// Non-playing screens (paused, level complete, game over, victory) tick their ambient drift at 20 fps.
const AMBIENT_STEP = 1 / 20;

// ----------------------------- Game Core -----------------------------
class Game {
  constructor() {
    this.canvas = document.getElementById("game");
    this.ctx = this.canvas.getContext("2d");

    this.w = LOGICAL_W;
    this.h = LOGICAL_H;
    this.renderScale = 1;
    this.cssScale = 1;
    this.spriteEpoch = 0;
    this.hudSafeTop = 112;

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
      endingSkip: document.getElementById("btnEndingSkip"),
      creditsLine: document.getElementById("creditsLine"),
      pauseReason: document.getElementById("pauseReason"),
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
    this.btnRetryBoss = document.getElementById("btnRetryBoss");
    this.btnNewRun = document.getElementById("btnNewRun");

    // audio
    this.sfx = new SFX();
    this.audioUnavailable = false;
    this.audioReady = false;
    this._audioPromise = null;

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
    this.persistUnavailable = false;
    this.applySettings();

    // state
    this.mode = "menu"; // menu, playing, paused, levelComplete, gameOver, victory
    this.pauseReason = "user";
    this.levelIndex = 0;
    this.levelT = 0;
    this.wave = 0;
    this.waveKills = 0;
    this.wavePhase = "spawn";
    this.inBoss = false;
    this.bossClear = null;
    this.bossFinaleBursts = [];
    this.bossFinaleOrigin = null;
    this.bossIntro = null;
    this.deathInBoss = false;

    this.player = {
      x: 160,
      y: 360,
      hp: BASE_PLAYER_HP,
      maxHp: BASE_PLAYER_HP,
      shield: 0, // seconds
      shipId: this.save.selectedShip || "coconut"
    };

    // Run-wide and per-sector stats (full CONTRACT section 9 shapes; later tracks write into these fields).
    this.stats = defaultStats();
    this.levelStats = defaultLevelStats();
    this.run = null;       // live run object (=== save.run while a run exists)
    this.runMeta = null;   // { id, startLevel, ship, name, legacy } for commitHighScore
    this.toastOnce = new Set();
    this.deathsBySector = {};

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

    this.lock = null; // { kind: "enemy"|"powerup"|"boss", ref: objectRef }

    // Effects clock (A2): trauma drives the camera; shake mirrors its amplitude for legacy readers.
    this.trauma = 0;
    this.shake = 0;
    this.flash = 0;
    this.damagePulse = 0;
    this.hitStop = 0;
    this.timeScale = 1;

    // input diagnostics (A4)
    this.layoutStrikes = 0;
    this.imeStrikes = 0;
    this.keyboardSeen = false;

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

    // debug telemetry (TypeRDebug.stats)
    this._spawnLog = [];
    this._leakLog = [];

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

    window.addEventListener("focus", () => {
      if (this.mode === "playing") this.focusGameCanvas();
    });

    // main loop
    this.frameCount = 0;
    this.rafId = null;
    this.ambientAcc = 0;
    this._loopFails = 0;
    this._lastLoopErrAt = -Infinity;
    this._loop = this.loop.bind(this);
    this.prev = nowMs();
    this.rafId = requestAnimationFrame(this._loop);
  }

  // ------------------------- Loop -------------------------
  loop(t) {
    // Re-arm first so an exception below can never stop the loop (F001).
    this.rafId = requestAnimationFrame(this._loop);
    const raw = clamp((t - this.prev) / 1000, 0, 0.05);
    this.prev = t;

    try {
      this.tickEffects(raw);
      if (this.mode === "playing") {
        this.update(raw * this.timeScale);
        this.drawFrame(raw);
      } else if (this.mode === "menu") {
        // Full rate: the attract mode (D8) lives here later.
        this.stepAmbient(raw);
        this.drawFrame(raw);
      } else {
        // Paused / level complete / game over / victory: 20 fps ambient tick.
        this.ambientAcc += raw;
        if (this.ambientAcc >= AMBIENT_STEP) {
          const step = this.ambientAcc;
          this.ambientAcc = 0;
          // Game Over holds a still frame once the death impact has settled.
          if (this.mode !== "gameOver") this.stepAmbient(step);
          this.drawFrame(step);
        }
      }
      this._loopFails = 0;
    } catch (err) {
      this.onLoopError(err);
    }
  }

  drawFrame(dt) {
    this.render(dt);
    this.frameCount++;
  }

  // One synchronous frame so a new screen never shows a stale canvas; also re-arms the loop if it was
  // cancelled while the tab was hidden.
  requestFrame() {
    if (this.rafId === null && !document.hidden && this._loop) {
      this.prev = nowMs();
      this.rafId = requestAnimationFrame(this._loop);
    }
    try {
      this.drawFrame(0);
    } catch (err) {
      this.onLoopError(err);
    }
  }

  onLoopError(err) {
    const now = nowMs();
    this._loopFails = (this._loopFails || 0) + 1;
    if (now - this._lastLoopErrAt > 5000) {
      this._lastLoopErrAt = now;
      console.error("[TypeR] frame error", err);
    }
    if (this._loopFails >= 3) {
      this._loopFails = 0;
      try {
        this.stopToMenu(false);
      } catch (_) {
        this.mode = "menu";
      }
    }
  }
}
