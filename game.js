// Type-R 198X — game.js
//
// The browser build is split into load-ordered classic scripts (no bundler, no ES modules).
// Top-level const/class/function declarations in one script are visible to every later script
// through the shared global scope, so index.html must load them in exactly this order:
//
//   assets/audio/sfx.js              window.SFX
//   assets/js/core/00-util.js        clamp/lerp/rand/... helpers, normalizeKey/foldLatin, environment flags, GAME_HOOKS registry
//   assets/js/core/10-tokens.js      PALETTE / FONT / MOTION / easings / SHAKE_PAD (CSS tokens mirrored into JS)
//   assets/js/core/20-constants.js   balance constants, getHpBonusForLevel, buildBossSegments, LEVELS
//   assets/js/core/25-lexicon.js     COMMON_WORDS / PHRASES, wave-pool mix, two-word plates, weak-key bias (WORDS)
//   assets/js/core/30-content.js     word pools, boss tables, ship/boss/theme art, explosion sheet, victory script
//   assets/js/core/40-save.js        LS_KEY, defaultSave/loadSave/storeSave/migrateSave, checkpoint + resume helpers
//   assets/js/core/50-assets.js      Assets IIFE: manifest-driven image loader (window.TypeRAssets)
//   assets/js/core/60-entities.js    Enemy, Powerup, Bullet, ExplosionSprite, Particle, Boss
//   assets/js/core/70-canvas.js      roundRect, bracketRect, capsulePath, drawSplitText, fitText, drawTracked, typewriterText
//   game.js (this file)              ASSET_VERSION/withAssetVersion + class Game { constructor, loop } + hook / runMode / rand
//   assets/js/game/05-boot.js        Game.prototype: boot sequence, loading overlay, per-sector asset gate, prefetch, warmSector
//   assets/js/game/10-ui.js          Game.prototype: bindUI, setMode state machine, focus/announcer, modals/confirm, settings, toasts, top bar, mobile input
//   assets/js/game/15-screens.js     Game.prototype: sector grid, resume card, records/help modals, results cards, tutorial toasts, CRT overlay, typewriter
//   assets/js/game/17-onboarding.js  Game.prototype: first-run Flight Check, briefing disclosure (ONBOARD)
//   assets/js/game/20-run.js         Game.prototype: run/level lifecycle, checkpoints, saves, level complete / game over / victory, ending dialogue
//   assets/js/game/30-input.js       Game.prototype: keydown routing, handleTyped, lock rules, combo/multiplier, addScore
//   assets/js/game/32-typist.js      Game.prototype: hand speed, key / bigram profile, typo pair, rank lines, Flight Log (MEASURE)
//   assets/js/game/40-combat.js      Game.prototype: spawning, waves, kills, powerups, damage, update(dt)
//   assets/js/game/42-pacing.js      Game.prototype: pace controller, stakes, Cadet assist (PACE)
//   assets/js/game/45-feedback.js    Game.prototype: banner system (bossIntro/bossClear/sector/wave/callout), floaters
//   assets/js/game/50-boss.js        Game.prototype: boss fight (phases, minions, Counter-Signal, intro/outro, finale tally)
//   assets/js/game/52-modes.js       Game.prototype: Daily Sortie, Endless Drift, Drill (MODES)
//   assets/js/game/60-hud.js         Game.prototype: DOM HUD (diffed writes on a 5 Hz commit cadence), chips, boss bar, live WPM
//   assets/js/game/70-render.js      Game.prototype: resizeCanvas, plates/capsules/rails, boss art + slab, parallax, stars, render() layer order
//   assets/js/game/72-atmos.js       Game.prototype: ATMOS seam-dissolve parallax tiles, per-sector grade / lane haze / storm hue (baked once)
//   assets/js/game/75-fx-draw.js     Game.prototype: ship, beams, rings/bolts/debris, particles, overlays, vignette, active-target redraw
//   assets/js/game/47-cinematic.js  Game.prototype: CINEMATIC camera zoom (sector drop-in, boss punch), letterbox subtitles / telemetry, hazard chevrons, edge pulse, screen wipe
//   assets/js/game/73-ambient.js     Game.prototype: AMBIENT mid-depth silhouette strip, blinking emissives, weather, explosion light, bolts
//   assets/js/game/74-drones.js      Game.prototype: DRONES plate bodies (sheet from tools/art/gen_drones.py, baked per accent), tethers, wrecks
//   assets/js/game/76-bloom.js       Game.prototype: BLOOM quarter-res luminance^3 halo added over L1-L12 (no filters, no pixel reads)
//   assets/js/game/78-bossfx.js      Game.prototype: BOSSFX boss motion, emissive pulse, baked damage states, sparks / smoke (overrides drawBossArt)
//   assets/js/game/80-fx.js          Game.prototype: trauma camera, hit-stop/slow-mo, flash channels, onKeyFx/onKillFx, effect lists, stepAmbient
//   assets/js/game/82-overdrive.js   Game.prototype: Overdrive, pilotWpm (ARCADE)
//   assets/js/game/85-attract.js     Game.prototype: attract mode (ghost typist behind the title, PERF-10 idle drift)
//   assets/js/99-boot.js             const game = new Game(); window.game = game; window.TypeRDebug
//
// Every game/*.js file is an Object.assign(Game.prototype, { ... }) mixin. Methods are only called at
// runtime (after all scripts have loaded), so a method may live in any file; only top-level code
// has to respect the order above.
//
// native/sync-web.sh patches the withAssetVersion return line below by sed; keep it byte-identical.

