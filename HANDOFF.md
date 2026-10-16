# HANDOFF — UI shell track (index.html, style.css, tokens.css, assets/ui, privacy pages)

The markup and CSS implement the full DOM/CSS contract while keeping the CURRENT JavaScript working
(legacy `.hidden` screen toggling). Everything below is a JS-side change another track must make, or a
shim to remove once that track lands. Shared names follow CONTRACT.md.

## 1. Screen state machine (A2 / C1) — order matters
- `body[data-mode]` is the switch between the two regimes: without it, `.screen` is visible unless `.hidden`
  (today's JS). With it, `body[data-mode] .screen:not(.is-active)` is faded out and only `.screen.is-active`
  shows. **The same `setMode` change that sets `document.body.dataset.mode` must also toggle `.is-active`
  on the five `.screen` sections** (C-11 + C1 must land together; A2 alone would hide the active screen).
- Screens carry no `.hidden` in source; the C1 `setMode` should stop adding `.hidden` to screens (it may
  remove any stale one once at boot).
- Extra CSS hooks ready for C1: `#game.freeze` (desaturated canvas after death), `#main.crtOff` (one-shot
  420 ms power-off line on `#main::after`, JS adds/removes the class), `#main.is-typing` (cyan inset ring when
  the canvas or `#typeInput` has focus), `.riseIn` is expressed as the `.screenInner > *` stagger (no class needed).
- `#storyModal` is `class="modalOverlay hidden"` in source so the current `classList.remove("hidden")` still
  opens it. `openModal(el)` must remove BOTH `.hidden` and `.is-dismissed` (UX-04 already says so); once that
  lands, the source class may become `modalOverlay is-dismissed` like the other four modals.
- Modal scroll affordance: add `.is-scrollable` / `.at-bottom` to the **`.modalScroll` wrapper** (not the
  `.modalBody`); the fade (`.modalScroll::after`) and the `.modalScrollHint` key off that element.

## 2. Top bar (C2)
- Write button labels into `.btnLabel` (`btn.querySelector('.btnLabel').textContent = ...`), never
  `btn.textContent`: today's `applySettings`/`setMode` wipe the `.btnLabel` span, the `.dot` and the mask icon
  pseudo-element's layout. Toggle state via `aria-pressed` only ("Sound"/"CRT" labels never change;
  `#btnPause` label flips Pause/Resume and `aria-pressed` flips the icon to play).
- `#btnFullscreen` / `#btnFullscreen2`: add `.hidden` when `!document.fullscreenEnabled && !document.webkitFullscreenEnabled`.
- `#rotateHint` ships with `.hidden`; C2 removes it when `(pointer:coarse) and (orientation:portrait)` matches
  and `sessionStorage.typer.rotateHintDismissed` is unset; `.rotateHintClose` click → add `.hidden` + set the key.
  CSS already restricts display to coarse+portrait ≤1024 px.
- `#hudPause` has no `[hidden]` attribute (amendment C-18); CSS shows it only in immersive landscape
  `(max-height:520px) and (orientation:landscape)`. It needs a click handler → `togglePause()`.
- `--vvh` / `body.kb-open` rules exist (`body.kb-open #main { max-height: calc(var(--vvh) - 8px) }`).

## 3. HUD (C3)
- `#hudHPFill` / `#hudHPGhost`: write `style.transform = scaleX(frac)` (CSS transitions 120 ms / 600 ms+250 ms).
- `#bossFill`: write `style.transform = scaleX(frac)` (or `--frac`); stop writing `style.width` (today's width
  write still works because the fill is `width:100%` + `inset:0`). `#bossMeter`: `style.setProperty('--segments', n)`,
  `dataset.state = 'p1'..'p4'` (colours: p1 magenta, p2 amber, p3 danger, p4 violet; `ok|warn|crit` also styled),
  `.isCharging` during a surge, `.segmentClear` 160 ms. Phase ticks: `.bossPhaseTick` elements with
  `style.setProperty('--at', pct + '%')`; add a third `<i class="bossPhaseTick">` for L10.
- `#stageBar`: each `.stageFill` takes `style.setProperty('--p', 0..1)`; add `.isDone` on a finished `.stageSeg`;
  the boss segment pulses danger with `.stageSeg--boss.isCharging` during the approach.
