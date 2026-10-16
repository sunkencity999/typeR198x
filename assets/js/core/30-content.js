// Type-R 198X — static content tables (word pools, letter sets, boss tables, ship/boss/theme art, explosion sheet, victory script).
// Classic script; load order is defined in index.html. Loads after 20-constants.js and attaches the per-level word
// pools to LEVELS at the bottom of this file (attachLevelContent).

const EXPLOSION_SHEET = {
  src: "./assets/explosions/explosions.png",
  width: 2816,   // the PNG master's pixel size; the synthetic manifest (no TYPER_ASSET_MANIFEST) derives the half-sheet
  height: 1536   // prepare and ExplosionSprite.scaleFor from it (review R1 follow-up); content-tables.mjs checks both
};

// Rects in the sheet's original pixel space. Indices are stable: frames 10, 18 and 20 are empty on the sheet and 16
// is a lone debris chunk, so no set references them (F012); they stay in the table so the numbering does not shift.
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

// Frame order follows the art (time runs right-to-left on each sheet row): flash -> fireball -> smoke.
// flashFrames are the frames drawn additively; the rest are smoke and composite source-over (D2).
const EXPLOSION_SETS = {
  small:  { frames: [2, 1, 0],                   flashFrames: [2],      scale: 0.9,  frameTime: 0.055 },
  medium: { frames: [9, 7, 6, 5, 4, 3, 8],       flashFrames: [9, 7],   scale: 1.0,  frameTime: 0.06 },
  large:  { frames: [15, 14, 12, 11, 13, 19, 17], flashFrames: [15, 14], scale: 1.15, frameTime: 0.07 }
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
  },
  {
    id: "sixth",
    bg: "./assets/backgrounds/sixthlevelbg.png",
    fg: "./assets/foregrounds/sixthlevelFG.png",
    bgSpeed: 24,
    fgSpeed: 66,
    fgHeight: 0.66
  },
  {
    id: "seventh",
    bg: "./assets/backgrounds/seventhlevelbg.png",
    fg: "./assets/foregrounds/seventhlevelFG.png",
    bgSpeed: 25,
    fgSpeed: 70,
    fgHeight: 0.68
  },
  {
    id: "eighth",
    bg: "./assets/backgrounds/eighthlevelbg.png",
    fg: "./assets/foregrounds/eighthlevelFG.png",
    bgSpeed: 27,
    fgSpeed: 74,
    fgHeight: 0.7
  },
  {
    id: "ninth",
    bg: "./assets/backgrounds/ninthlevelbg.png",
    fg: "./assets/foregrounds/ninthlevelFG.png",
    bgSpeed: 28,
    fgSpeed: 78,
    fgHeight: 0.72
  },
  {
    id: "tenth",
    bg: "./assets/backgrounds/tenthlevelbg.png",
    fg: "./assets/foregrounds/tenthlevelFG.png",
    bgSpeed: 30,
    fgSpeed: 82,
    fgHeight: 0.74,
    tileFg: false
  }
];

// Sector -> art mapping (VIS-09 / F020). Only seven art sets are distinct (seventh/eighth/ninth duplicate
// fourth/fifth/third), so the back half revisits familiar skies as "storm passes" and the finale gets the crystal city.
const LEVEL_THEMES = [
  { art: "first" },
  { art: "sixth" },
  { art: "third" },
  { art: "fourth" },
  { art: "fifth" },
  { art: "third", storm: true },
  { art: "second" },
  { art: "fourth", storm: true },
  { art: "fifth", storm: true },
  { art: "tenth" }
];
// PALETTE token names (10-tokens.js); the presentation track maps them to hex for --theme-accent.
const THEME_ACCENT = { first: "cyan", sixth: "amber", third: "magenta", fourth: "violet", fifth: "cyan", second: "amber", tenth: "violet" };
const STORM_SPEED_MUL = 1.25;

// One merged view per sector: the PARALLAX_THEMES entry (id/bg/fg/bgSpeed/fgSpeed/fgHeight/tileFg, which the
// renderer reads today) plus art/storm/accent/speedMul for the overhaul. The canonical views are frozen;
// getThemeForLevel hands out a shallow copy so callers may annotate their copy.
const LEVEL_THEME_VIEWS = LEVEL_THEMES.map((entry) => {
  const base = PARALLAX_THEMES.find((t) => t.id === entry.art) || PARALLAX_THEMES[0];
  return Object.freeze({
    ...base,
    art: entry.art,
    storm: !!entry.storm,
    accent: THEME_ACCENT[entry.art] || "cyan",
    speedMul: entry.storm ? STORM_SPEED_MUL : 1
  });
});

const getThemeForLevel = (index) => ({ ...LEVEL_THEME_VIEWS[clamp(index | 0, 0, LEVEL_THEME_VIEWS.length - 1)] });

// ----------------------------- Content -----------------------------
// The three tiers stay as named lists (other code still references them); gameplay draws from ALL_WORDS via LEVELS[i].words.
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

