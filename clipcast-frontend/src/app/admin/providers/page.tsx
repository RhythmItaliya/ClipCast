import { getLlmProviderSetting, getProviderKeys } from "~/actions/admin";
import { ProviderKeysPanel } from "~/components/admin/provider-keys-panel";

export default async function AdminProvidersPage() {
  const [current, statuses] = await Promise.all([
    getLlmProviderSetting(),
    getProviderKeys(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">AI Providers</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Choose the active LLM and manage each provider&apos;s API key. Keys are
          stored encrypted and used across the video and audio pipelines.
        </p>
      </div>
      <ProviderKeysPanel current={current} statuses={statuses} />
    </div>
  );
}
