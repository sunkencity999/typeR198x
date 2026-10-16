// Type-R 198X — presentation primitives the gameplay systems talk to: floaters (JUICE-08) and the banner system
// (VIS-14). Methods are mixed into Game.prototype; load order is defined in index.html (after 40-combat.js).
//
// API (CONTRACT section 4): addFloater(x, y, text, colorName, size) / drawFloaters(ctx) at L13;
// showBanner({ kind, eyebrow, title, sub, color, dur }) / updateBanner(dt) / drawBanner(ctx) at L15 (unshaken);
// BANNER_PRESETS is the one table every big moment tunes from. Primary kinds (bossIntro / bossClear / sector)
// replace each other; wave is the eyebrow-only line under the HUD; callouts queue (max 2 waiting).
//
// Timeline of a primary banner (t in s, D = dur): 0-.18 the letterbox bar and the band slide in (easeOutExpo);
// eyebrow typewriter 30 ms/char from .05 (blinking 4 Hz afterwards when the preset says so); title slam at .18:
// scale 1.4 -> 1 and alpha 0 -> 1 over .24 s easeOutBack with a one-frame additive white copy and uiTick('slam');
// sub fades in at .40; D-.3..D everything fades out. Reduced motion: typewriters, slams and blinks become fades.
// drawBanner publishes game.bannerRect ({x,y,w,h} of the visible band or null) for the camera's L16 redraw.

const BANNER_PRESETS = {
  bossIntro: { dur: 2.4, size: 48, subSize: 20, y: (g) => g.h * 0.42, align: "left", anchor: "left", letterbox: true, letterboxUntil: 1.9, color: "text", stroke: "magenta", eyebrowColor: "danger", subColor: "magenta", blinkEyebrow: true, typeTitleCps: 18 },
  bossClear: { dur: 3.0, size: 56, subSize: 24, y: (g) => g.h * 0.46, align: "center", anchor: "center", letterbox: false, color: "amber", stroke: "amber", eyebrowColor: "amber", subColor: "amber" },
  sector:    { dur: 1.6, size: 52, subSize: 20, y: (g) => g.h * 0.46, align: "center", anchor: "center", letterbox: true, color: "accent", stroke: "accent", eyebrowColor: "accent", subColor: "cyan" },
  wave:      { dur: 1.2, size: 20, subSize: 14, y: (g) => g.hudSafeTop + 36, align: "center", anchor: "center", letterbox: false, color: "cyan" },
  callout:   { dur: 1.0, size: 28, subSize: 14, y: (g) => g.hudSafeTop + 36, align: "center", anchor: "center", letterbox: false, color: "text", queueMax: 2 }
};
const BANNER_IN_S = 0.18;       // bars / band slide in
const BANNER_SLAM_AT = 0.18;    // title slam start
const BANNER_SLAM_S = 0.24;
const BANNER_SUB_AT = 0.40;
const BANNER_OUT_S = 0.3;       // fade out
const BANNER_TYPE_S = 0.03;     // eyebrow typewriter, per char
const BANNER_LETTERBOX_PX = 56;
const BANNER_BAND_Y = 0.34;     // centre band y .34h .. .64h
const BANNER_BAND_H = 0.30;
const BANNER_LEFT_X = 64;
const FLOATER_LIFE_S = 0.75;
const FLOATER_RISE_PX = 48;
const FLOATER_CAP = 24;
const FLOATER_POP_S = 0.12;
const FEEDBACK_FALLBACK_COLORS = {
  cyan: "#39F5FF", magenta: "#FF39D1", lime: "#A8FF3A", amber: "#FFC14A", violet: "#B86BFF",
  danger: "#FF4D6D", text: "#F6F7FF", white: "#F6F7FF", accent: "#39F5FF"
};
const FEEDBACK_TOKEN_VARS = {
  cyan: "--neon-cyan", magenta: "--neon-magenta", lime: "--neon-lime", amber: "--neon-amber", violet: "--neon-violet",
  danger: "--danger", text: "--c-text", white: "--c-text", accent: "--theme-accent"
};
const feedbackColorCache = {};

