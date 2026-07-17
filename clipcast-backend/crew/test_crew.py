"""CPU smoke tests for the production-crew framework (docs/17).

A scripted mock LLM drives the crew deterministically — no network, no models —
so flow ordering, handoff routing, the critic loop-back, fallbacks, and the log
shape are all verified on CPU. Run: `python crew/test_crew.py`.
"""
import json

from agents import Agent, Crew, ProductionState


class MockLLM:
    """Returns scripted JSON per role. The critic rejects until `accept_round`,
    handing back to `reroute_to`, then accepts."""

    def __init__(self, scripts: dict[str, dict], accept_round=2, reroute_to="composer"):
        self.scripts = scripts
        self.calls: list[str] = []
        self._critic_calls = 0
        self.accept_round = accept_round
        self.reroute_to = reroute_to

    def complete(self, system: str, user: str) -> str:
        role = system  # tests pass the role name as the persona for routing
        self.calls.append(role)
        if role == "critic":
            self._critic_calls += 1
            accept = self._critic_calls >= self.accept_round
            return json.dumps(
                {"accept": accept, "to_role": None if accept else self.reroute_to,
                 "rationale": "ok" if accept else "make it sparser"}
            )
        return json.dumps(self.scripts.get(role, {"choices": {}, "rationale": "x"}))


def _agents():
    roles = ["writer", "director", "composer", "engineer", "critic"]
    return {r: Agent(role=r, persona=r) for r in roles}  # persona=role → mock routing


def test_flow_runs_in_order_and_records_log():
    scripts = {
        "writer": {"hook": "sad line", "rationale": "emotional core"},
        "director": {"mood": "mellow", "to_role": None},
        "composer": {"bed_prompt": "lofi 84bpm"},
        "engineer": {"fx": "clean"},
    }
    llm = MockLLM(scripts, accept_round=1)  # accept immediately → single round
    crew = Crew(
        agents=_agents(),
        flow=["writer", "director", "composer", "engineer"],
        critic_role="critic",
        execute=lambda state: {"score": 8.0, "path": "take.wav"},
        llm=llm,
        max_rounds=3,
    )
    state = ProductionState(brief={"genre": "lofi"}, analysis={"bpm": 84})
    result, log = crew.run(state)

    assert result["score"] == 8.0
    # One round: writer, director, composer, engineer, then critic.
    froms = [e.from_role for e in log.entries]
    assert froms == ["writer", "director", "composer", "engineer", "critic"]
    assert state.decisions["director"]["mood"] == "mellow"
    assert state.decisions["composer"]["bed_prompt"] == "lofi 84bpm"
    assert all(e.round == 1 for e in log.entries)
    print("flow order + log: ok")


def test_critic_reroute_loops_back():
    scripts = {r: {"v": r} for r in ("writer", "director", "composer", "engineer")}
    llm = MockLLM(scripts, accept_round=2, reroute_to="composer")
    crew = Crew(
        agents=_agents(),
        flow=["writer", "director", "composer", "engineer"],
        critic_role="critic",
        execute=lambda state: {"score": 6.0},
        llm=llm,
        max_rounds=3,
    )
    _result, log = crew.run(ProductionState())

    rounds = {e.round for e in log.entries}
    assert rounds == {1, 2}, rounds  # rejected once, accepted on round 2
    # Round 2 re-enters at 'composer' (the reroute target), skipping writer/director.
    round2 = [e.from_role for e in log.entries if e.round == 2]
    assert round2 == ["composer", "engineer", "critic"], round2
    # The critic's rejection note is visible in the log (observability).
    reject = [e for e in log.entries if e.from_role == "critic" and e.round == 1][0]
    assert reject.choices["accept"] is False
    print("critic reroute loop-back: ok")


def test_agent_falls_back_when_llm_fails():
    class BoomLLM:
        def complete(self, system, user):
            if system == "composer":
                raise RuntimeError("llm down")
            return json.dumps({"ok": True, "accept": True} if system == "critic" else {"ok": True})

    agents = {
        "composer": Agent("composer", "composer", fallback=lambda s: {"bed_prompt": "deterministic"}),
        "critic": Agent("critic", "critic"),
    }
    crew = Crew(agents, flow=["composer"], critic_role="critic",
                execute=lambda s: {"score": 9}, llm=BoomLLM(), max_rounds=1)
    _result, log = crew.run(ProductionState())
    comp = [e for e in log.entries if e.from_role == "composer"][0]
    assert comp.choices == {"bed_prompt": "deterministic"}
    assert comp.rationale == "fallback"
    print("llm-failure fallback: ok")


def test_runs_headless_without_llm():
    agents = {
        "director": Agent("director", "director", fallback=lambda s: {"mood": "auto"}),
        "critic": Agent("critic", "critic", fallback=lambda s: {"accept": True}),
    }
    crew = Crew(agents, flow=["director"], critic_role="critic",
                execute=lambda s: {"score": 7}, llm=None, max_rounds=2)
    result, log = crew.run(ProductionState())
    assert result["score"] == 7
    assert log.entries[0].choices == {"mood": "auto"}
    # to_json is serialisable (the observability payload).
    json.dumps(log.to_json())
    print("headless (no LLM) + json log: ok")


def test_unknown_role_in_flow_raises():
    try:
        Crew({"a": Agent("a", "a")}, flow=["a", "ghost"], critic_role="a",
             execute=lambda s: {}, llm=None)
    except ValueError as e:
        assert "ghost" in str(e)
        print("unknown-role guard: ok")
        return
    raise AssertionError("expected ValueError for unknown role")


if __name__ == "__main__":
    test_flow_runs_in_order_and_records_log()
    test_critic_reroute_loops_back()
    test_agent_falls_back_when_llm_fails()
    test_runs_headless_without_llm()
    test_unknown_role_in_flow_raises()
    print("\nAll crew framework tests passed.")
