"""Music production crew (docs/17 §3a) — the AI decision layer for a mashup.

A crew of role agents reads the song's brief (target genre, tempo, key) and its
lyrics/emotion, then hands work down the line to produce a production plan:
mood → a genre instrumental prompt for ACE-Step → an FX bias. The mixer's
existing ACE-Step/melody/FX code is the *execution* layer that renders the plan.

Every agent has a deterministic fallback that reproduces the pre-crew
`_producer_plan` output, so with no Gemini the crew's plan == today's plan (no
regression). `music_plan` also returns the ProductionLog — the observable
transcript of who decided what and why — for the Production Room (Phase 4).
"""
from crew import Agent, Crew, ProductionState

LYRICIST = (
    "You are a LYRICIST. Read the song's lyrics and name the core emotion and "
    "the single most emotional hook line. Be concise and specific."
)
DIRECTOR = (
    "You are a music DIRECTOR. From the lyric's emotion and the target genre, "
    "set the creative mood and energy for the remix (e.g. a sad lyric in lofi "
    "→ mellow, sparse, intimate). Hand a clear mood to the composer."
)
COMPOSER = (
    "You are a COMPOSER. Write ONE text-to-music prompt for an instrumental in "
    "the target genre that fits the director's mood. Include the tempo (BPM) and "
    "key from the brief. No vocals. Under 60 words."
)
ENGINEER = (
    "You are a SOUND ENGINEER. Choose the finishing bias: 'clean' for intimate/"
    "mellow moods, 'viral' for bright/energetic ones."
)
CRITIC = (
    "You are the CRITIC. Judge whether the plan is coherent for the genre + "
    "emotion. Return {\"accept\": true} unless a role clearly contradicts the "
    "mood, in which case accept:false and to_role the role to redo."
)


def _mellow(genre: str) -> bool:
    return (genre or "").split()[0] in {"lofi", "ambient", "cinematic"}


def _bed_prompt(brief: dict) -> str:
    return (
        f"{brief.get('genre', 'pop')} instrumental, "
        f"{float(brief.get('target_bpm', 100)):.0f} BPM, "
        f"key {brief.get('key_name', 'C')} {brief.get('quality', 'minor')}, "
        "clean production, no vocals, tight drums, musical, cohesive"
    )


def build_music_crew(llm) -> Crew:
    agents = {
        "lyricist": Agent(
            "lyricist", LYRICIST,
            fallback=lambda s: {
                "emotion": "introspective" if _mellow(s.brief.get("genre", "")) else "energetic",
                "hook": "",
            },
        ),
        "director": Agent(
            "director", DIRECTOR,
            fallback=lambda s: {
                "mood": "introspective, mellow" if _mellow(s.brief.get("genre", "")) else "energetic, bright",
            },
        ),
        "composer": Agent(
            "composer", COMPOSER,
            fallback=lambda s: {"bed_prompt": _bed_prompt(s.brief)},
        ),
        "engineer": Agent(
            "engineer", ENGINEER,
            fallback=lambda s: {"fx_bias": "clean" if _mellow(s.brief.get("genre", "")) else "viral"},
        ),
        "critic": Agent("critic", CRITIC, fallback=lambda s: {"accept": True}),
    }
    # Phase 2 is a planning crew (max_rounds=1): the agents decide, the existing
    # mixer pipeline renders + rates. The render-in-the-loop critic is a later
    # refinement; the framework already supports it (docs/17 §5).
    return Crew(
        agents,
        flow=["lyricist", "director", "composer", "engineer"],
        critic_role="critic",
        execute=lambda state: {"planned": True},
        llm=llm,
        max_rounds=1,
    )


def music_plan(llm, brief: dict) -> tuple[dict, list]:
    """Run the crew and distil its decisions into the plan the mixer consumes,
    plus the ProductionLog JSON. Never raises — falls back per-agent."""
    state = ProductionState(brief=brief, analysis={"bpm": brief.get("target_bpm")})
    _result, log = build_music_crew(llm).run(state)
    d = state.decisions
    mellow = _mellow(brief.get("genre", ""))
    plan = {
        "mood": str(d.get("director", {}).get("mood") or
                    ("introspective, mellow" if mellow else "energetic, bright"))[:80],
        "bed_prompt": str(d.get("composer", {}).get("bed_prompt") or _bed_prompt(brief))[:400],
        "fx_bias": str(d.get("engineer", {}).get("fx_bias") or ("clean" if mellow else "viral")),
        "emotion": str(d.get("lyricist", {}).get("emotion") or "")[:80],
    }
    plan["note"] = (
        f"crew · {plan['emotion'] or 'genre'} → mood {plan['mood']}"
        if llm is not None else f"deterministic {brief.get('genre', '')} plan"
    )
    return plan, log.to_json()
