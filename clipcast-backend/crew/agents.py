"""ClipCast multi-agent production crew — the framework (docs/17).

A tiny, dependency-free orchestration layer: a crew of role-specialised agents
that read a shared production state, each own one decision, hand work to each
other, and revise in a bounded loop under a critic. Every decision + handoff is
recorded to a ProductionLog (the observable "conversation").

Design rules (docs/17):
  • Fallback-first — an agent that can't reach its LLM returns a deterministic
    Decision, so a crew always runs headless (degrades to today's behaviour).
  • Nothing hidden — an agent only reads ProductionState; a run is reproducible
    from the log + seed.
  • Model-agnostic — agents talk to an `LLM` protocol; Gemini (or any other
    service, in any language, behind the protocol) is a swappable adapter.

This module is pure stdlib so it unit-tests on CPU with a mock LLM
(`test_crew.py`) and is vendored into the mixer/processor Modal images later.
"""
from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Callable, Protocol, runtime_checkable


@runtime_checkable
class LLM(Protocol):
    """Any text model/service. `complete` takes a persona (system) + a user
    prompt and returns raw text (ideally JSON)."""

    def complete(self, system: str, user: str) -> str: ...


@runtime_checkable
class Tracer(Protocol):
    """Observability sink for a crew run — every decision, retry, and failure is
    emitted here so a monitoring tool (Langfuse, see `crew/monitoring.py`) can
    visualise the agents' work. `event` must never raise."""

    def event(self, name: str, data: dict) -> None: ...


class _NoopTracer:
    def event(self, name: str, data: dict) -> None:  # noqa: D401
        pass


NOOP_TRACER: Tracer = _NoopTracer()


def parse_json(raw: str):
    """Parse a JSON object from an LLM reply, tolerating ```json fences."""
    text = (raw or "").strip()
    if text.startswith("```json"):
        text = text[len("```json"):]
    elif text.startswith("```"):
        text = text[3:]
    if text.endswith("```"):
        text = text[:-3]
    try:
        return json.loads(text.strip())
    except (ValueError, TypeError):
        return None


@dataclass
class Decision:
    """One agent's structured output for a turn."""

    role: str
    choices: dict = field(default_factory=dict)
    rationale: str = ""
    to_role: str | None = None  # explicit handoff target (None = follow the flow)
    note: str = ""              # note carried with the handoff


@dataclass
class ProductionState:
    """The shared 'script' passed agent → agent, append-only."""

    brief: dict = field(default_factory=dict)      # the user's request/intent
    analysis: dict = field(default_factory=dict)   # measured facts (audio/video)
    decisions: dict = field(default_factory=dict)  # role -> latest choices

    def record(self, decision: Decision) -> None:
        self.decisions[decision.role] = decision.choices


@dataclass
class LogEntry:
    round: int
    from_role: str
    to_role: str | None
    choices: dict
    rationale: str
    note: str
    ts: float

    def to_dict(self) -> dict:
        return {
            "round": self.round,
            "from": self.from_role,
            "to": self.to_role,
            "choices": self.choices,
            "rationale": self.rationale,
            "note": self.note,
            "ts": round(self.ts, 3),
        }


class ProductionLog:
    """The observable transcript of the whole crew run (docs/17 §6)."""

    def __init__(self) -> None:
        self.entries: list[LogEntry] = []

    def append(self, round_: int, decision: Decision) -> None:
        self.entries.append(
            LogEntry(
                round=round_,
                from_role=decision.role,
                to_role=decision.to_role,
                choices=decision.choices,
                rationale=decision.rationale,
                note=decision.note,
                ts=time.time(),
            )
        )

    def to_json(self) -> list[dict]:
        return [e.to_dict() for e in self.entries]


