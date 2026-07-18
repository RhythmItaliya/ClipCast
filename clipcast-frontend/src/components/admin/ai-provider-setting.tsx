"use client";

import { Check, Cpu, Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { setLlmProvider } from "~/actions/admin";
import {
  LLM_PROVIDERS,
  LLM_PROVIDER_LABELS,
  type LlmProvider,
} from "~/lib/llm-providers";

/** Admin control: which LLM drives the AI crew (Colorist, music director…).
 * Live — the next job picks it up, no redeploy. */
export function AiProviderSetting({ current }: { current: LlmProvider }) {
  const [selected, setSelected] = useState<LlmProvider>(current);
  const [pending, startTransition] = useTransition();

  const save = (provider: LlmProvider) => {
    setSelected(provider);
    startTransition(async () => {
      const res = await setLlmProvider(provider);
      if (res.success) {
        toast.success(`AI provider set to ${LLM_PROVIDER_LABELS[provider]}.`);
      } else {
        setSelected(current);
        toast.error(res.error ?? "Couldn't update the provider.");
      }
    });
  };

  return (
    <div className="border-border bg-surface/40 rounded-3xl border p-5">
      <div className="flex items-center gap-2">
        <span className="bg-brand-soft text-brand grid size-8 place-items-center rounded-xl">
          <Cpu className="size-4" />
        </span>
        <div>
          <h3 className="text-sm font-semibold">AI provider</h3>
          <p className="text-muted-foreground text-xs">
            Which LLM the AI crew uses. Applies to the next job — no redeploy.
          </p>
        </div>
        {pending && <Loader2 className="text-muted-foreground ml-auto size-4 animate-spin" />}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {LLM_PROVIDERS.map((provider) => {
          const active = selected === provider;
          return (
            <button
              key={provider}
              onClick={() => save(provider)}
              disabled={pending}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-60 ${
                active
                  ? "border-brand bg-brand-soft text-brand"
                  : "border-border hover:bg-surface-2"
              }`}
            >
              {active && <Check className="size-3.5" />}
              {LLM_PROVIDER_LABELS[provider]}
            </button>
          );
        })}
      </div>
      <p className="text-muted-foreground mt-3 text-xs">
        Each provider needs its key in the Modal secret: DeepSeek →
        <code className="mx-1">DEEPSEEK_API_KEY</code>, Claude →
        <code className="mx-1">ANTHROPIC_API_KEY</code>, Gemini →
        <code className="mx-1">GEMINI_API_KEY</code>. If the chosen one isn&apos;t
        configured, the crew falls back to another, then to deterministic logic.
      </p>
    </div>
  );
}
