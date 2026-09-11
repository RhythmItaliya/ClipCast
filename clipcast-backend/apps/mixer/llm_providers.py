"""Pluggable LLM providers for the crew (docs/17). DeepSeek + Gemini + Claude +
OpenAI behind the crew's `LLM` protocol, chosen at runtime so the admin can
switch providers without a redeploy (the provider name is passed per job).

DeepSeek is the DEFAULT (the user runs DeepSeek); Gemini, Claude and OpenAI are
the alternatives. All are best-effort — if the chosen one isn't configured we
fall back to another, and if none is available `make_llm` returns None so the
crew runs on its deterministic fallbacks. DeepSeek, Claude and OpenAI use only
the stdlib (urllib), so no extra image dependency is needed; Gemini uses the
genai client the caller passes in.

Per-job config (all optional) comes from the admin panel and is forwarded with
each job, overriding the code defaults for the CHOSEN provider only:
  api_key  -> the provider's key (also stored in the Modal secret as a fallback)
  model    -> the model id to call
  effort   -> Anthropic "output_config.effort" (Claude only) — cost control
  base_url -> point the provider at a compatible gateway/proxy instead of the
              real API (e.g. a Foundry-style Claude gateway). The provider's
              path (e.g. "/v1/messages") is appended automatically.

Env fallbacks (in the Modal secret) per provider:
  deepseek -> DEEPSEEK_API_KEY   gemini -> GEMINI_API_KEY (client passed in)
  claude   -> ANTHROPIC_API_KEY  openai -> OPENAI_API_KEY
  claude base url / model can also default from ANTHROPIC_BASE_URL / CLAUDE_MODEL.
"""
from __future__ import annotations

import json
import os
import urllib.request

PROVIDERS = ("deepseek", "gemini", "claude", "openai")

# The default provider when a job doesn't specify one (admin can override the
# effective choice per job; this is the backend fallback default).
DEFAULT_PROVIDER = (os.environ.get("LLM_PROVIDER") or "deepseek").lower()

# Each HTTP provider has a default host + the path we append. The host (base
# URL) and the model can both be overridden per job from the admin panel.
DEEPSEEK_BASE_URL = "https://api.deepseek.com"
DEEPSEEK_PATH = "/chat/completions"
DEEPSEEK_MODEL = "deepseek-chat"

# Claude defaults can also come from env, so a gateway can be the baseline even
# without admin config. The per-job admin values still win over these.
ANTHROPIC_BASE_URL = os.environ.get("ANTHROPIC_BASE_URL") or "https://api.anthropic.com"
ANTHROPIC_PATH = "/v1/messages"
CLAUDE_MODEL = os.environ.get("CLAUDE_MODEL") or "claude-opus-4-8"
CLAUDE_EFFORT = "low"  # cheapest effort — the crew only needs short JSON back

OPENAI_BASE_URL = "https://api.openai.com"
OPENAI_PATH = "/v1/chat/completions"
OPENAI_MODEL = "gpt-4o-mini"

GEMINI_MODEL = "gemini-2.5-flash"


def _endpoint(base_url: str | None, default_base: str, path: str) -> str:
    """Join a base URL (admin override or default host) with the provider's
    fixed path, e.g. ("https://gw.example", ".../v1/messages")."""
    return (base_url or default_base).rstrip("/") + path


def _post_json(url: str, payload: dict, headers: dict) -> dict:
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", **headers}, method="POST",
    )
    # 120s: Opus can be slower than the other chat models on a cold turn.
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read())


class GeminiLLM:
    def __init__(self, client, model: str | None = None) -> None:
        self._client = client
        self._model = model or GEMINI_MODEL
        self.name = self._model

    def complete(self, system: str, user: str) -> str:
        resp = self._client.models.generate_content(
            model=self._model, contents=f"{system}\n\n{user}"
        )
        return resp.text or ""


class DeepSeekLLM:
    def __init__(self, api_key: str | None = None, model: str | None = None,
                 base_url: str | None = None) -> None:
        # Prefer explicit per-request values; otherwise fall back to env/default.
        self._api_key = api_key or os.environ.get("DEEPSEEK_API_KEY", "")
        self._model = model or DEEPSEEK_MODEL
        self._url = _endpoint(base_url, DEEPSEEK_BASE_URL, DEEPSEEK_PATH)
        self.name = self._model

    def complete(self, system: str, user: str) -> str:
        data = _post_json(
            self._url,
            {
                "model": self._model,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                "stream": False,
                "temperature": 0.7,
            },
            {"Authorization": f"Bearer {self._api_key}"},
        )
        return data["choices"][0]["message"]["content"] or ""


