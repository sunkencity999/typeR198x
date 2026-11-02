#!/usr/bin/env python3
"""Type-R 198X — announcer voice lines: macOS `say` -> radio-comms processing -> assets/audio/vo/<line>.wav.

    /Users/christopher.bradford/.venvs/typer-art/bin/python tools/audio/gen_vo.py              # all lines (Daniel, 22.05 kHz)
    ... gen_vo.py --voice Reed --rate 180 --only ready,go --out /tmp/vo

Chain (numpy/scipy, 22.05 kHz mono): trim silence, 4th-order Butterworth band-pass 300-3400 Hz (the comms band),
light ring-mod (28 Hz, 12 %) + 9-bit crush with 2x sample-hold mixed under the clean signal for the carrier grit, a
feed-forward RMS compressor (-18 dB, 4:1, 5/80 ms), a -45 dBFS carrier hiss while the line is open, a 2 ms key click at
the start and a 70 ms squelch burst at the end, peak -2 dBFS. The lines are deterministic for a given macOS voice
build; re-run to regenerate after changing the table. index.json carries the runtime trim and the line priorities.
"""
import argparse
import json
import os
import struct
import subprocess
import tempfile

import numpy as np
from scipy.signal import butter, sosfilt

SR = 22050
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT_DEFAULT = os.path.join(ROOT, "assets", "audio", "vo")

# line id -> (spoken text, priority 1..5 used by the runtime queue, trim)
LINES = {
    "warning": ("Warning.", 4, 0.9),
    "boss_incoming": ("Boss incoming.", 4, 0.9),
    "sector_clear": ("Sector clear.", 5, 0.9),
    "signal_lost": ("Signal lost.", 5, 0.9),
    "perfect": ("Perfect.", 2, 0.85),
    "overdrive": ("Overdrive.", 3, 0.85),
    "new_record": ("New record.", 3, 0.9),
    "rank_s": ("Rank S.", 4, 0.9),
    "rank_a": ("Rank A.", 4, 0.9),
    "rank_b": ("Rank B.", 4, 0.9),
    "rank_c": ("Rank C.", 4, 0.9),
    "rank_d": ("Rank D.", 4, 0.9),
    "ready": ("Ready.", 1, 0.8),
    "go": ("Go!", 1, 0.85),
}


def n_of(dur):
    return max(1, int(round(dur * SR)))


def db(x):
    return 10.0 ** (x / 20.0)


def tts(text, voice, rate):
    """say -> aiff -> float32 mono at SR via ffmpeg."""
    with tempfile.TemporaryDirectory() as tmp:
        aiff = os.path.join(tmp, "line.aiff")
        subprocess.run(["say", "-v", voice, "-r", str(rate), "-o", aiff, text], check=True)
        raw = subprocess.run(["ffmpeg", "-v", "error", "-i", aiff, "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"], check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype="<f4").astype(float)


def trim(x, floor_db=-45.0, pre=0.01, post=0.04):
    thr = db(floor_db)
    idx = np.nonzero(np.abs(x) > thr)[0]
    if not len(idx):
        return x
    a = max(0, idx[0] - n_of(pre))
    b = min(len(x), idx[-1] + n_of(post))
    return x[a:b]


def bandpass(x, lo=300.0, hi=3400.0, order=4):
    sos = butter(order, [lo, hi], btype="band", fs=SR, output="sos")
    return sosfilt(sos, x)


def lowpass(x, hz, order=2):
    return sosfilt(butter(order, hz, btype="low", fs=SR, output="sos"), x)


def compress(x, thr_db=-18.0, ratio=4.0, att=0.005, rel=0.08, makeup_db=6.0):
    """Feed-forward RMS compressor with one-pole attack / release."""
    a_att = np.exp(-1.0 / (att * SR))
    a_rel = np.exp(-1.0 / (rel * SR))
    env = np.empty_like(x)
    e = 0.0
    sq = x * x
    for i, v in enumerate(sq):
        coef = a_att if v > e else a_rel
        e = coef * e + (1 - coef) * v
        env[i] = e
    level_db = 10 * np.log10(env + 1e-12)
    over = np.maximum(0.0, level_db - thr_db)
    gain_db = -over * (1 - 1 / ratio) + makeup_db
    return x * db(gain_db)


def radio(x, rng):
    """Comms colour: band-pass, carrier grit, compression, hiss, key click and squelch tail."""
    x = bandpass(x)
    t = np.arange(len(x)) / SR
    rm = x * (0.88 + 0.12 * np.sin(2 * np.pi * 28 * t))
    q = 2 ** 8
    crushed = np.round(rm * q) / q
    crushed = crushed[(np.arange(len(crushed)) // 2) * 2]  # 11 kHz sample-hold
    grit = 0.55 * rm + 0.45 * crushed
    y = compress(grit)
    y = np.tanh(y * 1.6) / np.tanh(1.6)
    y = bandpass(y, 280, 3600, 2)
    # carrier hiss while keyed, the key click, the squelch burst
    hiss = lowpass(rng.standard_normal(len(y)), 3000) * db(-45)
    y = y + hiss
    click = rng.standard_normal(n_of(0.002)) * np.linspace(1, 0, n_of(0.002)) * 0.35
    y[: len(click)] += click
    sq_n = n_of(0.07)
    squelch = bandpass(rng.standard_normal(sq_n), 500, 3000) * np.exp(-np.arange(sq_n) / (0.02 * SR)) * 0.5
    tail = np.zeros(n_of(0.09))
    tail[: sq_n] += squelch
    y = np.concatenate([y, tail])
    y[: n_of(0.001)] *= np.linspace(0, 1, n_of(0.001))
    y[-n_of(0.01):] *= np.linspace(1, 0, n_of(0.01))
    return y


def write_wav(path, x):
    pcm = (np.clip(x, -1, 1) * 32767).astype("<i2").tobytes()
    hdr = b"RIFF" + struct.pack("<I", 36 + len(pcm)) + b"WAVE" + b"fmt " + struct.pack("<IHHIIHH", 16, 1, 1, SR, SR * 2, 2, 16) + b"data" + struct.pack("<I", len(pcm))
    with open(path, "wb") as fh:
        fh.write(hdr + pcm)


def render(voice, rate, only=None, out=OUT_DEFAULT):
    os.makedirs(out, exist_ok=True)
    index = {"sampleRate": SR, "voice": voice, "rate": rate, "cues": {}}
    total = 0.0
    for name, (text, prio, trim_gain) in LINES.items():
        if only and name not in only:
            continue
        rng = np.random.default_rng(hash(name) & 0xFFFF)
        x = trim(tts(text, voice, rate))
        y = radio(x, rng)
        y = y * (db(-2.0) / (np.max(np.abs(y)) or 1.0))
        fname = f"{name}.wav"
        write_wav(os.path.join(out, fname), y)
        dur = len(y) / SR
        total += dur
        index["cues"][name] = {"files": [fname], "trim": trim_gain, "voices": 1, "jitter": 0.0, "priority": prio, "text": text}
        print(f"{fname:20s} {dur * 1000:6.0f} ms  '{text}'")
    with open(os.path.join(out, "index.json"), "w") as fh:
        json.dump(index, fh, indent=1)
    print(f"{len(index['cues'])} lines, {total:.1f} s -> {out}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--voice", default="Daniel")
    ap.add_argument("--rate", type=int, default=172)
    ap.add_argument("--only")
    ap.add_argument("--out", default=OUT_DEFAULT)
    a = ap.parse_args()
    render(a.voice, a.rate, set(a.only.split(",")) if a.only else None, a.out)