const ASSET_VERSION = "20261031a";
// Stale-shell guard. A cache can keep serving a previous index.html after a deploy, and the server ignores ?v= when it
// resolves a file, so the old shell's versioned URLs come back with this release's code:
//   * a host page cache (SiteGround's dynamic cache did it for "/" on 2026-10-17) or a browser that cached a
//     pre-overhaul shell: it loads only this file (no assets/js/ scripts) and cannot boot the split build;
//   * a browser that kept an older modular /index.html (served max-age=15552000, 180 days): its assets/js/ tags carry
//     an older ?v= token, so it boots this release's code without the scripts and markup the release added.
// Either way the page is reloaded once with the current token in the query string, a URL no cache has seen. The
// current shell carries ?v=ASSET_VERSION on every tag (tools/bump-version.sh writes both), so it never takes this
// path; the v= check stops a second reload if a stale copy somehow comes back. Never on file: or in the native
// wrappers (their bundled shell is synced with this file by native/sync-web.sh and its URLs are bare).
// What it cannot reach: a browser that cached the whole older build at /index.html (shell and scripts, the normal
// state after the footer pages' "Back to the game" links) runs that build with zero requests, so this file never
// loads there (release finding RET-1). Nor a mixed cache (release review RB-1): a browser that kept the older
// /index.html and the older game.js but lost one other assets/js script fetches that script's old ?v= URL, gets this
// release's file (the host ignores the query) and runs old and new code together; Resume can do nothing, plates can
// stop spawning or a boss can stop taking damage, with "[TypeR] frame error" in the console, until the player reloads
// once (the reload revalidates /index.html, and the new shell's ?v= URLs are all new). Once a browser runs this shell
// (it loads "/", served no-cache), revalidateDocs refreshes its long-lived copies of /index.html and the secondary
// pages, and the in-site links carry ?v=<token> (bump-version.sh), so the next /index.html visit is this release. A
// browser that never sends a request keeps its copy until it expires; only the host can stop new 180-day entries
// (DEPLOY.md step 6).
(function staleShellGuard() {
  try {
    if (typeof document === "undefined" || typeof location === "undefined" || location.protocol === "file:") return;
    if (typeof IS_NATIVE_SHELL !== "undefined" ? IS_NATIVE_SHELL : /TypeR198X-(macOS|iOS)/i.test(navigator.userAgent || "")) return;
    if (new URLSearchParams(location.search).get("v") === ASSET_VERSION) {
      // Arrived here through the reload or a tokenized in-site link: refresh the bare document URLs so the browser's
      // 180-day copy of the old shell is replaced and the next visit to /index.html needs no reload ("/" is no-cache).
      revalidateDocs(true);
      return;
    }
    const tags = document.querySelectorAll('script[src*="assets/js/"]');
    let stale = tags.length === 0;
    for (const s of tags) {
      const v = new URL(s.src, location.href).searchParams.get("v");
      if (v && v !== ASSET_VERSION) { stale = true; break; }
    }
    if (!stale) { revalidateDocs(false); return; }
    const u = new URL(location.href);
    u.searchParams.set("v", ASSET_VERSION);
    location.replace(u.toString());
  } catch (_) { /* never let the guard itself break a boot */ }

  // After load, revalidate the documents the host serves with max-age=15552000: cache "no-cache" sends a conditional
  // request (a 304 without a body while the copy is current) and stores a changed copy. Only for a returning browser
  // (the page arrived through ?v=, or a save exists; nothing new is stored): a first visit holds no stale copy.
  function revalidateDocs(arrived) {
    if (typeof fetch !== "function" || typeof addEventListener !== "function") return;
    let returning = arrived;
    if (!returning) { try { returning = typeof LS_KEY === "string" && localStorage.getItem(LS_KEY) !== null; } catch (_) { returning = false; } }
    if (!returning) return;
    const run = () => {
      for (const page of ["index.html", "privacy-policy.html", "support.html", "info.html"]) {
        // The body is read so the cache entry is written out whole (an unread body may stay pending).
        try { fetch(new URL(page, location.href).toString(), { cache: "no-cache" }).then((r) => r.arrayBuffer()).catch(() => {}); } catch (_) { /* offline / blocked */ }
      }
    };
    // At idle after the first keystroke (keydown, or the touch field's input), else 30 s after load for a visit that
    // never types: never inside the boot budget measured up to the first keystroke (CONTRACT 8.z Z11; a returning
    // save's matrix rows paid ~0.07 MB for it), and out of the way of the boot's own requests.
    let fired = false, timer = 0;
    const go = () => {
      if (fired) return;
      fired = true;
      clearTimeout(timer);
      removeEventListener("keydown", go, true);
      removeEventListener("input", go, true);
      if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout: 3000 }); else setTimeout(run, 0);
    };
    addEventListener("keydown", go, true);
    addEventListener("input", go, true);
    const arm = () => { if (!fired) timer = setTimeout(go, 30000); };
    if (document.readyState === "complete") arm();
    else addEventListener("load", arm, { once: true });
  }
})();
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
    // Opaque context: the base fill covers the shake margin, so no page background ever shows through (F051).
    this.ctx = this.canvas.getContext("2d", { alpha: false });

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
      crtOverlay: document.getElementById("crtOverlay"),
      loading: document.getElementById("loadingOverlay"),
      storyModal: document.getElementById("storyModal"),
      storyLaunch: document.getElementById("btnStoryLaunch"),
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
    this.endingScript = getVictoryScript();
    this.endingIndex = 0;

    // Art is owned by the Assets loader (50-assets.js): the boot sequence in 05-boot.js loads the critical set,
    // startLevel loads each sector's bg/fg/boss on demand and the renderer reads drawables through Assets.get()
    // / Assets.sprite() every frame. Fields below are filled by initBoot().
    this.assetsReady = false;
    this.degradedAssets = false;
    this.levelReady = false;
    this.levelWait = 0;
    this.bootPromise = null;
    this.fontsReady = null;
    this.plateCache = new Map();
    this.debug = { railsDrawn: false, tileDraws: 0 };

    // Save + settings (applySettings resolves motion, CRT and the audio buses from save.settings)
    this.save = loadSave();
    this.persistUnavailable = false;
    this.modalStack = [];
    this.reduceMotion = false;
    this.touchMode = false;
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

    // Effects clock (A2): trauma drives the camera; shake mirrors its amplitude in px (pause / reduce-motion zero it).
    this.trauma = 0;
    this.shake = 0;
    this.hitStop = 0;
    this.timeScale = 1;

    // input diagnostics (A4) + keyboard evidence (C7)
    this.layoutStrikes = 0;
    this.imeStrikes = 0;
    this.keyboardSeen = false;
    this.lastTypeValue = "";

    // background parallax
    this.stars = this.makeStars(180);
    this.starT = 0;

    this.currentTheme = getThemeForLevel(0);
    this.parallax = { bgOffset: 0, fgOffset: 0 };

    // spawn timers
    this.spawnAcc = 0;
    this.powerAcc = 0;
    this.minionAcc = 0;

    // debug telemetry (TypeRDebug.stats)
    this._spawnLog = [];
    this._leakLog = [];

    // autosave
    this.lastSaveAt = 0;

    // focus target: the canvas (or #typeInput on touch devices while playing; see focusGameCanvas)
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute("role", "application");

    this.bindUI();
    this.refreshMenu();

    // HiDPI backing store (A6): logical 1280x720, device pixels = round(1280*renderScale)
    this.bindResize();
    this.resizeCanvas();

    // Boot (A8): Assets.init at the computed renderScale, critical set + display font behind the loading
    // overlay, watchdogs, error UI, ship-card hydration. Everything after this line must not block on art.
    this.initBoot();

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
      // DOM-side timers (tutorial toasts, count-ups) live in the screens track; feature-detected.
      if (typeof this.tickUI === "function") this.tickUI(raw);
      if (this.mode === "playing") {
        // Per-sector asset gate + next-sector prefetch (05-boot.js); cheap and idempotent per frame.
        this.tickBoot(raw);
        this.update(raw * this.timeScale);
        this.drawFrame(raw);
      } else if (this.mode === "menu") {
        // Full rate. Attract mode (D8, 85-attract.js) steps before the ambient drift so its parallax multiplier
        // applies this frame; PERF-10 lets it drop the draw to 20 fps once the menu has been idle for 90 s.
        if (typeof this.updateAttract === "function") this.updateAttract(raw);
        this.stepAmbient(raw);
        if (!(typeof this.attractFrameSkip === "function" && this.attractFrameSkip())) this.drawFrame(raw);
      } else {
        // Paused / level complete / game over / victory: 20 fps ambient tick.
        this.ambientAcc += raw;
        if (this.ambientAcc >= AMBIENT_STEP) {
          const step = this.ambientAcc;
          this.ambientAcc = 0;
          // Game Over holds a still frame once the death impact has settled.
          if (this.mode !== "gameOver") this.stepAmbient(step);
          // Level Complete pre-uploads the next sector's bitmaps (05-boot.js) so its first frame does not hitch.
          if (this.mode === "levelComplete") this.warmNextSector();
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

// Training scaffold: the hook emitter and the gameplay RNG every game/* mixin shares (they load after this file).
Object.assign(Game.prototype, {
  // Runs GAME_HOOKS[name] with this = game (core/00-util.js); returns evt so emit sites can read mutated fields.
  hook(name, evt) {
    return runGameHooks(name, evt, this);
  },

  // The run's mode (D9): "campaign" | "daily" | "endless" | "drill". No run (menu, Flight Check) reads as campaign.
  runMode() {
    return (this.run && this.run.mode) || "campaign";
  },

  // Gameplay randomness (spawner text / lane / speed / roll-in, powerup rolls and drops, minion picks): the seeded
  // this._rng a mode installs (MODES' Daily Sortie), never during a campaign run; Math.random otherwise. Visual randomness
  // (particles, shake, explosions, sparks, finale bursts) keeps Math.random.
  rand() {
    return (this._rng && this.runMode() !== "campaign") ? this._rng() : Math.random();
  },
  randRange(a, b) {
    return a + this.rand() * (b - a);
  },
  randPick(list) {
    return list[Math.floor(this.rand() * list.length)];
  }
});
