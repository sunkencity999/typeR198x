#!/usr/bin/env python3
"""Type-R 198X — neon-arcade SFX sample generator (numpy/scipy DSP, no audio dependencies).

Renders a coherent round-robin sample set to assets/audio/sfx/<cue>_<n>.wav (44.1 kHz mono, 16-bit) and an
index (assets/audio/sfx/index.json) with the per-cue runtime trim, voice cap and pitch-jitter hints that
tools/audio/pack-bank.mjs copies into the manifest. Every variant is deterministic (seeded from "<cue>:<n>"), so a
re-run reproduces the committed files bit for bit; change a recipe or a seed to get new takes.

    /Users/christopher.bradford/.venvs/typer-art/bin/python tools/audio/gen_sfx.py            # all cues
    ... gen_sfx.py --only laser,impact --out /tmp/sfx                                          # a subset elsewhere
    ... gen_sfx.py --preview                                                                   # also a spectrogram sheet

Design: layered noise bursts, FM / sub tones, filtered sweeps, tanh saturation, bit-crush, and short reverbs
(synthetic exponentially decaying noise IRs, fftconvolve) plus feedback-delay tails. Each cue is peak-normalised to
PEAK_DB and the runtime applies the trim from the index, so the bank is consistent and the mix is tuned in one table.
"""
import argparse
import json
import os
import sys
import zlib

import numpy as np
from scipy.signal import fftconvolve, lfilter

SR = 44100
PEAK_DB = -1.0
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT_DEFAULT = os.path.join(ROOT, "assets", "audio", "sfx")

# ----------------------------------------------------------------------------- primitives


def n_of(dur):
    return max(1, int(round(dur * SR)))


def tt(dur):
    return np.arange(n_of(dur)) / SR


def db(x):
    return 10.0 ** (x / 20.0)


def var(rng, pct):
    """1 +- pct (uniform)."""
    return 1.0 + rng.uniform(-pct, pct)


def seed_for(name):
    return zlib.crc32(name.encode("utf-8")) & 0xFFFFFFFF


def pad_to(x, n):
    if len(x) >= n:
        return x[:n]
    return np.concatenate([x, np.zeros(n - len(x))])


def mix(*layers):
    """Sum layers of different lengths (each may be (array, gain) or array)."""
    n = 0
    items = []
    for L in layers:
        if L is None:
            continue
        if isinstance(L, tuple):
            x, g = L
        else:
            x, g = L, 1.0
        items.append((x, g))
        n = max(n, len(x))
    out = np.zeros(n)
    nf = n_of(0.006)
    for x, g in items:
        x = np.array(x, float, copy=True)
        if len(x) > nf:  # every layer leaves on a 6 ms fade: an exponential tail cut at 5-10 % is a click
            x[-nf:] *= np.linspace(1, 0, nf)
        out[: len(x)] += x * g
    return out


def at(x, t0, total=None):
    """Delay x by t0 seconds (zero-padded front)."""
    pre = np.zeros(n_of(t0)) if t0 > 0 else np.zeros(0)
    y = np.concatenate([pre, x])
    return pad_to(y, n_of(total)) if total else y


def env_adsr(n, a, d, s, r, curve=3.0):
    """Attack / decay / sustain / release in seconds, exponential-ish segments. Returns length n."""
    na, nd, nr = n_of(a), n_of(d), n_of(r)
    ns = max(0, n - na - nd - nr)
    seg_a = np.linspace(0, 1, na, endpoint=False) ** (1.0 / curve) if na else np.zeros(0)
    seg_d = 1 - (1 - s) * (np.linspace(0, 1, nd, endpoint=False) ** (1.0 / curve)) if nd else np.zeros(0)
    seg_s = np.full(ns, s)
    seg_r = s * (1 - np.linspace(0, 1, nr, endpoint=True)) ** curve if nr else np.zeros(0)
    e = np.concatenate([seg_a, seg_d, seg_s, seg_r])
    return pad_to(e, n)


def env_exp(n, tau, a=0.0015):
    """Instant-ish attack then exponential decay with time constant tau (s)."""
    t = np.arange(n) / SR
    e = np.exp(-t / max(1e-4, tau))
    na = n_of(a)
    if na > 1:
        e[:na] *= np.linspace(0, 1, na) ** 0.5
    return e


def env_ramp(n, a, hold=0.0, r=0.05, curve=2.0):
    """Rise over a (s), hold, release r."""
    na, nh, nr = n_of(a), n_of(hold), n_of(r)
    e = np.concatenate([np.linspace(0, 1, na) ** curve, np.ones(nh), (1 - np.linspace(0, 1, nr)) ** 2])
    return pad_to(e, n)


def sweep(f0, f1, dur, shape="exp", hold=0.0):
    """Per-sample frequency array: f0 -> f1 over dur, then held (hold seconds)."""
    n = n_of(dur)
    if shape == "exp":
        f = f0 * (f1 / f0) ** np.linspace(0, 1, n)
    else:
        f = np.linspace(f0, f1, n)
    if hold > 0:
        f = np.concatenate([f, np.full(n_of(hold), f1)])
    return f


