"""CPU tests for the music crew (docs/17 §3a). Pure-Python (crew + music_crew
only, no audio deps) so it runs locally: `python apps/mixer/test_music_crew.py`."""
import json

from music_crew import music_plan


def test_headless_plan_matches_deterministic():
    # No LLM → every agent uses its fallback; the plan must equal the pre-crew
    # deterministic producer plan (no regression).
    brief = {"genre": "lofi remix", "target_bpm": 84, "key_name": "A", "quality": "minor"}
    plan, log = music_plan(None, brief)
    assert plan["fx_bias"] == "clean"            # lofi → mellow → clean
    assert "introspective" in plan["mood"]
    assert "lofi remix instrumental" in plan["bed_prompt"]
    assert "84 BPM" in plan["bed_prompt"] and "key A minor" in plan["bed_prompt"]
    # Log is a well-formed, JSON-safe transcript of the 4 roles + critic.
    roles = [e["from"] for e in log]
    assert roles == ["lyricist", "director", "composer", "engineer", "critic"]
    json.dumps(log)
    print("headless plan == deterministic: ok")


def test_energetic_genre_is_viral():
    plan, _log = music_plan(None, {"genre": "house remix", "target_bpm": 124, "key_name": "C", "quality": "major"})
    assert plan["fx_bias"] == "viral"
    assert "energetic" in plan["mood"]
    print("energetic genre → viral: ok")


def test_llm_backed_plan_uses_agent_choices():
    class ScriptLLM:
        def complete(self, system, user):
            if system.startswith("You are a LYRICIST"):
                return json.dumps({"emotion": "heartbroken", "hook": "we were younger"})
            if system.startswith("You are a music DIRECTOR"):
                return json.dumps({"mood": "aching, sparse"})
            if system.startswith("You are a COMPOSER"):
                return json.dumps({"bed_prompt": "dusty lofi, 84 BPM, key A minor, no vocals"})
            if system.startswith("You are a SOUND ENGINEER"):
                return json.dumps({"fx_bias": "clean"})
            return json.dumps({"accept": True})

    plan, log = music_plan(ScriptLLM(), {"genre": "lofi remix", "target_bpm": 84, "key_name": "A", "quality": "minor"})
    assert plan["mood"] == "aching, sparse"
    assert plan["bed_prompt"] == "dusty lofi, 84 BPM, key A minor, no vocals"
    assert plan["emotion"] == "heartbroken"
    assert plan["note"].startswith("crew ·")
    # The lyricist's reasoning is captured in the observable log.
    lyr = [e for e in log if e["from"] == "lyricist"][0]
    assert lyr["choices"]["emotion"] == "heartbroken"
    print("llm-backed plan uses agent choices: ok")


if __name__ == "__main__":
    test_headless_plan_matches_deterministic()
    test_energetic_genre_is_viral()
    test_llm_backed_plan_uses_agent_choices()
    print("\nAll music-crew tests passed.")
