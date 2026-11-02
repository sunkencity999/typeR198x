// Type-R 198X — CINEMATIC (presentation pass 2026-11): framing for the big moments, on top of the banner system.
// Methods are mixed into Game.prototype; load order is defined in index.html (after 45-feedback.js). Draws in the
// renderOverlay hook (unshaken, over the banners) and sets game.cameraZoom, which render() applies around the screen
// centre to the WORLD layers only (L1-L4: backdrop, stars, mid strip, near parallax, storm; zoom >= 1 so the shake margin
// stays covered). The play layer is never scaled: plates and the ship keep their geometry, the world rushes in behind.
//
// 1. Camera. Sector entry drops out of warp: zoom 1.08 -> 1 over the sector card (with the star streaks). The boss
//    warning punches 1 -> 1.035 at the title slam and settles by 1.2 s; the boss kill punches 1.05 and settles in .5 s.
// 2. Sector card subtitles. The letterbox bar carries the sector's location (CINE_LOCATIONS, typed at 40 cps) and a
//    telemetry readout (vector / signal / hull) on the right; a hairline rule above the bar in the accent.
// 3. Boss warning. Hazard chevrons scroll along the letterbox bar (pattern baked once), a THREAT readout types in, and a
//    red edge pulse (pre-rendered edge glow, 2 Hz) breathes while the intro is locked.
// 4. Screen wipe. A scanline band sweeps the stage on every mode change between HTML screens (#cineWipe, CSS keyframes);
//    not for playing <-> paused, which must feel instant.
// Reduce-motion: no zoom, no chevron scroll, no pulse, no wipe; subtitles still appear (fade instead of type).
// Budget: source-over only; one pattern fill, one edge-glow drawImage, text.

const CINE = Object.freeze({
  zoom: Object.freeze({ intro: 0.08, bossPunch: 0.035, bossSettleS: 1.2, killPunch: 0.05, killSettleS: 0.5 }),
  bar: Object.freeze({ h: 56, pad: 26, cps: 40 }),
  chevron: Object.freeze({ period: 36, h: 12, speed: 90, alpha: 0.9 }),
  pulse: Object.freeze({ hz: 2.0, max: 0.42 }),
  wipeMs: 360
});

// Where each sector is (levelIndex 0..9); the eyebrow of the sector card says ENTERING, this says where.
const CINE_LOCATIONS = Object.freeze([
  "SPACE STATION 404 // OUTER RING",
  "VECTOR FIELDS // SALVAGE BELT",
  "PLASMA NEBULA // DRIFT LANES",
  "HOLO DOCKS // MAINTENANCE SPUR",
  "CHROME YARDS // ASSEMBLY ROW",
  "ABYSSAL RELAY // RING STATION",
  "STATIC REFINERY // SECTOR 7 WORKS",
  "LOGIC FOUNDRY // SMELTER DISTRICT",
  "NIGHT ENGINE // RED GIANT ORBIT",
  "TYPEGRID CORE // FINAL APPROACH"
]);

