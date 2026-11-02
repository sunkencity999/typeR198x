# tools/audio — sound generators and packers

Everything the SOUND pass renders is reproducible from these scripts; the committed outputs are the WAV masters under
`assets/audio/sfx` and `assets/audio/vo` and the packed banks under `assets/opt/audio` (written by
`tools/build-web-assets.sh`). The runtime that plays them is `assets/audio/sfx.js` (sample pool, announcer, sidechain).

| Script | What it does | Output |
| --- | --- | --- |
| `gen_sfx.py` | numpy/scipy synthesis of the neon-arcade sample set: 31 cues x 1-4 round-robin variants (layered noise bursts, FM / sub tones, filtered sweeps, tanh saturation, bit-crush, synthetic-IR reverbs, feedback-delay tails). Deterministic per `<cue>:<n>` seed. | `assets/audio/sfx/<cue>_<n>.wav` (44.1 kHz mono 16-bit) + `index.json` (trim, voice cap, pitch jitter per cue) |
| `gen_vo.py` | macOS `say` (Daniel, 172 wpm) -> radio-comms chain: 300-3400 Hz band-pass, 28 Hz ring-mod + 9-bit / 11 kHz crush under the clean signal, RMS compressor, carrier hiss, key click, squelch tail. 14 lines. | `assets/audio/vo/<line>.wav` (22.05 kHz mono) + `index.json` (trim, priority, text) |
| `pack-bank.mjs` | Packs a WAV directory + its `index.json` into one MP3 sprite bank behind a 10 ms 1 kHz alignment marker (30 ms gaps) and writes the cue table the manifest embeds. | `assets/opt/audio/<bank>.mp3` + `<bank>.json` |
| `split_stems.sh` | Demucs (`htdemucs`, two-stem drums / no_drums) over the six music masters, for the adaptive-music layers. CPU, 6 threads: about 1.5 min per track on an M4 Max; the first run downloads the weights into the venv. Stems are not committed (`assets/audio/stems/` is ignored, 267 MB). | `assets/audio/stems/htdemucs/Galactic_High_Score_<n>/{drums,no_drums}.wav` |

## Regenerate

```bash
PY=/Users/christopher.bradford/.venvs/typer-art/bin/python          # pillow, numpy, scipy
$PY tools/audio/gen_sfx.py --preview        # 82 WAVs in ~4 s; --preview writes tools/audio/preview_sfx.png (spectrogram sheet, not committed)
$PY tools/audio/gen_vo.py                   # 14 lines through `say`; --voice / --rate to audition another voice
tools/build-web-assets.sh                   # packs both banks (node + ffmpeg) and embeds the cue tables as manifest.sfxBank / voBank
```

`MANIFEST_ONLY=1 tools/build-web-assets.sh` re-embeds the existing `assets/opt/audio/*-bank.json` without re-encoding. To
audition a single cue: `$PY tools/audio/gen_sfx.py --only laser,impact --out /tmp/sfx` then open the WAVs.

Music layers (adaptive music):

```bash
python3.12 -m venv ~/.venvs/typer-audio && ~/.venvs/typer-audio/bin/pip install demucs torch torchaudio soundfile
tools/audio/split_stems.sh [--device cpu|mps] [--threads 6] [--only 1,4]   # stems -> assets/audio/stems (ignored)
tools/build-web-assets.sh                                                 # encodes the layers when the stems are present
```

The build writes `galactic_high_score_<n>_nodrums.mp3` (stereo, `-q:a 5`, ~2.1 MB) and `_drums.mp3` (mono, `-q:a 7`,
~0.85-1.1 MB) and lists them as `manifest.musicLayers[i] = {base, top}`; without stems it keeps the committed encodes.
The full mixes are `-q:a 5` since this pass (were `-q:a 2`) so the whole `assets/opt` stays under 45 MB (42.96 MB).
Why mono drums: on the stems the drums carry 95-99 % of their energy in the mid channel (side 0.7-4.7 %), so the mono
top layer halves the second buffer with no audible image change and keeps a decoded pair at 56-67 MB (48 kHz, loop
body only) under the ~90 MB budget with the sample banks. Stem quality as measured (track 1-6): the drumless layer
keeps 5-16 % of the drums' onset flux in the 2-9 kHz band (faint hat bleed at calm moments, masked under SFX), and
`no_drums + drums` differs from the master by -28..-34 dBFS, which is why the pair is `base + intensity x top` rather
than a crossfade toward the original file.

