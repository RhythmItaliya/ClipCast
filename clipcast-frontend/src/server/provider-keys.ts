import { LLM_PROVIDERS, type LlmProvider } from "~/lib/llm-providers";
import { decryptSecret, encryptSecret } from "~/server/crypto";
import { db } from "~/server/db";

/**
 * Encrypted storage for each provider's LLM config, managed from the admin AI
 * Providers page.
 *
 * SECURITY: the WHOLE config (API key + model + effort + base URL) is stored as
 * one AES-256-GCM blob using SETTINGS_ENCRYPTION_KEY, so nothing is ever in
 * plaintext at rest. The API key is NEVER returned to any client — only a
 * `configured` flag + the last 4 chars. The non-secret fields (model / effort /
 * baseUrl) are decrypted only inside admin-gated server code so the panel can
 * edit them. At job dispatch the active provider's full config is decrypted
 * server-side and sent to Modal.
 */
export type ProviderConfig = {
  apiKey?: string;
  model?: string;
  effort?: string;
  baseUrl?: string;
};

/** Admin-safe view of a provider's config — never includes the API key. */
export type ProviderConfigStatus = {
  provider: LlmProvider;
  configured: boolean; // has an API key set
  last4: string | null;
  model: string | null;
  effort: string | null;
  baseUrl: string | null;
};

/**
 * Decrypt a provider's stored config blob, or null if unset/undecryptable.
 * Server-only (returns the API key). Legacy rows, which stored just the raw key
 * string, are read as `{ apiKey }` so nothing breaks after the upgrade.
 */
export async function getProviderConfig(
  provider: LlmProvider,
): Promise<ProviderConfig | null> {
  const row = await db.providerKey.findUnique({ where: { provider } });
  if (!row) return null;
  let plaintext: string;
  try {
    plaintext = decryptSecret({
      ciphertext: row.ciphertext,
      iv: row.iv,
      authTag: row.authTag,
    });
  } catch {
    // Wrong/rotated encryption key, or corrupted row — treat as unset rather
    // than crashing the job. Surfaced as "not configured" in the admin UI.
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(plaintext);
    if (parsed && typeof parsed === "object") return parsed as ProviderConfig;
  } catch {
    // Not JSON — a legacy row that stored the raw key string.
  }
  return { apiKey: plaintext };
}

/**
 * Merge `patch` into a provider's stored config and re-encrypt the whole blob.
 * Only the fields present in `patch` change (an empty string clears a field), so
 * the admin can update the model without re-entering the key. Gate on admin.
 */
export async function setProviderConfig(
  provider: LlmProvider,
  patch: ProviderConfig,
): Promise<void> {
  const merged: ProviderConfig = { ...((await getProviderConfig(provider)) ?? {}) };
  for (const field of ["apiKey", "model", "effort", "baseUrl"] as const) {
    if (patch[field] === undefined) continue; // field not being edited
    const value = patch[field]?.trim() ?? "";
    if (value) merged[field] = value;
    else delete merged[field]; // blank clears it → falls back to the default
  }
  const enc = encryptSecret(JSON.stringify(merged));
  const last4 = merged.apiKey ? merged.apiKey.slice(-4) : null;
  await db.providerKey.upsert({
    where: { provider },
    update: { ...enc, last4 },
    create: { provider, ...enc, last4 },
  });
}

/** Remove a provider's stored config (key + settings). Gate on admin. */
export async function deleteProviderKey(provider: LlmProvider): Promise<void> {
  await db.providerKey.deleteMany({ where: { provider } });
}

/** Admin-safe status for every provider — never returns the API key. */
export async function getProviderKeyStatuses(): Promise<ProviderConfigStatus[]> {
  const statuses: ProviderConfigStatus[] = [];
  for (const provider of LLM_PROVIDERS) {
    const cfg = await getProviderConfig(provider);
    statuses.push({
      provider,
      configured: !!cfg?.apiKey?.trim(),
      last4: cfg?.apiKey ? cfg.apiKey.slice(-4) : null,
      model: cfg?.model ?? null,
      effort: cfg?.effort ?? null,
      baseUrl: cfg?.baseUrl ?? null,
    });
  }
  return statuses;
}
