"use client";

import {
  Check,
  Cpu,
  KeyRound,
  Loader2,
  Save,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  removeProviderApiKey,
  saveProviderApiKey,
  saveProviderConfig,
  setLlmProvider,
} from "~/actions/admin";
import { useConfirm } from "~/components/ui/confirm-dialog";
import {
  LLM_EFFORTS,
  LLM_PROVIDERS,
  LLM_PROVIDER_DEFAULT_MODELS,
  LLM_PROVIDER_ENV_KEYS,
  LLM_PROVIDER_LABELS,
  PROVIDERS_WITH_EFFORT,
  type LlmProvider,
} from "~/lib/llm-providers";
import type { ProviderConfigStatus } from "~/server/provider-keys";

/**
 * Admin control for the multi-LLM setup: pick the active provider (drives the
 * AI crew + clip moment-selection), manage each provider's API key, and set its
 * per-provider config — model, endpoint (base URL, for gateways), and effort
 * (Claude only). The API key is stored encrypted and never returned; only a
 * configured flag + last 4 chars are shown. Model/endpoint/effort are editable
 * settings (not secrets) and are only ever loaded here on the admin page.
 */
type ConfigDraft = { model: string; effort: string; baseUrl: string };

export function ProviderKeysPanel({
  current,
  statuses,
}: {
  current: LlmProvider;
  statuses: ProviderConfigStatus[];
}) {
  const confirm = useConfirm();
  const [active, setActive] = useState<LlmProvider>(current);
  const [switching, setSwitching] = useState<LlmProvider | null>(null);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [configs, setConfigs] = useState<Record<string, ConfigDraft>>(() =>
    Object.fromEntries(
      LLM_PROVIDERS.map((p) => {
        const s = statuses.find((x) => x.provider === p);
        return [
          p,
          {
            model: s?.model ?? "",
            effort: s?.effort ?? "",
            baseUrl: s?.baseUrl ?? "",
          },
        ];
      }),
    ),
  );
  const [busy, setBusy] = useState<string | null>(null); // `${action}:${provider}`

  const statusFor = (p: LlmProvider): ProviderConfigStatus =>
    statuses.find((s) => s.provider === p) ?? {
      provider: p,
      configured: false,
      last4: null,
      model: null,
      effort: null,
      baseUrl: null,
    };

  const configFor = (p: LlmProvider): ConfigDraft =>
    configs[p] ?? { model: "", effort: "", baseUrl: "" };

  const setConfigField = (
    p: LlmProvider,
    field: keyof ConfigDraft,
    value: string,
  ) =>
    setConfigs((c) => ({ ...c, [p]: { ...configFor(p), [field]: value } }));

  const chooseActive = async (provider: LlmProvider) => {
    if (provider === active || switching) return;
    const prev = active;
    setActive(provider);
    setSwitching(provider);
    const res = await setLlmProvider(provider);
    setSwitching(null);
    if (res.success) {
      toast.success(`Active provider: ${LLM_PROVIDER_LABELS[provider]}.`);
    } else {
      setActive(prev);
      toast.error(res.error ?? "Couldn't switch provider.");
    }
  };

  const saveKey = async (provider: LlmProvider) => {
    const value = (inputs[provider] ?? "").trim();
    if (!value) {
      toast.error("Enter a key first.");
      return;
    }
    setBusy(`save:${provider}`);
    const res = await saveProviderApiKey(provider, value);
    setBusy(null);
    if (res.success) {
      setInputs((s) => ({ ...s, [provider]: "" }));
      toast.success(`${LLM_PROVIDER_LABELS[provider]} key saved.`);
    } else {
      toast.error(res.error ?? "Couldn't save the key.");
    }
  };

  const saveConfig = async (provider: LlmProvider) => {
    setBusy(`config:${provider}`);
    const res = await saveProviderConfig(provider, configFor(provider));
    setBusy(null);
    if (res.success) {
      toast.success(`${LLM_PROVIDER_LABELS[provider]} settings saved.`);
    } else {
      toast.error(res.error ?? "Couldn't save settings.");
    }
  };

  const removeKey = async (provider: LlmProvider) => {
    const ok = await confirm({
      title: `Remove the ${LLM_PROVIDER_LABELS[provider]} key?`,
      description:
        "Jobs will fall back to another provider or the backend secret.",
      confirmLabel: "Remove",
      destructive: true,
    });
    if (!ok) return;
    setBusy(`remove:${provider}`);
    const res = await removeProviderApiKey(provider);
    setBusy(null);
    if (res.success) {
      toast.success(`${LLM_PROVIDER_LABELS[provider]} key removed.`);
    } else {
      toast.error(res.error ?? "Couldn't remove the key.");
    }
  };

  return (
    <div className="space-y-6">
      {/* Active provider selector */}
      <div className="border-border bg-surface/40 rounded-3xl border p-5">
        <div className="flex items-center gap-2">
          <span className="bg-brand-soft text-brand grid size-8 place-items-center rounded-xl">
            <Cpu className="size-4" />
          </span>
          <div>
            <h3 className="text-sm font-semibold">Active provider</h3>
            <p className="text-muted-foreground text-xs">
              Which LLM runs the AI crew and clip moment-selection. Applies to
              the next job — no redeploy.
            </p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {LLM_PROVIDERS.map((provider) => {
            const isActive = active === provider;
            return (
              <button
                key={provider}
                onClick={() => chooseActive(provider)}
                disabled={switching !== null}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-60 ${
                  isActive
                    ? "border-brand bg-brand-soft text-brand"
                    : "border-border hover:bg-surface-2"
                }`}
              >
                {switching === provider ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  isActive && <Check className="size-3.5" />
                )}
                {LLM_PROVIDER_LABELS[provider]}
              </button>
            );
          })}
        </div>
      </div>

      {/* Per-provider keys + settings */}
      <div className="border-border bg-surface/40 rounded-3xl border p-5">
        <div className="flex items-center gap-2">
          <span className="bg-brand-soft text-brand grid size-8 place-items-center rounded-xl">
            <KeyRound className="size-4" />
          </span>
          <div>
            <h3 className="text-sm font-semibold">Keys & settings</h3>
            <p className="text-muted-foreground text-xs">
              Everything here is stored encrypted (AES-256-GCM) and passed to
              processing per job. The API key is never shown again after saving.
            </p>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {LLM_PROVIDERS.map((provider) => {
            const st = statusFor(provider);
            const cfg = configFor(provider);
            const saving = busy === `save:${provider}`;
            const removing = busy === `remove:${provider}`;
            const savingConfig = busy === `config:${provider}`;
            const supportsEffort = PROVIDERS_WITH_EFFORT.includes(provider);
            return (
              <div
                key={provider}
                className="border-border bg-background rounded-2xl border p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">
                    {LLM_PROVIDER_LABELS[provider]}
                  </span>
                  {active === provider && (
                    <span className="bg-brand-soft text-brand rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase">
                      Active
                    </span>
                  )}
                  {st.configured ? (
                    <span className="rounded-full bg-green-500/10 px-2 py-0.5 text-[11px] font-medium text-green-600 dark:text-green-400">
                      Configured •••• {st.last4 ?? "????"}
                    </span>
                  ) : (
                    <span className="text-muted-foreground bg-surface-2 rounded-full px-2 py-0.5 text-[11px] font-medium">
                      No key set
                    </span>
                  )}
                  <code className="text-muted-foreground ml-auto text-[11px]">
                    {LLM_PROVIDER_ENV_KEYS[provider]}
                  </code>
                </div>

                {/* API key (write-only) */}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <input
                    type="password"
                    autoComplete="off"
                    placeholder={
                      st.configured
                        ? "Enter a new key to replace"
                        : "Paste API key"
                    }
                    value={inputs[provider] ?? ""}
                    onChange={(e) =>
                      setInputs((s) => ({ ...s, [provider]: e.target.value }))
                    }
                    className="border-border bg-surface/40 focus:border-brand min-w-0 flex-1 rounded-lg border px-3 py-1.5 text-sm outline-none"
                  />
                  <button
                    onClick={() => saveKey(provider)}
                    disabled={saving || removing}
                    className="border-brand bg-brand-soft text-brand flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-60"
                  >
                    {saving ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Save className="size-3.5" />
                    )}
                    Save
                  </button>
                  {st.configured && (
                    <button
                      onClick={() => removeKey(provider)}
                      disabled={saving || removing}
                      title="Remove key"
                      className="border-border text-muted-foreground hover:text-destructive grid size-8 place-items-center rounded-lg border transition-colors disabled:opacity-60"
                    >
                      {removing ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="size-3.5" />
                      )}
                    </button>
                  )}
                </div>

                {/* Non-secret settings: model, endpoint, effort */}
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <label className="block">
                    <span className="text-muted-foreground text-[11px] font-medium">
                      Model
                    </span>
                    <input
                      type="text"
                      autoComplete="off"
                      placeholder={LLM_PROVIDER_DEFAULT_MODELS[provider]}
                      value={cfg.model}
                      onChange={(e) =>
                        setConfigField(provider, "model", e.target.value)
                      }
                      className="border-border bg-surface/40 focus:border-brand mt-1 w-full rounded-lg border px-3 py-1.5 text-sm outline-none"
                    />
                  </label>
                  <label className="block">
                    <span className="text-muted-foreground text-[11px] font-medium">
                      Endpoint (optional)
                    </span>
                    <input
                      type="text"
                      autoComplete="off"
                      placeholder="Default API — set to use a gateway"
                      value={cfg.baseUrl}
                      onChange={(e) =>
                        setConfigField(provider, "baseUrl", e.target.value)
                      }
                      className="border-border bg-surface/40 focus:border-brand mt-1 w-full rounded-lg border px-3 py-1.5 text-sm outline-none"
                    />
                  </label>
                  {supportsEffort && (
                    <label className="block">
                      <span className="text-muted-foreground text-[11px] font-medium">
                        Effort (cost control)
                      </span>
                      <select
                        value={cfg.effort}
                        onChange={(e) =>
                          setConfigField(provider, "effort", e.target.value)
                        }
                        className="border-border bg-surface/40 focus:border-brand mt-1 w-full rounded-lg border px-3 py-1.5 text-sm outline-none"
                      >
                        <option value="">Default (low)</option>
                        {LLM_EFFORTS.map((e) => (
                          <option key={e} value={e}>
                            {e}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
                <div className="mt-2 flex justify-end">
                  <button
                    onClick={() => saveConfig(provider)}
                    disabled={savingConfig}
                    className="border-border hover:bg-surface-2 flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-60"
                  >
                    {savingConfig ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <SlidersHorizontal className="size-3.5" />
                    )}
                    Save settings
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <p className="text-muted-foreground mt-4 text-xs">
          Values set here override the backend defaults for the matching
          provider. Leave a field blank to use the default. If a provider has no
          key here or in the Modal secret, the crew falls back to another
          provider, then to deterministic logic.
        </p>
      </div>
    </div>
  );
}