- Chips: `.chip[data-type][style="--p:;--accent:"] > i.chipIcon + .chipLabel + .chipTime.mono`; `.expiring`
  blinks; add `.is-leaving` for the 160 ms exit fade before removal. `.chipIcon` expects an inline `<svg>` child.
- `#hudMult[data-tier=1..5]`, `.pop` (240 ms), `#hudScore.gain`, `#hud.is-hit` (180 ms), `#hud[data-hp=ok|warn|crit]`.
- Today's `updateHUD` writes "`combo ×mult`" into `#hudCombo`; the new HUD should write the bare combo there and
  the multiplier into `#hudMult`.

## 4. Menu (C5)
- Compatibility shim to delete once `renderResumeCard()` lands: `.resumeCard:has(> #btnContinue:disabled) { display:none }`
  (style.css, section 7). It keeps Continue reachable with today's `btnContinue.disabled` logic.
- The ten `.sectorCard` buttons are static placeholders (card 1 `.is-current`, 2–10 `.is-locked` + `disabled`);
  `renderSectorGrid()` may rebuild `#sectorGrid` innerHTML with the same markup. Number colours default to
  `THEME_ACCENT` per `data-level`; override with `style="--sector-accent: ..."` if desired.
- `#btnStart` is `type="submit"` inside `form#menuForm`; the inline boot guard already `preventDefault`s submits of
  `#menuForm` and `#settingsPanel` so Enter in `#playerName` never reloads. C5's submit handler just starts the run.
- `.pressStart` has two spans (`.pressStart__kbd` / `.pressStart__tap`) switched by CSS; no JS text swap needed.

## 5. Pause / settings (C6)
- `#settingsPanel` starts inside `#pauseSettingsHost`; `mountSettings(host)` moves the node. The range inputs
  read a `--val` custom property for the filled track: `el.style.setProperty('--val', pct + '%')` on `input`.
- `#setCRTIntensityOut` exists (extra `<output>`), update it with the percentage like `#setMusicOut`.
- Pause scrim blur is dropped under `:root.reduce-motion` by CSS; nothing to do in JS besides `resolveMotion()`.

## 6. Loading (A8)
- Overlay markup per UX-09; the bar sweeps (indeterminate) while `#loadingBar[aria-valuenow="0"]`, so write
  `aria-valuenow` with every `setLoadingProgress`. Dismiss with `.is-dismissed` then `.hidden` on `transitionend` (450 ms).
- `#loadingOverlay.isError` styles the error state. The inline guard binds `#btnLoadingRetry` to `location.reload()`
  ONLY after an uncaught boot error (`retry.onclick`), so A8's asset-retry listener is unaffected.
- `assets/opt/manifest.js` is NOT yet referenced from index.html (not needed by the current code). A7/A10 add
  `<script src="./assets/opt/manifest.js?v=<SHELL>"></script>` as the first script after the inline guard.

## 7. CRT (D9)
- `#crtNoise` ships with a static CSS tile (`assets/ui/noise.png`, 128 px) so the overlay works with today's JS;
  `makeNoiseTile()` may override it with an inline `background-image: url(data:image/png...)`.
- Toggle via `document.documentElement.dataset.crt = 'on'|'off'` and `--crt-k`; the legacy inline
  `crtOverlay.style.display` still works. `crtTear()` adds `#crtOverlay.tear` for 120 ms.

## 8. Toasts (A4 / C8)
- `#toastStack` sits at `bottom:14%` (10% ≤640 px). Add `.is-leaving` to a `.toast` for the 200 ms exit animation
  (opacity-only under reduce-motion), then remove the node.

## 9. Versioning (A10) and secondary pages (E1)
- CSS links now carry `?v=20251130a` (same token as the scripts) and `<meta name="asset-version" content="20251130a">`;
  bump all three places together. `tools/build-web-assets.sh` should regenerate `assets/ui/og-card.jpg`
  (built here with: `magick assets/screenshot.png -gravity center -crop 3086x1620+0+0 +repage -resize 1200x630! -strip -interlace Plane -sampling-factor 4:2:0 -quality 80 assets/ui/og-card.jpg`, 115 KB).
- `info.html` / `support.html` (not owned here) still need the icon/meta block and a back link; copy the head of
  `privacy-policy.html`. Footer links point at `./privacy-policy.html` and `./support.html`.
- `native/sync-web.sh`: `#loadingOverlay` keeps `id` first and no `class` attribute, so the sed still inserts `class="hidden"`.
