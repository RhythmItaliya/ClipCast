"""Pure-Python music analysis + mixing helpers for the ClipCast mixer.

Kept as its own module (like the processor's captions.py) so the musical logic
— BPM detection, Camelot harmonic matching, tempo/key alignment, and the final
mix — is unit-testable on a CPU without a Modal/GPU deploy. Nothing here touches
S3, Modal, or the network. See docs/15-mashup-mixing-mechanics.md for the "why"
behind every step; the step numbers in that doc match the log lines below.
"""

from __future__ import annotations

import subprocess
from dataclasses import dataclass

import librosa
import numpy as np
import pyloudnorm as pyln
import soundfile as sf
from scipy.ndimage import uniform_filter1d
from scipy.signal import butter, sosfilt

SAMPLE_RATE = 44100  # music, not the 16 kHz speech rate the processor uses


# ── Musical analysis ─────────────────────────────────────────────────────────

# Krumhansl-Schmuckler key profiles (major/minor), used to score which key a
# track's averaged chroma best fits. Cheap and dependency-light; docs/15 notes
# Essentia as the higher-accuracy upgrade.
_MAJOR_PROFILE = np.array(
    [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
)
_MINOR_PROFILE = np.array(
    [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
)
_PITCHES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

# Camelot wheel: (pitch-class index, is_minor) -> code. Minor = "A", major = "B".
# Two tracks mix cleanly when codes are equal, ±1 on the number, or same number
# with the letter swapped (relative major/minor).
_CAMELOT = {
    ("C", False): "8B", ("C#", False): "3B", ("D", False): "10B",
    ("D#", False): "5B", ("E", False): "12B", ("F", False): "7B",
    ("F#", False): "2B", ("G", False): "9B", ("G#", False): "4B",
    ("A", False): "11B", ("A#", False): "6B", ("B", False): "1B",
    ("A", True): "8A", ("A#", True): "3A", ("B", True): "10A",
    ("C", True): "5A", ("C#", True): "12A", ("D", True): "7A",
    ("D#", True): "2A", ("E", True): "9A", ("F", True): "4A",
    ("F#", True): "11A", ("G", True): "6A", ("G#", True): "1A",
}


@dataclass
class TrackAnalysis:
    bpm: float
    beat_times: list[float]  # seconds; first beat is used as the grid anchor
    key: str  # e.g. "F#"
    is_minor: bool
    camelot: str  # e.g. "11A"


def load_audio(path: str, sr: int = SAMPLE_RATE) -> tuple[np.ndarray, int]:
    """Mono float32 for analysis. Mixing loads stereo separately via soundfile."""
    y, _ = librosa.load(path, sr=sr, mono=True)
    return y.astype(np.float32), sr


def detect_bpm_and_beats(y: np.ndarray, sr: int) -> tuple[float, list[float]]:
    """Global tempo + beat grid (docs/15 step 2)."""
    tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr, trim=False)
    beat_times = librosa.frames_to_time(beat_frames, sr=sr)
    bpm = float(np.atleast_1d(tempo)[0])
    return bpm, [float(t) for t in beat_times]


def detect_key(y: np.ndarray, sr: int) -> tuple[str, bool]:
    """Best-fit key via Krumhansl-Schmuckler correlation (docs/15 step 3)."""
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
    profile = chroma.mean(axis=1)
    if profile.sum() > 0:
        profile = profile / profile.sum()

    best_score, best_pitch, best_minor = -np.inf, "C", False
    for shift in range(12):
        rotated = np.roll(profile, -shift)
        for is_minor, ref in ((False, _MAJOR_PROFILE), (True, _MINOR_PROFILE)):
            score = float(np.corrcoef(rotated, ref)[0, 1])
            if score > best_score:
                best_score, best_pitch, best_minor = score, _PITCHES[shift], is_minor
    return best_pitch, best_minor


def analyze_track(path: str) -> TrackAnalysis:
    y, sr = load_audio(path)
    bpm, beats = detect_bpm_and_beats(y, sr)
    key, is_minor = detect_key(y, sr)
    return TrackAnalysis(
        bpm=bpm,
        beat_times=beats,
        key=key,
        is_minor=is_minor,
        camelot=_CAMELOT[(key, is_minor)],
    )


def rms_energy(path: str) -> float:
    y, _ = sf.read(path, dtype="float32")
    if y.ndim > 1:
        y = y.mean(axis=1)
    return float(np.sqrt(np.mean(np.square(y)))) if len(y) else 0.0


def stem_balance(vocal_path: str, instrumental_path: str) -> dict:
    """Cheap role-detection signal after Demucs: a vocal-heavy source has a
    high vocal_ratio; a clean bed has stronger no-vocals energy. The Modal app
    uses this to auto-pick roles for N-source mixes."""
    vocal = rms_energy(vocal_path)
    instrumental = rms_energy(instrumental_path)
    total = vocal + instrumental
    vocal_ratio = vocal / total if total > 0 else 0.0
    instrumental_ratio = instrumental / total if total > 0 else 0.0
    return {
        "vocal_energy": vocal,
        "instrumental_energy": instrumental,
        "vocal_ratio": vocal_ratio,
        "instrumental_ratio": instrumental_ratio,
    }


def audio_features(y: np.ndarray, sr: int, bpm: float) -> dict:
    """Compact source profile for style decisions before mixing."""
    if y.ndim > 1:
        y = y.mean(axis=1)
    if len(y) == 0:
        return {
            "bpm": bpm,
            "rms": 0.0,
            "centroid": 0.0,
            "bandwidth": 0.0,
            "rolloff": 0.0,
            "zcr": 0.0,
            "onset_strength": 0.0,
        }
    onset_env = librosa.onset.onset_strength(y=y, sr=sr)
    return {
        "bpm": float(bpm),
        "rms": float(np.sqrt(np.mean(np.square(y)))),
        "centroid": float(np.mean(librosa.feature.spectral_centroid(y=y, sr=sr))),
        "bandwidth": float(np.mean(librosa.feature.spectral_bandwidth(y=y, sr=sr))),
        "rolloff": float(np.mean(librosa.feature.spectral_rolloff(y=y, sr=sr))),
        "zcr": float(np.mean(librosa.feature.zero_crossing_rate(y))),
        "onset_strength": float(np.mean(onset_env)) if len(onset_env) else 0.0,
    }


def infer_genre(y: np.ndarray, sr: int, bpm: float) -> str:
    """Small deterministic genre hint for auto mode and summaries. This is not
    a classifier replacement; it gives the AI/composer a useful first label."""
    features = audio_features(y, sr, bpm)
    rms = features["rms"]
    centroid = features["centroid"]
    bandwidth = features["bandwidth"]
    zcr = features["zcr"]
    onset = features["onset_strength"]
    if bpm <= 0 and rms < 0.04:
        return "ambient"
    if 60 <= bpm <= 96 and centroid < 2300 and onset < 1.5:
        return "lofi"
    if 82 <= bpm <= 112 and 1800 <= centroid <= 3400 and bandwidth > 1800:
        return "bollywood/pop"
    if 76 <= bpm <= 105 and onset >= 1.2 and centroid < 3000:
        return "hip-hop"
    if 95 <= bpm <= 118 and centroid < 2800:
        return "bollywood/pop"
    if 118 <= bpm <= 132 and onset >= 1.0:
        return "house"
    if 132 <= bpm <= 155 and zcr > 0.055:
        return "trap"
    if centroid > 3200 and rms > 0.06:
        return "rock/pop"
    return "pop"


# User-forcable target lanes. Keys match the frontend genre dropdown; each
# style string carries the keyword style_to_kit() maps to a drum kit, so a
# forced genre composes the right beat. avg source BPM is ignored on purpose —
# a forced genre should sound like that genre, not the source tempo.
_GENRE_LANES: dict[str, dict] = {
    "lofi": {"style": "lofi remix", "target_bpm": 84.0, "transform_strength": "subtle"},
    "ambient": {"style": "ambient cinematic remix", "target_bpm": 78.0, "transform_strength": "subtle"},
    "cinematic": {"style": "ambient cinematic remix", "target_bpm": 90.0, "transform_strength": "subtle"},
    "trap": {"style": "trap-pop remix", "target_bpm": 140.0, "transform_strength": "max"},
    "house": {"style": "house remix", "target_bpm": 124.0, "transform_strength": "transformed"},
    "pop": {"style": "pop fusion remix", "target_bpm": 112.0, "transform_strength": "transformed"},
    "bollywood": {"style": "bollywood hip-hop fusion", "target_bpm": 96.0, "transform_strength": "transformed"},
    "rock": {"style": "rock remix", "target_bpm": 120.0, "transform_strength": "transformed"},
}


def decide_mix_style(source_profiles: list[dict], user_genre: str | None = None) -> dict:
    """Choose the target production lane before rendering.

    This is intentionally deterministic and cheap: it lets the mixer decide
    whether the final should lean lofi/ambient/hip-hop/house/Bollywood-fusion
    before any stems are joined. Gemini still handles section arrangement later.

    ``user_genre`` (from the UI dropdown) forces the lane; "auto"/None/unknown
    falls back to detecting the lane from the source profiles.
    """
    forced = _GENRE_LANES.get((user_genre or "").strip().lower())
    if forced is not None:
        return dict(forced)

    genres = [str(p.get("genre", "unknown")) for p in source_profiles]
    bpms = [float(p.get("bpm", 0.0)) for p in source_profiles if float(p.get("bpm", 0.0)) > 0]
    avg_bpm = float(np.median(bpms)) if bpms else 110.0
    has_bollywood = any("bollywood" in g for g in genres)
    has_house = any(g == "house" for g in genres)
    has_trap = any(g == "trap" for g in genres)
    has_hiphop = any(g == "hip-hop" for g in genres)
    has_lofi = any(g == "lofi" for g in genres)
    has_ambient = any(g == "ambient" for g in genres)

    if has_bollywood and (has_house or avg_bpm >= 118):
        return {"style": "bollywood house fusion", "target_bpm": 124.0, "transform_strength": "max"}
    if has_bollywood and (has_hiphop or 82 <= avg_bpm <= 106):
        return {"style": "bollywood hip-hop fusion", "target_bpm": 96.0, "transform_strength": "transformed"}
    if has_bollywood and (has_lofi or has_ambient or avg_bpm < 90):
        return {"style": "lofi bollywood fusion", "target_bpm": 86.0, "transform_strength": "transformed"}
    if has_trap:
        return {"style": "trap-pop remix", "target_bpm": 140.0, "transform_strength": "max"}
    if has_house:
        return {"style": "house remix", "target_bpm": 124.0, "transform_strength": "transformed"}
    if has_hiphop:
        return {"style": "hip-hop remix", "target_bpm": 94.0, "transform_strength": "transformed"}
    if has_ambient:
        return {"style": "ambient cinematic remix", "target_bpm": 78.0, "transform_strength": "subtle"}
    if has_lofi:
        return {"style": "lofi remix", "target_bpm": 84.0, "transform_strength": "subtle"}
    if avg_bpm >= 128:
        return {"style": "dance-pop remix", "target_bpm": 124.0, "transform_strength": "transformed"}
    return {"style": "pop fusion remix", "target_bpm": max(92.0, min(116.0, avg_bpm)), "transform_strength": "transformed"}


# ── Harmonic (Camelot) matching ──────────────────────────────────────────────

def _camelot_parts(code: str) -> tuple[int, str]:
    return int(code[:-1]), code[-1]


def camelot_compatible(a: str, b: str) -> bool:
    na, la = _camelot_parts(a)
    nb, lb = _camelot_parts(b)
    if la == lb:  # same letter: equal or ±1 (12-wrap)
        return na == nb or (na % 12) + 1 == nb or (nb % 12) + 1 == na
    return na == nb  # relative major/minor swap


def semitones_to_compatible(vocal: TrackAnalysis, bed: TrackAnalysis) -> int:
    """Smallest pitch shift (in semitones, -6..+6) that lands the vocal on a key
    compatible with the bed. 0 if already compatible or nothing qualifies
    (docs/15 step 8 — smallest move keeps the voice natural)."""
    if camelot_compatible(vocal.camelot, bed.camelot):
        return 0
    base = _PITCHES.index(vocal.key)
    for shift in sorted(range(-6, 7), key=abs):
        if shift == 0:
            continue
        shifted_pitch = _PITCHES[(base + shift) % 12]
        shifted_camelot = _CAMELOT[(shifted_pitch, vocal.is_minor)]
        if camelot_compatible(shifted_camelot, bed.camelot):
            return shift
    return 0


def tempo_ratio(source_bpm: float, target_bpm: float) -> float:
    """Stretch factor to move source→target, folding to half/double time when
    the naive ratio is extreme so we stretch the smallest amount (docs/15
    step 7)."""
    if source_bpm <= 0 or target_bpm <= 0:
        return 1.0
    ratio = target_bpm / source_bpm
    while ratio > 1.4:
        ratio /= 2.0
    while ratio < 0.71:
        ratio *= 2.0
    return ratio


# ── Loudness + write ─────────────────────────────────────────────────────────

def normalize_loudness(y: np.ndarray, sr: int, target_lufs: float = -14.0) -> np.ndarray:
    """EBU R128 to a social-media target (docs/15 step 14)."""
    meter = pyln.Meter(sr)
    loudness = meter.integrated_loudness(y)
    if not np.isfinite(loudness):
        return y
    normalized = pyln.normalize.loudness(y, loudness, target_lufs)
    peak = np.max(np.abs(normalized))
    if peak > 1.0:  # guard against inter-sample clipping after the gain
        normalized = normalized / peak * 0.98
    return normalized


def reference_master(target_path: str, reference_path: str, out_path: str) -> bool:
    """Reference-master the mix with Matchering so it sounds "released": match the
    target's EQ / RMS / peak / stereo-width to a professionally-mastered
    reference (we pass a source song's own original recording). Returns True on
    success; on any failure the caller should fall back to normalize_loudness."""
    try:
        import matchering as mg

        # Quiet Matchering's verbose default logging; keep failures visible.
        mg.log(warning_handler=lambda *_a, **_k: None, info_handler=lambda *_a, **_k: None)
        mg.process(target=target_path, reference=reference_path, results=[mg.pcm16(out_path)])
        return True
    except Exception as e:  # noqa: BLE001 — mastering must never break the render
        print(f"matchering reference master unavailable, using loudnorm: {e}")
        return False


def write_wav(y: np.ndarray, sr: int, path: str) -> None:
    sf.write(path, y, sr, subtype="PCM_16")


def encode_mp3(wav_path: str, mp3_path: str) -> None:
    subprocess.run(
        ["ffmpeg", "-y", "-i", wav_path, "-codec:a", "libmp3lame", "-b:a", "256k", mp3_path],
        check=True,
        capture_output=True,
    )


# ── The join: vocal-over-instrumental mashup ─────────────────────────────────

def _to_stereo(y: np.ndarray) -> np.ndarray:
    if y.ndim == 1:
        return np.stack([y, y], axis=1)
    return y


# ── DJ treatment: sections, filters, ducking, transitions, arrangement ────────
# The pieces the AI arrangement brain composes. All deterministic + CPU-testable
# (the AI *chooses* the plan in main.py; these *apply* it). See docs/16.

def _db(db: float) -> float:
    return float(10 ** (db / 20.0))


# Starting point for the rating-feedback loop; each retry nudges these.
DEFAULT_MIX_PARAMS = {
    "vocal_gain_db": -1.0,
    "bed_gain_db": -3.0,
    "duck_db": -3.0,  # how far the bed drops under the vocal (sidechain feel)
    "intro_build_sec": 0.0,
}


def highpass(y: np.ndarray, sr: int, cutoff_hz: float, order: int = 4) -> np.ndarray:
    sos = butter(order, cutoff_hz / (sr / 2), btype="highpass", output="sos")
    return sosfilt(sos, y, axis=0).astype(np.float32)


def lowpass(y: np.ndarray, sr: int, cutoff_hz: float, order: int = 4) -> np.ndarray:
    sos = butter(order, cutoff_hz / (sr / 2), btype="lowpass", output="sos")
    return sosfilt(sos, y, axis=0).astype(np.float32)


# ── Genre-aware "composer": synth drums + sub-bass + instrument stabs ─────────
# The user asked for real-producer-style production: match the genre, then add
# the beats and instruments that genre uses — tabla for Bollywood, 808s + hat
# rolls for trap, four-on-the-floor for house, etc. Everything is synthesized
# with numpy (no samples → no sample-licensing) and locked to the detected beat
# grid, so it plays in time with the source. Deterministic and CPU-testable.

_SYNTH_RNG = np.random.default_rng(20260713)
_KIT_GAINS = {"subtle": 0.55, "transformed": 0.9, "max": 1.25}


def _decayed_noise(n: int, sr: int, decay: float) -> np.ndarray:
    x = _SYNTH_RNG.standard_normal(max(1, n)).astype(np.float32)
    env = np.exp(-np.arange(max(1, n), dtype=np.float32) / sr * decay)
    return x * env


def _synth_kick(sr: int, base: float = 50.0, click: float = 110.0, length: float = 0.20, decay: float = 20.0) -> np.ndarray:
    t = np.arange(max(1, int(length * sr)), dtype=np.float32) / sr
    freq = base + click * np.exp(-t * 48.0)  # pitch drops from click to sub
    return (np.sin(2 * np.pi * np.cumsum(freq) / sr) * np.exp(-t * decay)).astype(np.float32)


def _synth_sub(sr: int, freq: float = 55.0, length: float = 0.45, decay: float = 6.0) -> np.ndarray:
    t = np.arange(max(1, int(length * sr)), dtype=np.float32) / sr
    f = freq * (1.0 + 0.4 * np.exp(-t * 25.0))
    return (np.sin(2 * np.pi * np.cumsum(f) / sr) * np.exp(-t * decay)).astype(np.float32)


def _synth_snare(sr: int, length: float = 0.18, tone_hz: float = 190.0) -> np.ndarray:
    t = np.arange(max(1, int(length * sr)), dtype=np.float32) / sr
    body = np.sin(2 * np.pi * tone_hz * t) * np.exp(-t * 32.0)
    return (0.5 * body + 0.8 * _decayed_noise(len(t), sr, 28.0)).astype(np.float32)


def _synth_clap(sr: int, length: float = 0.20) -> np.ndarray:
    n = max(1, int(length * sr))
    out = np.zeros(n, dtype=np.float32)
    for d in (0.0, 0.008, 0.016):  # three quick bursts = a clap
        s = int(d * sr)
        out[s:] += _decayed_noise(n - s, sr, 60.0)
    return out


def _synth_hat(sr: int, length: float = 0.05, decay: float = 90.0) -> np.ndarray:
    return highpass(_decayed_noise(max(1, int(length * sr)), sr, decay)[:, None], sr, 7000.0)[:, 0]


def _synth_tabla(sr: int, freq: float = 250.0, length: float = 0.16) -> np.ndarray:
    t = np.arange(max(1, int(length * sr)), dtype=np.float32) / sr
    f = freq * (1.0 + 1.5 * np.exp(-t * 60.0))  # pitched "tun"
    return (np.sin(2 * np.pi * np.cumsum(f) / sr) * np.exp(-t * 22.0)).astype(np.float32)


def _synth_stab(sr: int, root_pc: int, is_minor: bool, length: float = 0.35, base_hz: float = 220.0) -> np.ndarray:
    """A soft triad pluck in the song's key — the 'instrument' a composer adds."""
    t = np.arange(max(1, int(length * sr)), dtype=np.float32) / sr
    third = 3 if is_minor else 4
    root = base_hz * (2 ** (root_pc / 12.0))
    sig = np.zeros(len(t), dtype=np.float32)
    for semi in (0, third, 7):  # root / third / fifth
        sig += np.sin(2 * np.pi * root * (2 ** (semi / 12.0)) * t)
    env = np.exp(-t * 5.0) * (1.0 - np.exp(-t * 80.0))  # pluck attack + decay
    return (sig / 3.0 * env).astype(np.float32)


def style_to_kit(label: str) -> str:
    """Map a style/genre label to the drum-kit family to compose with."""
    s = (label or "").lower()
    for key in ("trap", "house", "hip-hop", "lofi", "bollywood", "ambient", "rock"):
        if key in s:
            return "hiphop" if key == "hip-hop" else key
    return "pop"


def compose_genre_layer(
    n_samples: int,
    sr: int,
    beat_times: list[float],
    genre: str,
    strength: str = "transformed",
    key_root: int = 0,
    is_minor: bool = True,
) -> np.ndarray:
    """Build a genre-appropriate drums + sub-bass + stab layer locked to the beat
    grid. Returns a stereo array of ``n_samples``. ``clean`` strength = silent."""
    layer = np.zeros((max(1, n_samples), 2), dtype=np.float32)
    if n_samples <= 0 or strength in {"clean", "none", "off"}:
        return layer
    g = _KIT_GAINS.get(strength, 0.9)
    kit = style_to_kit(genre)

    beats = [b for b in beat_times if 0 <= b * sr < n_samples][:2048]
    if len(beats) < 2:  # no usable grid → steady 100 BPM fallback
        beats = list(np.arange(0.0, n_samples / sr, 0.6))

    kick = _to_stereo(_synth_kick(sr))
    snare = _to_stereo(_synth_snare(sr))
    clap = _to_stereo(_synth_clap(sr))
    hat = _to_stereo(_synth_hat(sr))
    ohat = _to_stereo(_synth_hat(sr, length=0.13, decay=26.0))
    tabla = _to_stereo(_synth_tabla(sr))
    root_low = 40.0 * (2 ** ((key_root % 12) / 12.0))  # sub in the song's key
    sub = _to_stereo(_synth_sub(sr, freq=root_low))
    stab = _to_stereo(_synth_stab(sr, key_root, is_minor))

    def put(sample: np.ndarray, at_sec: float, gain: float) -> None:
        s = int(at_sec * sr)
        if s < 0 or s >= n_samples:
            return
        e = min(n_samples, s + sample.shape[0])
        layer[s:e] += sample[: e - s] * gain

    for i, bt in enumerate(beats):
        pos = i % 4
        step = (beats[i + 1] - bt) if i + 1 < len(beats) else 0.5
        half, quarter = bt + step / 2.0, bt + step / 4.0

        if kit == "house":
            put(kick, bt, 1.0 * g)
            put(sub, bt, 0.7 * g)
            if pos in (1, 3):
                put(clap, bt, 0.8 * g)
            put(ohat, half, 0.5 * g)
            if pos == 0:
                put(stab, bt, 0.35 * g)
        elif kit == "trap":
            if pos in (0, 2):
                put(kick, bt, 1.0 * g)
                put(sub, bt, 0.9 * g)
            if pos in (1, 3):
                put(snare, bt, 0.9 * g)
            for k in range(4):  # fast hat roll
                put(hat, bt + step * k / 4.0, (0.5 if k % 2 else 0.3) * g)
        elif kit == "hiphop":
            if pos in (0, 2):
                put(kick, bt, 0.95 * g)
                put(sub, bt, 0.7 * g)
            if pos in (1, 3):
                put(snare, bt, 0.85 * g)
            put(hat, bt, 0.4 * g)
            put(hat, half, 0.3 * g)
        elif kit == "bollywood":
            put(tabla, bt, 0.9 * g)
            put(tabla, half, 0.5 * g)
            if pos in (1, 3):
                put(clap, bt, 0.6 * g)
            put(kick, bt, 0.4 * g)
            if pos == 0:
                put(stab, bt, 0.4 * g)
        elif kit == "lofi":
            if pos in (0, 2):
                put(kick, bt, 0.6 * g)
            if pos in (1, 3):
                put(snare, bt, 0.5 * g)
            put(hat, half, 0.25 * g)
            if pos == 0:
                put(stab, bt, 0.3 * g)
        elif kit == "ambient":
            if pos == 0:
                put(stab, bt, 0.4 * g)  # pads only, no drums
        else:  # pop / rock
            if pos in (0, 2):
                put(kick, bt, 0.8 * g)
            if pos in (1, 3):
                put(snare, bt, 0.8 * g)
            put(hat, half, 0.35 * g)
            put(hat, quarter, 0.2 * g)

    peak = float(np.max(np.abs(layer))) if layer.size else 0.0
    if peak > 0.98:
        layer = layer / peak * 0.98
    return layer.astype(np.float32)


def reproduce_bed(
    bed: np.ndarray,
    sr: int,
    beat_times: list[float],
    genre: str = "pop",
    strength: str = "transformed",
    key_root: int = 0,
    is_minor: bool = True,
) -> np.ndarray:
    """Re-produce the instrumental like a composer would: clear the low end, then
    add a genre-matched drum kit + sub-bass + instrument stabs on the beat grid,
    with light sidechain pump for glue. Not legal protection — recognisable
    melodies/vocals can still carry rights."""
    b = _to_stereo(np.asarray(bed, dtype=np.float32))
    if b.size == 0 or strength in {"clean", "none", "off"}:
        return b
    hp = {"subtle": 90.0, "transformed": 130.0, "max": 170.0}.get(strength, 130.0)
    bed_gain = {"subtle": 0.9, "transformed": 0.82, "max": 0.72}.get(strength, 0.82)
    pump_depth = {"subtle": 0.06, "transformed": 0.11, "max": 0.16}.get(strength, 0.11)

    shaped = highpass(b, sr, hp) * bed_gain
    layer = compose_genre_layer(shaped.shape[0], sr, beat_times, genre, strength, key_root, is_minor)
    out = shaped + layer

    pump = np.ones((out.shape[0], 1), dtype=np.float32)
    for bt in beat_times:
        s = int(bt * sr)
        if 0 <= s < out.shape[0]:
            e = min(out.shape[0], s + int(0.18 * sr))
            pump[s:e, 0] = np.minimum(pump[s:e, 0], np.linspace(1.0 - pump_depth, 1.0, e - s, dtype=np.float32))
    out = out * pump
    peak = float(np.max(np.abs(out))) if out.size else 0.0
    if peak > 0.98:
        out = out / peak * 0.98
    return out.astype(np.float32)


# ── Neural bed blend + melody re-instrumentation (docs/14 phases 2-3) ─────────
# The FluidSynth General MIDI soundfont installed via apt (fluid-soundfont-gm).
SOUNDFONT_PATH = "/usr/share/sounds/sf2/FluidR3_GM.sf2"

# General-MIDI program for the re-instrumented lead per genre/kit family.
_GENRE_LEAD_PROGRAM = {
    "house": 81,      # synth lead (sawtooth)
    "trap": 81,
    "hiphop": 5,      # electric piano 2
    "bollywood": 104, # sitar
    "lofi": 4,        # electric piano 1
    "ambient": 89,    # warm pad
    "rock": 29,       # overdriven guitar
    "pop": 80,        # square lead
}


def genre_lead_program(genre: str) -> int:
    """GM program number for the melody's genre lead voice (piano default)."""
    return _GENRE_LEAD_PROGRAM.get(style_to_kit(genre), 0)


def _fit_length(arr: np.ndarray, n: int) -> np.ndarray:
    """Tile/truncate a stereo array to exactly ``n`` samples."""
    a = _to_stereo(np.asarray(arr, dtype=np.float32))
    if a.shape[0] == 0:
        return np.zeros((max(1, n), 2), dtype=np.float32)
    if a.shape[0] >= n:
        return a[:n]
    reps = int(np.ceil(n / a.shape[0]))
    return np.tile(a, (reps, 1))[:n]


def layer_in(base: np.ndarray, extra: np.ndarray | None, level: float) -> np.ndarray:
    """Mix ``extra`` under ``base`` at ``level`` (0..1), length-matched + peak-safe.
    ``extra`` None or ``level`` <= 0 is a no-op — so a missing neural bed or
    melody layer simply leaves the deterministic bed untouched."""
    base = _to_stereo(np.asarray(base, dtype=np.float32))
    if extra is None or level <= 0.0:
        return base
    out = base + _fit_length(extra, base.shape[0]) * float(level)
    peak = float(np.max(np.abs(out))) if out.size else 0.0
    if peak > 0.98:
        out = out / peak * 0.98
    return out.astype(np.float32)


def reinstrument_melody(
    stem_path: str, sr: int, genre: str, soundfont: str = SOUNDFONT_PATH
) -> np.ndarray | None:
    """Transcribe a (mostly monophonic) stem to MIDI with Spotify basic-pitch,
    then replay it as a genre-appropriate instrument via FluidSynth — so the
    recognisable tune carries into the new genre. Returns stereo @ ``sr``, or
    None if transcription/synthesis isn't available (caller layers nothing)."""
    import os

    try:
        from basic_pitch.inference import predict
    except Exception as e:  # noqa: BLE001
        print(f"basic-pitch unavailable, skipping melody re-instrument: {e}")
        return None
    if not os.path.exists(soundfont):
        print(f"soundfont missing at {soundfont}; skipping melody re-instrument")
        return None
    try:
        _model_out, midi_data, _notes = predict(stem_path)
        if midi_data is None or not midi_data.instruments:
            return None
        program = genre_lead_program(genre)
        for inst in midi_data.instruments:
            inst.program = program
            inst.is_drum = False
        audio = midi_data.fluidsynth(fs=sr, sf2_path=soundfont)
        if audio is None or len(audio) == 0:
            return None
        return _to_stereo(np.asarray(audio, dtype=np.float32))
    except Exception as e:  # noqa: BLE001
        print(f"melody re-instrument failed: {e}")
        return None


def duck_bed(bed: np.ndarray, vocal: np.ndarray, sr: int, duck_db: float = -3.0,
             release_sec: float = 0.25) -> np.ndarray:
    """Sidechain-style: drop the bed wherever the vocal is present so the voice
    always sits on top, then smooth the gain so it swells back (no clicks).
    This is the 'one clean voice over one clean bed' rule made audible."""
    v = vocal.mean(axis=1) if vocal.ndim > 1 else vocal
    env = np.abs(v)
    threshold = 0.02 * env.max() if env.max() > 0 else np.inf
    gain = np.where(env > threshold, _db(duck_db), 1.0).astype(np.float32)
    gain = uniform_filter1d(gain, size=max(1, int(sr * release_sec)))
    return (bed * gain[: bed.shape[0], None]).astype(np.float32)


def crossfade(a: np.ndarray, b: np.ndarray, overlap_samples: int) -> np.ndarray:
    """Equal-power-ish linear crossfade between two stereo clips (docs/16
    transition toolbox)."""
    a = _to_stereo(a)
    b = _to_stereo(b)
    overlap_samples = int(min(overlap_samples, a.shape[0], b.shape[0]))
    if overlap_samples <= 0:
        return np.concatenate([a, b], axis=0)
    fade_out = np.linspace(1.0, 0.0, overlap_samples)[:, None]
    fade_in = np.linspace(0.0, 1.0, overlap_samples)[:, None]
    mid = a[-overlap_samples:] * fade_out + b[:overlap_samples] * fade_in
    return np.concatenate([a[:-overlap_samples], mid, b[overlap_samples:]], axis=0)


def render_mashup(vocal: np.ndarray, bed: np.ndarray, sr: int, offset_sec: float,
                  params: dict, transitions: bool = True) -> np.ndarray:
    """Compose the final mix from the AI's arrangement decision: place the vocal
    at offset_sec, duck the bed under it, optionally sweep a high-pass build into
    the intro, gain-stage, and guard against clipping. Stereo out (docs/16)."""
    v = _to_stereo(np.asarray(vocal, dtype=np.float32))
    b = _to_stereo(np.asarray(bed, dtype=np.float32))
    offset = max(0, int(round(offset_sec * sr)))
    total = max(b.shape[0], offset + v.shape[0])
    canvas_bed = np.zeros((total, 2), dtype=np.float32)
    canvas_voc = np.zeros((total, 2), dtype=np.float32)
    canvas_bed[: b.shape[0]] = b
    canvas_voc[offset : offset + v.shape[0]] = v

    if transitions:
        build = float(params.get("intro_build_sec", 0.0))
        if build > 0:  # tension→release high-pass sweep on the very intro
            n = min(int(build * sr), canvas_bed.shape[0])
            canvas_bed[:n] = highpass(canvas_bed[:n], sr, cutoff_hz=400.0)
        canvas_bed = duck_bed(canvas_bed, canvas_voc, sr, float(params.get("duck_db", -3.0)))

    mix = canvas_bed * _db(float(params.get("bed_gain_db", -3.0))) + \
        canvas_voc * _db(float(params.get("vocal_gain_db", -1.0)))
    peak = float(np.max(np.abs(mix))) if mix.size else 0.0
    if peak > 1.0:
        mix = mix / peak * 0.98
    return mix.astype(np.float32)


# ── Rating-feedback loop (docs/16) ────────────────────────────────────────────
# main.py FX-polishes and sequences the parts, scores the take with
# Audiobox-Aesthetics, and keeps the best-scoring one (falling back to a cleaner
# FX preset when the first take scores low).
PRODUCTION_QUALITY_TARGET = 7.5  # 1-10; stop early once the mix is this good


# ── Viral short "hook edit" (docs/14, the ≤59s two-part X×ABC edit) ────────────
# Instead of exporting a full-length overlay, we find the catchiest window (the
# "best part") of each source, join two of them with a DJ transition, cap the
# result to a short social length, and finish with a BandLab-style FX chain.

MAX_VIRAL_SECONDS = 59.0  # hard ceiling: never export a long video


def decide_edit_length(
    target_bpm: float,
    requested_seconds: float | None = None,
    n_parts: int = 2,
    overlap_sec: float = 3.0,
) -> tuple[float, float]:
    """Choose the final length musically instead of with a fixed number.

    When the user leaves length on Auto (``requested_seconds`` falsy), we size
    each part to ~8 bars at the target tempo — a natural phrase — so a fast song
    gets a tighter clip and a slow song gets a longer one, always under
    ``MAX_VIRAL_SECONDS``. A user-set length just clamps into the same window.
    Returns ``(total_seconds, part_seconds)``.
    """
    bpm = target_bpm if target_bpm and target_bpm > 0 else 110.0
    seconds_per_bar = 240.0 / bpm  # 4 beats per bar
    if requested_seconds and requested_seconds > 0:
        total = min(MAX_VIRAL_SECONDS, max(8.0, float(requested_seconds)))
        part = max(6.0, min(30.0, (total + overlap_sec * (n_parts - 1)) / n_parts))
        return total, part
    part = max(8.0, min(26.0, 8.0 * seconds_per_bar))  # ~8-bar phrase per part
    total = min(MAX_VIRAL_SECONDS, max(12.0, n_parts * part - overlap_sec * (n_parts - 1)))
    return total, part


def _rms(y: np.ndarray) -> float:
    """RMS loudness of a mono/stereo array (array twin of rms_energy)."""
    y = np.asarray(y, dtype=np.float32)
    if y.ndim > 1:
        y = y.mean(axis=1)
    return float(np.sqrt(np.mean(np.square(y)))) if y.size else 0.0


def _minmax(a: np.ndarray) -> np.ndarray:
    a = np.asarray(a, dtype=np.float32)
    if a.size == 0:
        return a
    lo, hi = float(a.min()), float(a.max())
    return (a - lo) / (hi - lo) if hi > lo else np.zeros_like(a)


def detect_hook(
    y: np.ndarray,
    sr: int,
    window_sec: float = 15.0,
    n: int = 1,
    hop_sec: float = 0.5,
) -> list[tuple[float, float]]:
    """Find the catchiest window(s) — the "best part" the user asked for.

    Scores every candidate window by loudness (RMS) + rhythmic energy (onset
    strength); the hook is where a song is loudest and busiest, which is what a
    listener remembers. Returns up to ``n`` non-overlapping ``(start, end)``
    windows in seconds, most-catchy first.
    """
    if y.ndim > 1:
        y = y.mean(axis=1)
    total = len(y) / sr if sr else 0.0
    if total <= window_sec or len(y) == 0:
        return [(0.0, total)]

    frame_hop = 512
    rms = librosa.feature.rms(y=y, hop_length=frame_hop)[0]
    onset = librosa.onset.onset_strength(y=y, sr=sr, hop_length=frame_hop)
    m = min(len(rms), len(onset))
    score = 0.6 * _minmax(rms[:m]) + 0.4 * _minmax(onset[:m])

    frames_per_win = max(1, int(window_sec * sr) // frame_hop)
    step = max(1, int(hop_sec * sr) // frame_hop)
    windows: list[tuple[float, float]] = []  # (score, start_sec)
    i = 0
    while i + frames_per_win <= len(score):
        windows.append((float(np.mean(score[i : i + frames_per_win])), i * frame_hop / sr))
        i += step
    windows.sort(key=lambda w: w[0], reverse=True)

    picked: list[float] = []
    for _, start in windows:
        if all(abs(start - p) >= window_sec for p in picked):
            picked.append(start)
            if len(picked) >= n:
                break
    picked.sort()
    return [(s, min(total, s + window_sec)) for s in picked] or [(0.0, min(total, window_sec))]


def slice_segment(y: np.ndarray, sr: int, start_sec: float, end_sec: float) -> np.ndarray:
    """Cut ``[start_sec, end_sec)`` from a mono/stereo array (stereo out)."""
    y = _to_stereo(np.asarray(y, dtype=np.float32))
    a = max(0, int(start_sec * sr))
    b = min(y.shape[0], int(end_sec * sr))
    return y[a:b].copy() if b > a else y[:0].copy()


def is_tune_only(vocal_seg: np.ndarray, instrumental_seg: np.ndarray, threshold: float = 0.22) -> tuple[bool, float]:
    """Decide whether to drop the vocal and let the *tune* carry the part.

    When the vocal's share of energy in the chosen hook is low — a sparse or
    instrumental section, or a lyric that just doesn't sit on the bed — the
    instrumental melody is the stronger hook. Returns ``(tune_only, ratio)``.
    """
    v, i = _rms(vocal_seg), _rms(instrumental_seg)
    total = v + i
    ratio = v / total if total > 0 else 0.0
    return ratio < threshold, ratio


def apply_fx_chain(y: np.ndarray, sr: int, preset: str = "viral") -> np.ndarray:
    """BandLab-style channel strip via Spotify's pedalboard (EQ → glue comp →
    air → light reverb → limiter). Falls back to a scipy high-pass + ceiling if
    pedalboard is unavailable, so the pipeline never hard-fails on FX."""
    y = _to_stereo(np.asarray(y, dtype=np.float32))
    if y.size == 0:
        return y
    try:
        from pedalboard import (  # noqa: PLC0415
            Compressor,
            Gain,
            HighpassFilter,
            HighShelfFilter,
            Limiter,
            LowShelfFilter,
            Pedalboard,
            Reverb,
        )

        presets = {
            "viral": [
                HighpassFilter(cutoff_frequency_hz=30.0),
                LowShelfFilter(cutoff_frequency_hz=110.0, gain_db=2.5),
                Compressor(threshold_db=-18.0, ratio=2.5, attack_ms=8.0, release_ms=140.0),
                HighShelfFilter(cutoff_frequency_hz=8000.0, gain_db=2.0),
                Reverb(room_size=0.12, wet_level=0.08, dry_level=0.92),
                Gain(gain_db=1.0),
                Limiter(threshold_db=-1.0, release_ms=100.0),
            ],
            "clean": [
                HighpassFilter(cutoff_frequency_hz=32.0),
                Compressor(threshold_db=-16.0, ratio=2.0, attack_ms=12.0, release_ms=160.0),
                Limiter(threshold_db=-1.5, release_ms=120.0),
            ],
        }
        board = Pedalboard(presets.get(preset, presets["viral"]))
        # pedalboard uses (channels, samples); our buffers are (samples, channels).
        out = board(np.ascontiguousarray(y.T), float(sr)).T
        out = np.ascontiguousarray(out, dtype=np.float32)
    except Exception as e:  # noqa: BLE001 — FX must never break the render
        print(f"pedalboard unavailable, using scipy FX fallback: {e}")
        out = highpass(y, sr, 30.0)
    peak = float(np.max(np.abs(out))) if out.size else 0.0
    if peak > 0.98:
        out = out / peak * 0.98
    return out.astype(np.float32)


def beat_matched_transition(
    a: np.ndarray, b: np.ndarray, sr: int, overlap_sec: float = 3.0, sweep: bool = True
) -> np.ndarray:
    """DJ-style join between two parts: sweep a high-pass open on the outgoing
    tail (tension), then equal-power crossfade into the incoming part. This is
    the "best transition" between the X and ABC halves (docs/15 transition
    toolbox)."""
    a = _to_stereo(np.asarray(a, dtype=np.float32))
    b = _to_stereo(np.asarray(b, dtype=np.float32))
    overlap = int(min(overlap_sec * sr, a.shape[0], b.shape[0]))
    if overlap <= 0:
        return np.concatenate([a, b], axis=0)
    if sweep:
        a = a.copy()
        tail = a[-overlap:]
        swept = highpass(tail, sr, 700.0)
        ramp = np.linspace(0.0, 1.0, overlap, dtype=np.float32)[:, None]
        a[-overlap:] = tail * (1.0 - ramp) + swept * ramp
    return crossfade(a, b, overlap)


def sequence_parts(
    parts: list[np.ndarray], sr: int, target_seconds: float, overlap_sec: float = 3.0
) -> np.ndarray:
    """Join the chosen parts with beat-matched transitions and hard-cap the
    result to a short social length (never above ``MAX_VIRAL_SECONDS``)."""
    usable = [_to_stereo(np.asarray(p, dtype=np.float32)) for p in parts if p is not None and np.asarray(p).size]
    if not usable:
        return np.zeros((1, 2), dtype=np.float32)
    out = usable[0]
    for nxt in usable[1:]:
        out = beat_matched_transition(out, nxt, sr, overlap_sec=overlap_sec)

    cap = min(float(target_seconds) if target_seconds and target_seconds > 0 else MAX_VIRAL_SECONDS, MAX_VIRAL_SECONDS)
    target = int(cap * sr)
    if out.shape[0] > target:
        out = out[:target].copy()
    fade_out = min(int(1.5 * sr), out.shape[0] // 6)
    if fade_out > 0:
        out[-fade_out:] *= np.linspace(1.0, 0.0, fade_out, dtype=np.float32)[:, None]
    return out.astype(np.float32)
