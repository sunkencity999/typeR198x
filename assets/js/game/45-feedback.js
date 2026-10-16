// Type-R 198X — minimal presentation primitives the gameplay systems talk to: floaters (JUICE-08 API) and the banner
// system (VIS-14 API). Methods are mixed into Game.prototype; load order is defined in index.html (after 40-combat.js).
//
// This file keeps the API exact (addFloater / drawFloaters / showBanner / updateBanner / drawBanner / BANNER_PRESETS)
// and draws plain centred text; the juice phase (D5) restyles the look without touching the callers.
//
// Drawing: the renderer calls this.drawFloaters(ctx) at layer L13, this.drawBanner(ctx) at L15 and
// this.drawBossHazardMeter(ctx, rect) at L10 when those methods exist. Until it does, installFeedbackHooks() wraps
// Game.prototype.render once and calls whichever of the three the frame did not draw (each draw method bumps its own
// counter, so the renderer's own calls win as soon as they exist). Nothing here ever draws from update().

// Banner presets (CONTRACT section 11). y is a function of the game so hudSafeTop is read at show time.
const BANNER_PRESETS = {
  bossIntro: { dur: 2.4, size: 48, subSize: 20, y: (g) => g.h * 0.42, align: "center", letterbox: true, color: "magenta" },
  bossClear: { dur: 3.0, size: 56, subSize: 22, y: (g) => g.h * 0.46, align: "center", letterbox: false, color: "amber" },
  sector:    { dur: 1.6, size: 44, subSize: 18, y: (g) => g.h * 0.46, align: "center", letterbox: true, color: "cyan" },
  wave:      { dur: 1.2, size: 28, subSize: 14, y: (g) => g.hudSafeTop + 36, align: "center", letterbox: false, color: "text" },
  callout:   { dur: 1.0, size: 22, subSize: 14, y: (g) => g.hudSafeTop + 36, align: "center", letterbox: false, color: "text", queueMax: 2 }
};
const BANNER_IN_S = 0.24;     // title slam / fade in
const BANNER_OUT_S = 0.3;     // fade out
const FLOATER_LIFE_S = 0.75;
const FLOATER_RISE_PX = 48;
const FLOATER_CAP = 24;
const FEEDBACK_FALLBACK_COLORS = {
  cyan: "#39F5FF", magenta: "#FF39D1", lime: "#A8FF3A", amber: "#FFC14A", violet: "#B86BFF",
  danger: "#FF4D6D", text: "#F6F7FF", white: "#F6F7FF"
};
const FEEDBACK_TOKEN_VARS = {
  cyan: "--neon-cyan", magenta: "--neon-magenta", lime: "--neon-lime", amber: "--neon-amber", violet: "--neon-violet",
  danger: "--danger", text: "--c-text", white: "--c-text"
};
const feedbackColorCache = {};

// Colour by token name: PALETTE (10-tokens.js) when it exists, else the CSS token, else the shipped hex.
function feedbackColor(name) {
  const key = name || "text";
  if (typeof PALETTE !== "undefined" && PALETTE && typeof PALETTE[key] === "string") return PALETTE[key];
  if (feedbackColorCache[key]) return feedbackColorCache[key];
  let v = "";
  try {
    const varName = FEEDBACK_TOKEN_VARS[key];
    if (varName && typeof getComputedStyle === "function") v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  } catch (_) { v = ""; }
  feedbackColorCache[key] = v || FEEDBACK_FALLBACK_COLORS[key] || FEEDBACK_FALLBACK_COLORS.text;
  return feedbackColorCache[key];
}

function feedbackFont(px, weight = 700) {
  if (typeof FONT !== "undefined" && FONT && typeof FONT.target === "function") return FONT.target(px, weight);
  return `${weight} ${px}px ui-monospace, Menlo, Monaco, Consolas, monospace`;
}

function feedbackDisplayFont(px, weight = 800) {
  if (typeof FONT !== "undefined" && FONT && typeof FONT.display === "function") return FONT.display(px, weight);
  return `${weight} ${px}px 'Orbitron', ui-monospace, Menlo, Monaco, Consolas, monospace`;
}

