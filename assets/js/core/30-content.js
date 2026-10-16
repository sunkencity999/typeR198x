// Type-R 198X — static content tables (word pools, boss tables, ship/boss/theme art, explosion sheet, victory script). Classic script; load order is defined in index.html.

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
const getThemeForLevel = (index) => {
  if (index < 5) return PARALLAX_THEMES[index];
  const themeIndex = (index - 5) % PARALLAX_THEMES.length;
  return PARALLAX_THEMES[themeIndex];
};

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
