"""CPU tests for the clip crew / Colorist (docs/17 §3b). Pure-Python (crew +
clip_crew only) — runs locally: `python apps/processor/test_clip_crew.py`."""
import json

from clip_crew import plan_clip_presentation


def test_headless_uses_fallback_rgb():
    # No LLM → the Colorist returns the category's fallback RGB (== old map).
    ctx = {"title": "A sad goodbye", "category": "Sad Story", "transcript": "we lost everything",
           "fallback_rgb": [99, 102, 241]}
    pres, log = plan_clip_presentation(None, ctx)
    assert pres["rgb"] == [99, 102, 241]
    roles = [e["from"] for e in log]
    assert roles == ["colorist", "critic"]
    json.dumps(log)
    print("headless colorist → fallback rgb: ok")


def test_llm_colorist_decides_dynamic_rgb():
    class ColorLLM:
        def complete(self, system, user):
            if system.startswith("You are a COLORIST"):
                return json.dumps({"r": 20, "g": 60, "b": 200, "rationale": "cool blue for grief"})
            return json.dumps({"accept": True})

    pres, log = plan_clip_presentation(
        ColorLLM(),
        {"title": "A sad goodbye", "category": "Sad Story", "transcript": "we lost everything",
         "fallback_rgb": [99, 102, 241]},
    )
    assert pres["rgb"] == [20, 60, 200]  # dynamic, not the hardcoded fallback
    colorist = [e for e in log if e["from"] == "colorist"][0]
    assert "grief" in colorist["rationale"]
    print("llm colorist → dynamic rgb + rationale: ok")


def test_out_of_range_rgb_is_clamped():
    class BadLLM:
        def complete(self, system, user):
            if system.startswith("You are a COLORIST"):
                return json.dumps({"r": 999, "g": -5, "b": "x"})
            return json.dumps({"accept": True})

    pres, _log = plan_clip_presentation(BadLLM(), {"fallback_rgb": [10, 20, 30]})
    assert pres["rgb"] == [255, 0, 30]  # clamp hi, clamp lo, garbage → fallback channel
    print("rgb clamp + garbage guard: ok")


if __name__ == "__main__":
    test_headless_uses_fallback_rgb()
    test_llm_colorist_decides_dynamic_rgb()
    test_out_of_range_rgb_is_clamped()
    print("\nAll clip-crew tests passed.")