function easeOutBackFx(t) {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

Object.assign(Game.prototype, {
  // ------------------------- Floaters -------------------------
  // addFloater(x, y, text, colorName, size): rises 48 px over .75 s and fades; in reduced motion it fades in place.
  addFloater(x, y, text, colorName = "text", size = 18) {
    if (!this.floaters) this.floaters = [];
    const list = this.floaters;
    if (list.length >= FLOATER_CAP) list.shift();
    list.push({ x, y, text: String(text), color: colorName || "text", size: size || 18, t: 0, life: FLOATER_LIFE_S });
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
    for (const f of list) {
      const k = clamp(f.t / f.life, 0, 1);
      const rise = rm ? 0 : FLOATER_RISE_PX * (1 - Math.pow(1 - k, 3));
      const alpha = k < 0.15 ? k / 0.15 : 1 - Math.max(0, (k - 0.45) / 0.55);
      ctx.globalAlpha = clamp(alpha, 0, 1);
      ctx.font = feedbackFont(f.size, 700);
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(5,6,11,0.85)";
      ctx.strokeText(f.text, f.x, f.y - rise);
      ctx.fillStyle = feedbackColor(f.color);
      ctx.fillText(f.text, f.x, f.y - rise);
    }
    ctx.restore();
  },

  // ------------------------- Banners -------------------------
  // showBanner({ kind, title, sub, eyebrow, color, dur }). Kinds: bossIntro | bossClear | sector | wave | callout.
  // Primary kinds replace each other; callouts queue (max 2 waiting) behind the current callout.
  showBanner(opts = {}) {
    const kind = BANNER_PRESETS[opts.kind] ? opts.kind : "callout";
    const preset = BANNER_PRESETS[kind];
    const b = {
      kind,
      title: String(opts.title ?? ""),
      sub: opts.sub != null ? String(opts.sub) : "",
      eyebrow: opts.eyebrow != null ? String(opts.eyebrow) : "",
      color: opts.color || preset.color,
      dur: Number.isFinite(opts.dur) ? opts.dur : preset.dur,
      t: 0,
      done: false,
      y: Number.isFinite(opts.y) ? opts.y : null
    };
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
    if (this.calloutQueue) this.calloutQueue.length = 0;
  },

  drawBanner(ctx) {
    this._feedbackDraws = (this._feedbackDraws | 0) + 1;
    if (this.banner) this.drawOneBanner(ctx, this.banner);
    if (this.callout) this.drawOneBanner(ctx, this.callout);
  },

  drawOneBanner(ctx, b) {
    const preset = BANNER_PRESETS[b.kind] || BANNER_PRESETS.callout;
    const rm = !!this.reduceMotion;
    const tIn = clamp(b.t / BANNER_IN_S, 0, 1);
    const tOut = clamp((b.dur - b.t) / BANNER_OUT_S, 0, 1);
    const alpha = Math.min(tIn, tOut);
    if (alpha <= 0) return;
    let y = b.y != null ? b.y : preset.y(this);
    // A callout under an active wave banner sits one line lower so the two never overprint.
    if (b.kind === "callout" && this.banner && this.banner !== b && this.banner.kind === "wave") y += 44;
    const cx = this.w / 2;
    const scale = rm ? 1 : (0.7 + 0.3 * easeOutBackFx(tIn));
    ctx.save();
    ctx.globalAlpha = alpha;
    if (preset.letterbox) {
      // Bottom bar only (the DOM HUD covers the top); 56 px, under the full-frame alpha cap.
      ctx.fillStyle = "rgba(5,6,11,0.55)";
      ctx.fillRect(0, this.h - 56, this.w, 56);
      ctx.fillStyle = "rgba(5,6,11,0.42)";
      ctx.fillRect(0, y - preset.size * 1.1, this.w, preset.size * 2.6);
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if (b.eyebrow) {
      ctx.font = feedbackFont(Math.max(12, Math.round(preset.subSize * 0.85)), 700);
      ctx.fillStyle = feedbackColor("text");
      ctx.globalAlpha = alpha * 0.85;
      ctx.fillText(b.eyebrow, cx, y - preset.size * 0.95);
      ctx.globalAlpha = alpha;
    }
    ctx.translate(cx, y);
    ctx.scale(scale, scale);
    ctx.font = feedbackDisplayFont(preset.size, 800);
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(5,6,11,0.85)";
    ctx.strokeText(b.title, 0, 0);
    ctx.fillStyle = feedbackColor(b.color);
    ctx.fillText(b.title, 0, 0);
    ctx.setTransform(this.renderScale || 1, 0, 0, this.renderScale || 1, 0, 0);
    if (b.sub) {
      ctx.font = feedbackFont(preset.subSize, 600);
      ctx.fillStyle = feedbackColor("text");
      ctx.globalAlpha = alpha * 0.92;
      ctx.lineWidth = 3;
      ctx.strokeText(b.sub, cx, y + preset.size * 0.85);
      ctx.fillText(b.sub, cx, y + preset.size * 0.85);
    }
    ctx.restore();
  },

  // ------------------------- Render stopgap -------------------------
  // Wraps Game.prototype.render once so floaters, banners and the boss hazard meter are visible before the
  // renderer adopts the L10/L13/L15 calls. Each draw method bumps a counter; whatever the frame already drew is
  // not drawn again. Also retires the legacy canvas boss-intro / boss-clear text (amendment C-10): the banner
  // system owns that copy now. Installed on DOMContentLoaded (every script has run by then) and lazily from update().
  installFeedbackHooks() {
    const proto = Game.prototype;
    if (proto._feedbackHooked) return;
    const base = proto.render;
    if (typeof base !== "function") return;
    proto._feedbackHooked = true;
    proto.render = function (dt) {
      const drawsBefore = this._feedbackDraws | 0;
      const hazardBefore = this._hazardDraws | 0;
      base.call(this, dt);
      const drewFeedback = (this._feedbackDraws | 0) !== drawsBefore;
      const drewHazard = (this._hazardDraws | 0) !== hazardBefore;
      if (drewFeedback && drewHazard) return;
      const ctx = this.ctx;
      const s = this.renderScale || 1;
      ctx.save();
      ctx.setTransform(s, 0, 0, s, 0, 0);
      if (!drewHazard && this.inBoss && this.boss && typeof this.drawBossHazardMeter === "function") {
        this.drawBossHazardMeter(ctx, this.bossHazardRect ? this.bossHazardRect() : null);
      }
      if (!drewFeedback) {
        this.drawFloaters(ctx);
        this.drawBanner(ctx);
      }
      ctx.restore();
    };
    if (typeof proto.drawBossIntro === "function" && !proto.drawBossIntro.bannerAware) proto.drawBossIntro = function () {};
    if (typeof proto.drawBossClearText === "function" && !proto.drawBossClearText.bannerAware) proto.drawBossClearText = function () {};
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
