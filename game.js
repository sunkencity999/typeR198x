import { SFX } from "./assets/audio/sfx.js";

// ----------------------------- Utilities -----------------------------
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const choice = (arr) => arr[randi(0, arr.length - 1)];

const ASSET_VERSION = "v20251129a";
const withAssetVersion = (path) => {
  if (!path) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}${ASSET_VERSION}`;
};

const EXPLOSION_SHEET = {
  src: "./assets/explosions/explosions.png",
  width: 2048,
  height: 1117
};

const EXPLOSION_FRAMES = [
  { x: 586, y: 118, w: 164, h: 162 },
  { x: 353, y: 135, w: 147, h: 144 },
  { x: 127, y: 154, w: 135, h: 126 },
  { x: 1647, y: 393, w: 255, h: 332 },
  { x: 1325, y: 403, w: 261, h: 321 },
  { x: 1008, y: 416, w: 273, h: 309 },
  { x: 703, y: 456, w: 249, h: 268 },
  { x: 368, y: 502, w: 268, h: 221 },
  { x: 2280, y: 555, w: 242, h: 170 },
  { x: 111, y: 562, w: 207, h: 162 },
  { x: 1233, y: 598, w: 23, h: 22 },
  { x: 1513, y: 890, w: 293, h: 312 },
  { x: 967, y: 913, w: 506, h: 515 },
  { x: 1894, y: 937, w: 219, h: 236 },
  { x: 486, y: 1018, w: 419, h: 409 },
  { x: 81, y: 1106, w: 379, h: 321 },
  { x: 1531, y: 1177, w: 96, h: 85 },
  { x: 2138, y: 1232, w: 520, h: 195 },
  { x: 2557, y: 1243, w: 43, h: 41 },
  { x: 1535, y: 1265, w: 578, h: 162 },
  { x: 2656, y: 1422, w: 14, h: 7 }
];

const EXPLOSION_SETS = {
  small: { frames: [0, 1, 2, 10], scale: 0.9, frameTime: 0.05 },
  medium: { frames: [3, 4, 5, 6, 7, 8, 9], scale: 1.0, frameTime: 0.065 },
  large: { frames: [11, 12, 14, 15, 17, 19, 20], scale: 1.15, frameTime: 0.075 }
};

const BOSS_ARTS = [
  { level: 1, src: "./assets/boss_ships/firstlevelBoss.png" },
  { level: 2, src: "./assets/boss_ships/secondlevelboss.png" },
  { level: 3, src: "./assets/boss_ships/thirdlevelboss.png" },
  { level: 4, src: "./assets/boss_ships/fourthevelboss.png" },
  { level: 5, src: "./assets/boss_ships/fifthlevelboss.png" },
  { level: 6, src: "./assets/boss_ships/sixthlevelboss.png" },
  { level: 7, src: "./assets/boss_ships/seventhlevelboss.png" },
  { level: 8, src: "./assets/boss_ships/eigthlevelboss.png" },
  { level: 9, src: "./assets/boss_ships/ninthlevelboss.png" },
  { level: 10, src: "./assets/boss_ships/10thlevelboss.png" }
];

function getVictoryScript() {
  return [
    { speaker: "SYSTEM // TYPEGRID", text: "SIGNAL RESTORED…" },
    { speaker: "SYSTEM // TYPEGRID", text: "WORDSTORM COLLAPSING…" },
    { speaker: "SYSTEM // TYPEGRID", text: "CHECKSUM: CLEAN" },
    { speaker: "PILOT (YOU)", text: "…Did I just spell-check a god?" },
    { speaker: "TYPEGRID", text: "CONFIRMATION: YES. NICE WORK, PILOT." },
    { speaker: "ELECTROMANCER EMPRESS", text: "Impossible. My message was perfect. My syntax was law." },
    { speaker: "PILOT (YOU)", text: "Your syntax was… aggressive." },
    { speaker: "ELECTROMANCER EMPRESS", text: "You think you won because you typed faster? No— You won because you typed clean." },
    { speaker: "TYPEGRID", text: "TRANSLATION: ‘ACCURACY > ATTITUDE.’" },
    { speaker: "PILOT (YOU)", text: "Yeah. Turns out the universe prefers correct punctuation." },
    { speaker: "ELECTROMANCER EMPRESS", text: "I only wanted to be heard. To become the headline. To fill every screen… with me." },
    { speaker: "PILOT (YOU)", text: "The city’s got plenty of screens. Just… maybe don’t annex reality next time." },
    { speaker: "ELECTROMANCER EMPRESS", text: "…Accepted." },
    { speaker: "TYPEGRID", text: "HOSTILE MESSAGE DISARMED. EXECUTING PATCH: ‘HUMILITY v1.0’" },
    { speaker: "PILOT (YOU)", text: "That’s a patch note I’d frame." },
    { speaker: "TYPEGRID", text: "SECTOR 10 CLEARED. TYPEGRID ONLINE. SKYWAYS SAFE." },
    { speaker: "CONTROL (RADIO)", text: "Keystream—this is Control. The billboards stopped screaming. The monorails stopped rhyming. The arcade cabinets… stopped judging us." },
    { speaker: "PILOT (YOU)", text: "Tell them I’m available for… proofreading." },
    { speaker: "CONTROL (RADIO)", text: "Pilot… you saved the city. We’re uploading your score to every screen from here to forever." },
    { speaker: "TYPEGRID", text: "HIGH SCORE CONFIRMED. LEGEND STATUS GRANTED. PLEASE DO NOT LET IT GO TO YOUR HEAD." },
    { speaker: "PILOT (YOU)", text: "No promises." },
    { speaker: "SYSTEM // TYPEGRID", text: "ONE LAST PROMPT: ‘PRESS START TO PLAY AGAIN.’" },
    { speaker: "PILOT (YOU)", text: "…Okay. One more run." }
  ];
}

const SHIP_CONFIGS = {
  coconut: {
    id: "coconut",
    name: "The S.S. Coconut",
    src: "./assets/ships/S_S_Coconut.png"
  },
  "little-dark-one": {
    id: "little-dark-one",
    name: "The S.S. Little Dark One",
    src: "./assets/ships/S_S_littledarkone.png"
  },
  sofrito: {
    id: "sofrito",
    name: "The S.S. Sofrito",
    src: "./assets/ships/S_S_Sofrito.png"
  },
  honeybee: {
    id: "honeybee",
    name: "The S.S. HoneyBee",
    src: "./assets/ships/S_S_honeyBee.png"
  }
};

const getShipConfig = (id) => SHIP_CONFIGS[id] || SHIP_CONFIGS.coconut;

function getResumeLevelIndex(save) {
  if (save.run) {
    return clamp(save.run.levelIndex ?? 0, 0, 9);
  }
  const unlocked = clamp((save.lastUnlockedLevel || 1) - 1, 0, 9);
  return unlocked > 0 ? unlocked : null;
}

function buildResumeRun(levelIndex, maxHp, shipId) {
  return {
    levelIndex: clamp(levelIndex, 0, 9),
    levelT: 0,
    inBoss: false,
    hp: maxHp,
    shield: 0,
    power: { spread: 0, pierce: 0, rapid: 0, multiplier: 0 },
    stats: { score: 0, combo: 0, mult: 1, correct: 0, total: 0 },
    spawnAcc: 0,
    powerAcc: 0,
    minionAcc: 0,
    hazardAcc: 0,
    shipId,
    maxHp
  };
}

function clampPlayerHp(player) {
  player.hp = clamp(player.hp, 0, player.maxHp);
}

function getHpBonusForLevel(levelNumber) {
  return BASE_PLAYER_HP + Math.max(0, (levelNumber - 1)) * LEVEL_HP_BONUS;
}

const BASE_PLAYER_HP = 200;
const LEVEL_HP_BONUS = 100;

const PARALLAX_THEMES = [
  {
    id: "first",
    bg: "./assets/backgrounds/firstlevelbg.png",
    fg: "./assets/foregrounds/firstlevelFG.png",
    bgSpeed: 16,
    fgSpeed: 46,
    fgHeight: 0.55
  },
  {
    id: "second",
    bg: "./assets/backgrounds/secondlevelbg.png",
    fg: "./assets/foregrounds/secondlevelFG.png",
    bgSpeed: 18,
    fgSpeed: 50,
    fgHeight: 0.58
  },
  {
    id: "third",
    bg: "./assets/backgrounds/thirdlevelbg.png",
    fg: "./assets/foregrounds/thirdlevelFG.png",
    bgSpeed: 19,
    fgSpeed: 54,
    fgHeight: 0.6,
    tileFg: false
  },
  {
    id: "fourth",
    bg: "./assets/backgrounds/fourthlevelbg.png",
    fg: "./assets/foregrounds/fourthlevelFG.png",
    bgSpeed: 20,
    fgSpeed: 58,
    fgHeight: 0.62
  },
  {
    id: "fifth",
    bg: "./assets/backgrounds/fifthlevelbg.png",
    fg: "./assets/foregrounds/fifthlevelFG.png",
    bgSpeed: 22,
    fgSpeed: 62,
    fgHeight: 0.64
  }
];
const getThemeForLevel = (index) => {
  if (index < 5) return PARALLAX_THEMES[index];
  const themeIndex = (index - 5) % PARALLAX_THEMES.length;
  return PARALLAX_THEMES[themeIndex];
};
const nowMs = () => performance.now();

function formatInt(n) {
  return Math.floor(n).toLocaleString();
}

function normalizeKey(e) {
  // Only accept printable single-character keys & space.
  const k = e.key;
  if (k === " ") return " ";
  if (k.length === 1) return k.toLowerCase();
  return null;
}

// ----------------------------- Storage -----------------------------
const LS_KEY = "typesmup198x.save.v1";

const defaultSave = () => ({
  playerName: "",
  selectedShip: "coconut",
  highScore: 0,
  lastUnlockedLevel: 1, // 1..10
  storySeen: false,
  keyboardHintSeen: false,
  settings: { muted: false, crt: true },
  run: null // { levelIndex, score, hp, seed, shipId, powerups, stats, time, ... }
});

function loadSave() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return defaultSave();
    const obj = JSON.parse(raw);
    const base = defaultSave();
    return {
      ...base,
      ...obj,
      settings: { ...base.settings, ...(obj.settings || {}) }
    };
  } catch {
    return defaultSave();
  }
}

function storeSave(save) {
  localStorage.setItem(LS_KEY, JSON.stringify(save));
}

// ----------------------------- Content -----------------------------
const WORDS_EASY = [
  "neon","arcade","laser","shift","type","pilot","score","combo","spark","wave","nova","drift","glow","bolt","trail",
  "vita","kana","pixel","grid","chrome","vapor","retro","japan","tokyo","speed","boost","hype","dash","flame",
  "pulse","turbo","synth","glyph","flux","radar","orbit","phase","metro","rhythm","drive","glide","storm","blitz","trace",
  "flash","macro","byte","logic","gloss","cyber","tempo","sparkle","vector","arc","beam","ionic","jolt","zeta","strobe",
  "nimbus","hover","zen","flow","flare","vibe","silk","digi","lumen","vivid","aero","retrobit","plasma","rocket","saber",
  "chrono","booster","neutrino","pixelate","analog","scroll","novae","lazer","analog","mecha","sparkplug","polystar","warp","glitch"
];

const WORDS_MED = [
  "afterburn","synthesis","hologram","cyberline","starlight","turbowave","polychrome","flicker","overdrive","nighttrain",
  "skybridge","magnetic","chromatic","vectorized","hyperjump","nanoforge","rainmaker","phasegate","sideload","monorail",
  "neonforge","photonic","datastream","holomatrix","retroshock","geostorm","ionlanes","spectralink","quantaflux","metadrift",
  "midnight","laserbank","typhoon","palindrome","dreamline","tachyon","citylight","afterglow","retrograde","hyperlane",
  "dataglide","omnivoid","nanoloom","stormrail","polyverse","synthwave","neutrify","skyforge","holopunk","bytecycle"
];

const WORDS_HARD = [
  "interference","electrostatic","parallaxing","synchronizer","microprocessor","hyperspectral","transcontinental",
  "neuroplastic","deterministic","antigravity","spectrograph","electromancer","autocorrelation","metachronistic",
  "ultrachromatic","dimensional","polyharmonics","omnidirectional","chronoelastic","retrotransmission","technocratic",
  "phosphorescent","vectorization","megalopolitan","interstellar","spectrophonic","metallurgical","hypervectorial",
  "telekinetics","chronostatic","nanofabrication","bioelectric","vibrosensing","quantumspliced","aerolithics",
  "transnebulous","astrocartography","thermodynamic","luminescence","neurotransmitter","tachyometric","photogrammetric"
];

// Boss segments per level (stylized phrases; avoid punctuation that is annoying to type)
const BOSS_SEGMENT_BASE = [
  ["neon", "express", "boss"],
  ["turbo", "arcade", "guardian"],
  ["hyper", "vector", "shogun"],
  ["plasma", "temple", "warden"],
  ["chrome", "legend", "engine"],
  ["process", "titan", "matrix"],
  ["null", "queen", "symphony"],
  ["logic", "dragon", "protocol"],
  ["night", "engine", "evermore"],
  ["final", "electro", "sovereign"]
];

const BOSS_WORD_POOL = [
  "neon","signal","vector","ghost","quantum","phase","horizon","vapor",
  "matrix","gamma","cypher","shadow","omega","binary","cadence","volt",
  "nova","spirit","core","zenith","rift","cipher","delta","glyph",
  "static","echo","sable","flux","lumen","aether","cinder","pulse",
  "aurora","glitch","cursor","plinth","bastion","spire","ember","auric",
  "radiant","specter","lattice","ionstorm","solstice","parallax","carbon","crystal",
  "hyperion","omega","solenoid","paladin","cathedral","symphony","monolith","oblivion",
  "zenithal","transistor","oscillation","helix","redshift","sunflare","midnight","membrane"
];

const shuffle = (arr) => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

function buildBossSegments(level) {
  const base = (BOSS_SEGMENT_BASE[level - 1] || ["neon", "boss"]).map(w => w.toLowerCase());
  const needed = (base.length * 2) + Math.max(0, (level - 1) * 5);
  const extraNeeded = Math.max(0, needed - base.length);
  const pool = shuffle([...BOSS_WORD_POOL]);
  const extras = [];
  while (extras.length < extraNeeded) {
    if (pool.length === 0) shuffle(pool);
    extras.push((pool.shift() || "nova").toLowerCase());
  }
  return [...base, ...extras];
}

// ----------------------------- Level Config -----------------------------
const LEVELS = Array.from({ length: 10 }, (_, i) => {
  const level = i + 1;
  const baseSpeed = lerp(95, 210, i / 9);              // px/s
  const spawnRate = lerp(0.75, 1.8, i / 9);            // enemies/second
  const maxEnemies = Math.round(lerp(6, 14, i / 9));
  const wordMin = Math.round(lerp(3, 7, i / 9));
  const wordMax = Math.round(lerp(5, 12, i / 9));
  const letterRatio = lerp(0.78, 0.25, i / 9);         // early more letters
  const duration = Math.round(lerp(26, 38, i / 9)) * 3;    // three waves before boss
  const bossName = ["SIGNAL WRAITH","VECTOR OGRE","PLASMA SHOGUN","HOLO TITAN","CHROME MONOLITH","SYNC LEVIATHAN","STATIC EMPRESS","LOGIC DRAGON","NIGHT ENGINE","FINAL ELECTROMANCER"][i];

  return {
    level,
    baseSpeed,
    spawnRate,
    maxEnemies,
    wordMin,
    wordMax,
    letterRatio,
    duration,
    boss: {
      name: bossName,
      minionRate: lerp(0.35, 0.75, i / 9),
      hazardRate: lerp(0.0, 0.55, i / 9) // starting from level 1 no hazards
    }
  };
});

// ----------------------------- Game Entities -----------------------------
class Enemy {
  constructor({ text, x, y, speed, kind = "enemy" }) {
    this.kind = kind; // enemy | bossMinion
    this.text = text.toLowerCase();
    this.progress = 0;
    this.x = x;
    this.y = y;
    this.speed = speed;
    this.radius = 18 + Math.min(42, this.text.length * 6);
    this.alive = true;
    this.flash = 0;
    this.locked = false;
  }
  remaining() { return this.text.slice(this.progress); }
  nextChar() { return this.text[this.progress] || null; }
  update(dt) {
    this.x -= this.speed * dt;
    this.flash = Math.max(0, this.flash - dt * 5);
  }
}

class Powerup {
  constructor({ type, label, x, y, speed }) {
    this.kind = "powerup";
    this.type = type;
    this.label = label.toLowerCase();
    this.progress = 0;
    this.x = x;
    this.y = y;
    this.speed = speed;
    this.alive = true;
    this.locked = false;
    this.floatT = rand(0, Math.PI * 2);
  }
  remaining() { return this.label.slice(this.progress); }
  nextChar() { return this.label[this.progress] || null; }
  update(dt) {
    this.x -= this.speed * dt;
    this.floatT += dt * 2.1;
    this.y += Math.sin(this.floatT) * dt * 10;
  }
}

class Bullet {
  constructor({ x, y, tx, ty, life = 0.08, width = 3, color = "cyan" }) {
    this.kind = "bullet";
    this.x = x; this.y = y;
    this.tx = tx; this.ty = ty;
    this.life = life;
    this.t = 0;
    this.width = width;
    this.color = color; // cyan | magenta | lime
  }
  update(dt) {
    this.t += dt;
  }
  alive() { return this.t < this.life; }
}

class ExplosionSprite {
  constructor({ x, y, type = "small", sheet }) {
    this.x = x;
    this.y = y;
    this.sheet = sheet;
    const cfg = EXPLOSION_SETS[type] || EXPLOSION_SETS.small;
    this.frames = cfg.frames;
    this.frameIndex = 0;
    this.scale = cfg.scale ?? 1;
    this.frameTime = 0;
    this.perFrame = cfg.frameTime ?? 0.06;
    this.done = false;
  }
  update(dt) {
    if (this.done) return;
    const ready = this.sheet && this.sheet.complete && this.sheet.naturalWidth > 0;
    if (!ready) return;
    this.frameTime += dt;
    while (this.frameTime >= this.perFrame) {
      this.frameTime -= this.perFrame;
      this.frameIndex++;
      if (this.frameIndex >= this.frames.length) {
        this.done = true;
        break;
      }
    }
  }
  draw(ctx) {
    if (this.done || !this.sheet) return;
    const ready = this.sheet.complete && this.sheet.naturalWidth > 0;
    if (!ready) return;

    const frameIdx = this.frames[Math.min(this.frameIndex, this.frames.length - 1)];
    const frame = EXPLOSION_FRAMES[frameIdx];
    if (!frame) return;
    const { x, y, w, h } = frame;
    const dw = w * this.scale;
    const dh = h * this.scale;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.drawImage(this.sheet, x, y, w, h, this.x - dw / 2, this.y - dh / 2, dw, dh);
    ctx.restore();
  }
}

class Particle {
  constructor({ x, y, vx, vy, life, size, hue }) {
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.life = life;
    this.t = 0;
    this.size = size;
    this.hue = hue;
  }
  update(dt) {
    this.t += dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.vx *= (1 - dt * 2.2);
    this.vy *= (1 - dt * 2.2);
  }
  alive() { return this.t < this.life; }
  alpha() { return 1 - (this.t / this.life); }
}

class Boss {
  constructor({ name, segments, artLevel }) {
    this.kind = "boss";
    this.name = name;
    this.segments = segments.map(s => s.toLowerCase());
    this.segmentIndex = 0;
    this.progress = 0;
    this.x = 980;
    this.y = 250;
    this.vy = 0;
    this.phaseT = 0;
    this.flash = 0;
    this.alive = true;
    this.artLevel = artLevel;
  }
  get segment() { return this.segments[this.segmentIndex] || null; }
  get remaining() {
    const seg = this.segment;
    return seg ? seg.slice(this.progress) : "";
  }
  get nextChar() {
    const seg = this.segment;
    return seg ? (seg[this.progress] || null) : null;
  }
  get done() { return this.segmentIndex >= this.segments.length; }
  get maxLen() { return Math.max(...this.segments.map(s => s.length)); }
  get totalChars() { return this.segments.reduce((a,s)=>a+s.length,0); }
  charsDone() {
    let done = 0;
    for (let i=0;i<this.segmentIndex;i++) done += this.segments[i].length;
    done += this.progress;
    return done;
  }
  hpFrac() {
    const total = this.totalChars;
    return total <= 0 ? 0 : 1 - (this.charsDone() / total);
  }
  update(dt, h) {
    this.phaseT += dt;
    // Gentle float
    this.y = 240 + Math.sin(this.phaseT * 0.8) * 60;
    this.flash = Math.max(0, this.flash - dt * 5);
  }
  advance() {
    this.progress++;
    this.flash = 0.25;
    if (this.progress >= this.segment.length) {
      this.segmentIndex++;
      this.progress = 0;
    }
  }
}

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
      img.crossOrigin = "anonymous";
      this.registerAsset(img, () => {
        this.shipImages[id] = this.prepareShipSprite(img);
      });
      img.src = withAssetVersion(cfg.src);
      this.shipImages[id] = img;
    });

    this.themeImages = {};
    PARALLAX_THEMES.forEach((theme) => {
      const bg = new Image();
      bg.crossOrigin = "anonymous";
       this.registerAsset(bg);
      bg.src = withAssetVersion(theme.bg);
      const fg = new Image();
      fg.crossOrigin = "anonymous";
       this.registerAsset(fg);
      fg.src = withAssetVersion(theme.fg);
      this.themeImages[theme.id] = { bg, fg };
    });

    this.bossArtImages = {};
    BOSS_ARTS.forEach((art) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
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
    this.explosionSheet.crossOrigin = "anonymous";
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

  getSelectedShipId() {
    return this.save.selectedShip || "coconut";
  }

  setPlayerShip(id) {
    const cfg = getShipConfig(id);
    this.player.shipId = cfg.id;
  }

  currentShipId() {
    return this.player.shipId || this.getSelectedShipId();
  }

  prepareShipSprite(img) {
    const canvas = document.createElement("canvas");
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    try {
      const data = ctx.getImageData(0, 0, w, h);
      const pixels = data.data;
      // sample corners to determine background color
      const sample = (x, y) => {
        const idx = (y * w + x) * 4;
        return [pixels[idx], pixels[idx + 1], pixels[idx + 2]];
      };
      const base = sample(0, 0);
      const tol = 12;
      for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i];
        const g = pixels[i + 1];
        const b = pixels[i + 2];
        if (Math.abs(r - base[0]) <= tol && Math.abs(g - base[1]) <= tol && Math.abs(b - base[2]) <= tol) {
          pixels[i + 3] = 0;
        }
      }
      ctx.putImageData(data, 0, 0);
    } catch {
      // ignore security errors, fallback to original image
      return img;
    }
    return canvas;
  }
  focusGameCanvas() {
    if (!this.canvas) return;
    if (document.activeElement !== this.canvas) {
      this.canvas.focus({ preventScroll: true });
    }
  }

  bindUI() {
    this.btnStart.addEventListener("click", async () => {
      await this.ensureAudio();
      const name = (this.ui.playerName.value || "").trim();
      if (name) this.save.playerName = name;
      this.save.run = null;
      this.storeAndRefresh();
      this.handleLaunchRequest();
    });

    this.btnContinue.addEventListener("click", async () => {
      await this.ensureAudio();
      const name = (this.ui.playerName.value || "").trim();
      if (name) this.save.playerName = name;
      this.storeAndRefresh();
      if (this.save.run) {
        this.continueRun();
        this.focusGameCanvas();
        return;
      }
      const resumeIndex = getResumeLevelIndex(this.save);
      if (resumeIndex !== null) {
        this.save.run = buildResumeRun(resumeIndex, this.player.maxHp, this.getSelectedShipId());
        storeSave(this.save);
        this.continueRun();
        this.focusGameCanvas();
        return;
      }
      this.handleLaunchRequest();
    });

    this.btnResetSave.addEventListener("click", () => {
      this.save = defaultSave();
      storeSave(this.save);
      this.applySettings();
      this.refreshMenu();
    });

    this.btnPause.addEventListener("click", () => this.togglePause());
    this.btnStop.addEventListener("click", () => this.stopToMenu(true));
    this.btnMute.addEventListener("click", () => this.toggleMute());
    this.btnCRT.addEventListener("click", () => this.toggleCRT());

    this.btnResume.addEventListener("click", () => { this.setMode("playing"); this.focusGameCanvas(); });
    this.btnRestart.addEventListener("click", () => { this.restartLevel(); this.focusGameCanvas(); });

    this.btnNextLevel.addEventListener("click", () => { this.advanceLevel(); this.focusGameCanvas(); });
    this.btnBackToMenu1.addEventListener("click", () => this.stopToMenu(true));
    this.btnBackToMenu2.addEventListener("click", () => this.stopToMenu(true));
    this.btnBackToMenu3.addEventListener("click", () => this.stopToMenu(true));
    this.btnTryAgain.addEventListener("click", () => { this.restartLevel(); this.focusGameCanvas(); });
    this.btnNewRun.addEventListener("click", () => { this.startNewRun(); this.focusGameCanvas(); });

    if (this.ui.endingNext) {
      this.ui.endingNext.addEventListener("click", () => this.advanceEndingDialogue());
    }

    if (this.keyboardHintBtn) {
      this.keyboardHintBtn.addEventListener("click", () => this.dismissKeyboardHint());
    }

    if (this.storyLaunchBtn) {
      this.storyLaunchBtn.addEventListener("click", () => {
        this.hideStoryModal();
        if (this.pendingLaunch === "continue") {
          this.startGameplayFlow(false);
        } else {
          this.startGameplayFlow(true);
        }
      });
    }

    this.shipInputs.forEach((input) => {
      input.addEventListener("change", () => {
        if (!input.checked) return;
        this.save.selectedShip = input.value;
        storeSave(this.save);
      });
    });

    // Keyboard
    window.addEventListener("keydown", async (e) => {
      if (e.repeat) return;

      const target = e.target;
      const tag = (target && target.tagName) ? target.tagName.toLowerCase() : "";
      const isEditable =
        tag === "input" ||
        tag === "textarea" ||
        (target && target.isContentEditable) ||
        (document.activeElement && document.activeElement.isContentEditable);
      if (isEditable) return;

      if (e.key === "Escape") {
        e.preventDefault();
        if (this.mode === "playing" || this.mode === "paused") this.togglePause();
        return;
      }

      if (this.mode !== "playing") return;
      const ch = normalizeKey(e);
      if (!ch) return;

      e.preventDefault();
      await this.ensureAudio();
      this.handleTyped(ch);
    });

    window.addEventListener("blur", () => {
      if (this.mode === "playing") this.setMode("paused");
      this.saveRun(true);
    });

    window.addEventListener("beforeunload", () => {
      this.saveRun(true);
    });
  }

  async ensureAudio() {
    await this.sfx.unlock();
    this.sfx.setMuted(this.save.settings.muted);
  }

  applySettings() {
    this.sfx.setMuted(this.save.settings.muted);
    this.btnMute.textContent = this.save.settings.muted ? "Unmute" : "Mute";
    this.ui.crtOverlay.style.display = this.save.settings.crt ? "block" : "none";
    this.btnCRT.textContent = this.save.settings.crt ? "CRT:ON" : "CRT:OFF";
  }

  toggleMute() {
    this.save.settings.muted = !this.save.settings.muted;
    this.applySettings();
    storeSave(this.save);
  }

  toggleCRT() {
    this.save.settings.crt = !this.save.settings.crt;
    this.applySettings();
    storeSave(this.save);
  }

  togglePause() {
    if (this.mode === "playing") this.setMode("paused");
    else if (this.mode === "paused") this.setMode("playing");
  }

  setMode(m) {
    this.mode = m;
    // screens
    this.ui.menu.classList.toggle("hidden", m !== "menu");
    this.ui.paused.classList.toggle("hidden", m !== "paused");
    this.ui.levelComplete.classList.toggle("hidden", m !== "levelComplete");
    this.ui.gameOver.classList.toggle("hidden", m !== "gameOver");
    this.ui.victory.classList.toggle("hidden", m !== "victory");
    // Pause button label
    this.btnPause.textContent = (m === "paused") ? "Resume" : "Pause";
    // Autosave when leaving playing
    if (m !== "playing") this.saveRun(true);
    // Focus canvas
    if (m === "playing") this.canvas.focus();
  }

  refreshMenu() {
    this.ui.playerName.value = this.save.playerName || "";
    this.ui.statHigh.textContent = formatInt(this.save.highScore || 0);
    this.ui.statUnlocked.textContent = `${this.save.lastUnlockedLevel || 1}/10`;
    const resumeIndex = getResumeLevelIndex(this.save);
    const canContinue = resumeIndex !== null;
    this.btnContinue.disabled = !canContinue;
    this.btnContinue.classList.toggle("disabled", !canContinue);
    const shipId = this.getSelectedShipId();
    this.shipInputs.forEach(input => {
      input.checked = (input.value === shipId);
    });
  }

  handleLaunchRequest() {
    const shipPicked = !!this.getSelectedShipId();
    if (!shipPicked) return;
    if (this.storyModal && !this.save.storySeen) {
      this.pendingLaunch = "new";
      this.showStoryModal();
    } else {
      this.startGameplayFlow(true);
    }
  }

  showStoryModal() {
    this.storyModal.classList.remove("hidden");
    this.storyLaunchBtn?.focus();
  }

  hideStoryModal() {
    this.storyModal?.classList.add("hidden");
  }

  startGameplayFlow(resetRun) {
    if (resetRun) this.startNewRun();
    else this.continueRun();
    this.save.storySeen = true;
    storeSave(this.save);
    this.focusGameCanvas();
  }

  maybeShowKeyboardHint() {
    if (this.save.keyboardHintSeen) return;
    const prefersTouch = ("maxTouchPoints" in navigator && navigator.maxTouchPoints > 1) ||
      /android|iphone|ipad|ipod/i.test(navigator.userAgent);
    const narrow = window.matchMedia("(max-width: 820px)").matches;
    if (!(prefersTouch || narrow)) return;
    this.keyboardHintModal?.classList.remove("hidden");
  }

  dismissKeyboardHint() {
    this.keyboardHintModal?.classList.add("hidden");
    this.save.keyboardHintSeen = true;
    storeSave(this.save);
  }

  storeAndRefresh() {
    storeSave(this.save);
    this.refreshMenu();
  }

  // ------------------------- Run/Level control -------------------------
  startNewRun() {
    this.setPlayerShip(this.getSelectedShipId());
    this.levelIndex = 0;
    this.player.maxHp = BASE_PLAYER_HP;
    this.stats.score = 0;
    this.stats.combo = 0;
    this.stats.mult = 1;
    this.stats.correct = 0;
    this.stats.total = 0;
    this.player.hp = this.player.maxHp;
    this.player.shield = 0;
    this.power.spread = 0;
    this.power.pierce = 0;
    this.power.rapid = 0;
    this.power.multiplier = 0;
    this.startLevel(this.levelIndex, true);
  }

  continueRun() {
    const r = this.save.run;
    if (!r) return this.startNewRun();
    this.levelIndex = clamp(r.levelIndex ?? 0, 0, 9);
    this.stats = { ...this.stats, ...(r.stats || {}) };
    if (typeof r.maxHp === "number" && r.maxHp > 0) {
      this.player.maxHp = Math.max(BASE_PLAYER_HP, r.maxHp);
    }
    const restoredHp = clamp(r.hp ?? this.player.maxHp, 0, this.player.maxHp);
    this.player.hp = restoredHp > 0 ? restoredHp : this.player.maxHp;
    this.player.shield = r.shield ?? 0;
    this.power = { ...this.power, ...(r.power || {}) };
    this.setPlayerShip(r.shipId || this.getSelectedShipId());
    this.startLevel(this.levelIndex, true, r);
  }

  startLevel(levelIndex, fromMenu = false, restoredRun = null) {
    this.levelIndex = clamp(levelIndex, 0, 9);
    const cfg = LEVELS[this.levelIndex];

    this.currentTheme = getThemeForLevel(this.levelIndex);
    if (this.sfx && !this.save.settings.muted) {
      this.sfx.playMusic();
    }
    this.parallax.bgOffset = 0;
    this.parallax.fgOffset = 0;

    this.bossClear = null;
    this.bossFinaleBursts.length = 0;
    this.bossFinaleOrigin = null;
    this.enemies.length = 0;
    this.powerups.length = 0;
    this.particles.length = 0;
    this.bullets.length = 0;
    this.lock = null;
    this.inBoss = false;
    this.boss = null;

    this.levelT = restoredRun?.levelT ?? 0;
    this.spawnAcc = restoredRun?.spawnAcc ?? 0;
    this.powerAcc = restoredRun?.powerAcc ?? 0;
    this.minionAcc = restoredRun?.minionAcc ?? 0;
    this.hazardAcc = restoredRun?.hazardAcc ?? 0;

    // If restoring, we can choose to restore active enemies, but keeping it simple:
    // restore only the timers and overall run stats. Keeps "Continue" robust.
    // (Level restarts are available via R.)
    if (restoredRun?.inBoss) {
      this.beginBossFight();
      // If the run was in boss, keep it in boss (still restarts boss fresh for sanity)
    }

    if (fromMenu) this.setMode("playing");
    this.updateHUD();
    this.saveRun(true);
    this.sfx.powerup();
  }

  restartLevel() {
    // Keep overall score and stats, but reset level-specific spawns
    this.player.hp = this.player.maxHp;
    this.player.shield = 0;
    this.power.spread = 0;
    this.power.pierce = 0;
    this.power.rapid = 0;
    this.power.multiplier = 0;
    this.startLevel(this.levelIndex, true, null);
    if (this.sfx && !this.save.settings.muted) this.sfx.playMusic();
  }

  advanceLevel() {
    if (this.levelIndex >= 9) return;
    this.levelIndex++;
    this.startLevel(this.levelIndex, true);
    if (this.sfx && !this.save.settings.muted) this.sfx.playMusic();
  }

  stopToMenu(saveRun = true) {
    if (saveRun) this.saveRun(true);
    this.setMode("menu");
    this.refreshMenu();
  }

  // ------------------------- Spawning -------------------------
  makeEnemyText(cfg) {
    const isLetter = Math.random() < cfg.letterRatio;
    if (isLetter) {
      const letters = "abcdefghijklmnopqrstuvwxyz";
      return letters[randi(0, letters.length - 1)];
    }

    const pool = (cfg.level <= 3) ? WORDS_EASY : (cfg.level <= 6) ? WORDS_MED : WORDS_HARD;
    let w = choice(pool);
    // Clamp length to desired range by re-rolling a few times
    for (let i=0;i<6;i++) {
      if (w.length >= cfg.wordMin && w.length <= cfg.wordMax) break;
      w = choice(pool);
    }
    // If still out of range, slice
    if (w.length > cfg.wordMax) w = w.slice(0, cfg.wordMax);
    if (w.length < cfg.wordMin) w = w.padEnd(cfg.wordMin, "x");
    return w;
  }

  spawnEnemy() {
    const cfg = LEVELS[this.levelIndex];
    if (this.enemies.length >= cfg.maxEnemies) return;

    const text = this.makeEnemyText(cfg);
    const y = rand(170, this.h - 140);
    const x = this.w + rand(20, 260);
    const speed = cfg.baseSpeed * rand(0.85, 1.18) * (text.length <= 1 ? rand(1.0, 1.25) : 1.0);
    this.enemies.push(new Enemy({ text, x, y, speed }));
  }

  spawnPowerup() {
    const cfg = LEVELS[this.levelIndex];
    // in early levels, fewer powerups
    if (Math.random() < (cfg.level <= 2 ? 0.55 : 0.72)) {
      const types = ["SPREAD","PIERCE","RAPID","SHIELD","MULTI"];
      const type = choice(types);
      const label = (type === "SHIELD") ? "shield" : (type === "MULTI" ? "x2" : type.toLowerCase());
      const y = rand(210, this.h - 220);
      const x = this.w + rand(80, 380);
      const speed = cfg.baseSpeed * 0.70;
      this.powerups.push(new Powerup({ type, label, x, y, speed }));
    }
  }

  beginBossFight() {
    const cfg = LEVELS[this.levelIndex];
    this.inBoss = true;
    this.lock = null;
    this.bossClear = null;

    this.enemies.length = 0;
    this.powerups.length = 0;

    this.boss = new Boss({
      name: cfg.boss.name,
      segments: buildBossSegments(cfg.level),
      artLevel: cfg.level
    });
    this.ui.bossBar.classList.remove("hidden");
    this.ui.bossName.textContent = cfg.boss.name;
    this.ui.bossSegment.textContent = "";
    this.sfx.bossSiren();
  }

  endBossFight(victory = true) {
    this.inBoss = false;
    this.ui.bossBar.classList.add("hidden");
    this.lock = null;
    this.boss = null;
  }

  // ------------------------- Typing -------------------------
  handleTyped(ch) {
    if (this.bossClear) return;
    this.stats.total++;

    // Boss priority: if inBoss, we type against boss (lock implied).
    if (this.inBoss && this.boss) {
      const expect = this.boss.nextChar;
      if (ch === expect) {
        this.stats.correct++;
        this.stats.combo++;
        this.bumpMultiplier();

        this.fireLaserTo(this.boss.x - 140, this.boss.y + 10, "cyan");
        this.sfx.laser();
        this.sfx.hit();

        this.boss.advance();
        this.addSparks(this.boss.x - 180, this.boss.y + rand(-40, 40), 10);

        // segment change hint
        this.ui.bossSegment.textContent = `segment ${Math.min(this.boss.segmentIndex + 1, this.boss.segments.length)}/${this.boss.segments.length}  •  ${this.boss.remaining}`;

        if (this.boss.done) {
          // boss defeated
          const centerX = this.boss.x - 150;
          const centerY = this.boss.y;
          this.sfx.explosion();
          this.screenShake(10);
          this.addExplosion(centerX, centerY, 120);
          this.sfx.bossExplosion();
          for (let i = 0; i < 9; i++) {
            this.addExplosionSprite(
              centerX + rand(-140, 140),
              centerY + rand(-120, 120),
              "large"
            );
          }
          for (let i = 0; i < 6; i++) {
            this.addExplosionSprite(
              centerX + rand(-220, 220),
              centerY + rand(-200, 200),
              "medium"
            );
          }

          this.endBossFight(true);

          // Level complete / unlock next
          const completedLevel = LEVELS[this.levelIndex].level;
          const nextUnlocked = Math.max(this.save.lastUnlockedLevel || 1, Math.min(10, completedLevel + 1));
          this.save.lastUnlockedLevel = nextUnlocked;

          // bonus
          const bonus = 2500 + completedLevel * 450;
          this.stats.score += bonus;
          const target = (this.levelIndex >= 9) ? "victory" : "level";
          this.bossClear = {
            t: 0,
            target,
            bonus,
            level: completedLevel,
            bossName: LEVELS[this.levelIndex].boss.name,
            levelIndex: this.levelIndex,
            nextLevelIndex: target === "level" ? Math.min(this.levelIndex + 1, 9) : null
          };
          this.startBossFinale(centerX, centerY);
        }
      } else {
        this.onWrongKey();
      }

      return;
    }

    // If we have a lock, try to type into it
    if (this.lock?.ref && this.lock.ref.alive) {
      const ref = this.lock.ref;
      const expect = ref.nextChar();
      if (ch === expect) {
        this.onCorrectKey(ref);
      } else {
        this.onWrongKey();
      }
      return;
    }

    // Acquire a new lock: check powerups first (reward), then enemies.
    const candPower = this.powerups
      .filter(p => p.alive && p.nextChar() === ch)
      .sort((a,b) => a.x - b.x)[0];

    if (candPower) {
      this.lock = { kind: "powerup", ref: candPower };
      candPower.locked = true;
      this.onCorrectKey(candPower);
      return;
    }

    const candEnemy = this.enemies
      .filter(en => en.alive && en.nextChar() === ch)
      .sort((a,b) => a.x - b.x)[0];

    if (candEnemy) {
      this.lock = { kind: "enemy", ref: candEnemy };
      candEnemy.locked = true;
      this.onCorrectKey(candEnemy);
      return;
    }

    this.onWrongKey(true);
  }

  onCorrectKey(ref) {
    this.stats.correct++;
    this.stats.combo++;
    this.bumpMultiplier();

    // Fire visuals
    const beamColor = this.power.multiplier > 0 ? "lime" : (this.power.spread > 0 ? "magenta" : "cyan");
    this.fireLaserTo(ref.x, ref.y, beamColor);
    this.sfx.laser();
    ref.progress++;
    ref.flash = 0.18;

    const isDone = (ref.kind === "powerup")
      ? (ref.progress >= ref.label.length)
      : (ref.progress >= ref.text.length);

    if (isDone) {
      // Resolve
      if (ref.kind === "powerup") {
        this.collectPowerup(ref);
      } else {
        this.killEnemy(ref);
      }
      this.lock = null;
    } else {
      // Mild hit feedback
      if (ref.kind !== "powerup") this.sfx.hit();
      this.addSparks(ref.x, ref.y, 6);
    }
  }

  onWrongKey(noTarget = false) {
    // Break combo
    this.stats.combo = 0;
    this.stats.mult = 1;
    this.sfx.error();
    this.flash = 0.08;

    // Optional small penalty when typing truly wrong (but not too harsh)
    if (!noTarget) {
      this.stats.score = Math.max(0, this.stats.score - 15);
    }

    // If we had a lock on something, keep lock (so user can recover) in early levels.
    // In later levels, drop lock sometimes.
    const lvl = LEVELS[this.levelIndex].level;
    if (this.lock?.ref && lvl >= 6 && Math.random() < 0.35) {
      this.lock.ref.locked = false;
      this.lock = null;
    }
  }

  bumpMultiplier() {
    // using combo brackets + active multiplier powerup
    const base = this.stats.combo >= 30 ? 3 : this.stats.combo >= 15 ? 2 : 1;
    const pu = this.power.multiplier > 0 ? 2 : 1;
    this.stats.mult = base * pu;
  }

  // ------------------------- Combat resolution -------------------------
  killEnemy(en) {
    en.alive = false;
    en.locked = false;

    const base = en.text.length <= 1 ? 55 : 75 + en.text.length * 10;
    const gained = Math.floor(base * this.stats.mult);
    this.stats.score += gained;

    this.addExplosion(en.x, en.y, 14 + en.text.length * 2);
    this.addExplosionSprite(en.x, en.y, this.getExplosionTypeForEnemy(en));
    this.sfx.explosion();
    this.screenShake(4);

    // Chance to drop powerup on word kills (later more likely)
    const lvl = LEVELS[this.levelIndex].level;
    if (en.text.length >= 4 && Math.random() < lerp(0.08, 0.18, (lvl - 1) / 9)) {
      this.spawnPowerup();
    }
  }

  collectPowerup(p) {
    if (!p.alive) return;
    p.alive = false;
    p.locked = false;
    this.sfx.powerup();
    this.addExplosion(p.x, p.y, 22);
    this.addExplosionSprite(p.x, p.y, "small");
    this.stats.score += 120 * this.stats.mult;

    const seconds = 9;
    switch (p.type) {
      case "SPREAD": this.power.spread = Math.max(this.power.spread, seconds); break;
      case "PIERCE": this.power.pierce = Math.max(this.power.pierce, seconds); break;
      case "RAPID": this.power.rapid = Math.max(this.power.rapid, seconds); break;
      case "SHIELD": this.player.shield = Math.max(this.player.shield, seconds); break;
      case "MULTI": this.power.multiplier = Math.max(this.power.multiplier, seconds); break;
    }
  }

  takeDamage(amount) {
    if (this.player.shield > 0) {
      this.player.shield = Math.max(0, this.player.shield - amount * 0.1);
      this.screenShake(4);
      return;
    }
    this.player.hp -= amount;
    this.screenShake(12);
    this.flash = Math.max(this.flash, 0.35);
    this.damagePulse = 1;
    this.sfx.hit();
    if (this.player.hp <= 0) {
      this.player.hp = 0;
      this.onGameOver();
    }
  }

  onLevelComplete(bonus) {
    this.setMode("levelComplete");
    this.ui.levelCompleteText.textContent = `Level ${LEVELS[this.levelIndex].level} cleared! Bonus +${formatInt(bonus)}.`;
    this.applyLevelHpBonus();
    this.saveRun(true);
  }

  onGameOver() {
    this.setMode("gameOver");
    const acc = this.getAccuracyPct();
    this.ui.gameOverText.textContent = `Final score: ${formatInt(this.stats.score)} • Accuracy: ${acc}%`;
    this.commitHighScore();
    const shipId = this.player.shipId || this.getSelectedShipId();
    this.save.run = buildResumeRun(this.levelIndex, this.player.maxHp, shipId);
    storeSave(this.save);
  }

  onVictory() {
    this.setMode("victory");
    const acc = this.getAccuracyPct();
    this.ui.victoryText.textContent = `You beat all 10 levels! Score: ${formatInt(this.stats.score)} • Accuracy: ${acc}%`;
    this.resetEndingDialogue();
    this.advanceEndingDialogue();
    this.commitHighScore();
    this.save.run = null;
    storeSave(this.save);
  }

  commitHighScore() {
    if (this.stats.score > (this.save.highScore || 0)) {
      this.save.highScore = this.stats.score;
    }
    storeSave(this.save);
    this.refreshMenu();
  }

  // ------------------------- Save state -------------------------
  saveRun(force = false) {
    const t = nowMs();
    if (!force && t - this.lastSaveAt < 1500) return;
    this.lastSaveAt = t;

    if (this.mode === "menu" || this.mode === "victory" || this.mode === "gameOver") return;

    if (this.bossClear) {
      if (this.bossClear.target === "victory") {
        this.save.run = null;
        storeSave(this.save);
        return;
      }
      const nextIndex = clamp(this.bossClear.nextLevelIndex ?? (this.levelIndex + 1), 0, 9);
      const safeHp = clamp(Math.round(this.player.hp ?? this.player.maxHp), 1, this.player.maxHp);
      const run = {
        levelIndex: nextIndex,
        levelT: 0,
        inBoss: false,
        hp: safeHp,
        shield: this.player.shield,
        power: { ...this.power },
        stats: { ...this.stats },
        spawnAcc: 0,
        powerAcc: 0,
        minionAcc: 0,
        hazardAcc: 0,
        shipId: this.player.shipId || this.getSelectedShipId(),
        maxHp: this.player.maxHp
      };
      this.save.run = run;
      storeSave(this.save);
      return;
    }

    const safeHp = clamp(Math.round(this.player.hp ?? this.player.maxHp), 1, this.player.maxHp);
    const run = {
      levelIndex: this.levelIndex,
      levelT: this.levelT,
      inBoss: this.inBoss,
      hp: safeHp,
      shield: this.player.shield,
      power: { ...this.power },
      stats: { ...this.stats },
      spawnAcc: this.spawnAcc,
      powerAcc: this.powerAcc,
      minionAcc: this.minionAcc,
      hazardAcc: this.hazardAcc,
      shipId: this.player.shipId || this.getSelectedShipId(),
      maxHp: this.player.maxHp
    };

    this.save.playerName = this.save.playerName || this.ui.playerName.value || "";
    this.save.run = run;
    storeSave(this.save);
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

  update(dt) {
    const cfg = LEVELS[this.levelIndex];

    // timers
    this.levelT += dt;
    this.starT += dt;
    if (this.currentTheme) {
      this.parallax.bgOffset += (this.currentTheme.bgSpeed || 0) * dt;
      this.parallax.fgOffset += (this.currentTheme.fgSpeed || 0) * dt;
    }
    this.flash = Math.max(0, this.flash - dt * 3);
    this.shake = Math.max(0, this.shake - dt * 12);
    this.damagePulse = Math.max(0, this.damagePulse - dt * 1.8);

    // powerups durations
    this.power.spread = Math.max(0, this.power.spread - dt);
    this.power.pierce = Math.max(0, this.power.pierce - dt);
    this.power.rapid = Math.max(0, this.power.rapid - dt);
    this.power.multiplier = Math.max(0, this.power.multiplier - dt);
    this.player.shield = Math.max(0, this.player.shield - dt);

    // Spawning
    const celebrating = !!this.bossClear;

    if (!this.inBoss && !celebrating) {
      this.spawnAcc += dt * cfg.spawnRate * (this.power.rapid > 0 ? 1.10 : 1.0);
      while (this.spawnAcc >= 1) { this.spawnAcc -= 1; this.spawnEnemy(); }

      this.powerAcc += dt;
      const puEvery = lerp(8.8, 6.4, (cfg.level - 1) / 9);
      if (this.powerAcc >= puEvery) { this.powerAcc = 0; this.spawnPowerup(); }

      // Enter boss after duration
      if (this.levelT >= cfg.duration) {
        this.beginBossFight();
      }
    } else if (this.inBoss) {
      // Boss: minions and hazards
      if (cfg.boss.minionRate > 0) {
        this.minionAcc += dt * cfg.boss.minionRate;
        while (this.minionAcc >= 1) {
          this.minionAcc -= 1;
          const letters = "abcdefghijklmnopqrstuvwxyz";
          const text = letters[randi(0, letters.length - 1)];
          this.enemies.push(new Enemy({ text, x: this.w + rand(0, 220), y: rand(150, this.h - 160), speed: cfg.baseSpeed * 1.2, kind: "bossMinion" }));
        }
      }

      // Hazards are simple: periodic "damage pulses" if boss is alive and player too slow
      this.hazardAcc += dt * cfg.boss.hazardRate;
      if (cfg.level >= 4 && this.hazardAcc >= 1.0) {
        this.hazardAcc = 0;
        // If player has low combo, hazard pings lightly
        if (this.stats.combo < 4 && Math.random() < 0.55) {
          this.takeDamage(6);
        }
      }
    }

    // Update enemies and powerups
    for (const en of this.enemies) {
      if (!en.alive) continue;
      en.update(dt);
      // If enemy reaches the player line, it damages.
      if (en.x < this.player.x + 35) {
        en.alive = false;
        this.takeDamage(12 + Math.min(12, en.text.length * 2));
        this.addExplosion(this.player.x + 40, en.y, 18);
        this.addExplosionSprite(this.player.x + 40, en.y, this.getExplosionTypeForEnemy(en));
      }
    }

    for (const p of this.powerups) {
      if (!p.alive) continue;
      p.update(dt);
      if (p.x < this.player.x + 60) {
        // Missed powerup, just despawn softly
        p.alive = false;
      }
    }

    // Boss update
    if (this.inBoss && this.boss) {
      this.boss.update(dt, this.h);
      this.ui.bossFill.style.width = `${Math.round(this.boss.hpFrac() * 100)}%`;
      const seg = this.boss.segmentIndex + 1;
      const total = this.boss.segments.length;
      this.ui.bossSegment.textContent = `segment ${Math.min(seg,total)}/${total}  •  ${this.boss.remaining}`;
    }

    // Bullets (visual only)
    this.bullets = this.bullets.filter(b => (b.update(dt), b.alive()));

    // Particles
    this.particles = this.particles.filter(p => (p.update(dt), p.alive()));
    this.explosions = this.explosions.filter(ex => (ex.update(dt), !ex.done));

    // Clean dead arrays occasionally
    this.enemies = this.enemies.filter(e => e.alive);
    this.powerups = this.powerups.filter(p => p.alive);

    // Lock validity
    if (this.lock?.ref && !this.lock.ref.alive) this.lock = null;

    // autosave
    this.saveRun(false);

    // HUD
    this.updateHUD();

    if (this.bossClear) {
      this.bossClear.t += dt;
      while (this.bossFinaleBursts.length && this.bossFinaleBursts[0].time <= this.bossClear.t) {
        const burst = this.bossFinaleBursts.shift();
        this.runBossFinaleBurst(burst);
      }
      if (this.bossClear.t >= 6.3) {
        const info = this.bossClear;
        this.bossClear = null;
        this.bossFinaleBursts.length = 0;
        this.bossFinaleOrigin = null;
        if (info.target === "victory") this.onVictory();
        else this.onLevelComplete(info.bonus);
      }
    }
  }

  updateHUD() {
    this.ui.hudName.textContent = this.save.playerName || "(unnamed)";
    this.ui.hudLevel.textContent = `${LEVELS[this.levelIndex].level}/10`;
    this.ui.hudScore.textContent = formatInt(this.stats.score);
    this.ui.hudCombo.textContent = `${this.stats.combo} ×${this.stats.mult}`;
    this.ui.hudAcc.textContent = `${this.getAccuracyPct()}%`;
    const shield = this.player.shield > 0 ? `+S` : "";
    this.ui.hudHP.textContent = `${Math.round(this.player.hp)}${shield}`;

    if (!this.inBoss) {
      this.ui.bossBar.classList.add("hidden");
    }
  }

  getAccuracyPct() {
    if (this.stats.total <= 0) return 100;
    return Math.round((this.stats.correct / this.stats.total) * 100);
  }

  // ------------------------- Rendering -------------------------
  makeStars(n) {
    const stars = [];
    for (let i=0;i<n;i++) {
      stars.push({
        x: Math.random() * this.w,
        y: Math.random() * this.h,
        z: Math.random(), // parallax depth
        s: rand(0.8, 2.2)
      });
    }
    return stars;
  }

  screenShake(amount) {
    this.shake = Math.max(this.shake, amount);
  }

  fireLaserTo(tx, ty, color) {
    // Multi-shot if spread or rapid: create extra beams to nearby points
    const shots = [];
    const baseWidth = 3 + this.levelIndex * 0.7;
    const spreadWidth = Math.max(2, baseWidth * 0.65);
    shots.push({ tx, ty, color, width: baseWidth });

    if (this.power.spread > 0) {
      shots.push({ tx: tx + rand(-20, 20), ty: ty + rand(-80, -20), color: "magenta", width: spreadWidth });
      shots.push({ tx: tx + rand(-20, 20), ty: ty + rand(20, 80), color: "magenta", width: spreadWidth });
    }

    for (const s of shots) {
      this.bullets.push(new Bullet({
        x: this.player.x + 20,
        y: this.player.y,
        tx: s.tx,
        ty: s.ty,
        width: s.width,
        color: s.color
      }));
    }
  }

  addSparks(x, y, n) {
    for (let i=0;i<n;i++) {
      this.particles.push(new Particle({
        x, y,
        vx: rand(-120, 120),
        vy: rand(-120, 120),
        life: rand(0.12, 0.26),
        size: rand(1, 2.8),
        hue: choice([185, 310, 95])
      }));
    }
  }

  addExplosion(x, y, size) {
    const n = Math.floor(size * 1.2);
    for (let i=0;i<n;i++) {
      const a = rand(0, Math.PI * 2);
      const r = rand(0, size);
      this.particles.push(new Particle({
        x: x + Math.cos(a) * r * 0.2,
        y: y + Math.sin(a) * r * 0.2,
        vx: Math.cos(a) * rand(80, 320),
        vy: Math.sin(a) * rand(80, 320),
        life: rand(0.18, 0.5),
        size: rand(1.2, 4.5),
        hue: choice([185, 310, 95, 40])
      }));
    }
  }

  registerAsset(img, onLoad) {
    this.pendingAssets = (this.pendingAssets ?? 0) + 1;
    const finalize = () => {
      if (onLoad) onLoad();
      this.pendingAssets = Math.max(0, this.pendingAssets - 1);
      this.checkLoadingOverlay();
    };
    img.addEventListener("load", finalize, { once: true });
    img.addEventListener("error", finalize, { once: true });
  }

  checkLoadingOverlay() {
    if (!this.loadingOverlay) return;
    if (this.pendingAssets > 0) return;
    if (this.assetsReady) return;
    this.assetsReady = true;
    requestAnimationFrame(() => this.loadingOverlay.classList.add("hidden"));
  }

  startBossFinale(cx, cy) {
    this.bossFinaleOrigin = { x: cx, y: cy };
    this.bossFinaleBursts = [];
    const finaleDuration = 6;
    const interval = 0.3;
    for (let t = 0; t <= finaleDuration; t += interval) {
      const step = Math.floor(t / interval) % 3;
      if (step === 0) this.bossFinaleBursts.push({ time: t, kind: "shock" });
      else if (step === 1) this.bossFinaleBursts.push({ time: t, kind: "large" });
      else this.bossFinaleBursts.push({ time: t, kind: "medium" });
    }
  }

  runBossFinaleBurst(burst) {
    const origin = this.bossFinaleOrigin || { x: this.player.x + 20, y: this.player.y };
    const ox = origin.x;
    const oy = origin.y;
    switch (burst.kind) {
      case "shock":
        this.addExplosion(ox + rand(-40, 40), oy + rand(-40, 40), 140);
        this.addExplosionSprite(ox + rand(-40, 40), oy + rand(-40, 40), "large");
        this.screenShake(6);
        this.sfx.explosion();
        break;
      case "medium":
        for (let i = 0; i < 3; i++) {
          this.addExplosionSprite(
            ox + rand(-260, 260),
            oy + rand(-220, 220),
            "medium"
          );
        }
        break;
      default:
        for (let i = 0; i < 4; i++) {
          this.addExplosionSprite(
            ox + rand(-200, 200),
            oy + rand(-160, 160),
            "large"
          );
        }
        break;
    }
  }

  addExplosionSprite(x, y, type = "small") {
    if (!this.explosionSheet) return;
    this.explosions.push(new ExplosionSprite({ x, y, type, sheet: this.explosionSheet }));
  }

  getExplosionTypeForEnemy(en) {
    if (!en) return "small";
    if (en.text.length <= 3 || en.kind === "bossMinion") return "small";
    return "medium";
  }

  drawBackground(ctx) {
    ctx.save();
    ctx.fillStyle = "#05060B";
    ctx.fillRect(0, 0, this.w, this.h);

    const theme = this.currentTheme;
    const assets = theme ? this.themeImages[theme.id] : null;
    const bgImg = assets?.bg;
    if (bgImg && bgImg.complete && bgImg.naturalWidth > 0) {
      const scale = this.h / bgImg.naturalHeight;
      this.drawTiledImage(ctx, bgImg, scale, 0, this.parallax.bgOffset);
    } else {
      const g1 = ctx.createRadialGradient(this.w*0.25, this.h*0.2, 60, this.w*0.25, this.h*0.2, 520);
      g1.addColorStop(0, "rgba(255,57,209,0.18)");
      g1.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g1;
      ctx.fillRect(0,0,this.w,this.h);

      const g2 = ctx.createRadialGradient(this.w*0.75, this.h*0.62, 90, this.w*0.75, this.h*0.62, 640);
      g2.addColorStop(0, "rgba(57,245,255,0.14)");
      g2.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g2;
      ctx.fillRect(0,0,this.w,this.h);
    }

    for (const s of this.stars) {
      const spd = lerp(30, 140, 1 - s.z);
      s.x -= spd * (1/60);
      if (s.x < -5) { s.x = this.w + rand(0, 80); s.y = rand(0, this.h); s.z = Math.random(); }
      const alpha = lerp(0.25, 0.9, 1 - s.z);
      ctx.fillStyle = `rgba(255,255,255,${alpha})`;
      ctx.fillRect(s.x, s.y, s.s, s.s);
    }

    ctx.restore();
  }

  drawTiledImage(ctx, img, scale, y = 0, offset = 0) {
    if (!img || !img.naturalWidth) return;
    const tileW = img.naturalWidth * scale;
    const tileH = img.naturalHeight * scale;
    if (!tileW || !tileH) return;
    const startX = -((offset % tileW) + tileW) % tileW;
    for (let x = startX; x < this.w + tileW; x += tileW) {
      ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, x, y, tileW, tileH);
    }
  }

  drawForegroundParallax(ctx) {
    const theme = this.currentTheme;
    const assets = theme ? this.themeImages[theme.id] : null;
    const fgImg = assets?.fg;

    ctx.save();
    if (fgImg && fgImg.complete && fgImg.naturalWidth > 0) {
      const targetHeight = this.h * (theme?.fgHeight || 0.6);
      const scale = targetHeight / fgImg.naturalHeight;
      const y = this.h - targetHeight;
      ctx.globalAlpha = 0.95;
      if (theme?.tileFg === false) {
        const width = fgImg.naturalWidth * scale;
        const x = (this.w - width) / 2;
        ctx.drawImage(fgImg, 0, 0, fgImg.naturalWidth, fgImg.naturalHeight, x, y, width, targetHeight);
      } else {
        this.drawTiledImage(ctx, fgImg, scale, y, this.parallax.fgOffset);
      }
    } else {
      // fallback to neon highway
      const trackY = this.h * 0.72;
      const trackH = this.h * 0.28;

      const grad = ctx.createLinearGradient(0, trackY, 0, trackY + trackH);
      grad.addColorStop(0, "rgba(10,16,32,0.20)");
      grad.addColorStop(1, "rgba(0,0,0,0.65)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, trackY, this.w, trackH);

      ctx.globalAlpha = 0.22;
      ctx.strokeStyle = "rgba(57,245,255,0.35)";
      ctx.lineWidth = 1;

      const t = this.starT * 160;
      for (let i=0;i<22;i++) {
        const y = trackY + i * (trackH/22);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(this.w, y);
        ctx.stroke();
      }

      ctx.globalAlpha = 0.16;
      for (let i=0;i<26;i++) {
        const x = ((i * 90) - (t % 90));
        ctx.beginPath();
        ctx.moveTo(x, trackY);
        ctx.lineTo(x + 220, trackY + trackH);
        ctx.stroke();
      }

      ctx.globalAlpha = 0.88;
      ctx.strokeStyle = "rgba(57,245,255,0.75)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, trackY+6);
      ctx.lineTo(this.w, trackY+6);
      ctx.stroke();

      ctx.globalAlpha = 0.35;
      ctx.fillStyle = "rgba(255,57,209,0.55)";
      const cW = 34;
      for (let x=0; x<this.w + cW; x += 140) {
        const xx = x - (t % 140);
        ctx.beginPath();
        ctx.moveTo(xx, trackY+18);
        ctx.lineTo(xx+14, trackY+10);
        ctx.lineTo(xx+28, trackY+18);
        ctx.lineTo(xx+20, trackY+20);
        ctx.lineTo(xx+14, trackY+16);
        ctx.lineTo(xx+8, trackY+20);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.restore();
  }

  drawShip(ctx) {
    const x = this.player.x;
    const y = this.player.y;

    // engine trail
    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = "rgba(255,57,209,0.20)";
    ctx.beginPath();
    ctx.ellipse(x - 30, y, 38, 16, 0, 0, Math.PI*2);
    ctx.fill();

    ctx.globalAlpha = 0.75;
    ctx.fillStyle = "rgba(57,245,255,0.22)";
    ctx.beginPath();
    ctx.ellipse(x - 24, y, 26, 10, 0, 0, Math.PI*2);
    ctx.fill();

    const shipId = this.currentShipId();
    const resource = this.shipImages[shipId];
    const isCanvas = resource instanceof HTMLCanvasElement;
    const ready = resource && (isCanvas || (resource.complete && resource.naturalWidth > 0));

    if (ready) {
      const img = resource;
      const natW = isCanvas ? img.width : img.naturalWidth;
      const natH = isCanvas ? img.height : img.naturalHeight;
      const dw = 150;
      const scale = dw / natW;
      const dh = natH * scale;
      ctx.save();
      ctx.globalAlpha = 0.95;
      ctx.drawImage(img, x - dw * 0.38, y - dh / 2, dw, dh);
      ctx.restore();
    } else {
      ctx.globalAlpha = 1;
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(57,245,255,0.85)";
      ctx.fillStyle = "rgba(10,16,32,0.75)";
      ctx.beginPath();
      ctx.moveTo(x - 10, y);
      ctx.lineTo(x + 22, y - 18);
      ctx.lineTo(x + 40, y);
      ctx.lineTo(x + 22, y + 18);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // cockpit
    ctx.fillStyle = "rgba(255,57,209,0.35)";
    ctx.beginPath();
    ctx.ellipse(x + 18, y, 10, 6, 0, 0, Math.PI*2);
    ctx.fill();

    // shield ring
    if (this.player.shield > 0) {
      const a = 0.18 + 0.12 * Math.sin(this.starT * 6);
      ctx.strokeStyle = `rgba(168,255,58,${a})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(x + 10, y, 52, 28, 0, 0, Math.PI*2);
      ctx.stroke();
    }

    ctx.restore();
  }

  drawGlyphPlate(ctx, x, y, w, h, locked, flash, tint) {
    ctx.save();
    // glow outer
    const glowA = locked ? 0.26 : 0.14;
    const glowB = locked ? 0.18 : 0.10;
    ctx.shadowBlur = locked ? 18 : 10;
    ctx.shadowColor = tint === "magenta" ? `rgba(255,57,209,${glowA})` : `rgba(57,245,255,${glowA})`;

    // plate
    ctx.fillStyle = "rgba(10,16,32,0.70)";
    ctx.strokeStyle = tint === "magenta" ? "rgba(255,57,209,0.55)" : "rgba(57,245,255,0.50)";
    ctx.lineWidth = 2;

    const r = 12;
    roundRect(ctx, x - w/2, y - h/2, w, h, r);
    ctx.fill();
    ctx.stroke();

    // inner sheen
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 0.65;
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    roundRect(ctx, x - w/2 + 3, y - h/2 + 3, w - 6, (h - 6) * 0.45, 10);
    ctx.fill();

    // flash overlay
    if (flash > 0) {
      ctx.globalAlpha = clamp(flash * 2, 0, 0.55);
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      roundRect(ctx, x - w/2, y - h/2, w, h, r);
      ctx.fill();
    }

    // lock brackets
    if (locked) {
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = "rgba(168,255,58,0.75)";
      ctx.lineWidth = 2;
      const bx = x - w/2 - 6, by = y - h/2 - 6, bw = w + 12, bh = h + 12;
      bracketRect(ctx, bx, by, bw, bh, 10);
    }

    ctx.restore();
  }

  drawEnemy(ctx, en) {
    const remaining = en.text.slice(en.progress);
    const done = en.text.slice(0, en.progress);

    const w = 64 + en.text.length * 10;
    const h = 44;
    const tint = en.locked ? "magenta" : "cyan";
    this.drawGlyphPlate(ctx, en.x, en.y, w, h, en.locked, en.flash, tint);

    // text
    ctx.save();
    ctx.font = "20px ui-monospace, Menlo, Monaco, Consolas, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // Completed portion dim
    if (done.length) {
      ctx.fillStyle = "rgba(255,255,255,0.32)";
      ctx.fillText(done, en.x - (remaining.length * 6), en.y);
    }

    // Remaining portion bright
    ctx.fillStyle = en.locked ? "rgba(168,255,58,0.90)" : "rgba(255,255,255,0.88)";
    ctx.fillText(remaining, en.x + (done.length * 6), en.y);

    ctx.restore();
  }

  drawPowerup(ctx, p) {
    const w = 70 + p.label.length * 10;
    const h = 42;
    this.drawGlyphPlate(ctx, p.x, p.y, w, h, p.locked, 0, "magenta");

    ctx.save();
    ctx.font = "18px ui-monospace, Menlo, Monaco, Consolas, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(168,255,58,0.95)";
    ctx.fillText(p.label.slice(p.progress), p.x, p.y);
    ctx.restore();
  }

  drawBoss(ctx, boss) {
    // boss "word slab"
    const x = boss.x;
    const y = boss.y;
    const w = 520;
    const h = 190;

    ctx.save();

    const art = this.getBossArtForLevel(boss.artLevel);
    if (art && art.complete && art.naturalWidth > 0) {
      const maxH = this.h * 0.65;
      const scale = Math.min(maxH / art.naturalHeight, 0.7);
      const artH = art.naturalHeight * scale;
      const artW = art.naturalWidth * scale;
      const drawX = x - artW * 0.35;
      const drawY = y - artH * 0.45;
      ctx.drawImage(art, drawX, drawY, artW, artH);
    }

    ctx.shadowBlur = 26;
    ctx.shadowColor = "rgba(255,57,209,0.20)";
    ctx.fillStyle = "rgba(10,16,32,0.78)";
    ctx.strokeStyle = boss.flash > 0 ? "rgba(255,255,255,0.65)" : "rgba(255,57,209,0.55)";
    ctx.lineWidth = 3;
    roundRect(ctx, x - w/2, y - h/2, w, h, 24);
    ctx.fill();
    ctx.stroke();

    // inner chrome lines
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = "rgba(57,245,255,0.35)";
    ctx.beginPath();
    ctx.moveTo(x - w/2 + 20, y - h/2 + 56);
    ctx.lineTo(x + w/2 - 20, y - h/2 + 56);
    ctx.stroke();

    ctx.globalAlpha = 1;

    // name
    ctx.font = "18px ui-monospace, Menlo, Monaco, Consolas, monospace";
    ctx.fillStyle = "rgba(57,245,255,0.85)";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(boss.name, x - w/2 + 22, y - h/2 + 14);

    // segment prompt
    const seg = boss.segment;
    const done = seg.slice(0, boss.progress);
    const rem = seg.slice(boss.progress);

    ctx.font = "44px ui-monospace, Menlo, Monaco, Consolas, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.fillStyle = "rgba(255,255,255,0.28)";
    ctx.fillText(done, x - (rem.length * 13), y + 18);

    ctx.fillStyle = "rgba(168,255,58,0.92)";
    ctx.fillText(rem, x + (done.length * 13), y + 18);

    // segment dots
    ctx.globalAlpha = 0.9;
    for (let i=0;i<boss.segments.length;i++) {
      const cx = x - w/2 + 26 + i * 18;
      const cy = y + h/2 - 22;
      ctx.fillStyle = i < boss.segmentIndex ? "rgba(168,255,58,0.85)" : "rgba(255,255,255,0.15)";
      ctx.beginPath();
      ctx.arc(cx, cy, 5, 0, Math.PI*2);
      ctx.fill();
    }

    ctx.restore();
  }

  drawBullets(ctx) {
    for (const b of this.bullets) {
      const a = 1 - (b.t / b.life);
      ctx.save();
      ctx.globalAlpha = clamp(a * 1.1, 0, 1);
      let col = "rgba(57,245,255,0.9)";
      if (b.color === "magenta") col = "rgba(255,57,209,0.9)";
      if (b.color === "lime") col = "rgba(168,255,58,0.9)";
      ctx.strokeStyle = col;
      ctx.lineWidth = b.width;
      ctx.shadowBlur = 18;
      ctx.shadowColor = col.replace("0.9", "0.35");

      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.tx, b.ty);
      ctx.stroke();

      ctx.restore();
    }
  }

  drawParticles(ctx) {
    for (const p of this.particles) {
      const a = p.alpha();
      ctx.save();
      ctx.globalAlpha = a;
      ctx.fillStyle = `hsla(${p.hue}, 95%, 65%, ${a})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI*2);
      ctx.fill();
      ctx.restore();
    }
  }

  drawExplosionSprites(ctx) {
    for (const ex of this.explosions) {
      ex.draw(ctx);
    }
  }

  drawHUDOverlays(ctx) {
    // subtle flash on wrong key
    if (this.flash > 0) {
      const a = clamp(this.flash * 3, 0, 0.18);
      ctx.save();
      ctx.fillStyle = `rgba(255,77,109,${a})`;
      ctx.fillRect(0, 0, this.w, this.h);
      ctx.restore();
    }

    if (this.damagePulse > 0) {
      const a = clamp(this.damagePulse * 0.4, 0, 0.35);
      ctx.save();
      ctx.fillStyle = `rgba(255,0,34,${a})`;
      ctx.fillRect(0, 0, this.w, this.h);
      ctx.restore();
    }

    // vignette via canvas (extra)
    ctx.save();
    const g = ctx.createRadialGradient(this.w/2, this.h/2, this.h*0.2, this.w/2, this.h/2, this.h*0.7);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.35)");
    ctx.fillStyle = g;
    ctx.fillRect(0,0,this.w,this.h);
    ctx.restore();
  }

  drawBossClearBackdrop(ctx) {
    ctx.save();
    const t = this.bossClear?.t || 0;
    const alpha = clamp(0.35 + t * 0.25, 0, 0.85);
    ctx.fillStyle = `rgba(9,12,24,${alpha * 0.5})`;
    ctx.fillRect(0, this.h * 0.35, this.w, this.h * 0.3);

    const art = this.getBossArtForLevel(this.bossClear?.level);
    if (art && art.complete && art.naturalWidth > 0) {
      const targetH = this.h * 0.5;
      const scale = targetH / art.naturalHeight;
      const targetW = art.naturalWidth * scale;
      ctx.drawImage(art, (this.w - targetW) / 2, this.h * 0.25, targetW, targetH);
    }
    ctx.restore();
  }

  drawBossClearText(ctx) {
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "bold 64px 'Orbitron', 'Segoe UI', sans-serif";
    ctx.fillStyle = "rgba(255, 247, 216, 0.95)";
    ctx.strokeStyle = "rgba(255,120,80,0.85)";
    ctx.lineWidth = 3;
    const cx = this.w / 2;
    const cy = this.h * 0.5 - 10;
    ctx.strokeText("BOSS DEFEATED", cx, cy);
    ctx.fillText("BOSS DEFEATED", cx, cy);

    ctx.font = "24px 'Segoe UI', sans-serif";
    ctx.fillStyle = "rgba(168,255,120,0.92)";
    const sub = this.bossClear?.target === "victory" ? "Congratulations!" : `${this.bossClear?.bossName || ""} neutralized.`;
    ctx.fillText(sub, cx, cy + 60);
    ctx.restore();
  }

  getBossArtForLevel(level) {
    if (!level) return null;
    return this.bossArtImages?.[level] || null;
  }

  render(dt) {
    const ctx = this.ctx;
    // Shake transform
    const sx = (this.shake > 0) ? rand(-this.shake, this.shake) : 0;
    const sy = (this.shake > 0) ? rand(-this.shake, this.shake) : 0;

    ctx.save();
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,this.w,this.h);
    ctx.translate(sx, sy);

    this.drawBackground(ctx);
    this.drawForegroundParallax(ctx);

    // Entities
    this.drawBullets(ctx);

    for (const p of this.powerups) this.drawPowerup(ctx, p);
    for (const e of this.enemies) this.drawEnemy(ctx, e);

    if (this.inBoss && this.boss) this.drawBoss(ctx, this.boss);

    this.drawShip(ctx);
    if (this.bossClear) this.drawBossClearBackdrop(ctx);
    this.drawExplosionSprites(ctx);
    this.drawParticles(ctx);

    this.drawHUDOverlays(ctx);
    if (this.bossClear) this.drawBossClearText(ctx);

    ctx.restore();
  }
}

// ----------------------------- Canvas helpers -----------------------------
function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w/2, h/2);
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.arcTo(x+w, y, x+w, y+h, r);
  ctx.arcTo(x+w, y+h, x, y+h, r);
  ctx.arcTo(x, y+h, x, y, r);
  ctx.arcTo(x, y, x+w, y, r);
  ctx.closePath();
}

function bracketRect(ctx, x, y, w, h, s) {
  // corner brackets
  ctx.beginPath();
  // TL
  ctx.moveTo(x, y+s); ctx.lineTo(x, y); ctx.lineTo(x+s, y);
  // TR
  ctx.moveTo(x+w-s, y); ctx.lineTo(x+w, y); ctx.lineTo(x+w, y+s);
  // BR
  ctx.moveTo(x+w, y+h-s); ctx.lineTo(x+w, y+h); ctx.lineTo(x+w-s, y+h);
  // BL
  ctx.moveTo(x+s, y+h); ctx.lineTo(x, y+h); ctx.lineTo(x, y+h-s);
  ctx.stroke();
}

// ----------------------------- Boot -----------------------------
const game = new Game();

// Ensure menu visible on load
game.setMode("menu");
game.refreshMenu();