Tuning lives in one table each: `CUES` in `gen_sfx.py` (`recipe, variants, trim, voice cap, jitter, peak dB`) and `LINES` in
`gen_vo.py` (`text, priority, trim`). The trim is the linear gain the runtime applies before `sfxGain` (every file is
peak-normalised to -1 dBFS, so the bank is consistent and the mix is balanced in that table); the voice cap is the per-cue
polyphony before the oldest voice is stolen; the jitter is the +- playbackRate fraction (0 for pitched cues such as the typing tick).

## Banks at runtime (assets/audio/sfx.js)

* `unlock()` fetches and decodes `sfx-bank.mp3` (~460 KB, 44.6 s) and, when the announcer is on, `vo-bank.mp3` (~100 KB)
  inside the unlock gesture, raced against `PRIME_TIMEOUT_MS` like the media primes; measured 28 ms + 6 ms of decode on an
  M4, ~10 MB of decoded float32 at 48 kHz. Until a bank is in (or when the manifest has none: legacy shells, `--legacy`
  probe, native / `file://`) every cue plays its synth.
* `_sample(cue, {rate, gain, dur, t0, dest, voices, jitter, track})` picks a round-robin variant (never the same twice in a
  row), applies the table trim and +- jitter, and plays an `AudioBufferSourceNode` over the shared buffer; per-cue caps and a
  32-voice global cap steal the oldest voice with a 10 ms fade. `sfx.lastVoice` records the pick for the probes.
* `_bankShift()` finds the marker's onset after decode and cancels any decoder pre-roll (0 ms in Chrome, which honours the
  LAME gapless header; the guard is for engines that do not).
* `_sideDuck(db, hold)` is the fast music sidechain on `musicDuck` (musicGain -> musicDuck -> master): -3 dB medium
  explosions / boss hits / hull damage, -4 dB large explosions, boss kill and announcer lines, 20 ms in, .35 s hold, .25 s out.
* The master chain is `master -> DynamicsCompressor (-12 dB, knee 20, 3:1, 5 / 150 ms) -> WaveShaper soft clip ->
  destination`. The clip is bit-exact below .6 and bends to a .88 ceiling: several sampled onsets on the same instant run
  ahead of the compressor's attack, and the ceiling is what keeps `12 zaps + explosion(1) + bossKill + damage` under
  full scale (.86 measured) without trimming every cue for that one worst case.
* Music layers (`layersAvailable(i)`, `_layersPrepare(i)`, `_layersStart/_layersStop`, `setIntensity(v)`,
  `musicLayerInfo()`, `seekMusic(t)`, `setLayersEnabled(on)`): `prefetchMusic(i)` fetches the pair's bytes, the level
  clear (`fanfare("levelClear")`) releases the old pair and decodes the next behind the results card, `playMusic(i)`
  starts the pair when nothing streams the track (resuming a parked position), and the streaming element's loop
  boundary (`_crossfadeLoop`) hands over to a decoded pair instead of the second element. The pair loops over
  `[loopStart, loopEnd - LOOP_FADE)` with a 12 ms splice; `88-audio-director.js` eases the intensity.
* `say(line, {delay, priority})` / `setAnnouncer(on)`: one line at a time through `voGain -> sfxGain`; a higher priority
  interrupts, an equal or lower one waits in the single queue slot. Lines: `SFX.VO_LINES`.
* The typing tick (`_typeClimb`) rides every `zap(progress)`: the `tick` sample at `0.75 * 2^progress` playbackRate (an
  octave across the word) with a root / fifth / octave chord on the last glyph; `error()` is the dull miss tick.
  `typeTick(variant, progress)` takes the same climb when a progress is passed.

Acceptance: `cd tools/playtest && node probes/audio-sound.mjs` (pool, climb, sidechain, announcer, setting, legacy
fallback, offline peak, layer decode / memory / intensity / loop wrap), plus the existing `npm run audio` (the contract
and lifecycle probes are path-aware: they seek whichever carrier has the music and judge the same RMS continuity).
