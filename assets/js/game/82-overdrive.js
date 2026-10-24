// Type-R 198X — ARCADE track (D11): Overdrive, a burst meter relative to the pilot's own speed (white arc on the shield
// ring, white-hot beams, plume x2, amber floaters, +25 % on kill / boss-letter / segment score, vent on any hard miss, leak
// or surge hit) and pilotWpm(). Loads after 80-fx.js. Hooks consumed: keyCorrect, typistInterval, keyMiss, lockRelease,
// leak, tick, modeChange, sectorStart, runWillStart, scoreWillAdd, results, checkpoint, checkpointRestored, counterSignal,
// bossKill; emitted: overdrive. Top-level names OVERDRIVE / OD_*. Off in Drill and during the Flight Check.
