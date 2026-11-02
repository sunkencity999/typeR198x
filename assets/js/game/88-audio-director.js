// Type-R 198X — audio director (SOUND pass): feeds the announcer and the adaptive-music intensity from game state.
// Classic script; Game.prototype mixin + hook listeners (core/00-util.js onGameHook). Loads after every gameplay module.
//
// Announcer feed (window.SFX plays the lines itself from the cues that already exist):
//   results        -> sfx.lastRank / sfx.lastNewHigh, read by sfx.rankStamp() when the card stamps the letter
//   waveWillEnd    -> sfx.pendingPerfect on a perfect wave (campaign only), announced by sfx.waveClear()
//   modesRunEnd / modeChange(menu) -> the stale rank is cleared so a mode medal never announces a campaign letter
//
// Intensity (0..1) for sfx.setIntensity(v): a target from the wave phase, the boss's remaining hull, the combo tier,
// Overdrive and a low hull, eased on the tick hook (never a per-key jump) and sent only when it moved by > .01.
// sfx.setIntensity is optional (the transport exposes it only where the buffered music layers are available).
(function () {
  "use strict";
  if (typeof Game === "undefined" || typeof onGameHook !== "function") return;

  const AUDIO_DIRECTOR = Object.freeze({
    easePerSec: 1.4,          // intensity moves at most this far per second toward its target
    minDelta: 0.01,           // send threshold
    phase: { intro: 0.12, spawn: [0.35, 0.45, 0.55], drain: [0.35, 0.45, 0.55], approach: 0.7, boss: 0.75, finale: 0.3 },
    comboPerTier: 0.08,       // stats.mult 2..5 adds up to .3
    comboMax: 0.3,
    overdrive: 0.2,
    lowHull: 0.15,
    bossHull: 0.25            // added as the boss loses hull (1 - hpFrac)
  });

  Object.assign(Game.prototype, {
    // Target intensity from the current state; 0 outside play.
    audioIntensityTarget() {
      if (this.mode !== "playing") return 0;
      const P = AUDIO_DIRECTOR.phase;
      let v;
      if (this.inBoss && this.boss) {
        const hp = typeof this.boss.hpFrac === "function" ? this.boss.hpFrac() : 1;
        v = P.boss + AUDIO_DIRECTOR.bossHull * (1 - Math.max(0, Math.min(1, hp)));
      } else {
        const ph = this.wavePhase;
        const w = Math.max(0, Math.min(2, this.wave | 0));
        v = ph === "intro" ? P.intro : ph === "approach" ? P.approach : ph === "finale" ? P.finale : Array.isArray(P[ph]) ? P[ph][w] : P.spawn[w];
      }
      const mult = (this.stats && this.stats.mult) | 0;
      if (mult > 1) v += Math.min(AUDIO_DIRECTOR.comboMax, AUDIO_DIRECTOR.comboPerTier * (mult - 1));
      if (this.overdriveOn) v += AUDIO_DIRECTOR.overdrive;
      if (this.player && this.player.maxHp > 0 && this.player.hp / this.player.maxHp < 0.25) v += AUDIO_DIRECTOR.lowHull;
      return Math.max(0, Math.min(1, v));
    },

    // Eases the sent value toward the target; called from the tick hook with dt in seconds.
    audioDirectorTick(dt) {
      const sfx = this.sfx;
      if (!sfx || typeof sfx.setIntensity !== "function") return;
      const target = this.audioIntensityTarget();
      const cur = this._audioIntensity == null ? target : this._audioIntensity;
      const step = AUDIO_DIRECTOR.easePerSec * Math.max(0, Math.min(0.1, dt || 0));
      const next = cur + Math.max(-step, Math.min(step, target - cur));
      if (this._audioIntensity == null || Math.abs(next - (this._audioIntensitySent == null ? -1 : this._audioIntensitySent)) > AUDIO_DIRECTOR.minDelta) {
        this._audioIntensitySent = next;
        sfx.setIntensity(next);
      }
      this._audioIntensity = next;
    }
  });

  Game.AUDIO_DIRECTOR = AUDIO_DIRECTOR;

  onGameHook("results", function (e) {
    const sfx = this && this.sfx;
    if (!sfx || !e || !e.results) return;
    sfx.lastRank = e.results.rank || null;
    sfx.lastNewHigh = !!e.results.newHigh;
  });

  onGameHook("waveWillEnd", function (e) {
    const sfx = this && this.sfx;
    if (!sfx || !e) return;
    sfx.pendingPerfect = !!(e.perfect && e.byQuota && this.runMode && this.runMode() === "campaign");
  });

  onGameHook("modesRunEnd", function () {
    const sfx = this && this.sfx;
    if (sfx) { sfx.lastRank = null; sfx.lastNewHigh = false; }
  });

  onGameHook("modeChange", function (e) {
    const sfx = this && this.sfx;
    if (!sfx || !e) return;
    if (e.to === "menu") { sfx.lastRank = null; sfx.lastNewHigh = false; sfx.pendingPerfect = false; }
    if (e.to !== "playing" && typeof this.audioDirectorTick === "function") this.audioDirectorTick(0.1);   // ease toward 0 off the field
  });

  onGameHook("tick", function (e) {
    if (typeof this.audioDirectorTick === "function") this.audioDirectorTick(e && e.dt);
  });
})();