def osc(kind, freq, dur=None, phase=0.0, rng=None):
    """Band-unlimited classic waveforms; freq scalar or per-sample array. Slight analog drift when rng is given."""
    if np.ndim(freq) == 0:
        f = np.full(n_of(dur), float(freq))
    else:
        f = np.asarray(freq, float)
        if dur is not None:
            f = pad_to(f, n_of(dur)) if len(f) < n_of(dur) else f[: n_of(dur)]
            if len(f) < n_of(dur):
                f = np.concatenate([f, np.full(n_of(dur) - len(f), f[-1])])
    if rng is not None:
        f = f * (1 + 0.002 * np.sin(2 * np.pi * rng.uniform(3, 7) * np.arange(len(f)) / SR))
    ph = phase + 2 * np.pi * np.cumsum(f) / SR
    if kind == "sine":
        return np.sin(ph)
    if kind == "saw":
        return 2 * ((ph / (2 * np.pi)) % 1.0) - 1
    if kind == "square":
        return np.where((ph / (2 * np.pi)) % 1.0 < 0.5, 1.0, -1.0)
    if kind == "tri":
        return 2 * np.abs(2 * ((ph / (2 * np.pi)) % 1.0) - 1) - 1
    if kind == "pulse":
        return np.where((ph / (2 * np.pi)) % 1.0 < 0.25, 1.0, -1.0)
    raise ValueError(kind)


def fm(fc, ratio, index, dur, rng=None, decay=None):
    """2-op FM: carrier fc, modulator fc*ratio, index scalar or per-sample array (decaying bell with decay tau)."""
    n = n_of(dur)
    t = np.arange(n) / SR
    idx = np.asarray(index, float)
    if decay is not None:
        idx = idx * np.exp(-t / decay)
    if np.ndim(idx) == 0:
        idx = np.full(n, float(idx))
    mod = np.sin(2 * np.pi * fc * ratio * t) * idx
    return np.sin(2 * np.pi * fc * t + mod)


def noise(dur, rng, color="white"):
    x = rng.standard_normal(n_of(dur))
    if color == "pink":
        # Paul Kellet's economy pink filter
        b = np.zeros(7)
        y = np.empty_like(x)
        for i, w in enumerate(x):
            b[0] = 0.99886 * b[0] + w * 0.0555179
            b[1] = 0.99332 * b[1] + w * 0.0750759
            b[2] = 0.96900 * b[2] + w * 0.1538520
            b[3] = 0.86650 * b[3] + w * 0.3104856
            b[4] = 0.55000 * b[4] + w * 0.5329522
            b[5] = -0.7616 * b[5] - w * 0.0168980
            y[i] = (b[0] + b[1] + b[2] + b[3] + b[4] + b[5] + b[6] + w * 0.5362) * 0.11
            b[6] = w * 0.115926
        x = y
    elif color == "brown":
        x = np.cumsum(x)
        x -= np.linspace(x[0], x[-1], len(x))
    m = np.max(np.abs(x)) or 1.0
    return x / m


def _rbj(kind, f, q, gain_db=0.0):
    f = float(np.clip(f, 10.0, SR * 0.45))
    w0 = 2 * np.pi * f / SR
    cw, sw = np.cos(w0), np.sin(w0)
    alpha = sw / (2 * max(0.05, q))
    if kind == "lp":
        b0, b1, b2 = (1 - cw) / 2, 1 - cw, (1 - cw) / 2
        a0, a1, a2 = 1 + alpha, -2 * cw, 1 - alpha
    elif kind == "hp":
        b0, b1, b2 = (1 + cw) / 2, -(1 + cw), (1 + cw) / 2
        a0, a1, a2 = 1 + alpha, -2 * cw, 1 - alpha
    elif kind == "bp":  # constant 0 dB peak
        b0, b1, b2 = alpha, 0.0, -alpha
        a0, a1, a2 = 1 + alpha, -2 * cw, 1 - alpha
    elif kind == "notch":
        b0, b1, b2 = 1.0, -2 * cw, 1.0
        a0, a1, a2 = 1 + alpha, -2 * cw, 1 - alpha
    elif kind == "peak":
        A = 10 ** (gain_db / 40)
        b0, b1, b2 = 1 + alpha * A, -2 * cw, 1 - alpha * A
        a0, a1, a2 = 1 + alpha / A, -2 * cw, 1 - alpha / A
    else:
        raise ValueError(kind)
    return np.array([b0, b1, b2]) / a0, np.array([1.0, a1 / a0, a2 / a0])


