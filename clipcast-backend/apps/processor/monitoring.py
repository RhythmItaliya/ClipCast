"""Agent monitoring — a Langfuse-backed `Tracer` for the production crew.

[Langfuse](https://github.com/langfuse/langfuse) is a free, open-source (MIT)
LLM/agent observability platform: a visual dashboard of traces, per-agent
inputs/outputs, latency, and errors. Self-host it with `docker-compose`
(see `docker-compose.langfuse.yml` + `docs/18-agent-monitoring.md`).

This adapter is **entirely optional and best-effort**: if the SDK isn't
installed or `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` aren't set, or the
API shifts between versions, `make_tracer()` returns a no-op — a crew never
depends on monitoring being up. Every call is wrapped so tracing can never
raise into a render.
"""
from __future__ import annotations

import os

# `crew` when vendored into an app (apps/*/crew.py); `agents` in the canonical
# package (clipcast-backend/crew/agents.py).
try:
    from crew import NOOP_TRACER, Tracer
except ImportError:  # pragma: no cover
    from agents import NOOP_TRACER, Tracer


def make_tracer(run_name: str = "clipcast-crew") -> Tracer:
    """A Langfuse tracer when configured, else the no-op tracer."""
    if not (os.environ.get("LANGFUSE_PUBLIC_KEY") and os.environ.get("LANGFUSE_SECRET_KEY")):
        return NOOP_TRACER
    try:
        from langfuse import Langfuse

        client = Langfuse(host=os.environ.get("LANGFUSE_HOST") or "https://cloud.langfuse.com")
        return _LangfuseTracer(client, run_name)
    except Exception as e:  # noqa: BLE001
        print(f"Langfuse monitoring unavailable, tracing disabled: {e}")
        return NOOP_TRACER


class _LangfuseTracer:
    """Maps crew events onto a Langfuse trace + per-decision spans. Version- and
    failure-tolerant: any SDK mismatch degrades to a print, never an exception."""

    def __init__(self, client, run_name: str) -> None:
        self._client = client
        self._run_name = run_name
        self._trace = None

    def event(self, name: str, data: dict) -> None:
        try:
            if name == "run_start":
                self._trace = self._client.trace(name=self._run_name, metadata=data)
            elif name in ("decision", "critic") and self._trace is not None:
                self._trace.span(
                    name=f"{name}:{data.get('role', '?')}",
                    input={"round": data.get("round")},
                    output={"choices": data.get("choices"), "rationale": data.get("rationale")},
                    level="ERROR" if data.get("error") else "DEFAULT",
                    status_message=data.get("error"),
                )
            elif name == "execute" and self._trace is not None:
                self._trace.span(name=f"execute:round-{data.get('round')}", output=data.get("take"))
            elif name == "run_end":
                if self._trace is not None:
                    self._trace.update(output=data)
                # Flush so short-lived Modal containers don't drop the trace.
                if hasattr(self._client, "flush"):
                    self._client.flush()
                self._trace = None
        except Exception as e:  # noqa: BLE001
            print(f"Langfuse trace event '{name}' failed (ignored): {e}")
