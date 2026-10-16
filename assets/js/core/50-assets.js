// Type-R 198X — Assets: manifest-driven image loader (CONTRACT §5; amendments B-1, B-17, C-2, C-4).
// Classic script. Defines the top-level `Assets` IIFE (visible to every later script) and
// `window.TypeRAssets`. Loads after 40-save.js and before 60-entities.js. Nothing runs at load
// time: boot calls `Assets.init(...)`, and every other call lazily initialises if boot has not.
//
// Keys are the manifest keys: `bg/<art>`, `fg/<art>`, `ships/<shipId>`, `bosses/<1..10>`,
// `fx/explosions`. A manifest entry looks like
//   {orig:{w,h}, crop:{x,y,w,h}?, content:{x,y,w,h}?, x1:{src,w,h}?, x2:{src,w,h}?, src?, fallback}
// where `crop` is the box cut out of the ORIGINAL image (trimmed ships/bosses) and `content` is the
// opaque bounding box, both in original pixels. When `window.TYPER_ASSET_MANIFEST` is missing the
// loader synthesises an orig-only manifest from PARALLAX_THEMES / BOSS_ARTS / SHIP_CONFIGS /
// EXPLOSION_SHEET (PNG masters, no crop), so the game still runs.
//
// API (synchronous unless it says Promise; no call throws into the caller, no promise rejects):
//   Assets.init({manifest?, version?, renderScale?})  pick the manifest (explicit > window.TYPER_ASSET_MANIFEST
//                                   > synthesised), set the version token, seed the pin set (4 ships + fx/explosions).
//   Assets.setRenderScale(s)        variant becomes `x2` when `s > 1.25 && !navigator.connection?.saveData`, else
//                                   `x1` (ships are always `x1`, C-2). A variant flip re-fetches resident keys in the
//                                   background; a >10% scale change re-prepares resident bitmaps at their last size.
//   Assets.variant                  current variant string.
//   Assets.url(key, variant?)       the URL the loader would request: `./assets/opt/...?v=<manifest.version>` for
//                                   optimised files, `?v=<ASSET_VERSION>` for PNG masters, and the BARE path (no `?v=`)
//                                   when IS_FILE_ORIGIN || IS_NATIVE_SHELL (B-17). variant: 'x1'|'x2'|'orig'|'fallback'.
//                                   Ship cards use `Assets.url('ships/<id>','x1')` (C-2). null for an unknown key.
//   Assets.get(key)                 → ImageBitmap | HTMLCanvasElement | HTMLImageElement | null. Never throws.
//   Assets.load(key, {priority})    → Promise<drawable|null>. Memoised per key. 'high' starts now, 'low' (default)
//                                   waits in a queue so at most 6 low-priority requests are in flight. onerror → one retry
//                                   with `entry.fallback` (the PNG master) → `error` event; resolves null, never rejects.
//                                   After the Image loads it is decoded off-thread and prepared at its default draw size.
//   Assets.loadMany(keys, onProgress?, {priority='high'}) → Promise<drawable[]>; onProgress({loaded,total,key}) per key.
//   Assets.loadLevel(i)             = loadMany(levelKeys(i)) at high priority.
//   Assets.prefetchLevel(i)         = loadMany(levelKeys(i)) at low priority.
//   Assets.levelKeys(i)             ['bg/'+art,'fg/'+art,'bosses/'+(i+1)] with art = getThemeForLevel(i).art (falls back
//                                   to .id while the content track still returns raw PARALLAX_THEMES entries). [] outside 0..9.
//   Assets.prepare(key, {w,h,scale?}) → Promise<drawable>. Builds the draw-size bitmap: createImageBitmap at
//                                   round(w*renderScale) x round(h*renderScale) (scale overrides renderScale), canvas
//                                   fallback executed in requestIdleCallback/setTimeout slices, one asset per slice.
//                                   Re-prepares only when the device size changes by more than 10%.
//   Assets.sprite(key, targetOrigW) → {img,x,y,w,h} (B-1): k = targetOrigW/orig.w; x,y,w,h = crop * k. Callers draw at
//                                   (ox + x, oy + y, w, h) where (ox,oy) is where they used to draw the UNTRIMMED image's
//                                   top-left at targetOrigW wide. When the drawable is the untrimmed PNG master the box is
//                                   the full image (x=y=0). img is null until the key is loaded.
//   Assets.contentRect(key, targetOrigW) → {x,y,w,h}: the opaque content box in the same logical frame as sprite().
//   Assets.meta(key)                the manifest entry (or null).
//   Assets.sheetScale(key)          prepared-width / original-width (1 for the full explosion sheet, 0.5 for the x1 half
//                                   sheet) → boot assigns it to ExplosionSprite.sheetScale (fallback only: the sprite
//                                   derives the same factor from the resident drawable on every draw, review R1).
//   Assets.release(key)             close the bitmap, drop the Image, forget the memoised promise (ignores pins).
//   Assets.gc(keepKeys)             release every key that is neither pinned nor in keepKeys (in-flight loads are kept).
//   Assets.pin(key) / Assets.unpin(key)
//   Assets.retryFailed()            re-request every errored key once more with `&r=<n>` (A8's Retry button).
//   Assets.on(event, fn) → off()    'progress' {key, ok, loaded, total}  once per key that finishes (ready or error)
//                                   'ready'    {keys, loaded, failed, boot} after each loadMany batch (boot = first batch)
//                                   'error'    {key, src, message}        once per key after the fallback also failed
//   Assets.stats()                  {resident:[keys], decodedPx, loadedCount, totalCount, errors:[{key,src,message}],
//                                    bootReason:'manifest'|'synth'|'uninitialised', variant, renderScale, version,
//                                    inFlight:{low, queued}}
//
// Default prepare sizes (CONTRACT §5, logical px, multiplied by renderScale):
//   bg      (720 + 2*SHAKE_PAD) tall, width from the original aspect (the renderer anchors it at y = -SHAKE_PAD)
//   fg      round(orig.w * 720*fgHeight / orig.h) x round(720*fgHeight)  (fgHeight from the PARALLAX_THEMES entry)
//   ships   the sprite(key,168) box x1.5
//   bosses  the crop box fitted into 576 x (720 - 24 - hudSafeTop - 8) with hudSafeTop = 112 until the game passes
//           its own box through prepare()
//   fx      the full sheet at device scale 1 when the variant is x2, else the half-size sheet (sheetScale 0.5)
// No `crossOrigin` anywhere, no WebP probe: the same-origin WebP is requested, and the PNG master is the retry.
// URLs are stable per version (no random cache busters), so a caching server serves each unique URL once (C-4).
// Drawables are owned by the loader: read them through get()/sprite() every frame rather than caching them across
// frames, because a re-prepare (resize, variant flip) or release() replaces and closes the previous ImageBitmap.

