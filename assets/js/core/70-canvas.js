// Type-R 198X — stateless canvas drawing helpers. Classic script; load order is defined in index.html.

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

// Pixel size of a canvas font string ("600 22px ui-monospace" -> 22).
function fontPx(font) {
  const m = /(\d+(?:\.\d+)?)px/.exec(font || "");
  return m ? parseFloat(m[1]) : 16;
}

// Typed / untyped halves of one word drawn as a single centred run (VIS-03). Measures both halves so the join
// never drifts as letters are typed, paints a bg0 halo under every glyph and, when asked, a caret under the
// next character. Returns { x0, wd, wr, width } so plates can size themselves from the same metrics.
//   opts: { font, doneColor, remColor, halo=true, caret=false, caretColor, caretAlpha=1, leadColor }
//   leadColor paints only the first remaining glyph (the key that locks this target) in that colour.
function drawSplitText(ctx, done, remaining, cx, y, opts = {}) {
  const font = opts.font || ctx.font;
  ctx.font = font;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const wd = done ? ctx.measureText(done).width : 0;
  const wr = remaining ? ctx.measureText(remaining).width : 0;
  const width = wd + wr;
  const x0 = cx - width / 2;
  const halo = opts.halo !== false;
  const haloColor = opts.haloColor || PALETTE.rgba("bg0", 0.92);
  if (halo) {
    ctx.lineJoin = "round";
    ctx.lineWidth = 3;
    ctx.strokeStyle = haloColor;
    if (done) ctx.strokeText(done, x0, y);
    if (remaining) ctx.strokeText(remaining, x0 + wd, y);
  }
  if (done) {
    ctx.fillStyle = opts.doneColor || PALETTE.rgba("text", 0.45);
    ctx.fillText(done, x0, y);
  }
  if (remaining) {
    ctx.fillStyle = opts.remColor || PALETTE.rgba("text", 0.92);
    if (opts.leadColor && remaining.length) {
      const lead = remaining[0];
      const wl = ctx.measureText(lead).width;
      ctx.fillStyle = opts.leadColor;
      ctx.fillText(lead, x0 + wd, y);
      if (remaining.length > 1) {
        ctx.fillStyle = opts.remColor || PALETTE.rgba("text", 0.92);
        ctx.fillText(remaining.slice(1), x0 + wd + wl, y);
      }
    } else {
      ctx.fillText(remaining, x0 + wd, y);
    }
  }
  if (opts.caret && remaining) {
    const px = fontPx(font);
    const cw = ctx.measureText(remaining[0]).width;
    const prevAlpha = ctx.globalAlpha;
    ctx.globalAlpha = prevAlpha * (typeof opts.caretAlpha === "number" ? opts.caretAlpha : 1);
    ctx.fillStyle = opts.caretColor || PALETTE.rgba("lime", 1);
    ctx.fillRect(x0 + wd, y + px * 0.52, cw, 2);
    ctx.globalAlpha = prevAlpha;
  }
  return { x0, wd, wr, width };
}

// Shrinks ctx.font in `step` px steps until `text` fits `maxW` (never below `min`). Sets ctx.font and returns the
// size used. makeFont(px) rebuilds the font string (defaults to swapping the px value in the current font).
function fitText(ctx, text, maxW, min = 32, step = 4, makeFont = null) {
  let px = fontPx(ctx.font);
  const build = makeFont || ((p) => ctx.font.replace(/(\d+(?:\.\d+)?)px/, `${p}px`));
  ctx.font = build(px);
  while (px - step >= min && ctx.measureText(text).width > maxW) {
    px -= step;
    ctx.font = build(px);
  }
  return px;
}

// Letter-spaced text: `em` is the tracking as a fraction of the font size. Honours ctx.textAlign for the whole
// run and draws glyph by glyph (the canvas has no letter-spacing on every browser we support). Returns the width.
function drawTracked(ctx, text, x, y, em = 0.12) {
  const str = String(text || "");
  if (!str) return 0;
  const px = fontPx(ctx.font);
  const gap = px * em;
  const widths = [];
  let total = 0;
  for (const ch of str) { const w = ctx.measureText(ch).width; widths.push(w); total += w; }
  total += gap * (widths.length - 1);
  const align = ctx.textAlign;
  let cx = x;
  if (align === "center") cx = x - total / 2;
  else if (align === "right" || align === "end") cx = x - total;
  ctx.textAlign = "left";
  let i = 0;
  for (const ch of str) {
    ctx.fillText(ch, cx, y);
    cx += widths[i++] + gap;
  }
  ctx.textAlign = align;
  return total;
}

function rectsIntersect(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