class Agent:
    """One production role. Owns a persona + a schema hint, asks the LLM for a
    JSON decision, and falls back to a deterministic function on any failure."""

    def __init__(
        self,
        role: str,
        persona: str,
        schema_hint: str = "",
        fallback: Callable[[ProductionState], dict] | None = None,
    ) -> None:
        self.role = role
        self.persona = persona
        self.schema_hint = schema_hint
        self.fallback = fallback or (lambda _state: {})

    def _prompt(self, state: ProductionState) -> str:
        return (
            f"{self.schema_hint}\n"
            f"Brief: {json.dumps(state.brief)[:1500]}\n"
            f"Analysis: {json.dumps(state.analysis)[:1500]}\n"
            f"Decisions so far: {json.dumps(state.decisions)[:1500]}\n"
            "Return STRICT JSON: your decision fields, plus 'rationale', and "
            "optional 'to_role' + 'note' to hand off to another role."
        )

    def decide(self, state: ProductionState, llm: LLM | None) -> Decision:
        if llm is not None:
            try:
                data = parse_json(llm.complete(self.persona, self._prompt(state)))
                if isinstance(data, dict):
                    reserved = {"rationale", "to_role", "note", "choices"}
                    choices = data.get("choices") or {
                        k: v for k, v in data.items() if k not in reserved
                    }
                    return Decision(
                        role=self.role,
                        choices=choices,
                        rationale=str(data.get("rationale", ""))[:400],
                        to_role=data.get("to_role"),
                        note=str(data.get("note", ""))[:200],
                    )
            except Exception as e:  # noqa: BLE001
                return Decision(
                    role=self.role, choices=self.fallback(state),
                    rationale="fallback", note=str(e)[:120],
                )
        return Decision(role=self.role, choices=self.fallback(state), rationale="fallback")


class Crew:
    """Runs the flow of agents, records the log, and loops under the critic.

    `execute(state) -> result` is supplied by the caller (the mixer renders a
    take; the processor renders clips). `critic_role` names the agent that, after
    each execute, returns choices `{"accept": bool}` and an optional `to_role`
    to re-enter the flow at for another round.
    """

    def __init__(
        self,
        agents: dict[str, Agent],
        flow: list[str],
        critic_role: str,
        execute: Callable[[ProductionState], object],
        llm: LLM | None = None,
        max_rounds: int = 3,
        tracer: Tracer | None = None,
    ) -> None:
        missing = [r for r in flow + [critic_role] if r not in agents]
        if missing:
            raise ValueError(f"flow references unknown roles: {missing}")
        self.agents = agents
        self.flow = flow
        self.critic_role = critic_role
        self.execute = execute
        self.llm = llm
        self.max_rounds = max(1, max_rounds)
        self.tracer = tracer or NOOP_TRACER

    def _trace(self, name: str, decision: Decision, round_: int) -> None:
        # A fallback decision means the agent's LLM failed — surface it as an
        # error in the monitoring tool, not a silent success.
        self.tracer.event(
            name,
            {
                "round": round_,
                "role": decision.role,
                "to": decision.to_role,
                "choices": decision.choices,
                "rationale": decision.rationale,
                "error": decision.note if decision.rationale == "fallback" else None,
            },
        )

    def run(self, state: ProductionState) -> tuple[object, ProductionLog]:
        log = ProductionLog()
        result: object = None
        reroute_from: str | None = None
        accepted = False
        self.tracer.event("run_start", {"flow": self.flow, "max_rounds": self.max_rounds})
        for round_ in range(1, self.max_rounds + 1):
            # A reroute re-enters the flow at the addressed role, not the top —
            # a critic sending work back re-does only that role onward.
            active = self.flow
            if reroute_from in self.flow:
                active = self.flow[self.flow.index(reroute_from):]
            for role in active:
                decision = self.agents[role].decide(state, self.llm)
                state.record(decision)
                log.append(round_, decision)
                self._trace("decision", decision, round_)

            result = self.execute(state)
            state.analysis["take"] = _summarize(result)
            self.tracer.event("execute", {"round": round_, "take": state.analysis["take"]})

            verdict = self.agents[self.critic_role].decide(state, self.llm)
            state.record(verdict)
            log.append(round_, verdict)
            self._trace("critic", verdict, round_)
            accepted = bool(verdict.choices.get("accept"))
            if accepted or round_ == self.max_rounds:
                break
            # Rejected → redo, like a studio sending a take back for another pass.
            reroute_from = verdict.to_role or self.flow[0]
        self.tracer.event("run_end", {"rounds": round_, "accepted": accepted})
        return result, log


def _summarize(result: object) -> object:
    """A compact, JSON-safe view of the rendered take for the critic to judge."""
    if isinstance(result, dict):
        return {k: v for k, v in result.items() if isinstance(v, (int, float, str, bool))}
    return {"repr": str(result)[:200]}
