"""CPU-only smoke test for the musical logic (no GPU, no Modal, no network).

Run before deploying changes to audio_engine.py — same spirit as the
processor's render_caption_test.py: verify the code that decides tempo/key
matching, hook detection, and the viral hook-edit finish on synthetic audio you
can reason about.

    python apps/mixer/test_audio_engine.py
"""

import numpy as np

import audio_engine as ae


def _sine(freq: float, seconds: float = 4.0, sr: int = ae.SAMPLE_RATE) -> np.ndarray:
    t = np.linspace(0, seconds, int(sr * seconds), endpoint=False)
    return 0.3 * np.sin(2 * np.pi * freq * t).astype(np.float32)


def test_camelot_compatibility():
    assert ae.camelot_compatible("8A", "8A")   # identical
    assert ae.camelot_compatible("8A", "9A")   # +1
    assert ae.camelot_compatible("8A", "7A")   # -1
    assert ae.camelot_compatible("8A", "8B")   # relative major/minor
    assert ae.camelot_compatible("12A", "1A")  # wrap-around
    assert not ae.camelot_compatible("8A", "3A")
    print("camelot compatibility: ok")


def test_tempo_ratio_folds_extremes():
    # 90 -> 120 is a direct stretch.
    assert abs(ae.tempo_ratio(90, 120) - (120 / 90)) < 1e-6
    # 80 -> 160 should fold to ~1.0 (double-time), not a 2x stretch.
    assert 0.71 <= ae.tempo_ratio(80, 160) <= 1.4
    # 150 -> 75 should fold up toward 1.0, not a 0.5x squash.
    assert 0.71 <= ae.tempo_ratio(150, 75) <= 1.4
    print("tempo ratio folding: ok")


def test_semitone_move_is_smallest():
    a = ae.TrackAnalysis(120, [0.0], "C", False, ae._CAMELOT[("C", False)])
    b = ae.TrackAnalysis(120, [0.0], "C", False, ae._CAMELOT[("C", False)])
    assert ae.semitones_to_compatible(a, b) == 0  # already compatible
    print("semitone move: ok")


def test_loudness_norm_runs():
    y = _sine(220.0)
    out = ae.normalize_loudness(y, ae.SAMPLE_RATE)
    assert np.max(np.abs(out)) <= 1.0
    print("loudness normalize: ok")


