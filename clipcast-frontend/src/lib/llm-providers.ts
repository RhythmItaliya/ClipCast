/** Client-safe LLM provider constants (no server/db imports) so both the admin
 * UI (client) and the server settings module can share them. */
export const LLM_PROVIDERS = ["deepseek", "gemini", "claude"] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];
export const DEFAULT_LLM_PROVIDER: LlmProvider = "deepseek";

export const LLM_PROVIDER_LABELS: Record<LlmProvider, string> = {
  deepseek: "DeepSeek",
  gemini: "Gemini",
  claude: "Claude",
};
