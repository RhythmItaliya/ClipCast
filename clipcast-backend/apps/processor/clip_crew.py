"""Clip production crew (docs/17 §3b) — the presentation decision layer.

The headline role is the **Colorist**: instead of a hardcoded category→color
lookup, it decides the caption highlight **RGB dynamically from the clip's
emotion** (docs/17's "everything dynamic, no hardcoding" rule). A critic guards
contrast. Every decision is recorded to a ProductionLog for the Production Room.

Fallback-first: with no LLM (or on any failure) the Colorist returns the
category's fallback RGB passed in the brief, so behaviour == the previous
`_category_highlight_hex` map.
"""
from crew import Agent, Crew, ProductionState

COLORIST = (
    "You are a COLORIST for short-form video captions. Choose ONE active-word "
    "highlight color that matches the clip's EMOTION and energy — e.g. sad/"
    "reflective → cool blue or indigo, hype/funny → warm orange or pink, calm → "
    "teal, intense/debate → red. It must be vivid and readable behind white "
    "text. Return STRICT JSON {\"r\":0-255,\"g\":0-255,\"b\":0-255} + a short "
    "'rationale'."
)
CRITIC = (
    "You are the CRITIC. Reject only if the color is so dark/low-contrast that "
    "white text on it would be unreadable. Return {\"accept\":true} or "
    "{\"accept\":false,\"to_role\":\"colorist\"}."
)

DEFAULT_RGB = (99, 102, 241)  # ClipCast brand indigo


def _fallback_rgb(state: ProductionState) -> dict:
    fb = state.brief.get("fallback_rgb") or list(DEFAULT_RGB)
    return {"r": int(fb[0]), "g": int(fb[1]), "b": int(fb[2])}


def build_clip_crew(llm, tracer=None) -> Crew:
    agents = {
        "colorist": Agent("colorist", COLORIST, fallback=_fallback_rgb),
        "critic": Agent("critic", CRITIC, fallback=lambda s: {"accept": True}),
    }
    # max_rounds=2: the critic can bounce a low-contrast color back to the
    # colorist for one retry (redo until readable).
    return Crew(
        agents,
        flow=["colorist"],
        critic_role="critic",
        execute=lambda state: {"planned": True},
        llm=llm,
        max_rounds=2,
        tracer=tracer,
    )


def _clamp(v, default: int) -> int:
    try:
        return max(0, min(255, int(v)))
    except (TypeError, ValueError):
        return default


def plan_clip_presentation(llm, ctx: dict) -> tuple[dict, list]:
    """Run the clip crew for one clip. `ctx` carries {title, category,
    transcript, fallback_rgb}. Returns ({'rgb': [r,g,b]}, production_log)."""
    from monitoring import make_tracer

    state = ProductionState(brief=ctx, analysis={})
    _result, log = build_clip_crew(llm, tracer=make_tracer("clipcast-clip-crew")).run(state)
    col = state.decisions.get("colorist", {})
    fb = ctx.get("fallback_rgb") or list(DEFAULT_RGB)
    rgb = [_clamp(col.get("r"), fb[0]), _clamp(col.get("g"), fb[1]), _clamp(col.get("b"), fb[2])]
    return {"rgb": rgb}, log.to_json()