// Space / retro-computing / arcade vocabulary that fills the short and middle lengths the tiers were missing (F005).
// Grouped by length: 3x15, 4x20, 5x25, 6x25, 7x20, 8x15, 9x12, 10x8, 11x6, 12x4.
const WORDS_THEMED = [
  "bit","ram","rom","hex","key","mod","bus","jam","ion","orb","pod","zip","cog","dot","pad",
  "chip","disk","code","data","port","ping","loop","node","tape","coin","star","moon","mars","void","atom","zoom","jump","boot","cart","lane",
  "modem","cache","patch","stack","queue","array","debug","float","token","cargo","comet","lunar","solar","sonar","probe","rover","relay",
  "micro","nexus","robot","droid","servo","bonus","level","pylon",
  "kernel","buffer","socket","upload","reboot","cyborg","saturn","photon","meteor","galaxy","cosmos","nebula","vortex","thrust","module",
  "sensor","credit","joypad","bitmap","sprite","shader","opcode","packet","hangar","pulsar",
  "console","cabinet","circuit","program","network","monitor","scanner","command","control","machine","antenna","orbital","stellar",
  "gravity","compile","decoder","payload","mission","capsule","reactor",
  "joystick","asteroid","thruster","terminal","keyboard","software","hardware","firmware","database","download","starship","overload",
  "override","cassette","wormhole",
  "mainframe","satellite","processor","algorithm","bandwidth","lightyear","cartridge","telemetry","gyroscope","simulator","astronaut","interface",
  "spacecraft","hyperdrive","hovercraft","controller","teleporter","cybernetic","trajectory","resolution",
  "holographic","accelerator","coprocessor","overclocked","spacewalker","gravitation",
  "microcircuit","hyperspatial","astronomical","transmission"
];

const ALL_WORDS = [...new Set([...WORDS_EASY, ...WORDS_MED, ...WORDS_HARD, ...WORDS_THEMED].map((w) => w.toLowerCase()))]
  .filter((w) => /^[a-z]+$/.test(w));

// Single-letter enemies draw from a graded alphabet: home row first, the full a-z from sector 4.
const LETTER_SETS = {
  tutorial: "asdfjkleiortn",
  basic: "asdfghjkleiortnucmpwy",
  full: "abcdefghijklmnopqrstuvwxyz"
};
const WORD_LEN_MIN = 3;
const WORD_LEN_MAX = 13;
const LEVEL_POOL_MIN = 24;

// Words of length min..max. If that is thin (< 24; never with the shipped table), the window widens one step at a
// time, max+1 first, then min-1, alternating, inside 3..13 (amendment C-7).
function buildLevelWordPool(min, max) {
  let lo = clamp(min, WORD_LEN_MIN, WORD_LEN_MAX);
  let hi = clamp(max, lo, WORD_LEN_MAX);
  const fitting = () => ALL_WORDS.filter((w) => w.length >= lo && w.length <= hi);
  let pool = fitting();
  let growMax = true;
  while (pool.length < LEVEL_POOL_MIN && (lo > WORD_LEN_MIN || hi < WORD_LEN_MAX)) {
    if (growMax && hi < WORD_LEN_MAX) hi++;
    else if (lo > WORD_LEN_MIN) lo--;
    else hi++;
    growMax = !growMax;
    pool = fitting();
  }
  return pool;
}

// Wave length windows (w = 0..2): the first wave uses the lower 60% of the level's window, the second the full
// window, the third the upper 60%, so a sector visibly escalates.
function waveLengthWindow(cfg, wave) {
  const w = clamp(wave | 0, 0, 2);
  const n = cfg.wordMax - cfg.wordMin + 1;
  const span = Math.max(1, Math.ceil(n * 0.6));
  if (w === 0) return { min: cfg.wordMin, max: Math.min(cfg.wordMax, cfg.wordMin + span - 1) };
  if (w === 2) return { min: Math.max(cfg.wordMin, cfg.wordMax - span + 1), max: cfg.wordMax };
  return { min: cfg.wordMin, max: cfg.wordMax };
}

function letterSetKeysForLevel(level) {
  if (level <= 1) return ["tutorial", "tutorial", "basic"];
  if (level <= 3) return ["basic", "basic", "basic"];
  return ["full", "full", "full"];
}

function letterSetForWave(cfg, wave) {
  return cfg.waveLetterSets[clamp(wave | 0, 0, 2)] || cfg.letterSet || LETTER_SETS.full;
}

function wordsForWave(cfg, wave) {
  const sub = cfg.waveWords[clamp(wave | 0, 0, 2)];
  return (sub && sub.length) ? sub : cfg.words;
}

// LEVELS (20-constants.js) is built before the word lists exist; this gives every row its pools and alphabets.
function attachLevelContent(levels) {
  for (const cfg of levels) {
    cfg.words = buildLevelWordPool(cfg.wordMin, cfg.wordMax);
    cfg.waveWords = [0, 1, 2].map((w) => {
      const { min, max } = waveLengthWindow(cfg, w);
      const sub = cfg.words.filter((x) => x.length >= min && x.length <= max);
      return sub.length >= LEVEL_POOL_MIN ? sub : cfg.words.slice();
    });
    const keys = letterSetKeysForLevel(cfg.level);
    cfg.waveLetterSets = keys.map((k) => LETTER_SETS[k]);
    cfg.letterSet = cfg.level <= 3 ? LETTER_SETS.basic : LETTER_SETS.full;   // the widest alphabet the sector uses
  }
  return levels;
}