def test_duck_bed_lowers_bed_under_vocal():
    sr = ae.SAMPLE_RATE
    bed = ae._to_stereo(_sine(110.0, 2.0))
    vocal = np.zeros_like(bed)
    vocal[: sr] = ae._to_stereo(_sine(440.0, 1.0))  # vocal only in first second
    ducked = ae.duck_bed(bed, vocal, sr, duck_db=-6.0)
    under_vocal = np.abs(ducked[: sr // 2]).mean()
    no_vocal = np.abs(ducked[sr + sr // 2 :]).mean()
    assert under_vocal < no_vocal  # bed is quieter where the vocal sits
    print("duck bed: ok")


def test_crossfade_is_seamless_length():
    sr = ae.SAMPLE_RATE
    a = ae._to_stereo(_sine(220.0, 1.0))
    b = ae._to_stereo(_sine(330.0, 1.0))
    overlap = sr // 2
    out = ae.crossfade(a, b, overlap)
    assert out.shape[0] == a.shape[0] + b.shape[0] - overlap
    print("crossfade: ok")


def test_render_mashup_no_clip_and_stereo():
    sr = ae.SAMPLE_RATE
    vocal = _sine(440.0, 2.0)
    bed = _sine(110.0, 4.0)
    mix = ae.render_mashup(vocal, bed, sr, offset_sec=1.0, params=ae.DEFAULT_MIX_PARAMS)
    assert mix.ndim == 2 and mix.shape[1] == 2
    assert np.max(np.abs(mix)) <= 1.0
    print("render mashup: ok")


def test_compose_genre_layer_adds_beats_per_genre():
    sr = ae.SAMPLE_RATE
    beats = [i * 0.5 for i in range(16)]  # 120 BPM grid, 8s
    n = int(8.0 * sr)
    for genre in ("trap", "house", "bollywood", "lofi", "pop", "hip-hop"):
        layer = ae.compose_genre_layer(n, sr, beats, genre, strength="transformed", key_root=9, is_minor=True)
        assert layer.shape == (n, 2)
        assert np.max(np.abs(layer)) <= 0.99  # never clips
        assert np.sqrt(np.mean(layer**2)) > 1e-4  # actually put beats down
    # clean strength = silent
    silent = ae.compose_genre_layer(n, sr, beats, "trap", strength="clean")
    assert np.max(np.abs(silent)) == 0.0
    print("compose genre layer: ok")


def test_reproduce_bed_is_genre_aware_and_safe():
    sr = ae.SAMPLE_RATE
    bed = ae._to_stereo(_sine(110.0, 4.0))
    beats = [i * 0.5 for i in range(8)]
    trap = ae.reproduce_bed(bed, sr, beats, genre="trap", strength="max", key_root=0, is_minor=False)
    house = ae.reproduce_bed(bed, sr, beats, genre="house", strength="max", key_root=0, is_minor=False)
    assert trap.shape == bed.shape and np.max(np.abs(trap)) <= 1.0
    assert np.mean(np.abs(trap - bed)) > 0.001  # composed something new
    assert np.mean(np.abs(trap - house)) > 1e-4  # genres differ audibly
    # clean strength returns the (stereo) bed unchanged
    same = ae.reproduce_bed(bed, sr, beats, genre="trap", strength="clean")
    assert np.allclose(same, bed)
    print("reproduce bed (genre-aware): ok")


def test_style_to_kit_maps_fusions():
    assert ae.style_to_kit("bollywood hip-hop fusion") in ("bollywood", "hiphop")
    assert ae.style_to_kit("house remix") == "house"
    assert ae.style_to_kit("trap-pop remix") == "trap"
    assert ae.style_to_kit("something unknown") == "pop"
    print("style to kit: ok")


def test_decide_mix_style_prefers_bollywood_fusion():
    profiles = [
        {"genre": "bollywood/pop", "bpm": 98.0},
        {"genre": "house", "bpm": 124.0},
    ]
    plan = ae.decide_mix_style(profiles)
    assert plan["style"] == "bollywood house fusion"
    assert plan["target_bpm"] == 124.0
    assert plan["transform_strength"] == "max"
    print("mix style decision: ok")


def test_decide_mix_style_user_genre_overrides_detection():
    # Sources auto-detect to a bollywood/house lane; a user genre must win and
    # carry a keyword style_to_kit() can map to a drum kit.
    profiles = [
        {"genre": "bollywood/pop", "bpm": 98.0},
        {"genre": "house", "bpm": 124.0},
    ]
    forced = ae.decide_mix_style(profiles, user_genre="lofi")
    assert forced["style"] == "lofi remix"
    assert forced["target_bpm"] == 84.0
    assert ae.style_to_kit(forced["style"]) == "lofi"
    # "auto"/None/unknown fall back to source-driven detection.
    assert ae.decide_mix_style(profiles, user_genre="auto")["style"] == "bollywood house fusion"
    assert ae.decide_mix_style(profiles, user_genre=None)["style"] == "bollywood house fusion"
    print("mix style user-genre override: ok")


# ── Viral hook-edit pipeline ─────────────────────────────────────────────────

def test_detect_hook_finds_loud_window():
    sr = ae.SAMPLE_RATE
    # quiet 10s, loud+busy 6s, quiet 10s → the hook must land in the loud middle.
    quiet = _sine(220.0, 10.0) * 0.05
    loud = _sine(220.0, 6.0) + _sine(660.0, 6.0) * 0.5  # louder and brighter
    y = np.concatenate([quiet, loud, quiet])
    (start, end), = ae.detect_hook(y, sr, window_sec=4.0, n=1)
    assert end - start <= 4.5
    assert 9.0 <= start <= 16.0  # inside/around the loud region
    print("detect hook: ok")


def test_detect_hook_returns_non_overlapping():
    sr = ae.SAMPLE_RATE
    y = _sine(220.0, 30.0) + _sine(440.0, 30.0) * 0.3
    hooks = ae.detect_hook(y, sr, window_sec=5.0, n=2)
    assert len(hooks) == 2
    (s0, _), (s1, _) = sorted(hooks)
    assert s1 - s0 >= 5.0  # windows do not overlap
    print("detect hook non-overlap: ok")


def test_is_tune_only_flags_weak_vocal():
    sr = ae.SAMPLE_RATE
    loud_inst = _sine(110.0, 2.0)
    weak_voc = _sine(440.0, 2.0) * 0.02
    tune_only, ratio = ae.is_tune_only(weak_voc, loud_inst)
    assert tune_only and ratio < 0.22
    strong_voc = _sine(440.0, 2.0)
    tune_only2, ratio2 = ae.is_tune_only(strong_voc, loud_inst)
    assert not tune_only2 and ratio2 >= 0.22
    print("tune-only fallback: ok")


def test_slice_segment_bounds():
    sr = ae.SAMPLE_RATE
    y = _sine(220.0, 10.0)
    seg = ae.slice_segment(y, sr, 2.0, 5.0)
    assert seg.ndim == 2 and seg.shape[1] == 2
    assert abs(seg.shape[0] - 3 * sr) <= 1
    print("slice segment: ok")


def test_apply_fx_chain_safe_and_stereo():
    sr = ae.SAMPLE_RATE
    y = _sine(220.0, 3.0)
    out = ae.apply_fx_chain(y, sr, preset="viral")
    assert out.ndim == 2 and out.shape[1] == 2
    assert np.max(np.abs(out)) <= 0.99  # never clips
    print("fx chain: ok")


def test_beat_matched_transition_length():
    sr = ae.SAMPLE_RATE
    a = ae._to_stereo(_sine(220.0, 5.0))
    b = ae._to_stereo(_sine(330.0, 5.0))
    out = ae.beat_matched_transition(a, b, sr, overlap_sec=2.0)
    assert out.shape[0] == a.shape[0] + b.shape[0] - int(2.0 * sr)
    assert out.shape[1] == 2
    print("beat-matched transition: ok")


def test_sequence_parts_caps_length():
    sr = ae.SAMPLE_RATE
    parts = [ae._to_stereo(_sine(220.0, 40.0)), ae._to_stereo(_sine(330.0, 40.0))]
    out = ae.sequence_parts(parts, sr, target_seconds=30.0, overlap_sec=3.0)
    assert out.shape[0] <= int(30.0 * sr)
    # hard ceiling always wins, even if asked for more.
    out2 = ae.sequence_parts(parts, sr, target_seconds=999.0, overlap_sec=3.0)
    assert out2.shape[0] <= int(ae.MAX_VIRAL_SECONDS * sr)
    print("sequence parts cap: ok")


def test_decide_edit_length_auto_and_manual():
    # Auto: faster tempo → shorter clip than a slower tempo, both under the cap.
    fast_total, fast_part = ae.decide_edit_length(150.0, None)
    slow_total, slow_part = ae.decide_edit_length(80.0, None)
    assert fast_total <= ae.MAX_VIRAL_SECONDS and slow_total <= ae.MAX_VIRAL_SECONDS
    assert fast_part <= slow_part  # slower song → longer phrase
    # Manual: clamps into the viral window.
    total, _ = ae.decide_edit_length(120.0, 999.0)
    assert total == ae.MAX_VIRAL_SECONDS
    total2, _ = ae.decide_edit_length(120.0, 3.0)
    assert total2 == 8.0
    print("decide edit length: ok")


if __name__ == "__main__":
    test_camelot_compatibility()
    test_tempo_ratio_folds_extremes()
    test_semitone_move_is_smallest()
    test_loudness_norm_runs()
    test_duck_bed_lowers_bed_under_vocal()
    test_crossfade_is_seamless_length()
    test_render_mashup_no_clip_and_stereo()
    test_compose_genre_layer_adds_beats_per_genre()
    test_reproduce_bed_is_genre_aware_and_safe()
    test_style_to_kit_maps_fusions()
    test_decide_mix_style_prefers_bollywood_fusion()
    test_decide_mix_style_user_genre_overrides_detection()
    test_detect_hook_finds_loud_window()
    test_detect_hook_returns_non_overlapping()
    test_is_tune_only_flags_weak_vocal()
    test_slice_segment_bounds()
    test_apply_fx_chain_safe_and_stereo()
    test_beat_matched_transition_length()
    test_sequence_parts_caps_length()
    test_decide_edit_length_auto_and_manual()
    print("\nAll audio_engine smoke tests passed.")
