"""Original score for the Mare Hackematis film, synthesised from scratch.

No samples and no third-party audio: sine partials, envelopes and a noise
reverb, all computed here with numpy. Two runs give the same file.

    python3 audio/score.py            ->  public/audio/score-30s.wav

120 BPM, D minor, 30.0 s. Scene cuts fall on beats (3, 7, 12, 16, 19, 23, 25.5
and 28 s); the cue list below follows the film scene by scene.
"""

import pathlib
import struct
import sys
import wave

import numpy as np

SR = 48_000
DUR = 30.0
N = int(SR * DUR)
BEAT = 0.5
rng = np.random.default_rng(2026)


def hz(midi):
    return 440.0 * 2 ** ((midi - 69) / 12)


def place(mix, start, sig, pan=0.0, gain=1.0):
    """Adds a mono signal to the stereo mix at `start` seconds (equal-power pan)."""
    i = int(round(start * SR))
    if i >= N:
        return
    sig = sig[: N - i]
    left = np.cos((pan + 1) * np.pi / 4) * gain
    right = np.sin((pan + 1) * np.pi / 4) * gain
    mix[0, i : i + len(sig)] += sig * left
    mix[1, i : i + len(sig)] += sig * right


def ramp(n, attack, release):
    """Raised-cosine fade in and out, in seconds: never a click."""
    env = np.ones(n)
    a = max(1, min(n // 2, int(attack * SR)))
    r = max(1, min(n - a, int(release * SR)))
    env[:a] = 0.5 - 0.5 * np.cos(np.pi * np.arange(a) / a)
    env[n - r :] *= 0.5 + 0.5 * np.cos(np.pi * np.arange(r) / r)
    return env


def pad(notes, dur, attack=0.9, release=1.4, bright=1.0, swell=None):
    """Warm sustained chord: a few soft partials per note, two detuned voices."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    out = np.zeros((2, n))
    for note in notes:
        f = hz(note)
        for side, cents in ((0, -4.0), (1, 4.0)):
            fv = f * 2 ** (cents / 1200)
            phase = rng.uniform(0, 2 * np.pi)
            voice = np.zeros(n)
            for k in range(1, 7):
                if fv * k > 5000:
                    break
                voice += np.sin(2 * np.pi * fv * k * t + phase * k) / k ** (2.4 - 0.7 * bright)
            # Slow, shallow movement so the chord breathes instead of droning.
            voice *= 1 + 0.05 * np.sin(2 * np.pi * 0.13 * t + phase)
            out[side] += voice / len(notes)
    env = ramp(n, attack, release)
    if swell is not None:
        env = env * np.interp(t, [p[0] for p in swell], [p[1] for p in swell])
    return out * env


def pluck(note, dur=0.9, tau=0.22):
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = hz(note)
    sig = np.sin(2 * np.pi * f * t) + 0.32 * np.sin(2 * np.pi * 2 * f * t) * np.exp(-t / 0.08) + 0.1 * np.sin(2 * np.pi * 3 * f * t) * np.exp(-t / 0.04)
    return sig * np.exp(-t / tau) * ramp(n, 0.008, 0.12)


def thump(dur=0.7, f0=82.0, f1=46.0, tau=0.16):
    """A felt beat: a short falling sine. Not a kick drum."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    freq = f1 + (f0 - f1) * np.exp(-t / 0.05)
    return np.sin(2 * np.pi * np.cumsum(freq) / SR) * np.exp(-t / tau) * ramp(n, 0.006, 0.2)


def bell(note, dur=4.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = hz(note)
    sig = np.zeros(n)
    for ratio, amp, tau in ((1.0, 1.0, 1.5), (2.0, 0.35, 0.9), (2.76, 0.22, 0.55), (5.4, 0.08, 0.25)):
        sig += amp * np.sin(2 * np.pi * f * ratio * t) * np.exp(-t / tau)
    return sig * ramp(n, 0.01, 0.6)


def low_note(note, dur=4.5, tau=1.5):
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = hz(note)
    sig = np.sin(2 * np.pi * f * t) + 0.5 * np.sin(2 * np.pi * 2 * f * t) * np.exp(-t / 0.9) + 0.18 * np.sin(2 * np.pi * 3 * f * t) * np.exp(-t / 0.5)
    return sig * np.exp(-t / tau) * ramp(n, 0.03, 1.0)


def reverb(mix, seconds=2.4, level=0.24):
    """Convolution with a decaying, darkened stereo noise burst."""
    n = int(seconds * SR)
    t = np.arange(n) / SR
    out = np.zeros_like(mix)
    size = 1 << int(np.ceil(np.log2(N + n)))
    for ch in range(2):
        noise = rng.standard_normal(n)
        kernel = np.hanning(96)
        noise = np.convolve(noise, kernel / kernel.sum(), mode="same")  # takes the hiss out of the tail
        ir = noise * np.exp(-t / (seconds / 6.9)) * ramp(n, 0.012, 0.3)
        ir /= np.sqrt(np.sum(ir**2))
        wet = np.fft.irfft(np.fft.rfft(mix[ch], size) * np.fft.rfft(ir, size), size)[:N]
        out[ch] = wet
    return mix + level * out


def band_limit(mix, low=32.0, high=15_000.0):
    """Zero-phase high-pass and low-pass: no rumble, nothing near Nyquist."""
    spec = np.fft.rfft(mix, axis=1)
    f = np.fft.rfftfreq(mix.shape[1], 1 / SR)
    hp = 1 / np.sqrt(1 + (low / np.maximum(f, 1e-6)) ** 8)
    lp = 1 / np.sqrt(1 + (f / high) ** 8)
    return np.fft.irfft(spec * hp * lp, mix.shape[1], axis=1)


# --- Chords (MIDI notes) and the pulse that goes with each -------------------
DM9 = [38, 45, 50, 53, 57, 64]
BB = [34, 41, 46, 50, 53, 57]
FADD9 = [41, 48, 53, 57, 60, 67]
CADD9 = [36, 43, 48, 52, 55, 62]
DOPEN = [38, 45, 50, 57, 64]
PULSE = {"dm": [62, 69, 65, 69], "bb": [62, 65, 70, 65], "f": [60, 65, 69, 65], "c": [64, 67, 72, 67]}

mix = np.zeros((2, N))

# 0.0-3.0  Text on black: a low fifth, barely there.
drone = pad([38, 45], 4.2, attack=2.2, release=1.6, bright=0.2)
place(mix, 0.0, drone[0], -0.3, 0.15)
place(mix, 0.0, drone[1], 0.3, 0.15)

# Pads, one per scene, overlapping so that no cut is a hole.
for start, dur, chord, gain, kw in (
    (3.0, 4.6, DM9, 0.50, dict(attack=0.5, release=1.2, bright=0.8)),
    # The app is computing: the same chord brightens until the map arrives at 9.5 s.
    (7.0, 5.6, DM9, 0.52, dict(attack=0.8, release=1.2, bright=1.2, swell=[(0, 0.75), (2.5, 1.0), (5.6, 0.9)])),
    (12.0, 4.6, BB, 0.52, dict(attack=0.5, release=1.2, bright=0.9)),
    (16.0, 3.6, FADD9, 0.50, dict(attack=0.5, release=1.2, bright=0.9)),
    # First person on the Moon: wide and airy, nothing else.
    (19.0, 4.6, [38, 45, 53, 60, 64], 0.50, dict(attack=1.0, release=1.4, bright=0.6)),
    (23.0, 2.7, CADD9, 0.50, dict(attack=0.4, release=0.5, bright=0.9)),
    (28.0, 1.86, DOPEN, 0.62, dict(attack=0.05, release=1.5, bright=1.0)),
):
    stereo = pad(chord, dur, **kw)
    place(mix, start, stereo[0], -0.6, gain)
    place(mix, start, stereo[1], 0.6, gain)

# Eighth-note pulse: on from 3.0 to 19.0 and again from 23.0 to 25.5.
for start, end, key in ((3.0, 12.0, "dm"), (12.0, 16.0, "bb"), (16.0, 19.0, "f"), (23.0, 25.5, "c")):
    step = 0
    t = start
    while t < end - 1e-6:
        note = PULSE[key][step % 4]
        accent = 1.0 if step % 4 == 0 else 0.72
        pan = -0.35 if step % 2 == 0 else 0.35
        place(mix, t, pluck(note), pan, 0.20 * accent)
        if t + 0.375 < end + 0.2:  # one dotted-eighth echo, quieter and on the other side
            place(mix, t + 0.375, pluck(note, tau=0.16), -pan, 0.07 * accent)
        t += BEAT / 2
        step += 1

# Beats on the cuts.
for t, gain in ((3.0, 0.80), (7.0, 0.55), (12.0, 0.60), (16.0, 0.55), (23.0, 0.50), (28.0, 0.60)):
    place(mix, t, thump(), 0.0, gain)

# 9.5 s: the scored map arrives. A soft bell on the chord, not a hit.
place(mix, 9.5, bell(74, 3.5), -0.15, 0.16)
place(mix, 9.5, bell(81, 3.5), 0.2, 0.11)
# 21.6 s: the Earth comes into the telephoto.
place(mix, 21.6, bell(81, 4.5), 0.1, 0.17)
place(mix, 21.62, bell(88, 4.0), -0.25, 0.06)
# 25.5 s: a number alone on black. One deep note and air.
place(mix, 25.5, low_note(26, 2.45, tau=0.9), 0.0, 0.60)
place(mix, 25.5, low_note(38, 2.45, tau=0.8), 0.0, 0.30)
place(mix, 25.5, bell(62, 2.4), 0.0, 0.10)

mix = reverb(mix)
mix = band_limit(mix)

# Everything is silent 150 ms before the end: the tail is inside the 30 s.
end = int((DUR - 0.15) * SR)
fade = int(1.2 * SR)
mix[:, end - fade : end] *= 0.5 + 0.5 * np.cos(np.pi * np.arange(fade) / fade)
mix[:, end:] = 0.0
mix[:, : int(0.02 * SR)] *= np.linspace(0, 1, int(0.02 * SR))

gain_db = float(sys.argv[2]) if len(sys.argv) > 2 else None
peak = np.max(np.abs(mix))
mix = mix / peak * 10 ** (-3.0 / 20) if gain_db is None else mix * 10 ** (gain_db / 20)
if np.max(np.abs(mix)) > 10 ** (-1.5 / 20):
    raise SystemExit(f"peak {20 * np.log10(np.max(np.abs(mix))):.2f} dBFS is above -1.5 dBFS")

out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else pathlib.Path(__file__).resolve().parent.parent / "public" / "audio" / "score-30s.wav")
out.parent.mkdir(parents=True, exist_ok=True)
pcm = np.clip(np.round(mix.T * (2**23 - 1)), -(2**23), 2**23 - 1).astype(np.int32)
with wave.open(str(out), "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(3)
    w.setframerate(SR)
    w.writeframes(b"".join(struct.pack("<i", int(v))[:3] for v in pcm.reshape(-1)))
print(f"{out}  {N / SR:.3f} s  peak {20 * np.log10(np.max(np.abs(mix))):.2f} dBFS  raw peak before gain {peak:.3f}")
