// Type-R 198X — canvas rendering: render(dt) and every draw* method, plus makeStars (background setup). Methods are mixed into Game.prototype; load order is defined in index.html.
Object.assign(Game.prototype, {
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
  },

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
  },

  drawTiledImage(ctx, img, scale, y = 0, offset = 0) {
    if (!img || !img.naturalWidth) return;
    const tileW = img.naturalWidth * scale;
    const tileH = img.naturalHeight * scale;
    if (!tileW || !tileH) return;
    const startX = -((offset % tileW) + tileW) % tileW;
    for (let x = startX; x < this.w + tileW; x += tileW) {
      ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, x, y, tileW, tileH);
    }
  },

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
  },

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
  },

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
  },

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
  },

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
  },

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
  },

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
  },

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
  },

  drawExplosionSprites(ctx) {
    for (const ex of this.explosions) {
      ex.draw(ctx);
    }
  },

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
  },

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
  },

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
  },

  getBossArtForLevel(level) {
    if (!level) return null;
    return this.bossArtImages?.[level] || null;
  },

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
    if (this.bossIntro) this.drawBossIntro(ctx);

    ctx.restore();
  },

  drawBossIntro(ctx) {
    const info = this.bossIntro;
    if (!info) return;
    ctx.save();
    const alpha = clamp(1 - (info.t / 2.6), 0, 0.9);
    ctx.fillStyle = `rgba(5,6,18,${alpha * 0.7})`;
    ctx.fillRect(0, this.h * 0.3, this.w, this.h * 0.4);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = `rgba(255,255,255,${alpha})`;
    ctx.font = "48px 'Orbitron', sans-serif";
    ctx.fillText("INCOMING BOSS", this.w / 2, this.h * 0.42);
    ctx.font = "32px 'Segoe UI', sans-serif";
    ctx.fillText(info.name ?? "UNKNOWN", this.w / 2, this.h * 0.52);
    ctx.restore();
  },
});