Object.assign(Game.prototype, {
  cineState() {
    return this._cine || (this._cine = { zoomPunch: 0, zoomPunchT: 0, zoomPunchS: 1, chevron: null, chevronEpoch: -1, edge: null, edgeEpoch: -1, wipeEl: null });
  },

  // ------------------------- 1. camera -------------------------
  cineTick(dt) {
    const st = this.cineState();
    const rm = !!this.reduceMotion;
    let zoom = 1;
    if (!rm) {
      const li = this.levelIntro;
      if (li && li.dur > 0) zoom += CINE.zoom.intro * (1 - easeOutCubic(clamp(li.t / li.dur, 0, 1)));
      const bi = this.bossIntro;
      if (bi && bi.locked) {
        const t = bi.t - BANNER_SLAM_AT;
        if (t > 0) zoom += CINE.zoom.bossPunch * (1 - easeOutCubic(clamp(t / CINE.zoom.bossSettleS, 0, 1)));
      }
      if (st.zoomPunch > 0) {
        st.zoomPunchT += dt;
        const k = clamp(st.zoomPunchT / st.zoomPunchS, 0, 1);
        zoom += st.zoomPunch * (1 - easeOutCubic(k));
        if (k >= 1) st.zoomPunch = 0;
      }
    }
    this.cameraZoom = zoom;
  },

  cinePunch(amount, settleS) {
    const st = this.cineState();
    st.zoomPunch = Math.max(st.zoomPunch, amount);
    st.zoomPunchT = 0;
    st.zoomPunchS = settleS || 0.5;
  },

  // ------------------------- 2 + 3. letterbox dressing -------------------------
  cineChevronPattern(ctx) {
    const st = this.cineState();
    if (st.chevron && st.chevronEpoch === this.spriteEpoch) return st.chevron;
    const C = CINE.chevron;
    const s = this.renderScale || 1;
    const c = document.createElement("canvas");
    c.width = Math.round(C.period * s); c.height = Math.round(C.h * s);
    const g = c.getContext("2d");
    g.scale(s, s);
    g.fillStyle = PALETTE.rgba("amber", 0.95);
    g.beginPath();
    g.moveTo(0, C.h); g.lineTo(C.period * 0.5, C.h); g.lineTo(C.period, 0); g.lineTo(C.period * 0.5, 0); g.closePath();
    g.fill();
    st.chevron = ctx.createPattern(c, "repeat-x");
    st.chevronEpoch = this.spriteEpoch;
    return st.chevron;
  },

  cineEdgeSprite() {
    const st = this.cineState();
    if (st.edge && st.edgeEpoch === this.spriteEpoch) return st.edge;
    const s = (this.renderScale || 1) * 0.5;
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(this.w * s)); c.height = Math.max(1, Math.round(this.h * s));
    const g = c.getContext("2d");
    g.setTransform(s, 0, 0, s, 0, 0);
    const grad = g.createRadialGradient(this.w / 2, this.h / 2, this.h * 0.38, this.w / 2, this.h / 2, this.h * 0.78);
    grad.addColorStop(0, PALETTE.rgba("danger", 0));
    grad.addColorStop(0.7, PALETTE.rgba("danger", 0.35));
    grad.addColorStop(1, PALETTE.rgba("danger", 0.9));
    g.fillStyle = grad;
    g.fillRect(0, 0, this.w, this.h);
    st.edge = c;
    st.edgeEpoch = this.spriteEpoch;
    return c;
  },

  cineTyped(text, t, cps) {
    if (this.reduceMotion) return text;
    const n = Math.floor(Math.max(0, t) * cps);
    return text.slice(0, n);
  },

  drawCinematic(ctx) {
    const b = this.banner;
    if (!b || !(b.kind === "sector" || b.kind === "bossIntro")) return;
    const w = this.w, h = this.h;
    const t = b.t;
    const rm = !!this.reduceMotion;
    const lbUntil = b.letterboxUntil != null ? b.letterboxUntil : b.dur;
    const vis = Math.min(rm ? clamp(t / 0.2, 0, 1) : clamp(t / BANNER_IN_S, 0, 1), clamp((lbUntil - t) / BANNER_OUT_S, 0, 1));
    if (vis <= 0.01) return;
    const barH = CINE.bar.h * vis;
    const barY = h - barH;
    const sh = this.shakeNow || { x: 0, y: 0 };
    ctx.save();
    ctx.globalAlpha = vis;
    ctx.textBaseline = "middle";
    if (b.kind === "sector") {
      const accent = "accent";
      // hairline rule above the bar
      ctx.fillStyle = PALETTE.rgba(accent, 0.55);
      ctx.fillRect(0, Math.round(barY), w, 1);
      // location, typed
      const loc = CINE_LOCATIONS[clamp(this.levelIndex | 0, 0, CINE_LOCATIONS.length - 1)];
      const shown = this.cineTyped(loc, t - 0.25, CINE.bar.cps);
      ctx.font = feedbackDisplayFont(15, 600);
      ctx.textAlign = "left";
      ctx.fillStyle = PALETTE.rgba("text", 0.92);
      const cy = barY + barH / 2;
      drawTracked(ctx, shown, CINE.bar.pad, cy, 0.28);
      // telemetry, right
      const cfg = LEVELS[clamp(this.levelIndex | 0, 0, LEVELS.length - 1)];
      const hull = this.player ? `${this.player.hp | 0}/${this.player.maxHp | 0}` : "--";
      const tele = `VEC ${(0.3 + (this.levelIndex | 0) * 0.07).toFixed(2)}   SIG ${cfg && cfg.bossName ? cfg.bossName.split(" ")[0].toUpperCase() : "--"}   HULL ${hull}`;
      ctx.textAlign = "right";
      ctx.font = feedbackDisplayFont(13, 500);
      ctx.fillStyle = PALETTE.rgba(accent, 0.8);
      drawTracked(ctx, this.cineTyped(tele, t - 0.45, CINE.bar.cps * 1.5), w - CINE.bar.pad, cy, 0.22);
    } else {
      // boss warning: red edge pulse while locked (under), chevrons along the bar, THREAT readout
      const intro = this.bossIntro;
      if (intro && intro.locked && !rm) {
        const k = 0.5 + 0.5 * Math.sin((this.starT || 0) * Math.PI * 2 * CINE.pulse.hz);
        const edge = this.cineEdgeSprite();
        ctx.globalAlpha = CINE.pulse.max * k * vis;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(edge, 0, 0, this.canvas.width, this.canvas.height);
        const s = this.renderScale || 1;
        ctx.setTransform(s, 0, 0, s, 0, 0);
        ctx.globalAlpha = vis;
      }
      const C = CINE.chevron;
      const pat = this.cineChevronPattern(ctx);
      const y = Math.round(barY) + 4;
      ctx.save();
      ctx.globalAlpha = vis * C.alpha;
      ctx.translate(rm ? 0 : -(((this.starT || 0) * C.speed) % C.period), 0);
      ctx.fillStyle = pat;
      ctx.fillRect(-C.period, y, w + 2 * C.period, C.h);
      ctx.restore();
      ctx.font = feedbackDisplayFont(14, 600);
      ctx.textAlign = "left";
      ctx.fillStyle = PALETTE.rgba("danger", 0.95);
      const phases = this.boss && this.boss.phases ? this.boss.phases.length : 3;
      const threat = `THREAT // ${String(b.title || "").toUpperCase()}   PHASES ${phases}   HOLD THE LINE`;
      drawTracked(ctx, this.cineTyped(threat, t - 0.4, CINE.bar.cps), CINE.bar.pad, barY + barH - 16, 0.26);
    }
    ctx.restore();
    void sh;
  },

  // ------------------------- 5. title hero reveal -------------------------
  // The menu's hero block (.menuHero) powers on: CSS keyframes restarted whenever the menu comes back.
  cineHeroReveal() {
    const hero = document.querySelector(".menuHero");
    if (!hero) return;
    hero.classList.remove("reveal");
    if (this.reduceMotion) return;
    void hero.offsetWidth;
    hero.classList.add("reveal");
  },

  // ------------------------- 4. screen wipe -------------------------
  cineWipe() {
    if (this.reduceMotion) return;
    const st = this.cineState();
    let el = st.wipeEl;
    if (!el) {
      el = document.getElementById("cineWipe");
      if (!el) {
        el = document.createElement("div");
        el.id = "cineWipe";
        el.setAttribute("aria-hidden", "true");
        (this.mainEl || document.getElementById("main") || document.body).appendChild(el);
      }
      st.wipeEl = el;
    }
    el.classList.remove("run");
    void el.offsetWidth;
    el.classList.add("run");
    clearTimeout(st.wipeTimer);
    st.wipeTimer = setTimeout(() => el.classList.remove("run"), CINE.wipeMs + 60);
  }
});

onGameHook("tick", function (ev) { if (typeof this.cineTick === "function") this.cineTick(ev && typeof ev.dt === "number" ? ev.dt : 0); });
onGameHook("renderOverlay", function (ro) { if (ro && ro.ctx && typeof this.drawCinematic === "function") this.drawCinematic(ro.ctx); });
onGameHook("bossKill", function () { if (typeof this.cinePunch === "function") this.cinePunch(CINE.zoom.killPunch, CINE.zoom.killSettleS); });
onGameHook("modeChange", function (ev) {
  if (!ev) return;
  const a = ev.from, b = ev.to;
  if ((a === "playing" && b === "paused") || (a === "paused" && b === "playing")) return;
  if (!a || a === b) return;
  if (typeof this.cineWipe === "function") this.cineWipe();
  if (b === "menu" && typeof this.cineHeroReveal === "function") this.cineHeroReveal();
});
onGameHook("sectorStart", function () { this.cameraZoom = 1; const st = this._cine; if (st) st.zoomPunch = 0; });
