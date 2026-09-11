/** Client-safe LLM provider constants (no server/db imports) so both the admin
 * UI (client) and the server settings module can share them. */
export const LLM_PROVIDERS = ["deepseek", "gemini", "claude", "openai"] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];
export const DEFAULT_LLM_PROVIDER: LlmProvider = "deepseek";

export const LLM_PROVIDER_LABELS: Record<LlmProvider, string> = {
  deepseek: "DeepSeek",
  gemini: "Gemini",
  claude: "Claude",
  openai: "OpenAI",
};

/** The env/secret name each provider's API key is stored under on the backend
 * (Modal secret). Also the label used when surfacing key configuration. */
export const LLM_PROVIDER_ENV_KEYS: Record<LlmProvider, string> = {
  deepseek: "DEEPSEEK_API_KEY",
  gemini: "GEMINI_API_KEY",
  claude: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
};

/** Effort levels for providers that support Anthropic-style
 * `output_config.effort` (currently Claude only). Cheapest → most thorough. */
export const LLM_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type LlmEffort = (typeof LLM_EFFORTS)[number];

/** Providers that accept an "effort" setting (Anthropic output_config.effort).
 * The admin panel only shows the effort field for these. */
export const PROVIDERS_WITH_EFFORT: readonly LlmProvider[] = ["claude"];

/** Default model id per provider — shown as the placeholder / fallback hint in
 * the admin panel. The backend uses these same defaults when the field is
 * left blank, so an empty admin field never breaks a job. */
export const LLM_PROVIDER_DEFAULT_MODELS: Record<LlmProvider, string> = {
  deepseek: "deepseek-chat",
  gemini: "gemini-2.5-flash",
  claude: "claude-opus-4-8",
  openai: "gpt-4o-mini",
};