// Colour by token name (+ alpha): PALETTE (10-tokens.js) when it exists, else the CSS token, else the shipped hex.
function feedbackColor(name, alpha = 1) {
  const key = name || "text";
  if (typeof PALETTE !== "undefined" && PALETTE && typeof PALETTE.rgba === "function" && PALETTE.has && PALETTE.has(key === "white" ? "text" : key)) {
    return PALETTE.rgba(key === "white" ? "text" : key, alpha);
  }
  if (!feedbackColorCache[key]) {
    let v = "";
    try {
      const varName = FEEDBACK_TOKEN_VARS[key];
      if (varName && typeof getComputedStyle === "function") v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    } catch (_) { v = ""; }
    feedbackColorCache[key] = v || FEEDBACK_FALLBACK_COLORS[key] || FEEDBACK_FALLBACK_COLORS.text;
  }
  const hex = feedbackColorCache[key];
  if (alpha >= 1 || !/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function feedbackFont(px, weight = 700) {
  if (typeof FONT !== "undefined" && FONT && typeof FONT.target === "function") return FONT.target(px, weight);
  return `${weight} ${px}px ui-monospace, Menlo, Monaco, Consolas, monospace`;
}

function feedbackDisplayFont(px, weight = 800) {
  if (typeof FONT !== "undefined" && FONT && typeof FONT.display === "function") return FONT.display(px, weight);
  return `${weight} ${px}px 'Orbitron', ui-monospace, Menlo, Monaco, Consolas, monospace`;
}

const feedbackEaseOutBack = (t) => (typeof easeOutBack === "function" ? easeOutBack(t) : (() => { const c1 = 1.70158, c3 = c1 + 1, u = Math.max(0, Math.min(1, t)) - 1; return 1 + c3 * u * u * u + c1 * u * u; })());
const feedbackEaseOutCubic = (t) => 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 3);
const feedbackEaseOutExpo = (t) => (t >= 1 ? 1 : t <= 0 ? 0 : 1 - Math.pow(2, -10 * t));
const blink = (t, hz, low = 0.35) => (Math.floor(t * hz * 2) % 2 === 0 ? 1 : low);

Object.assign(Game.prototype, {
  // ------------------------- Floaters -------------------------
  // addFloater(x, y, text, colorName, size, opts): 20 px mono bold by default, rises 48 px over .75 s (easeOutCubic),
  // pops 1.3 -> 1 in the first .12 s, 4 px bg0 stroke. "COMBO LOST -N" floaters are danger / 22 px / 1.0 s.
  // Never spawned inside the locked plate's rect (pushed above it, y offset >= h/2 + 8).
  addFloater(x, y, text, colorName = "text", size = 20, opts = {}) {
    if (!this.floaters) this.floaters = [];
    const list = this.floaters;
    if (list.length >= FLOATER_CAP) list.shift();
    const str = String(text);
    let life = Number.isFinite(opts.life) ? opts.life : FLOATER_LIFE_S;
    let px = size || 20;
    if (/^COMBO LOST/.test(str)) { px = Math.max(px, 22); life = Math.max(life, 1.0); colorName = "danger"; }
    x = clamp(x, 60, this.w - 60);   // keep the text on the playfield
    const ref = this.lock && this.lock.ref;
    if (ref && ref.alive && Number.isFinite(ref.plateW)) {
      const hw = ref.plateW / 2 + 8, hh = (ref.plateH || 40) / 2 + 8;
      if (x > ref.x - hw && x < ref.x + hw && y > ref.y - hh && y < ref.y + hh) y = ref.y - hh - px * 0.5;
    }
    list.push({ x, y, text: str, color: colorName || "text", size: px, t: 0, life });
    return list[list.length - 1];
  },

  updateFloaters(dt) {
    const list = this.floaters;
    if (!list || !list.length) return;
    compactInPlace(list, (f) => { f.t += dt; return f.t < f.life; });
  },

  drawFloaters(ctx) {
    this._feedbackDraws = (this._feedbackDraws | 0) + 1;
    const list = this.floaters;
    if (!list || !list.length) return;
    const rm = !!this.reduceMotion;
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    for (const f of list) {
      const k = clamp(f.t / f.life, 0, 1);
      const rise = rm ? 0 : FLOATER_RISE_PX * feedbackEaseOutCubic(k);
      const fadeFrom = 1 - 0.25 / f.life;
      const alpha = k < 0.08 ? k / 0.08 : (k > fadeFrom ? 1 - (k - fadeFrom) / (1 - fadeFrom) : 1);
      const pop = (!rm && f.t < FLOATER_POP_S) ? 1.3 - 0.3 * feedbackEaseOutCubic(f.t / FLOATER_POP_S) : 1;
      ctx.globalAlpha = clamp(alpha, 0, 1);
      ctx.save();
      ctx.translate(f.x, f.y - rise);
      if (pop !== 1) ctx.scale(pop, pop);
      ctx.font = feedbackFont(f.size, 700);
      ctx.lineWidth = 4;
      ctx.strokeStyle = feedbackColor("bg0", 0.92);
      ctx.strokeText(f.text, 0, 0);
      ctx.fillStyle = feedbackColor(f.color);
      ctx.fillText(f.text, 0, 0);
      ctx.restore();
    }
    ctx.restore();
  },

  // ------------------------- Banners -------------------------
  // showBanner({ kind, title, sub, eyebrow, color, dur, blink, count:{from,dur,to} }). Kinds: bossIntro | bossClear |
  // sector | wave | callout. The sector preset derives its copy from the current sector (ENTERING / STORM PASS,
  // SECTOR 0N, BOSS: NAME) so every caller gets the same card.
  showBanner(opts = {}) {
    const kind = BANNER_PRESETS[opts.kind] ? opts.kind : "callout";
    const preset = BANNER_PRESETS[kind];
    let eyebrow = opts.eyebrow != null ? String(opts.eyebrow) : "";
    let title = String(opts.title ?? "");
    let sub = opts.sub != null ? String(opts.sub) : "";
    if (kind === "sector") {
      const cfg = (typeof LEVELS !== "undefined" && LEVELS[this.levelIndex]) || null;
      const theme = this.currentTheme;
      eyebrow = theme && theme.storm ? "STORM PASS" : "ENTERING";
      if (cfg) {
        title = `SECTOR ${String(cfg.level).padStart(2, "0")}`;
        sub = `BOSS: ${cfg.bossName}`;
      }
    }
    if (kind === "wave" && !eyebrow && title) { eyebrow = title; title = ""; }
    const b = {
      kind,
      anchor: preset.anchor || "center",
      title,
      sub,
      eyebrow,
      color: opts.color || preset.color,
      dur: Number.isFinite(opts.dur) ? opts.dur : preset.dur,
      t: 0,
      done: false,
      y: Number.isFinite(opts.y) ? opts.y : null,
      letterbox: opts.letterbox != null ? !!opts.letterbox : !!preset.letterbox,
      letterboxUntil: Number.isFinite(preset.letterboxUntil) ? preset.letterboxUntil : null,   // bars leave early (boss intro: when the slab arrives)
      blinkEyebrow: opts.blink != null ? !!opts.blink : !!preset.blinkEyebrow,
      typeTitleCps: Number.isFinite(opts.typeTitleCps) ? opts.typeTitleCps : (preset.typeTitleCps || 0),
      count: opts.count && Number.isFinite(opts.count.to) ? { from: opts.count.from || 0, dur: opts.count.dur || 1.2, to: opts.count.to } : null,
      rect: null,
      titleScale: 1,
      eyebrowAlpha: 0,
      slammed: false,
      slamFrame: false
    };
    b.rect = this.bannerRectFor(b);
    if (kind === "callout") {
      if (!this.calloutQueue) this.calloutQueue = [];
      if (this.callout && !this.callout.done) {
        if (this.calloutQueue.length < (preset.queueMax || 2)) this.calloutQueue.push(b);
      } else {
        this.callout = b;
      }
      return b;
    }
    this.banner = b;
    return b;
  },

  // Band rect of a banner (what the L16 redraw tests against): left anchor x 0..0.5w, centre full width, both
  // y .34h..0.64h; line banners (wave / callout) a 34 px pill around their text.
  bannerRectFor(b) {
    const w = this.w, h = this.h;
    if (b.kind === "wave" || b.kind === "callout") {
      const preset = BANNER_PRESETS[b.kind];
      const y = b.y != null ? b.y : preset.y(this);
      const tw = Math.max(120, (b.eyebrow || b.title || "").length * (b.kind === "callout" ? 20 : 16) + 48);
      return { x: Math.round(w / 2 - tw / 2), y: Math.round(y - 17), w: Math.round(tw), h: b.sub ? 62 : 34 };
    }
    const bandY = Math.round(h * BANNER_BAND_Y), bandH = Math.round(h * BANNER_BAND_H);
    return { x: 0, y: bandY, w: b.anchor === "left" ? Math.round(w * 0.5) : w, h: bandH };
  },

  updateBanner(dt) {
    const tick = (b) => {
      if (!b) return null;
      b.t += dt;
      if (b.t >= b.dur) b.done = true;
      return b.done ? null : b;
    };
    this.banner = tick(this.banner);
    this.callout = tick(this.callout);
    if (!this.callout && this.calloutQueue && this.calloutQueue.length) this.callout = this.calloutQueue.shift();
  },

  clearBanners() {
    this.banner = null;
    this.callout = null;
    this.bannerRect = null;
    if (this.calloutQueue) this.calloutQueue.length = 0;
  },

  drawBanner(ctx) {
    this._feedbackDraws = (this._feedbackDraws | 0) + 1;
    let rect = null;
    if (this.banner) rect = this.drawOneBanner(ctx, this.banner) || rect;
    if (this.callout) { const r = this.drawOneBanner(ctx, this.callout); if (!rect) rect = r; }
    this.bannerRect = rect;
  },

  bannerSlamCue() {
    const sfx = this.sfx;
    if (!sfx) return;
    if (typeof sfx.bannerSlam === "function") sfx.bannerSlam();
    else if (typeof sfx.uiTick === "function") sfx.uiTick("slam");
  },

  drawOneBanner(ctx, b) {
    const preset = BANNER_PRESETS[b.kind] || BANNER_PRESETS.callout;
    const rm = !!this.reduceMotion;
    const tOut = clamp((b.dur - b.t) / BANNER_OUT_S, 0, 1);
    if (b.kind === "wave" || b.kind === "callout") return this.drawLineBanner(ctx, b, preset, rm, tOut);
    return this.drawPrimaryBanner(ctx, b, preset, rm, tOut);
  },

  // bossIntro (left band, blinking WARNING, name typed at 18 cps), bossClear (centre, amber, +N BONUS counting up),
  // sector (centre, letterbox, ENTERING / STORM PASS, SECTOR 0N slam, BOSS: NAME, GET READY from .9 s).
  drawPrimaryBanner(ctx, b, preset, rm, tOut) {
    const t = b.t;
    const w = this.w, h = this.h;
    const left = b.anchor === "left";
    const rect = this.bannerRectFor(b);
    b.rect = rect;
    const kIn = rm ? clamp(t / 0.2, 0, 1) : feedbackEaseOutExpo(clamp(t / BANNER_IN_S, 0, 1));
    const fade = tOut;
    const vis = Math.min(kIn, fade);
    if (vis <= 0) return null;
    const accent = b.color === "accent" ? "accent" : b.color;
    ctx.save();
    ctx.lineJoin = "round";

    // letterbox: bottom bar only (the DOM HUD covers the top)
    if (b.letterbox) {
      const lbOut = b.letterboxUntil != null ? clamp((b.letterboxUntil - t) / BANNER_OUT_S, 0, 1) : 1;
      const bh = BANNER_LETTERBOX_PX * Math.min(vis, lbOut);
      ctx.fillStyle = feedbackColor("bg0", 0.92);
      ctx.fillRect(0, h - bh, w, bh);
    }
    // band (soft right edge when left-anchored)
    ctx.globalAlpha = vis;
    if (left) {
      const grad = ctx.createLinearGradient(0, 0, rect.w, 0);
      grad.addColorStop(0, feedbackColor("bg0", 0.70));
      grad.addColorStop(0.78, feedbackColor("bg0", 0.70));
      grad.addColorStop(1, feedbackColor("bg0", 0));
      ctx.fillStyle = grad;
    } else {
      ctx.fillStyle = feedbackColor("bg0", 0.70);
    }
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    // hairlines
    ctx.fillStyle = feedbackColor(accent, 0.25);
    ctx.fillRect(rect.x, rect.y, left ? rect.w * 0.78 : rect.w, 1);
    ctx.fillRect(rect.x, rect.y + rect.h - 1, left ? rect.w * 0.78 : rect.w, 1);

    const x0 = left ? BANNER_LEFT_X : w / 2;
    const maxW = left ? w * 0.46 : w * 0.80;
    const eyebrowY = rect.y + 40;
    const titleY = rect.y + rect.h * 0.5 + 4;
    const subY = rect.y + rect.h - 44;
    const hintY = rect.y + rect.h - 16;
    ctx.textAlign = left ? "left" : "center";
    ctx.textBaseline = "middle";

    // eyebrow: typewriter 30 ms/char from .05 (fade under reduce-motion), blink 4 Hz once typed when asked
    let eyebrowDoneAt = 0.05;
    if (b.eyebrow) {
      const n = rm ? b.eyebrow.length : typedCount(b.eyebrow, t - 0.05, BANNER_TYPE_S);
      eyebrowDoneAt = 0.05 + b.eyebrow.length * BANNER_TYPE_S;
      let ea = rm ? clamp((t - 0.05) / 0.2, 0, 1) : (n > 0 ? 1 : 0);
      if (b.blinkEyebrow && !rm && t >= eyebrowDoneAt) ea = blink(t - eyebrowDoneAt, 4);
      b.eyebrowAlpha = ea * fade;
      if (ea > 0) {
        ctx.globalAlpha = ea * fade;
        ctx.font = feedbackDisplayFont(18, 600);
        ctx.fillStyle = feedbackColor(preset.eyebrowColor || accent, 0.92);
        const shown = b.eyebrow.slice(0, n);
        const tw = drawTracked(ctx, shown, x0, eyebrowY, 0.35);
        if (!rm && n < b.eyebrow.length) {
          // typing caret
          const cx = left ? x0 + tw + 6 : x0 + tw / 2 + 6;
          ctx.fillStyle = feedbackColor("lime", 0.92);
          ctx.fillRect(cx, eyebrowY - 8, 8, 16);
        }
      }
    } else {
      b.eyebrowAlpha = 0;
    }

    // title: slam (or typed reveal for bossIntro)
    const slamT = t - BANNER_SLAM_AT;
    let ts = 1, ta = 0, shownTitle = b.title;
    if (b.typeTitleCps > 0 && !rm) {
      const startAt = Math.max(BANNER_SLAM_AT, Math.min(eyebrowDoneAt, 0.3));
      const n = t < startAt ? 0 : Math.min(b.title.length, Math.floor((t - startAt) * b.typeTitleCps) + 1);
      shownTitle = b.title.slice(0, n);
      ta = n > 0 ? 1 : 0;
      ts = 1;
    } else if (slamT >= 0) {
      const k = clamp(slamT / BANNER_SLAM_S, 0, 1);
      ts = rm ? 1 : 1 + 0.4 * (1 - feedbackEaseOutBack(k));
      ta = rm ? k : Math.min(1, k * 3);
    }
    b.titleScale = ts;
    if (!b.slammed && t >= BANNER_SLAM_AT) { b.slammed = true; this.bannerSlamCue(); }
    if (ta > 0 && shownTitle) {
      ctx.save();
      ctx.globalAlpha = ta * fade;
      ctx.translate(x0, titleY);
      if (ts !== 1) ctx.scale(ts, ts);
      ctx.font = feedbackDisplayFont(preset.size, 800);
      fitText(ctx, b.title, maxW, 32, 2, (px) => feedbackDisplayFont(px, 800));
      ctx.lineWidth = 6;
      ctx.strokeStyle = feedbackColor("bg0", 0.92);
      ctx.strokeText(shownTitle, 0, 0);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = feedbackColor(preset.stroke || accent, 0.70);
      ctx.strokeText(shownTitle, 0, 0);
      ctx.fillStyle = feedbackColor(b.color, 0.98);
      ctx.fillText(shownTitle, 0, 0);
      if (b.typeTitleCps > 0 && !rm && shownTitle.length < b.title.length) {
        const tw = ctx.measureText(shownTitle).width;
        const cx = left ? tw + 6 : tw / 2 + 6;
        const px = fontPx(ctx.font);
        ctx.fillStyle = feedbackColor("lime", 0.92);
        ctx.fillRect(cx, -px * 0.4, 6, px * 0.8);
      }
      if (!b.slamFrame && !rm) {
        // one-frame additive white copy on the slam frame
        b.slamFrame = true;
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = 0.5 * fade;
        ctx.fillStyle = feedbackColor("text", 0.92);
        ctx.fillText(shownTitle, 0, 0);
      }
      ctx.restore();
    }

    // sub: fades in at .40; bossClear counts the bonus up
    let subText = b.sub;
    if (b.count) {
      const k = clamp((t - b.count.from) / Math.max(0.01, b.count.dur), 0, 1);
      const shown = Math.round(b.count.to * (rm ? (k > 0 ? 1 : 0) : feedbackEaseOutCubic(k)));
      subText = `+${formatInt(shown)} BONUS`;
      if (k > 0 && k < 1 && !rm && t - (b._lastCountTick || -1) >= 0.06) {
        b._lastCountTick = t;
        if (this.sfx && typeof this.sfx.tallyTick === "function") this.sfx.tallyTick();
      }
    }
    if (subText) {
      const sa = clamp((t - BANNER_SUB_AT) / 0.2, 0, 1);
      if (sa > 0) {
        ctx.globalAlpha = sa * fade;
        ctx.font = feedbackFont(preset.subSize, 700);
        ctx.lineWidth = 3;
        ctx.strokeStyle = feedbackColor("bg0", 0.92);
        ctx.strokeText(subText, x0, subY);
        ctx.fillStyle = feedbackColor(preset.subColor || "cyan", 0.92);
        ctx.fillText(subText, x0, subY);
      }
    }

    // footer hints
    let hint = null, hintColor = "text", hintAlpha = 0.70, hintSize = 14;
    if (b.kind === "sector") {
      const gateOpen = typeof this.isLevelGateOpen === "function" ? this.isLevelGateOpen() : true;
      if (!gateOpen && t >= b.dur - 0.2) { hint = "SPOOLING SECTOR ART…"; hintAlpha = 0.70; }
      else if (t >= 0.9) { hint = "GET READY"; hintColor = "lime"; hintSize = 20; hintAlpha = rm ? 0.92 : blink(t - 0.9, 3, 0.25) * 0.92; }
    } else if (b.kind === "bossIntro") {
      const intro = this.bossIntro;
      const skipAt = typeof BOSS_INTRO_SKIP_S === "number" ? BOSS_INTRO_SKIP_S : 1.0;
      if (intro && intro.locked && intro.skippable && intro.t >= skipAt) { hint = "ANY KEY TO ENGAGE"; hintAlpha = rm ? 0.70 : blink(t, 2, 0.3) * 0.70; }
    } else if (b.kind === "bossClear") {
      const info = this.bossClear;
      const skipAt = typeof BOSS_FINALE_SKIP_S === "number" ? BOSS_FINALE_SKIP_S : 2.0;
      if (info && info.t >= skipAt) { hint = "SKIP: ANY KEY"; hintAlpha = rm ? 0.70 : blink(info.t - skipAt, 2, 0.3) * 0.70; }
    }
    if (hint) {
      ctx.globalAlpha = hintAlpha * fade;
      ctx.font = feedbackFont(hintSize, 700);
      ctx.lineWidth = 3;
      ctx.strokeStyle = feedbackColor("bg0", 0.92);
      ctx.strokeText(hint, x0, hintY);
      ctx.fillStyle = feedbackColor(hintColor, 0.92);
      ctx.fillText(hint, x0, hintY);
    }
    ctx.restore();
    return rect;
  },

  // wave: eyebrow-only tracked line at hudSafeTop + 36 (optional small sub: GO / NAME APPROACHING);
  // callout: 28 px Orbitron title (tier / type colour) for 1.0 s, queued behind the current callout.
  drawLineBanner(ctx, b, preset, rm, tOut) {
    const t = b.t;
    const w = this.w;
    let y = b.y != null ? b.y : preset.y(this);
    // A callout under an active wave banner sits one line lower so the two never overprint.
    if (b.kind === "callout" && this.banner && this.banner !== b && this.banner.kind === "wave") y += 44;
    const kIn = clamp(t / 0.16, 0, 1);
    const alpha = Math.min(kIn, tOut);
    if (alpha <= 0) return null;
    const isWave = b.kind === "wave";
    const text = isWave ? (b.eyebrow || b.title) : (b.title || b.eyebrow);
    if (!text && !b.sub) return null;
    const cx = w / 2;
    const color = b.color || preset.color;
    const scale = (!rm && !isWave) ? 1 + 0.3 * (1 - feedbackEaseOutBack(clamp(t / BANNER_SLAM_S, 0, 1))) : 1;
    b.titleScale = scale;
    let blinkA = 1;
    if (b.blinkEyebrow && !rm) blinkA = blink(t, 4);
    b.eyebrowAlpha = blinkA * alpha;

    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.font = isWave ? feedbackDisplayFont(preset.size, 600) : feedbackDisplayFont(preset.size, 800);
    const tw = isWave ? measureTracked(ctx, text, 0.3) : ctx.measureText(text).width;
    const bw = Math.round(tw + 48), bh = 34;
    const rect = { x: Math.round(cx - bw / 2), y: Math.round(y - bh / 2), w: bw, h: b.sub ? bh + 28 : bh };
    b.rect = rect;
    // pill band
    ctx.globalAlpha = alpha;
    ctx.fillStyle = feedbackColor("bg0", 0.70);
    roundRect(ctx, cx - bw / 2 * scale, y - bh / 2, bw * scale, bh, 17);
    ctx.fill();
    ctx.fillStyle = feedbackColor(color, 0.45);
    ctx.fillRect(cx - bw / 2 * scale + 12, y + bh / 2 - 1, (bw * scale - 24), 1);
    if (text) {
      ctx.save();
      ctx.translate(cx, y);
      if (scale !== 1) ctx.scale(scale, scale);
      ctx.globalAlpha = alpha * blinkA;
      if (isWave) {
        ctx.fillStyle = feedbackColor(color, 0.92);
        drawTracked(ctx, text, 0, 0, 0.3);
      } else {
        ctx.lineWidth = 4;
        ctx.strokeStyle = feedbackColor("bg0", 0.92);
        ctx.strokeText(text, 0, 0);
        ctx.fillStyle = feedbackColor(color, 0.98);
        ctx.fillText(text, 0, 0);
        if (!b.slamFrame && !rm) {
          b.slamFrame = true;
          ctx.globalCompositeOperation = "lighter";
          ctx.globalAlpha = 0.5 * alpha;
          ctx.fillStyle = feedbackColor("text", 0.92);
          ctx.fillText(text, 0, 0);
        }
      }
      ctx.restore();
    }
    if (b.sub) {
      ctx.globalAlpha = alpha;
      ctx.font = feedbackFont(preset.subSize, 700);
      const sw = ctx.measureText(b.sub).width + 24;
      ctx.fillStyle = feedbackColor("bg0", 0.70);
      roundRect(ctx, cx - sw / 2, y + 20, sw, 22, 11);
      ctx.fill();
      ctx.fillStyle = feedbackColor(isWave && color !== "danger" ? "text" : color, 0.92);
      ctx.fillText(b.sub, cx, y + 31);
    }
    ctx.restore();
    return rect;
  },

  // Installed once on DOMContentLoaded: binds the finale tap-to-skip. (The render stopgap that used to live here is
  // gone: 70-render.js calls drawBossHazardMeter at L10, drawFloaters at L13 and drawBanner at L15 directly.)
  installFeedbackHooks() {
    const proto = Game.prototype;
    if (proto._feedbackHooked) return;
    proto._feedbackHooked = true;
    // Finale skip on a canvas tap (B8): letters / Enter / Space are routed in 30-input.js.
    const canvas = document.getElementById("game");
    if (canvas && !canvas._finaleTapBound) {
      canvas._finaleTapBound = true;
      canvas.addEventListener("pointerdown", () => {
        const g = window.game;
        if (g && g.mode === "playing" && typeof g.skipFinale === "function") g.skipFinale("tap");
      });
    }
  }
});

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => Game.prototype.installFeedbackHooks());
  } else {
    Game.prototype.installFeedbackHooks();
  }
}
