"""CPU tests for Song Research (docs/19) — no network. Run:
`python apps/mixer/test_research.py`."""
import research


def test_identify_song_parses_titles():
    assert research.identify_song("Adele - Hello (Official Music Video)") == {
        "artist": "Adele", "title": "Hello", "matched": True,
    }
    # No artist separator → whole thing is the title.
    got = research.identify_song("some random clip")
    assert got["title"] == "some random clip" and got["artist"] == ""
    # Empty → not matched.
    assert research.identify_song("", "") == {"artist": "", "title": "", "matched": False}
    print("identify_song: ok")


def test_pick_viral_window_finds_hottest():
    heatmap = [
        {"start_time": 0, "end_time": 10, "value": 0.2},
        {"start_time": 40, "end_time": 50, "value": 0.95},  # the peak
        {"start_time": 80, "end_time": 90, "value": 0.3},
    ]
    win = research.pick_viral_window(heatmap, window_sec=12)
    assert win is not None
    # Centered on ~45s (the peak segment's midpoint).
    assert 38 <= win["start"] <= 40 and abs((win["end"] - win["start"]) - 12) < 0.01
    # No heatmap → None (caller falls back to energy detection).
    assert research.pick_viral_window(None, 12) is None
    assert research.pick_viral_window([], 12) is None
    print("pick_viral_window: ok")


def test_research_source_falls_back_to_whisper(monkeypatch=None):
    # Force both lyric providers to miss → Whisper fallback + energy hook.
    research.fetch_lyrics = lambda *a, **k: ("", None, "")  # type: ignore
    bundle = research.research_source(
        {"title": "Unknown - Track", "heatmap": None},
        whisper_lyrics="la la la sung words",
        window_sec=12,
    )
    assert bundle["lyrics"] == "la la la sung words"
    assert bundle["lyrics_source"] == "whisper"
    assert bundle["viral_window"] is None and bundle["viral_source"] == "energy"
    assert bundle["song"]["artist"] == "Unknown" and bundle["song"]["title"] == "Track"
    print("research_source whisper fallback: ok")


if __name__ == "__main__":
    test_identify_song_parses_titles()
    test_pick_viral_window_finds_hottest()
    test_research_source_falls_back_to_whisper()
    print("\nAll research tests passed.")
