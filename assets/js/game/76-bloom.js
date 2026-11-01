// Type-R 198X — BLOOM (presentation): a screen-space neon halo. Methods are mixed into Game.prototype; load order is
// defined in index.html (after 75-fx-draw.js; 70-render.js calls drawBloom after drawParticles, before the floaters,
// banners and vignette, so text never blooms).
//
// How: the frame so far (L1-L12) is drawn into a quarter-resolution canvas, multiplied by itself twice (luminance^3
// keeps the neon strips, beams, plates' glow and the boss lamps, drops the graded backdrop to near black), then
// blurred by a 1/16 downscale and back, and added onto the frame at BLOOM.alpha. No shadowBlur, no filter, no pixel
// reads. Composite sets per frame: none. The quarter canvas lives in "multiply" (set once when it is created; a draw
// onto its cleared surface composites like source-over), and the add onto the frame happens inside the particle batch
// that the plume keeps open in play; when no batch is open one set is spent and restore() undoes it.
// Off under reduced motion, on touch devices, and after the pass measures itself over BLOOM.budgetMs for 2 s.

const BLOOM = { alpha: 0.55, down: 4, blurDown: 4, budgetMs: 3.5 };

Object.assign(Game.prototype, {
  bloomEnabled() {
    if (this._bloomOff || this.reduceMotion || this.touchMode) return false;
    const m = this.motionProfile();
    return m.anim > 0;
  },

  bloomBuffers() {
    const cw = this.canvas.width, ch = this.canvas.height;
    let b = this._bloom;
    const aw = Math.max(1, Math.ceil(cw / BLOOM.down)), ah = Math.max(1, Math.ceil(ch / BLOOM.down));
    if (!b || b.aw !== aw || b.ah !== ah) {
      const mk = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; const g = c.getContext("2d"); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "medium"; return { c, g }; };
      const A = mk(aw, ah), B = mk(Math.max(1, Math.ceil(aw / BLOOM.blurDown)), Math.max(1, Math.ceil(ah / BLOOM.blurDown)));
      // A stays in "multiply" for its whole life: a draw onto its cleared (transparent) surface composites like
      // source-over, the next draws multiply, and no composite set is spent per frame (budget: 6 sets per frame).
      A.g.globalCompositeOperation = "multiply";
      b = this._bloom = { aw, ah, A, B, ema: 0, over: 0 };
    }
    return b;
  },

  drawBloom(ctx) {
    if (this._bloomFrame === this.frameCount) return;   // once per frame (drawParticles' batch, else render's fallback)
    this._bloomFrame = this.frameCount;
    if (!this.bloomEnabled()) return;
    const t0 = performance.now();
    const b = this.bloomBuffers();
    const src = this.canvas, cw = src.width, ch = src.height;
    const A = b.A, B = b.B;
    // threshold by self-multiplication
    A.g.clearRect(0, 0, b.aw, b.ah);
    A.g.drawImage(src, 0, 0, cw, ch, 0, 0, b.aw, b.ah);          // onto transparent: a plain copy
    A.g.drawImage(src, 0, 0, cw, ch, 0, 0, b.aw, b.ah);          // x itself
    A.g.drawImage(src, 0, 0, cw, ch, 0, 0, b.aw, b.ah);          // x itself again: luminance^3
    // blur: down to B and back
    B.g.clearRect(0, 0, B.c.width, B.c.height);
    B.g.drawImage(A.c, 0, 0, B.c.width, B.c.height);
    A.g.clearRect(0, 0, b.aw, b.ah);
    A.g.drawImage(B.c, 0, 0, b.aw, b.ah);
    // add onto the frame in device space
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (!this._fxAdditive) ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = BLOOM.alpha;
    ctx.drawImage(A.c, 0, 0, cw, ch);
    ctx.restore();
    // self-budget: a slow device loses the halo rather than frames
    const ms = performance.now() - t0;
    b.ema = b.ema ? b.ema * 0.9 + ms * 0.1 : ms;
    if (b.ema > BLOOM.budgetMs) { if (++b.over > 120) this._bloomOff = true; } else b.over = 0;
    this.debug.bloomMs = ms;
  }
});