const Assets = (() => {
  const LOW_MAX_INFLIGHT = 6;
  const REPREPARE_RATIO = 0.10;
  const DEFAULT_SHAKE_PAD = 20;
  const DEFAULT_HUD_SAFE_TOP = 112;
  const LOGICAL_H = 720;
  const BOSS_FIT_W = 576;
  const SHIP_SPRITE_W = 168;
  const SHIP_PREP_MUL = 1.5;
  const UNKNOWN_ASPECT = 1536 / 2816; // every master sprite is 2816x1536; used only before the image is known

  const state = {
    manifest: null,
    version: null,
    renderScale: 1,
    variant: "x1",
    bootReason: "uninitialised",
    records: new Map(),
    srcMap: new Map(),
    pinned: new Set(),
    listeners: { progress: [], ready: [], error: [] },
    errors: [],
    lowQueue: [],
    lowInFlight: 0,
    prepQueue: [],
    prepBusy: false,
    batches: 0,
    retrySeq: 0
  };

  // ----------------------------------------------------------- environment (all read lazily)
  const hasWindow = typeof window !== "undefined";
  const themes = () => (typeof PARALLAX_THEMES !== "undefined" && Array.isArray(PARALLAX_THEMES) ? PARALLAX_THEMES : []);
  const bossArts = () => (typeof BOSS_ARTS !== "undefined" && Array.isArray(BOSS_ARTS) ? BOSS_ARTS : []);
  const shipConfigs = () => (typeof SHIP_CONFIGS !== "undefined" && SHIP_CONFIGS ? SHIP_CONFIGS : {});
  const explosionSheet = () => (typeof EXPLOSION_SHEET !== "undefined" && EXPLOSION_SHEET ? EXPLOSION_SHEET : null);
  const levelCount = () => (typeof LEVELS !== "undefined" && Array.isArray(LEVELS) && LEVELS.length ? LEVELS.length : 10);
  const shakePad = () => (typeof SHAKE_PAD === "number" ? SHAKE_PAD : DEFAULT_SHAKE_PAD);
  const masterVersion = () => (typeof ASSET_VERSION === "string" ? ASSET_VERSION : null);
  const themeForLevel = (i) => {
    try {
      if (typeof getThemeForLevel === "function") return getThemeForLevel(i) || null;
    } catch (e) { /* fall through to the raw table */ }
    return themes()[i] || null;
  };
  const isBareOrigin = () => {
    if (typeof IS_FILE_ORIGIN !== "undefined" && IS_FILE_ORIGIN) return true;
    if (typeof IS_NATIVE_SHELL !== "undefined" && IS_NATIVE_SHELL) return true;
    // Same rule as sfx.js `versioned()` when 00-util.js is not loaded (probe pages).
    if (hasWindow && window.location && window.location.protocol === "file:") return true;
    if (typeof navigator !== "undefined" && /TypeR198X-(macOS|iOS)/i.test(navigator.userAgent || "")) return true;
    return false;
  };
  const saveData = () => {
    try { return !!(navigator.connection && navigator.connection.saveData === true); } catch (e) { return false; }
  };
  const now = () => (typeof performance !== "undefined" && performance.now ? performance.now() : Date.now());

  // ----------------------------------------------------------- manifest
  function synthesizeManifest() {
    const images = {};
    for (const t of themes()) {
      if (!t || !t.id) continue;
      if (t.bg) images["bg/" + t.id] = { src: t.bg, fallback: t.bg, synthetic: true };
      if (t.fg) images["fg/" + t.id] = { src: t.fg, fallback: t.fg, synthetic: true };
    }
    for (const [id, cfg] of Object.entries(shipConfigs())) {
      if (cfg && cfg.src) images["ships/" + id] = { src: cfg.src, fallback: cfg.src, synthetic: true };
    }
    for (const art of bossArts()) {
      if (art && art.src) images["bosses/" + art.level] = { src: art.src, fallback: art.src, synthetic: true };
    }
    const sheet = explosionSheet();
    if (sheet && sheet.src) images["fx/explosions"] = { src: sheet.src, fallback: sheet.src, w: sheet.width, h: sheet.height, synthetic: true };
    return { version: masterVersion() || "synth", music: [], sfx: {}, images, synthetic: true };
  }

  function init(opts = {}) {
    const explicit = opts && opts.manifest && opts.manifest.images ? opts.manifest : null;
    const generated = hasWindow && window.TYPER_ASSET_MANIFEST && window.TYPER_ASSET_MANIFEST.images ? window.TYPER_ASSET_MANIFEST : null;
    const chosen = explicit || generated;
    if (chosen) {
      state.manifest = chosen;
      state.bootReason = "manifest";
    } else {
      state.manifest = synthesizeManifest();
      state.bootReason = "synth";
    }
    state.version = (opts && opts.version) || state.manifest.version || masterVersion() || null;
    const keys = Object.keys(state.manifest.images || {});
    state.pinned.clear();
    for (const key of keys) {
      if (key.startsWith("ships/") || key === "fx/explosions") state.pinned.add(key);
    }
    // Records whose key vanished from a re-supplied manifest are released; the rest keep their entry fresh.
    for (const [key, r] of [...state.records]) {
      const entry = state.manifest.images[key];
      if (!entry) release(key);
      else r.entry = entry;
    }
    if (opts && typeof opts.renderScale === "number") setRenderScale(opts.renderScale);
    else recomputeVariant();
    return api;
  }

  const ensureInit = () => { if (!state.manifest) init({}); };
  const images = () => (ensureInit(), state.manifest.images || {});
  const entryOf = (key) => (typeof key === "string" ? images()[key] || null : null);

  // ----------------------------------------------------------- variant + URLs
  function recomputeVariant() {
    return (state.variant = state.renderScale > 1.25 && !saveData() ? "x2" : "x1");
  }

  function setRenderScale(s) {
    const next = Number(s);
    if (!Number.isFinite(next) || next <= 0) return state.variant;
    const prevScale = state.renderScale;
    const prevVariant = state.variant;
    state.renderScale = next;
    recomputeVariant();
    if (!state.manifest) return state.variant;
    const flipped = state.variant !== prevVariant;
    const rescaled = prevScale > 0 && Math.abs(next - prevScale) / prevScale > REPREPARE_RATIO;
    if (!flipped && !rescaled) return state.variant;
    // Resident keys are refreshed in the background: a key whose loaded variant no longer matches is re-fetched
    // (finish() re-prepares it), every other resident bitmap is re-prepared at the new scale. The old drawable
    // stays in place until the replacement is ready, so nothing flickers.
    for (const [key, r] of state.records) {
      if (r.state !== "ready") continue;
      const want = variantFor(key);
      if (flipped && r.variant !== want && r.variant !== "fallback" && r.variant !== "orig" && r.entry[want]) {
        load(key, { priority: "low" });
        continue;
      }
      if (!r.bitmap) continue;
      const size = r.wantPrepDefault ? defaultPrepareSize(key) : r.wantPrep;
      if (size && (typeof size.scale !== "number" || r.wantPrepDefault)) {
        r.wantPrep = size;
        prepareRecord(r, size);
      }
    }
    return state.variant;
  }

  const variantFor = (key) => (typeof key === "string" && key.startsWith("ships/") ? "x1" : state.variant);

  // Resolves which file a variant maps to for an entry: {src, variant}. Degrades x2→x1→orig→fallback.
  function pickSource(entry, variant) {
    if (!entry) return { src: null, variant: null };
    if (variant === "fallback") return { src: entry.fallback || entry.src || null, variant: "fallback" };
    if (variant === "orig") return entry.src ? { src: entry.src, variant: "orig" } : { src: entry.fallback || null, variant: "fallback" };
    if (variant && entry[variant] && entry[variant].src) return { src: entry[variant].src, variant };
    if (variant === "x2" && entry.x1 && entry.x1.src) return { src: entry.x1.src, variant: "x1" };
    if (variant === "x1" && entry.x2 && entry.x2.src) return { src: entry.x2.src, variant: "x2" };
    if (entry.src) return { src: entry.src, variant: "orig" };
    return { src: entry.fallback || null, variant: "fallback" };
  }

  const isOptPath = (src) => /(^|\/)assets\/opt\//.test(src);

  function versionedUrl(src, extraQuery) {
    if (!src) return src;
    if (isBareOrigin()) return src;
    let out = src;
    if (isOptPath(src)) {
      if (state.version) out = `${src}${src.includes("?") ? "&" : "?"}v=${state.version}`;
    } else if (typeof withAssetVersion === "function") {
      out = withAssetVersion(src);
    } else {
      const v = masterVersion() || state.version;
      if (v) out = `${src}${src.includes("?") ? "&" : "?"}v=${v}`;
    }
    if (extraQuery) out = `${out}${out.includes("?") ? "&" : "?"}${extraQuery}`;
    return out;
  }

  function url(key, variant) {
    const entry = entryOf(key);
    if (!entry) return null;
    return versionedUrl(pickSource(entry, variant || variantFor(key)).src);
  }

  // ----------------------------------------------------------- records
  function recordOf(key, create) {
    let r = state.records.get(key);
    if (!r && create) {
      const entry = entryOf(key);
      if (!entry) return null;
      r = {
        key, entry,
        state: "idle",      // idle | loading | ready | error
        variant: null,      // variant actually loaded: x1 | x2 | orig | fallback
        src: null,
        img: null,
        bitmap: null,
        natural: null,      // {w,h} of the loaded Image
        prep: null,         // {dw, dh, variant} of the resident bitmap
        wantPrep: null,     // last requested logical {w,h,scale?}
        wantPrepDefault: true, // wantPrep came from defaultPrepareSize (recomputed on variant/scale changes)
        prepPromise: null,
        preparing: false,   // between finish() and settle(): decode + default prepare in flight, raw img withheld
        promise: null,
        resolve: null,
        queued: null,
        lowSlot: false,
        retryTag: null,
        lastUsed: 0
      };
      state.records.set(key, r);
    }
    return r || null;
  }

  // The raw <img> is never handed out while its off-thread decode + default prepare are still pending (finish ->
  // settle): drawing an undecoded 2800 px image decodes and uploads it synchronously on the main thread, which was
  // the 45-80 ms first frame of every direct sector jump at DPR 2 (E2). Callers draw their fallback for those frames.
  const drawableOf = (r) => {
    if (!r) return null;
    if (r.bitmap) return r.bitmap;
    if (r.preparing) return null;
    const img = r.img;
    return img && img.complete && img.naturalWidth > 0 ? img : null;
  };

  const origOf = (key) => {
    const entry = entryOf(key);
    if (!entry) return null;
    if (entry.orig && entry.orig.w > 0 && entry.orig.h > 0) return entry.orig;
    const r = recordOf(key, false);
    if (r && r.natural) return r.natural;
    if (entry.w > 0 && entry.h > 0 && !entry.x1 && !entry.x2) return { w: entry.w, h: entry.h };
    return null;
  };

  // The crop box in original px. The untrimmed PNG master (fallback / orig / synthetic) has no crop.
  function cropOf(key) {
    const entry = entryOf(key);
    const orig = origOf(key);
    if (!entry || !orig) return null;
    const r = recordOf(key, false);
    const untrimmed = !entry.crop || (r && (r.variant === "fallback" || r.variant === "orig"));
    return untrimmed ? { x: 0, y: 0, w: orig.w, h: orig.h } : entry.crop;
  }

  // ----------------------------------------------------------- events
  function on(event, fn) {
    if (!state.listeners[event] || typeof fn !== "function") return () => {};
    state.listeners[event].push(fn);
    return () => off(event, fn);
  }
  function off(event, fn) {
    const list = state.listeners[event];
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }
  function emit(event, payload) {
    const list = state.listeners[event];
    if (!list || !list.length) return;
    for (const fn of [...list]) {
      try { fn(payload); } catch (e) { if (typeof console !== "undefined") console.warn("Assets listener failed", event, e); }
    }
  }

  const readyCount = () => { let n = 0; for (const r of state.records.values()) if (r.state === "ready") n++; return n; };
  const totalCount = () => Object.keys(images()).length;

  // ----------------------------------------------------------- loading
  function load(key, opts) {
    const priority = opts && opts.priority === "high" ? "high" : "low";
    const r = recordOf(key, true);
    if (!r) {
      noteError(key, null, "unknown asset key");
      return Promise.resolve(null);
    }
    r.lastUsed = now();
    const want = variantFor(key);
    if (r.state === "loading") {
      if (priority === "high" && r.queued) promote(r);
      return r.promise;
    }
    if (r.state === "error") return r.promise || Promise.resolve(null);
    if (r.state === "ready" && (r.variant === want || r.variant === "fallback" || r.variant === "orig" || !r.entry[want])) {
      return Promise.resolve(drawableOf(r));
    }
    return startFetch(r, want, priority);
  }

  function startFetch(r, want, priority) {
    r.state = "loading";
    r.promise = new Promise((resolve) => { r.resolve = resolve; });
    const job = () => fetchImage(r, pickSource(r.entry, want), 0);
    if (priority === "high") job();
    else enqueueLow(r, job);
    return r.promise;
  }

  function enqueueLow(r, job) {
    if (state.lowInFlight < LOW_MAX_INFLIGHT) {
      state.lowInFlight++;
      r.lowSlot = true;
      job();
    } else {
      r.queued = job;
      state.lowQueue.push(r);
    }
  }

  function promote(r) {
    const job = r.queued;
    const i = state.lowQueue.indexOf(r);
    if (i >= 0) state.lowQueue.splice(i, 1);
    r.queued = null;
    if (job) job();
  }

  function releaseSlot(r) {
    if (!r.lowSlot) return;
    r.lowSlot = false;
    state.lowInFlight = Math.max(0, state.lowInFlight - 1);
    while (state.lowInFlight < LOW_MAX_INFLIGHT && state.lowQueue.length) {
      const next = state.lowQueue.shift();
      const job = next.queued;
      next.queued = null;
      if (!job) continue;
      state.lowInFlight++;
      next.lowSlot = true;
      job();
    }
  }

  function fetchImage(r, pick, attempt) {
    if (!pick.src || typeof Image === "undefined") return fail(r, pick.src || null, "no source for key");
    const src = versionedUrl(pick.src, r.retryTag);
    let img = state.srcMap.get(src);
    const fresh = !img;
    if (fresh) {
      img = new Image();
      img.decoding = "async";
      try { img.fetchPriority = r.lowSlot || r.queued ? "low" : "high"; } catch (e) { /* unsupported */ }
      state.srcMap.set(src, img);
    }
    const onError = () => {
      cleanup();
      if (state.srcMap.get(src) === img) state.srcMap.delete(src);
      if (attempt === 0 && r.entry.fallback && r.entry.fallback !== pick.src) {
        fetchImage(r, { src: r.entry.fallback, variant: "fallback" }, 1);
      } else {
        fail(r, src, attempt === 0 ? "failed to load" : "fallback failed to load");
      }
    };
    const onLoad = () => {
      cleanup();
      if (!(img.naturalWidth > 0)) return onError();
      finish(r, img, pick.variant, src);
    };
    const cleanup = () => {
      img.removeEventListener("load", onLoad);
      img.removeEventListener("error", onError);
    };
    if (img.complete && img.naturalWidth > 0) return onLoad();
    if (!fresh && img.complete && img.getAttribute("src")) return onError();
    img.addEventListener("load", onLoad, { once: true });
    img.addEventListener("error", onError, { once: true });
    if (fresh) img.src = src;
  }

  function finish(r, img, variant, src) {
    r.img = img;
    r.variant = variant;
    r.src = src;
    r.natural = { w: img.naturalWidth, h: img.naturalHeight };
    r.state = "ready";
    r.lastUsed = now();
    r.preparing = true;
    const decoded = typeof img.decode === "function" ? img.decode().catch(() => {}) : Promise.resolve();
    decoded
      .then(() => {
        const size = r.wantPrepDefault || !r.wantPrep ? defaultPrepareSize(r.key) : r.wantPrep;
        if (!size) return null;
        r.wantPrep = size;
        return prepareRecord(r, size);
      })
      .catch(() => null)
      .then(() => settle(r, true));
  }

  function fail(r, src, message) {
    r.state = "error";
    noteError(r.key, src, message);
    settle(r, false);
  }

  function noteError(key, src, message) {
    if (state.errors.some((e) => e.key === key)) return;
    const err = { key, src, message };
    state.errors.push(err);
    emit("error", err);
  }

  function settle(r, ok) {
    r.preparing = false;
    releaseSlot(r);
    const resolve = r.resolve;
    r.resolve = null;
    emit("progress", { key: r.key, ok, loaded: readyCount(), total: totalCount() });
    if (resolve) resolve(ok ? drawableOf(r) : null);
  }

  function loadMany(keys, onProgress, opts) {
    const list = Array.isArray(keys) ? keys.filter((k) => typeof k === "string") : [];
    const priority = opts && opts.priority === "low" ? "low" : "high";
    const total = list.length;
    let loaded = 0;
    const failed = [];
    const batch = list.length ? ++state.batches : 0;
    const report = (key, drawable) => {
      loaded++;
      if (!drawable) failed.push(key);
      if (typeof onProgress === "function") {
        try { onProgress({ loaded, total, key }); } catch (e) { /* listener error must not break loading */ }
      }
    };
    return Promise.all(list.map((key) => load(key, { priority }).then((d) => (report(key, d), d))))
      .then((drawables) => {
        emit("ready", { keys: list, loaded: loaded - failed.length, failed, boot: batch === 1 });
        return drawables;
      });
  }

  function retryFailed() {
    const keys = [];
    state.retrySeq++;
    for (const [key, r] of state.records) {
      if (r.state !== "error") continue;
      r.state = "idle";
      r.promise = null;
      r.retryTag = `r=${state.retrySeq}`;
      keys.push(key);
    }
    state.errors = state.errors.filter((e) => !keys.includes(e.key));
    return keys.length ? loadMany(keys, null, { priority: "high" }) : Promise.resolve([]);
  }

  // ----------------------------------------------------------- level keys
  function levelKeys(i) {
    const n = levelCount();
    if (!Number.isInteger(i) || i < 0 || i >= n) return [];
    const theme = themeForLevel(i);
    const art = theme && (theme.art || theme.id);
    const keys = [];
    if (art) keys.push("bg/" + art, "fg/" + art);
    keys.push("bosses/" + (i + 1));
    return keys;
  }
  const loadLevel = (i) => loadMany(levelKeys(i), null, { priority: "high" });
  const prefetchLevel = (i) => loadMany(levelKeys(i), null, { priority: "low" });

  // ----------------------------------------------------------- prepare (draw-size bitmaps)
  const within = (a, b) => b > 0 && Math.abs(a - b) / b <= REPREPARE_RATIO;

  function defaultPrepareSize(key) {
    const entry = entryOf(key);
    const orig = origOf(key);
    if (!entry || !orig) return null;
    if (key.startsWith("bg/")) {
      const h = LOGICAL_H + 2 * shakePad();
      return { w: Math.round(orig.w * h / orig.h), h };
    }
    if (key.startsWith("fg/")) {
      const art = key.slice(3);
      const theme = themes().find((t) => t && t.id === art);
      const fgHeight = theme && typeof theme.fgHeight === "number" ? theme.fgHeight : 0.6;
      return { w: Math.round(orig.w * LOGICAL_H * fgHeight / orig.h), h: Math.round(LOGICAL_H * fgHeight) };
    }
    if (key.startsWith("ships/")) {
      const box = sprite(key, SHIP_SPRITE_W);
      return { w: Math.round(box.w * SHIP_PREP_MUL), h: Math.round(box.h * SHIP_PREP_MUL) };
    }
    if (key.startsWith("bosses/")) {
      const crop = cropOf(key) || orig;
      const fitH = LOGICAL_H - 24 - DEFAULT_HUD_SAFE_TOP - 8;
      const k = Math.min(BOSS_FIT_W / crop.w, fitH / crop.h);
      return { w: Math.round(crop.w * k), h: Math.round(crop.h * k) };
    }
    if (key.startsWith("fx/")) {
      const full = state.variant === "x2";
      return { w: full ? orig.w : Math.round(orig.w / 2), h: full ? orig.h : Math.round(orig.h / 2), scale: 1 };
    }
    return null;
  }

  function prepare(key, opts) {
    const r = recordOf(key, true);
    if (!r) return Promise.resolve(null);
    const explicit = normaliseSize(opts);
    const size = explicit || r.wantPrep || defaultPrepareSize(key);
    if (!size) return load(key, { priority: "high" });
    r.wantPrep = size;
    if (explicit) r.wantPrepDefault = false;
    if (r.state !== "ready") return load(key, { priority: "high" }).then(() => (r.state === "ready" ? prepareRecord(r, size) : null));
    return prepareRecord(r, size);
  }

  const normaliseSize = (opts) => {
    if (!opts || !(opts.w > 0) || !(opts.h > 0)) return null;
    const out = { w: opts.w, h: opts.h };
    if (typeof opts.scale === "number" && opts.scale > 0) out.scale = opts.scale;
    return out;
  };

  function prepareRecord(r, size) {
    const scale = typeof size.scale === "number" ? size.scale : state.renderScale;
    const dw = Math.max(1, Math.round(size.w * scale));
    const dh = Math.max(1, Math.round(size.h * scale));
    if (r.bitmap && r.prep && r.prep.variant === r.variant && within(dw, r.prep.dw) && within(dh, r.prep.dh)) {
      return Promise.resolve(r.bitmap);
    }
    if (r.prepPromise && r.prepPromise.dw === dw && r.prepPromise.dh === dh && r.prepPromise.variant === r.variant) {
      return r.prepPromise;
    }
    const img = r.img;
    const variant = r.variant;
    const p = makeBitmap(img, dw, dh)
      .then((bm) => {
        if (r.prepPromise === p) r.prepPromise = null;
        if (!bm) return drawableOf(r);
        if (r.img !== img || r.state !== "ready") { closeBitmap(bm); return drawableOf(r); } // released or re-fetched meanwhile
        const old = r.bitmap;
        r.bitmap = bm;
        r.prep = { dw, dh, variant };
        if (old && old !== bm) closeBitmapLater(old);
        return bm;
      })
      .catch(() => { if (r.prepPromise === p) r.prepPromise = null; return drawableOf(r); });
    p.dw = dw; p.dh = dh; p.variant = variant;
    r.prepPromise = p;
    return p;
  }

  function makeBitmap(img, dw, dh) {
    if (!img || !(img.naturalWidth > 0)) return Promise.resolve(null);
    if (typeof createImageBitmap === "function") {
      let bitmapPromise;
      try {
        bitmapPromise = createImageBitmap(img, { resizeWidth: dw, resizeHeight: dh, resizeQuality: "high" });
      } catch (e) {
        bitmapPromise = Promise.reject(e);
      }
      return bitmapPromise
        .then((bm) => {
          if (bm.width === dw && bm.height === dh) return bm;
          // Resize options ignored (older Safari): scale the full-size bitmap down on a canvas, off the frame.
          return canvasResize(bm, dw, dh).then((out) => { closeBitmap(bm); return out; });
        })
        .catch(() => canvasResize(img, dw, dh));
    }
    return canvasResize(img, dw, dh);
  }

  function canvasResize(source, dw, dh) {
    return new Promise((resolve) => {
      state.prepQueue.push(() => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = dw;
          canvas.height = dh;
          const ctx = canvas.getContext("2d");
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = "high";
          ctx.drawImage(source, 0, 0, dw, dh);
          resolve(canvas);
        } catch (e) {
          resolve(null);
        }
      });
      pumpPrepQueue();
    });
  }

  function idleSlice(fn) {
    if (hasWindow && typeof window.requestIdleCallback === "function") window.requestIdleCallback(fn, { timeout: 250 });
    else setTimeout(fn, 0);
  }

  function pumpPrepQueue() {
    if (state.prepBusy) return;
    const job = state.prepQueue.shift();
    if (!job) return;
    state.prepBusy = true;
    idleSlice(() => {
      try { job(); } finally {
        state.prepBusy = false;
        if (state.prepQueue.length) pumpPrepQueue();
      }
    });
  }

  function closeBitmap(bm) {
    if (bm && typeof bm.close === "function") { try { bm.close(); } catch (e) { /* already closed */ } }
  }

  // A replaced bitmap may still be referenced by the frame that is being drawn; it is closed a little later.
  const SWAP_CLOSE_DELAY_MS = 1500;
  function closeBitmapLater(bm) {
    if (!bm || typeof bm.close !== "function") return;
    setTimeout(() => closeBitmap(bm), SWAP_CLOSE_DELAY_MS);
  }

  // ----------------------------------------------------------- sprites
  function sprite(key, targetOrigW) {
    const r = recordOf(key, false);
    if (r) r.lastUsed = now();
    const img = drawableOf(r);
    const w0 = Number(targetOrigW) > 0 ? Number(targetOrigW) : 0;
    const orig = origOf(key);
    if (!orig) return { img, x: 0, y: 0, w: w0, h: w0 * UNKNOWN_ASPECT };
    const k = w0 / orig.w;
    const crop = cropOf(key) || { x: 0, y: 0, w: orig.w, h: orig.h };
    return { img, x: crop.x * k, y: crop.y * k, w: crop.w * k, h: crop.h * k };
  }

  function contentRect(key, targetOrigW) {
    const entry = entryOf(key);
    const orig = origOf(key);
    const w0 = Number(targetOrigW) > 0 ? Number(targetOrigW) : 0;
    if (!entry || !orig) return { x: 0, y: 0, w: w0, h: w0 * UNKNOWN_ASPECT };
    const k = w0 / orig.w;
    const box = entry.content || cropOf(key) || { x: 0, y: 0, w: orig.w, h: orig.h };
    return { x: box.x * k, y: box.y * k, w: box.w * k, h: box.h * k };
  }

  function sheetScale(key) {
    const r = recordOf(key, false);
    const orig = origOf(key);
    if (!r || !r.prep || !orig || !(orig.w > 0)) return 1;
    return r.prep.dw / orig.w;
  }

  // ----------------------------------------------------------- memory
  function release(key) {
    const r = state.records.get(key);
    if (!r) return;
    closeBitmap(r.bitmap);
    r.bitmap = null;
    r.prep = null;
    r.prepPromise = null;
    if (r.src && state.srcMap.get(r.src) === r.img) {
      let shared = false;
      for (const other of state.records.values()) if (other !== r && other.img === r.img) shared = true;
      if (!shared) state.srcMap.delete(r.src);
    }
    r.img = null;
    r.src = null;
    r.variant = null;
    r.state = "idle";
    r.preparing = false;
    r.promise = null;
    r.resolve = null;
    if (r.queued) {
      const i = state.lowQueue.indexOf(r);
      if (i >= 0) state.lowQueue.splice(i, 1);
      r.queued = null;
    }
  }

  function gc(keepKeys) {
    ensureInit();
    const keep = new Set(state.pinned);
    if (Array.isArray(keepKeys)) for (const k of keepKeys) keep.add(k);
    for (const [key, r] of [...state.records]) {
      if (keep.has(key) || r.state === "loading") continue;
      release(key);
    }
  }

  const pin = (key) => { ensureInit(); if (entryOf(key)) state.pinned.add(key); };
  const unpin = (key) => { state.pinned.delete(key); };

  // ----------------------------------------------------------- introspection
  function get(key) {
    const r = state.records.get(key);
    if (!r) return null;
    r.lastUsed = now();
    return drawableOf(r);
  }

  const meta = (key) => entryOf(key);

  function stats() {
    const resident = [];
    let decodedPx = 0;
    let loadedCount = 0;
    for (const [key, r] of state.records) {
      if (r.state === "ready") loadedCount++;
      const d = drawableOf(r);
      if (!d) continue;
      resident.push(key);
      if (r.bitmap) decodedPx += (r.bitmap.width || 0) * (r.bitmap.height || 0);
      else if (r.natural) decodedPx += r.natural.w * r.natural.h;
    }
    return {
      resident,
      decodedPx,
      loadedCount,
      totalCount: state.manifest ? totalCount() : 0,
      errors: state.errors.map((e) => ({ ...e })),
      bootReason: state.bootReason,
      variant: state.variant,
      renderScale: state.renderScale,
      version: state.version,
      inFlight: { low: state.lowInFlight, queued: state.lowQueue.length }
    };
  }

  const api = {
    init, setRenderScale, url, get, load, loadMany, prepare, sprite, contentRect, meta, sheetScale,
    levelKeys, loadLevel, prefetchLevel, release, gc, pin, unpin, retryFailed, on, off, stats,
    get variant() { return state.variant; },
    get renderScale() { return state.renderScale; },
    get version() { return state.version; },
    get manifest() { return state.manifest; },
    get pinned() { return [...state.pinned]; }
  };
  return api;
})();

if (typeof window !== "undefined") window.TypeRAssets = Assets;