def filt(x, kind, f, q=0.707, gain_db=0.0, block=64):
    """RBJ biquad; f scalar or per-sample array (block-wise time-varying, state carried)."""
    if np.ndim(f) == 0:
        b, a = _rbj(kind, f, q, gain_db)
        return lfilter(b, a, x)
    f = np.asarray(f, float)
    if len(f) < len(x):
        f = np.concatenate([f, np.full(len(x) - len(f), f[-1])])
    y = np.empty_like(x)
    zi = np.zeros(2)
    for i in range(0, len(x), block):
        j = min(len(x), i + block)
        b, a = _rbj(kind, f[(i + j) // 2], q, gain_db)
        y[i:j], zi = lfilter(b, a, x[i:j], zi=zi)
    return y


def lp(x, f, q=0.707):
    return filt(x, "lp", f, q)


def hp(x, f, q=0.707):
    return filt(x, "hp", f, q)


def bp(x, f, q=1.0):
    return filt(x, "bp", f, q)


def sat(x, drive=1.5):
    """tanh soft clip, gain-compensated."""
    return np.tanh(x * drive) / np.tanh(drive)


def crush(x, bits=8, hold=1):
    """Bit-depth and sample-and-hold reduction."""
    q = 2 ** (bits - 1)
    y = np.round(x * q) / q
    if hold > 1:
        idx = (np.arange(len(y)) // hold) * hold
        y = y[idx]
    return y


def ring(x, hz, depth=1.0):
    t = np.arange(len(x)) / SR
    return x * ((1 - depth) + depth * np.sin(2 * np.pi * hz * t))


def reverb(x, rt60=0.6, wet=0.3, predelay=0.012, lp_hz=5000, rng=None, dry=1.0):
    """Synthetic IR: exponentially decaying noise, darkened over time; fftconvolve."""
    rng = rng or np.random.default_rng(1)
    n = n_of(rt60 * 1.2)
    t = np.arange(n) / SR
    ir = rng.standard_normal(n) * np.exp(-6.91 * t / rt60)
    ir = lp(ir, lp_hz * np.exp(-t / max(0.05, rt60)) + 400)  # the tail darkens
    ir[: n_of(0.002)] *= np.linspace(0, 1, n_of(0.002))
    ir /= np.sqrt(np.sum(ir ** 2)) * 2.5
    tail = fftconvolve(x, ir)
    tail = at(tail, predelay)
    return mix((x, dry), (tail, wet))


def delay_fb(x, time_s=0.25, fb=0.35, wet=0.45, taps=8, lp_hz=4500):
    """Feedback delay as a tap IR (each tap darker and quieter)."""
    ir = np.zeros(n_of(time_s * taps) + 1)
    for k in range(1, taps + 1):
        ir[n_of(time_s * k)] = fb ** k
    y = fftconvolve(x, ir)
    y = lp(y, lp_hz)
    return mix((x, 1.0), (y, wet))


def crackle(dur, rng, density=120.0, decay=0.3, f=1500, q=1.5, width=0.0006):
    """Sparse random impulses (Poisson, density falling with time) through a bandpass."""
    n = n_of(dur)
    x = np.zeros(n)
    count = int(density * dur)
    times = np.sort(rng.random(count) ** 1.6) * dur
    for t0 in times:
        i = int(t0 * SR)
        amp = rng.uniform(0.3, 1.0) * np.exp(-t0 / decay) * rng.choice([-1, 1])
        w = n_of(width * rng.uniform(0.5, 1.5))
        x[i : min(n, i + w)] += amp
    return bp(x, f, q)


def norm(x, peak_db=PEAK_DB):
    m = np.max(np.abs(x))
    return x if m == 0 else x * (db(peak_db) / m)


def trim_tail(x, floor_db=-60.0, fade=0.012, keep=0.015):
    """Cut trailing silence below floor_db (plus keep seconds), with a short fade."""
    thr = db(floor_db)
    above = np.nonzero(np.abs(x) > thr)[0]
    if not len(above):
        return x[: n_of(0.05)]
    end = min(len(x), above[-1] + n_of(keep))
    y = x[:end].copy()
    nf = min(len(y), n_of(fade))
    if nf > 1:
        y[-nf:] *= np.linspace(1, 0, nf)
    return y


def declick(x, ms=0.5):
    n = min(len(x), n_of(ms / 1000))
    if n > 1:
        x[:n] *= np.linspace(0, 1, n)
    return x


def finish(x, peak_db=PEAK_DB):
    x = np.nan_to_num(np.asarray(x, float))
    x = hp(x, 24)  # dc / rumble guard
    x = norm(x, peak_db)
    x = trim_tail(x)
    return declick(x)


def write_wav(path, x):
    y = np.clip(x, -1, 1)
    pcm = (y * 32767).astype("<i2")
    data = pcm.tobytes()
    import struct

    hdr = b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVE" + b"fmt " + struct.pack("<IHHIIHH", 16, 1, 1, SR, SR * 2, 2, 16) + b"data" + struct.pack("<I", len(data))
    with open(path, "wb") as fh:
        fh.write(hdr + data)


# ----------------------------------------------------------------------------- recipes
# Each returns a float array; `v` is the variant index, `rng` the seeded generator. Variation lives in pitches
# (+-3..6 %), decays (+-10..15 %), noise seeds and layer balances, never in the identity of the sound.


def cue_laser(v, rng):
    k = var(rng, 0.05)
    dur = 0.19
    f = sweep(1900 * k, 430 * k, 0.085, hold=dur - 0.085)
    body = osc("saw", f, dur, rng=rng) * env_adsr(n_of(dur), 0.001, 0.07, 0.25, 0.1)
    body = filt(body, "lp", sweep(6500, 1100, 0.12, hold=dur - 0.12), 1.2)
    zing = fm(1700 * k, 2.01, 3.0, 0.12, decay=0.03) * env_exp(n_of(0.12), 0.035)
    click = hp(noise(0.006, rng), 4000) * env_exp(n_of(0.006), 0.002)
    sub = osc("sine", sweep(260 * k, 90 * k, 0.08), 0.08) * env_exp(n_of(0.08), 0.03)
    x = mix((body, 0.9), (zing, 0.28 * var(rng, 0.2)), (click, 0.5), (sub, 0.35))
    return sat(x, 1.6 * var(rng, 0.15))


def cue_tick(v, rng):
    k = var(rng, 0.02)
    dur = 0.05
    tone = osc("sine", 2200 * k, dur) * env_exp(n_of(dur), 0.009)
    tone2 = osc("sine", 4400 * k, 0.02) * env_exp(n_of(0.02), 0.004)
    click = bp(noise(0.012, rng), 2600 * k, 6) * env_exp(n_of(0.012), 0.003)
    return mix((tone, 0.8), (tone2, 0.15), (click, 0.7))


def cue_impact(v, rng):
    k = var(rng, 0.06)
    dur = 0.32
    hit = bp(noise(0.1, rng), 2400 * k, 3) * env_exp(n_of(0.1), 0.03)
    sub = osc("sine", sweep(105 * k, 38, 0.2), 0.2) * env_exp(n_of(0.2), 0.07)
    parts = [1180, 2730, 4100]
    ringy = mix(*[(osc("sine", p * var(rng, 0.03), 0.3) * env_exp(n_of(0.3), 0.045 * var(rng, 0.2)), 0.3 / (i + 1)) for i, p in enumerate(parts)])
    crack = hp(noise(0.015, rng), 3000) * env_exp(n_of(0.015), 0.004)
    x = mix((hit, 0.9), (sub, 0.9), (ringy, 0.55), (crack, 0.6))
    x = sat(x, 1.8)
    return reverb(x, 0.28, 0.16, rng=rng)


def _explosion(v, rng, size):
    """size 0 small .. 1 large."""
    det = var(rng, 0.08)
    dur = 0.3 + 0.95 * size
    f0 = (2400 - 1500 * size) * det
    body = noise(dur, rng) * env_adsr(n_of(dur), 0.003, dur * 0.25, 0.3, dur * 0.72)
    body = filt(body, "lp", sweep(f0, 110, dur * 0.9, hold=dur * 0.1), 0.9)
    crack = hp(noise(0.025, rng), 2500) * env_exp(n_of(0.025), 0.006)
    sub = osc("sine", sweep(115 * det, 42, 0.12 + 0.25 * size), 0.12 + 0.25 * size) * env_exp(n_of(0.12 + 0.25 * size), 0.06 + 0.1 * size)
    layers = [(body, 1.0), (crack, 0.5), (sub, 0.3 + 0.6 * size)]
    if size > 0.3:
        cr = crackle(dur * 0.9, rng, density=90 + 120 * size, decay=0.25 + 0.3 * size, f=1300 * var(rng, 0.15), q=1.2)
        layers.append((at(cr, 0.04), 0.4 + 0.3 * size))
    if size > 0.7:
        debris = noise(0.5, rng) * env_adsr(n_of(0.5), 0.01, 0.15, 0.3, 0.3)
        debris = lp(debris, 600)
        layers.append((at(debris, 0.15 * var(rng, 0.3)), 0.35))
    x = mix(*layers)
    x = sat(x, 1.4 + 1.3 * size)
    return reverb(x, 0.35 + 0.8 * size, 0.18 + 0.25 * size, predelay=0.015, lp_hz=4500 - 1500 * size, rng=rng)


def cue_explosion_s(v, rng):
    return _explosion(v, rng, 0.12)


def cue_explosion_m(v, rng):
    return _explosion(v, rng, 0.5)


def cue_explosion_l(v, rng):
    return _explosion(v, rng, 1.0)


def cue_lock(v, rng):
    k = var(rng, 0.03)
    dur = 0.085
    chirp = osc("sine", sweep(1900 * k, 2500 * k, 0.035, "lin", hold=0.05), dur) * env_adsr(n_of(dur), 0.002, 0.012, 0.55, 0.06)
    click = hp(noise(0.012, rng), 5000) * env_exp(n_of(0.012), 0.003)
    shimmer = osc("sine", 5000 * k, 0.04) * env_exp(n_of(0.04), 0.01)
    return mix((chirp, 0.9), (click, 0.4), (shimmer, 0.12))


def cue_lock_lost(v, rng):
    k = var(rng, 0.04)
    dur = 0.16
    x = osc("square", sweep(420 * k, 180 * k, 0.1, hold=0.06), dur) * env_adsr(n_of(dur), 0.002, 0.04, 0.5, 0.1)
    x = lp(x, 1400)
    thud = osc("sine", sweep(160, 70, 0.08), 0.08) * env_exp(n_of(0.08), 0.03)
    return mix((x, 0.9), (thud, 0.3))


def cue_error(v, rng):
    k = var(rng, 0.03)
    dur = 0.16
    f = np.concatenate([np.full(n_of(0.05), 180 * k), np.full(n_of(dur) - n_of(0.05), 140 * k)])
    buzz = osc("square", f, dur) * env_adsr(n_of(dur), 0.002, 0.02, 0.3, 0.12)
    buzz = lp(buzz, 900)
    knock = bp(noise(0.03, rng), 620 * k, 2.5) * env_exp(n_of(0.03), 0.008)
    thump = osc("sine", sweep(150, 80, 0.06), 0.06) * env_exp(n_of(0.06), 0.025)
    x = mix((buzz, 0.8), (knock, 0.9), (thump, 0.6))
    return sat(x, 2.0)


def cue_pickup(v, rng):
    k = var(rng, 0.015)
    notes = [523.25, 783.99, 1046.5]
    step = 0.07 * var(rng, 0.1)
    layers = []
    for i, f in enumerate(notes):
        bell = fm(f * k, 3.5, 1.6, 0.22, decay=0.06) * env_exp(n_of(0.22), 0.08)
        pure = osc("sine", f * k, 0.22) * env_exp(n_of(0.22), 0.09)
        spark = hp(noise(0.01, rng), 6000) * env_exp(n_of(0.01), 0.003)
        layers += [(at(bell, i * step), 0.45), (at(pure, i * step), 0.5), (at(spark, i * step), 0.15)]
    x = mix(*layers)
    return delay_fb(x, 0.11, 0.3, 0.3, taps=5)


def cue_shield_hit(v, rng):
    k = var(rng, 0.03)
    dur = 0.26
    a = osc("sine", 1320 * k, dur, rng=rng) * env_exp(n_of(dur), 0.06)
    b = osc("sine", 1980 * k, dur, rng=rng) * env_exp(n_of(dur), 0.05)
    glass = mix((osc("sine", 3300 * var(rng, 0.04), 0.12) * env_exp(n_of(0.12), 0.025), 0.5), (osc("sine", 5100 * var(rng, 0.04), 0.08) * env_exp(n_of(0.08), 0.015), 0.3))
    click = hp(noise(0.02, rng), 3500) * env_exp(n_of(0.02), 0.005)
    return mix((a, 0.8), (b, 0.55), (glass, 0.45), (click, 0.35))


def cue_shield_break(v, rng):
    k = var(rng, 0.03)
    a = osc("sine", sweep(1980 * k, 660 * k, 0.25), 0.3) * env_exp(n_of(0.3), 0.12)
    b = osc("sine", sweep(1320 * k, 440 * k, 0.25), 0.3) * env_exp(n_of(0.3), 0.12)
    wash = bp(noise(0.25, rng), 1500, 1.0) * env_adsr(n_of(0.25), 0.002, 0.05, 0.4, 0.19)
    shards = crackle(0.5, rng, density=220, decay=0.18, f=3600 * var(rng, 0.1), q=2.0, width=0.0003)
    x = mix((a, 0.8), (b, 0.6), (wash, 0.6), (at(shards, 0.02), 0.55))
    return reverb(x, 0.5, 0.25, rng=rng)


def cue_damage(v, rng):
    k = var(rng, 0.05)
    dur = 0.4
    buzz = osc("square", sweep(300 * k, 80 * k, 0.18, hold=dur - 0.18), dur) * env_adsr(n_of(dur), 0.003, 0.05, 0.3, 0.3)
    buzz = lp(buzz, 1800)
    rumble = lp(noise(0.3, rng), 600) * env_adsr(n_of(0.3), 0.003, 0.04, 0.4, 0.25)
    sub = osc("sine", sweep(70, 45, 0.25), 0.25) * env_exp(n_of(0.25), 0.1)
    x = mix((buzz, 0.9), (rumble, 0.8), (sub, 0.5))
    x = sat(x, 3.0)
    return reverb(x, 0.3, 0.15, rng=rng)


def cue_alarm(v, rng):
    k = var(rng, 0.02)
    pulse_d = 0.3
    layers = []
    for t0 in (0.0, 0.42):
        p = osc("saw", sweep(440 * k, 330 * k, pulse_d), pulse_d, rng=rng) * env_adsr(n_of(pulse_d), 0.01, 0.1, 0.6, 0.19)
        p = lp(p, 1500)
        layers.append((at(p, t0), 1.0))
    static = hp(noise(0.75, rng), 3000) * 0.025 * env_adsr(n_of(0.75), 0.01, 0.1, 0.8, 0.2)
    x = mix(*layers, (static, 1.0))
    return sat(x, 1.8)


def cue_segment_down(v, rng):
    k = var(rng, 0.04)
    sq = osc("square", sweep(440 * k, 220 * k, 0.12), 0.12) * env_adsr(n_of(0.12), 0.003, 0.04, 0.4, 0.077)
    sq = lp(sq, 2500)
    sub = osc("sine", 90 * k, 0.15) * env_exp(n_of(0.15), 0.06)
    hit = bp(noise(0.08, rng), 1200, 1.0) * env_exp(n_of(0.08), 0.02)
    metal = mix((osc("sine", 2100 * var(rng, 0.05), 0.3) * env_exp(n_of(0.3), 0.08), 0.5), (osc("sine", 3400 * var(rng, 0.05), 0.25) * env_exp(n_of(0.25), 0.06), 0.35))
    x = mix((sq, 0.8), (sub, 0.8), (hit, 0.7), (metal, 0.45))
    return reverb(sat(x, 1.5), 0.3, 0.18, rng=rng)


def cue_phase_clear(v, rng):
    base = cue_segment_down(v, rng)
    k = var(rng, 0.01)
    layers = [(base, 1.0)]
    for i, f in enumerate([523.25, 659.25, 783.99]):
        n = osc("tri", f * k, 0.16) * env_adsr(n_of(0.16), 0.004, 0.05, 0.5, 0.1)
        layers.append((at(n, 0.12 + i * 0.07), 0.5))
    x = mix(*layers)
    return delay_fb(x, 0.25, 0.35, 0.4, taps=6)


def cue_boss_crack(v, rng):
    det = var(rng, 0.06)
    crack = noise(0.6, rng) * env_adsr(n_of(0.6), 0.002, 0.1, 0.35, 0.49)
    crack = filt(crack, "lp", sweep(9000 * det, 220, 0.5, hold=0.1), 0.8)
    sub = osc("sine", sweep(85 * det, 24, 0.8), 0.9) * env_adsr(n_of(0.9), 0.005, 0.2, 0.5, 0.7)
    debris = crackle(1.1, rng, density=260, decay=0.45, f=1100 * var(rng, 0.15), q=1.0, width=0.0008)
    rumble = lp(noise(1.0, rng, "brown"), 300) * env_adsr(n_of(1.0), 0.02, 0.3, 0.4, 0.6)
    x = mix((crack, 1.0), (sub, 1.1), (at(debris, 0.06), 0.6), (at(rumble, 0.05), 0.7))
    x = sat(x, 2.5)
    return reverb(x, 1.4, 0.45, predelay=0.02, lp_hz=3500, rng=rng)


def cue_ui_tick(v, rng):
    k = var(rng, 0.015)
    tone = osc("sine", 1200 * k, 0.03) * env_exp(n_of(0.03), 0.008)
    click = hp(noise(0.006, rng), 5000) * env_exp(n_of(0.006), 0.0015)
    return mix((tone, 0.9), (click, 0.25))


def cue_ui_confirm(v, rng):
    k = var(rng, 0.01)
    a = osc("sine", 1200 * k, 0.06) * env_exp(n_of(0.06), 0.02)
    b = osc("sine", 1800 * k, 0.1) * env_exp(n_of(0.1), 0.03)
    sp = hp(noise(0.008, rng), 6000) * env_exp(n_of(0.008), 0.002)
    return mix((a, 0.8), (at(b, 0.045), 0.7), (sp, 0.2))


def cue_ui_back(v, rng):
    k = var(rng, 0.01)
    a = osc("sine", 900 * k, 0.06) * env_exp(n_of(0.06), 0.02)
    b = osc("sine", 700 * k, 0.1) * env_exp(n_of(0.1), 0.03)
    return mix((a, 0.8), (at(b, 0.045), 0.7))


def cue_rank_stamp(v, rng):
    k = var(rng, 0.04)
    thump = osc("sine", sweep(180 * k, 60, 0.08), 0.12) * env_exp(n_of(0.12), 0.05)
    slap = lp(noise(0.03, rng), 1200) * env_exp(n_of(0.03), 0.008)
    metal = bp(noise(0.08, rng), 3000 * var(rng, 0.1), 4) * env_exp(n_of(0.08), 0.02)
    ink = bp(noise(0.25, rng), 5000, 0.7) * env_adsr(n_of(0.25), 0.03, 0.1, 0.2, 0.12) * 0.15
    x = mix((thump, 1.0), (slap, 0.9), (metal, 0.35), (at(ink, 0.03), 1.0))
    x = sat(x, 2.2)
    return reverb(x, 0.35, 0.22, rng=rng)


def cue_banner_slam(v, rng):
    k = var(rng, 0.03)
    ping = osc("sine", 1000 * k, 0.08) * env_exp(n_of(0.08), 0.025)
    hit = bp(noise(0.04, rng), 2000, 1.0) * env_exp(n_of(0.04), 0.012)
    sub = osc("sine", sweep(90, 55, 0.15), 0.15) * env_exp(n_of(0.15), 0.06)
    air = hp(noise(0.12, rng), 2500) * env_exp(n_of(0.12), 0.04) * 0.3
    x = mix((ping, 0.9), (hit, 0.8), (sub, 0.6), (air, 1.0))
    return reverb(sat(x, 1.5), 0.35, 0.22, rng=rng)


def cue_surge_charge(v, rng):
    dur = 1.2
    n = n_of(dur)
    tex = noise(dur, rng)
    tex = filt(tex, "bp", sweep(380 * var(rng, 0.1), 4200, dur), 2.0) * env_ramp(n, 1.0, 0.1, 0.1, curve=2.2)
    hiss = hp(noise(dur, rng), 6000) * env_ramp(n, 1.1, 0.05, 0.05, curve=3.0) * 0.35
    flutter = ring(tex, 11 * var(rng, 0.2), 0.35)
    return mix((flutter, 1.0), (hiss, 1.0))


def cue_surge_fire(v, rng):
    k = var(rng, 0.05)
    crack = bp(noise(0.07, rng), 3000 * k, 2) * env_exp(n_of(0.07), 0.02)
    thump = osc("sine", sweep(110 * k, 30, 0.2), 0.25) * env_exp(n_of(0.25), 0.08)
    zap = osc("saw", sweep(1200 * k, 200, 0.12), 0.12) * env_exp(n_of(0.12), 0.04)
    zap = lp(zap, 3000)
    cr = crackle(0.3, rng, density=150, decay=0.12, f=2000, q=1.5)
    x = mix((crack, 1.0), (thump, 0.9), (zap, 0.4), (at(cr, 0.03), 0.4))
    return reverb(sat(x, 2.0), 0.3, 0.2, rng=rng)


def cue_combo_tier(v, rng):
    k = var(rng, 0.01)
    dur = 0.3
    whoosh = filt(noise(dur, rng), "bp", sweep(1800, 9000, dur), 1.5) * env_ramp(n_of(dur), 0.18, 0.0, 0.1)
    bell = fm(2093 * k, 2.0, 1.2, 0.4, decay=0.08) * env_exp(n_of(0.4), 0.12)
    bell2 = fm(3136 * k, 1.5, 0.8, 0.3, decay=0.06) * env_exp(n_of(0.3), 0.08)
    x = mix((whoosh, 0.5), (at(bell, 0.12), 0.6), (at(bell2, 0.16), 0.3))
    return delay_fb(x, 0.14, 0.3, 0.3, taps=5)


def cue_combo_break(v, rng):
    k = var(rng, 0.04)
    dur = 0.3
    fall = osc("saw", sweep(600 * k, 120 * k, 0.26, hold=0.04), dur) * env_adsr(n_of(dur), 0.004, 0.08, 0.5, 0.18)
    fall = filt(fall, "lp", sweep(2500, 300, dur), 1.0)
    thud = lp(noise(0.2, rng), 800) * env_adsr(n_of(0.2), 0.003, 0.06, 0.4, 0.13)
    sub = osc("sine", sweep(80, 40, 0.2), 0.2) * env_exp(n_of(0.2), 0.08)
    x = mix((fall, 0.9), (thud, 0.7), (sub, 0.5))
    return sat(x, 1.8)


def cue_low_hp(v, rng):
    k = var(rng, 0.01)
    dur = 0.07
    tone = osc("sine", 880 * k, dur) * env_adsr(n_of(dur), 0.003, 0.02, 0.6, 0.04)
    harm = osc("square", 880 * k, dur) * env_adsr(n_of(dur), 0.003, 0.02, 0.6, 0.04)
    harm = lp(harm, 3000)
    click = hp(noise(0.005, rng), 4000) * env_exp(n_of(0.005), 0.0015)
    return mix((tone, 0.8), (harm, 0.12), (click, 0.2))


def cue_overdrive(v, rng):
    k = var(rng, 0.01)
    rise = osc("sine", sweep(400 * k, 1600 * k, 0.18), 0.25) * env_adsr(n_of(0.25), 0.01, 0.06, 0.6, 0.11)
    layers = [(rise, 0.7)]
    for i, f in enumerate([783.99, 1046.5, 1318.5]):
        n = osc("tri", f * k, 0.14) * env_adsr(n_of(0.14), 0.004, 0.04, 0.5, 0.09)
        layers.append((at(n, 0.08 + i * 0.05), 0.5))
    air = filt(noise(0.3, rng), "bp", sweep(800, 4500, 0.3), 1.0) * env_adsr(n_of(0.3), 0.02, 0.08, 0.5, 0.15)
    layers.append((air, 0.35))
    x = mix(*layers)
    return delay_fb(x, 0.16, 0.32, 0.35, taps=5)


def cue_overdrive_vent(v, rng):
    dur = 0.38
    steam = filt(noise(dur, rng), "bp", sweep(6000 * var(rng, 0.1), 1400, dur), 0.8) * env_adsr(n_of(dur), 0.005, 0.1, 0.5, 0.24)
    drop = osc("sine", sweep(900, 300, 0.18), 0.2) * env_exp(n_of(0.2), 0.06)
    return mix((steam, 1.0), (drop, 0.35))


def cue_power_down(v, rng):
    k = var(rng, 0.01)
    layers = []
    for i, f in enumerate([1320, 880, 660]):
        n = osc("tri", f * k, 0.12) * env_adsr(n_of(0.12), 0.004, 0.03, 0.5, 0.08)
        layers.append((at(n, i * 0.09), 0.8))
    return mix(*layers)


def cue_sector_start(v, rng):
    dur = 0.9
    layers = []
    for f in (220, 330, 440):
        s = osc("saw", f * var(rng, 0.003), 0.55, rng=rng) * env_adsr(n_of(0.55), 0.01, 0.15, 0.5, 0.34)
        s = filt(s, "lp", sweep(1200, 400, 0.5, hold=0.05), 1.0)
        layers.append((s, 0.3))
    swell = filt(noise(dur, rng), "bp", sweep(300, 3000, dur), 1.0) * env_adsr(n_of(dur), 0.6, 0.1, 0.5, 0.1)
    layers.append((swell, 0.4))
    x = mix(*layers)
    return reverb(x, 0.6, 0.3, rng=rng)


# cue -> (recipe, variants, runtime trim (linear, before sfxGain), voice cap, pitch jitter (fraction), peak dB)
CUES = {
    "laser": (cue_laser, 4, 0.38, 4, 0.04, -1.0),
    "tick": (cue_tick, 3, 0.22, 4, 0.0, -3.0),
    "impact": (cue_impact, 4, 0.5, 3, 0.04, -1.0),
    "explosion_s": (cue_explosion_s, 4, 0.5, 4, 0.05, -1.0),
    "explosion_m": (cue_explosion_m, 4, 0.55, 3, 0.05, -1.0),
    "explosion_l": (cue_explosion_l, 3, 0.5, 2, 0.04, -1.0),
    "lock": (cue_lock, 3, 0.28, 2, 0.02, -2.0),
    "lock_lost": (cue_lock_lost, 3, 0.3, 2, 0.03, -2.0),
    "error": (cue_error, 3, 0.42, 2, 0.03, -1.0),
    "pickup": (cue_pickup, 3, 0.38, 2, 0.01, -1.0),
    "shield_hit": (cue_shield_hit, 3, 0.36, 2, 0.02, -1.0),
    "shield_break": (cue_shield_break, 3, 0.45, 1, 0.02, -1.0),
    "damage": (cue_damage, 3, 0.45, 2, 0.04, -1.0),
    "alarm": (cue_alarm, 2, 0.4, 1, 0.01, -1.0),
    "segment_down": (cue_segment_down, 3, 0.48, 2, 0.03, -1.0),
    "phase_clear": (cue_phase_clear, 2, 0.45, 1, 0.01, -1.0),
    "boss_crack": (cue_boss_crack, 2, 0.5, 1, 0.03, -0.5),
    "ui_tick": (cue_ui_tick, 3, 0.18, 2, 0.01, -3.0),
    "ui_confirm": (cue_ui_confirm, 2, 0.22, 1, 0.005, -2.0),
    "ui_back": (cue_ui_back, 2, 0.22, 1, 0.005, -2.0),
    "rank_stamp": (cue_rank_stamp, 2, 0.5, 1, 0.02, -1.0),
    "banner_slam": (cue_banner_slam, 2, 0.32, 1, 0.02, -1.0),
    "surge_charge": (cue_surge_charge, 2, 0.3, 1, 0.0, -2.0),
    "surge_fire": (cue_surge_fire, 3, 0.5, 2, 0.04, -1.0),
    "combo_tier": (cue_combo_tier, 3, 0.3, 2, 0.01, -1.5),
    "combo_break": (cue_combo_break, 2, 0.5, 1, 0.03, -1.0),
    "low_hp": (cue_low_hp, 2, 0.2, 1, 0.0, -3.0),
    "overdrive": (cue_overdrive, 2, 0.35, 1, 0.005, -1.0),
    "overdrive_vent": (cue_overdrive_vent, 2, 0.28, 1, 0.02, -2.0),
    "power_down": (cue_power_down, 2, 0.3, 1, 0.005, -2.0),
    "sector_start": (cue_sector_start, 1, 0.3, 1, 0.0, -2.0),
}


def render(only=None, out=OUT_DEFAULT, preview=False):
    os.makedirs(out, exist_ok=True)
    index = {"sampleRate": SR, "peakDb": PEAK_DB, "cues": {}}
    total = 0.0
    rows = []
    for name, (fn, count, trim, cap, jitter, peak) in CUES.items():
        if only and name not in only:
            continue
        files = []
        for v in range(count):
            rng = np.random.default_rng(seed_for(f"{name}:{v}"))
            x = finish(fn(v, rng), peak)
            fname = f"{name}_{v + 1}.wav"
            write_wav(os.path.join(out, fname), x)
            dur = len(x) / SR
            total += dur
            rms = 20 * np.log10(np.sqrt(np.mean(x ** 2)) + 1e-9)
            rows.append((fname, dur, rms))
            files.append(fname)
        index["cues"][name] = {"files": files, "trim": trim, "voices": cap, "jitter": jitter}
    with open(os.path.join(out, "index.json"), "w") as fh:
        json.dump(index, fh, indent=1)
    for fname, dur, rms in rows:
        print(f"{fname:22s} {dur * 1000:7.0f} ms  rms {rms:6.1f} dBFS")
    print(f"{len(rows)} files, {total:.1f} s of audio -> {out}")
    if preview:
        sheet(out, [r[0] for r in rows])


def sheet(out, files):
    """Spectrogram contact sheet via ffmpeg showspectrumpic (PIL assembles), for eyeballing the set."""
    import subprocess
    import tempfile

    try:
        from PIL import Image, ImageDraw
    except ImportError:
        print("preview: pillow missing, skipped")
        return
    tiles = []
    with tempfile.TemporaryDirectory() as tmp:
        for f in files:
            png = os.path.join(tmp, f + ".png")
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", os.path.join(out, f), "-lavfi", "showspectrumpic=s=360x140:legend=0:color=fiery:scale=log", png], check=True)
            tiles.append((f, Image.open(png).convert("RGB")))
    cols = 5
    rows = (len(tiles) + cols - 1) // cols
    W, H = 360, 156
    img = Image.new("RGB", (cols * W, rows * H), (8, 8, 12))
    d = ImageDraw.Draw(img)
    for i, (f, t) in enumerate(tiles):
        x, y = (i % cols) * W, (i // cols) * H
        img.paste(t, (x, y + 16))
        d.text((x + 4, y + 2), f, fill=(230, 230, 240))
    path = os.path.join(HERE, "preview_sfx.png")
    img.save(path)
    print("preview ->", path)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", help="comma-separated cue names")
    ap.add_argument("--out", default=OUT_DEFAULT)
    ap.add_argument("--preview", action="store_true", help="write tools/audio/preview_sfx.png (needs ffmpeg + pillow)")
    a = ap.parse_args()
    render(set(a.only.split(",")) if a.only else None, a.out, a.preview)
