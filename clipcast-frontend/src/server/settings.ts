import {
  DEFAULT_LLM_PROVIDER,
  LLM_PROVIDERS,
  type LlmProvider,
} from "~/lib/llm-providers";
import { db } from "~/server/db";

export { DEFAULT_LLM_PROVIDER, LLM_PROVIDERS, type LlmProvider };

const LLM_PROVIDER_KEY = "llm_provider";

/**
 * The admin-selected LLM provider for the AI crew (Colorist, music director,
 * …). Read on job submission and passed to the Modal backend so the choice can
 * be switched live with no redeploy. Falls back to the default when unset or
 * invalid.
 */
export async function getLlmProvider(): Promise<LlmProvider> {
  const row = await db.appSetting.findUnique({
    where: { key: LLM_PROVIDER_KEY },
  });
  const value = row?.value as LlmProvider | undefined;
  return value && LLM_PROVIDERS.includes(value) ? value : DEFAULT_LLM_PROVIDER;
}

/** Persist the active LLM provider (validated). Caller must gate on admin. */
export async function setLlmProviderSetting(value: LlmProvider): Promise<void> {
  await db.appSetting.upsert({
    where: { key: LLM_PROVIDER_KEY },
    update: { value },
    create: { key: LLM_PROVIDER_KEY, value },
  });
}
