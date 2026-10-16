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
