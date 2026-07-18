"""Pluggable LLM providers for the crew (docs/17). DeepSeek + Gemini + Claude
behind the crew's `LLM` protocol, chosen at runtime so the admin can switch
providers without a redeploy (the provider name is passed per job).

DeepSeek is the DEFAULT (the user runs DeepSeek); Gemini and Claude are the
alternatives. All are best-effort — if the chosen one isn't configured we fall
back to another, and if none is available `make_llm` returns None so the crew
runs on its deterministic fallbacks. DeepSeek + Claude use only stdlib (urllib)
so no new image dependency is needed.

Required env (in the Modal secret) per provider:
  deepseek -> DEEPSEEK_API_KEY   gemini -> GEMINI_API_KEY (client passed in)
  claude   -> ANTHROPIC_API_KEY
"""
from __future__ import annotations

import json
import os
import urllib.request

PROVIDERS = ("deepseek", "gemini", "claude")

# The default provider when a job doesn't specify one (admin can override the
# effective choice per job; this is the backend fallback default).
DEFAULT_PROVIDER = (os.environ.get("LLM_PROVIDER") or "deepseek").lower()

DEEPSEEK_URL = "https://api.deepseek.com/chat/completions"
DEEPSEEK_MODEL = "deepseek-chat"

ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
CLAUDE_MODEL = "claude-haiku-4-5-20251001"  # fast + cheap for short JSON decisions


def _post_json(url: str, payload: dict, headers: dict) -> dict:
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", **headers}, method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read())


class GeminiLLM:
    name = "gemini-2.5-flash"

    def __init__(self, client) -> None:
        self._client = client

    def complete(self, system: str, user: str) -> str:
        resp = self._client.models.generate_content(
            model="gemini-2.5-flash", contents=f"{system}\n\n{user}"
        )
        return resp.text or ""


class DeepSeekLLM:
    name = DEEPSEEK_MODEL

    def complete(self, system: str, user: str) -> str:
        data = _post_json(
            DEEPSEEK_URL,
            {
                "model": DEEPSEEK_MODEL,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                "stream": False,
                "temperature": 0.7,
            },
            {"Authorization": f"Bearer {os.environ['DEEPSEEK_API_KEY']}"},
        )
        return data["choices"][0]["message"]["content"] or ""


class ClaudeLLM:
    name = "claude-haiku-4-5"

    def complete(self, system: str, user: str) -> str:
        data = _post_json(
            ANTHROPIC_URL,
            {
                "model": CLAUDE_MODEL,
                "max_tokens": 1024,
                "system": system,
                "messages": [{"role": "user", "content": user}],
            },
            {
                "x-api-key": os.environ["ANTHROPIC_API_KEY"],
                "anthropic-version": "2023-06-01",
            },
        )
        # The Messages API returns a list of content blocks.
        return "".join(
            b.get("text", "") for b in data.get("content", []) if b.get("type") == "text"
        )


def make_llm(provider: str | None = None, gemini_client=None):
    """Return an LLM for `provider` ("deepseek"/"gemini"/"claude"), falling back
    to the other configured providers when the preferred one isn't available, or
    None when none is (crew then runs on deterministic fallbacks)."""
    builders = {
        "deepseek": lambda: DeepSeekLLM() if os.environ.get("DEEPSEEK_API_KEY") else None,
        "gemini": lambda: GeminiLLM(gemini_client) if gemini_client is not None else None,
        "claude": lambda: ClaudeLLM() if os.environ.get("ANTHROPIC_API_KEY") else None,
    }
    choice = (provider or DEFAULT_PROVIDER or "deepseek").lower()
    # Try the chosen provider first, then the rest in a stable order.
    for name in [choice] + [p for p in PROVIDERS if p != choice]:
        llm = builders.get(name, lambda: None)()
        if llm is not None:
            return llm
    return None