// ----------------------------- Boss content -----------------------------
// Signature words per boss (kept even when longer than the sector's wordMax + 1).
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

// Themed vocabulary per boss, keyed by level number (1-based).
const BOSS_WORD_THEMES = {
  1: ["signal","static","ghost","echo","haunt","wraith","aerial","carrier","hiss","phantom","beacon","fade","drift","whisper","relay","noise"],
  2: ["vector","angle","brute","crush","polygon","vertex","scalar","smash","jagged","tangent","ogre","blunt","wedge","matrix","normal","axis"],
  3: ["plasma","shogun","katana","honor","blade","ronin","banner","armor","flare","corona","ember","dojo","strike","tempest","bushido","warlord"],
  4: ["hologram","titan","mirage","colossus","lumen","prism","giant","facet","shimmer","projector","illusion","tower","refract","glimmer","immense","beam"],
  5: ["chrome","monolith","polish","granite","mirror","slab","alloy","basalt","gleam","pillar","obelisk","steel","lacquer","ingot","carbon","bastion"],
  6: ["sync","leviathan","abyss","tidal","cadence","fathom","pulse","trench","rhythm","current","kraken","swell","metronome","undertow","breach","depth"],
  7: ["empress","static","crown","decree","throne","scepter","regal","sovereign","dynasty","edict","jewel","tiara","court","dominion","royal","majesty"],
  8: ["logic","dragon","boolean","scale","syntax","inferno","wyrm","theorem","lambda","talon","axiom","cinder","recursion","hoard","predicate","wingspan"],
  9: ["night","engine","piston","nocturne","turbine","midnight","flywheel","eclipse","cylinder","twilight","exhaust","lunar","throttle","shadow","torque","dusk"],
  10: ["final","electro","voltage","sorcery","ampere","conjure","lightning","hex","tesla","incant","thunder","overwrite","surge","spellbook","kilovolt","headline"]
};

// The Electromancer's message from the briefing, typed as the fourth phase of the final boss.
const FINAL_MESSAGE = ["my", "syntax", "is", "law", "fill", "every", "screen", "with", "me"];

const BOSS_WORD_POOL = [
  "neon","signal","vector","ghost","quantum","phase","horizon","vapor",
  "matrix","gamma","cypher","shadow","omega","binary","cadence","volt",
  "nova","spirit","core","zenith","rift","cipher","delta","glyph",
  "static","echo","sable","flux","lumen","aether","cinder","pulse",
  "aurora","glitch","cursor","plinth","bastion","spire","ember","auric",
  "radiant","specter","lattice","ionstorm","solstice","parallax","carbon","crystal",
  "hyperion","solenoid","paladin","cathedral","symphony","monolith","oblivion",
  "zenithal","transistor","oscillation","helix","redshift","sunflare","midnight","membrane"
];

// Segment plan for a boss: 3 signature words, then the shuffled themed list, then the shuffled global pool (both
// filtered to length 3..wordMax+1 and deduped), and only when all of that runs out a repeat (amendment C-6).
// Count is 6+3(L-1); L10 appends FINAL_MESSAGE as a fourth phase. phaseStarts are segment indices.
function buildBossPlan(level) {
  const L = clamp(level | 0, 1, LEVELS.length);
  const cfg = LEVELS[L - 1];
  const count = bossSegmentCount(L);
  const maxLen = cfg.wordMax + 1;
  const fits = (w) => w.length >= WORD_LEN_MIN && w.length <= maxLen;

  const base = (BOSS_SEGMENT_BASE[L - 1] || ["neon", "boss"]).map((w) => w.toLowerCase());
  const themed = (BOSS_WORD_THEMES[L] || []).map((w) => w.toLowerCase());
  const themedSet = new Set([...base, ...themed]);
  const segments = [];
  const used = new Set();
  const take = (words) => {
    for (const w of words) {
      if (segments.length >= count) return;
      if (used.has(w)) continue;
      used.add(w);
      segments.push(w);
    }
  };
  take(base);
  take(shuffle(themed.filter(fits)));
  take(shuffle(BOSS_WORD_POOL.filter(fits)));
  if (segments.length < count) {
    const repeats = shuffle([...themed, ...BOSS_WORD_POOL].filter(fits));
    for (let k = 0; segments.length < count && repeats.length; k++) segments.push(repeats[k % repeats.length]);
  }

  const phaseStarts = [0, Math.ceil(count / 3), Math.ceil((2 * count) / 3)];
  if (L === LEVELS.length) {
    phaseStarts.push(count);
    segments.push(...FINAL_MESSAGE);
  }
  const themedCount = segments.filter((w) => themedSet.has(w)).length;
  return { level: L, segments, phaseStarts, coreCount: count, themedCount };
}

attachLevelContent(LEVELS);