class ClaudeLLM:
    def __init__(self, api_key: str | None = None, model: str | None = None,
                 base_url: str | None = None, effort: str | None = None) -> None:
        self._api_key = api_key or os.environ.get("ANTHROPIC_API_KEY", "")
        self._model = model or CLAUDE_MODEL
        self._effort = effort or CLAUDE_EFFORT
        self._url = _endpoint(base_url, ANTHROPIC_BASE_URL, ANTHROPIC_PATH)
        self.name = self._model

    def complete(self, system: str, user: str) -> str:
        data = _post_json(
            self._url,
            {
                "model": self._model,
                "max_tokens": 1024,
                # Cost control (Opus 4.8): no "thinking" key = thinking OFF, and a
                # low "effort" keeps token spend (and $) down — the crew only needs
                # a short JSON decision back. Effort is Anthropic-only; the admin
                # picks it per provider (low..max). Note: Haiku 4.5 rejects effort.
                "output_config": {"effort": self._effort},
                "system": system,
                "messages": [{"role": "user", "content": user}],
            },
            {
                "x-api-key": self._api_key,
                "anthropic-version": "2023-06-01",
            },
        )
        # The Messages API returns a list of content blocks.
        return "".join(
            b.get("text", "") for b in data.get("content", []) if b.get("type") == "text"
        )


class OpenAILLM:
    def __init__(self, api_key: str | None = None, model: str | None = None,
                 base_url: str | None = None) -> None:
        self._api_key = api_key or os.environ.get("OPENAI_API_KEY", "")
        self._model = model or OPENAI_MODEL
        self._url = _endpoint(base_url, OPENAI_BASE_URL, OPENAI_PATH)
        self.name = self._model

    def complete(self, system: str, user: str) -> str:
        data = _post_json(
            self._url,
            {
                "model": self._model,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                "temperature": 0.7,
            },
            {"Authorization": f"Bearer {self._api_key}"},
        )
        return data["choices"][0]["message"]["content"] or ""


def _build_gemini(gemini_client, api_key: str | None, model: str | None = None):
    """Prefer a client built from a per-request key; otherwise use the warm
    client the caller passed in. Returns None if neither is available."""
    if api_key:
        try:
            from google import genai
            return GeminiLLM(genai.Client(api_key=api_key), model)
        except Exception:
            pass
    return GeminiLLM(gemini_client, model) if gemini_client is not None else None


def make_llm(provider: str | None = None, gemini_client=None, api_key: str | None = None,
             model: str | None = None, effort: str | None = None,
             base_url: str | None = None):
    """Return an LLM for `provider` ("deepseek"/"gemini"/"claude"/"openai"),
    falling back to the other configured providers when the preferred one isn't
    available, or None when none is (crew then runs on deterministic fallbacks).

    The per-job overrides (api_key/model/effort/base_url) apply to the CHOSEN
    provider only; fallback providers use their env/default config.
    """
    choice = (provider or DEFAULT_PROVIDER or "deepseek").lower()

    def build(name: str, chosen: bool):
        # Only the admin-selected provider gets the per-job overrides.
        key = api_key if chosen else None
        m = model if chosen else None
        e = effort if chosen else None
        b = base_url if chosen else None
        if name == "deepseek":
            k = key or os.environ.get("DEEPSEEK_API_KEY")
            return DeepSeekLLM(k, model=m, base_url=b) if k else None
        if name == "gemini":
            return _build_gemini(gemini_client, key, m)
        if name == "claude":
            k = key or os.environ.get("ANTHROPIC_API_KEY")
            return ClaudeLLM(k, model=m, base_url=b, effort=e) if k else None
        if name == "openai":
            k = key or os.environ.get("OPENAI_API_KEY")
            return OpenAILLM(k, model=m, base_url=b) if k else None
        return None

    # Try the chosen provider (with its per-job overrides) first, then the rest
    # in a stable order using their env/default config.
    for name in [choice] + [p for p in PROVIDERS if p != choice]:
        llm = build(name, name == choice)
        if llm is not None:
            return llm
    return None
