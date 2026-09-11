"use server";

import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import Stripe from "stripe";
import { env } from "~/env";
import { type LlmProvider } from "~/lib/llm-providers";
import {
  SERVICES,
  type ServiceStatus,
  type ServiceTestResult,
} from "~/lib/services";
import { db } from "~/server/db";
import { getProviderConfig, getProviderKeyStatuses } from "~/server/provider-keys";
import { requireAdmin } from "~/server/require-admin";

// ── Config status (no network) ────────────────────────────────────────────────

/** Which dependencies are configured (env/keys present). Admin-only. */
export async function getServiceStatuses(): Promise<ServiceStatus[]> {
  await requireAdmin();
  const keyed = new Map((await getProviderKeyStatuses()).map((s) => [s.provider, s]));

  const endpoint = (url: string | undefined) => ({
    configured: !!url,
    note: url ? null : "Endpoint URL not set.",
  });
  const llm = (provider: LlmProvider) => {
    const st = keyed.get(provider);
    return st?.configured
      ? { configured: true, note: `UI key •••• ${st.last4 ?? "????"}` }
      : { configured: false, note: "No key in UI (may be set in the Modal secret)." };
  };

  const byId: Record<string, { configured: boolean; note: string | null }> = {
    database: { configured: true, note: null },
    s3: {
      configured: !!(env.AWS_ACCESS_KEY_ID && env.S3_BUCKET_NAME),
      note: env.S3_BUCKET_NAME ? `Bucket: ${env.S3_BUCKET_NAME}` : "No bucket set.",
    },
    "modal-processor": endpoint(env.PROCESS_VIDEO_ENDPOINT),
    "modal-downloader": endpoint(env.DOWNLOAD_VIDEO_ENDPOINT),
    "modal-mixer": endpoint(env.PROCESS_AUDIO_ENDPOINT),
    "modal-duration": endpoint(env.YOUTUBE_DURATION_ENDPOINT),
    "llm-deepseek": llm("deepseek"),
    "llm-gemini": llm("gemini"),
    "llm-claude": llm("claude"),
    "llm-openai": llm("openai"),
    stripe: { configured: !!env.STRIPE_SECRET_KEY, note: null },
    inngest: {
      configured: !!env.INNGEST_EVENT_KEY,
      note: "Config only — no live probe.",
    },
  };

  return SERVICES.map((s) => ({
    ...s,
    ...(byId[s.id] ?? { configured: false, note: null }),
  }));
}

// ── Live probes ────────────────────────────────────────────────────────────────

/** Run a real connection test against one service. Admin-only. */
export async function testService(id: string): Promise<ServiceTestResult> {
  await requireAdmin();
  switch (id) {
    case "database":
      return probeDatabase();
    case "s3":
      return probeS3();
    case "modal-processor":
      return probeReachable(env.PROCESS_VIDEO_ENDPOINT, "Processor");
    case "modal-downloader":
      return probeReachable(env.DOWNLOAD_VIDEO_ENDPOINT, "Downloader");
    case "modal-mixer":
      return probeReachable(env.PROCESS_AUDIO_ENDPOINT, "Mixer");
    case "modal-duration":
      return probeReachable(env.YOUTUBE_DURATION_ENDPOINT, "Duration lookup");
    case "llm-deepseek":
      return probeLlm("deepseek");
    case "llm-gemini":
      return probeLlm("gemini");
    case "llm-claude":
      return probeLlm("claude");
    case "llm-openai":
      return probeLlm("openai");
    case "stripe":
      return probeStripe();
    case "inngest":
      return {
        ok: !!env.INNGEST_EVENT_KEY,
        detail: env.INNGEST_EVENT_KEY
          ? "Event + signing keys present."
          : "Not configured.",
        latencyMs: 0,
      };
    default:
      return { ok: false, detail: "Unknown service.", latencyMs: 0 };
  }
}

function fail(err: unknown, started: number): ServiceTestResult {
  const msg = err instanceof Error ? err.message : "Unknown error.";
  return { ok: false, detail: msg.slice(0, 200), latencyMs: Date.now() - started };
}

async function probeDatabase(): Promise<ServiceTestResult> {
  const t = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    return { ok: true, detail: "Query OK.", latencyMs: Date.now() - t };
  } catch (err) {
    return fail(err, t);
  }
}

async function probeS3(): Promise<ServiceTestResult> {
  const t = Date.now();
  try {
    const client = new S3Client({
      region: env.AWS_REGION,
      credentials: {
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      },
    });
    await client.send(new HeadBucketCommand({ Bucket: env.S3_BUCKET_NAME }));
    return {
      ok: true,
      detail: `Bucket "${env.S3_BUCKET_NAME}" reachable.`,
      latencyMs: Date.now() - t,
    };
  } catch (err) {
    return fail(err, t);
  }
}

async function probeReachable(
  url: string | undefined,
  label: string,
): Promise<ServiceTestResult> {
  const t = Date.now();
  if (!url) return { ok: false, detail: `${label} endpoint not configured.`, latencyMs: 0 };
  try {
    // These endpoints require an authed POST; a GET returning 4xx/405 still
    // proves the app is deployed and routing — that's "reachable".
    const res = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(8000),
    });
    return { ok: true, detail: `Reachable (HTTP ${res.status}).`, latencyMs: Date.now() - t };
  } catch (err) {
    return fail(err, t);
  }
}

async function probeStripe(): Promise<ServiceTestResult> {
  const t = Date.now();
  try {
    const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
      apiVersion: "2026-04-22.dahlia",
    });
    await stripe.balance.retrieve();
    return { ok: true, detail: "Authenticated.", latencyMs: Date.now() - t };
  } catch (err) {
    return fail(err, t);
  }
}

// Each probe targets the provider's "list models" endpoint. `baseUrl` is the
// admin-configured endpoint (a gateway) when set, so the test hits the same
// host the real jobs do — otherwise a gateway key would look "invalid" against
// the real API. The trailing slash is trimmed before the path is appended.
const trimSlash = (u: string) => u.replace(/\/+$/, "");
const LLM_PROBES: Record<
  LlmProvider,
  (
    key: string,
    baseUrl: string | null,
  ) => { url: string; headers: Record<string, string> }
> = {
  deepseek: (key, baseUrl) => ({
    url: `${trimSlash(baseUrl ?? "https://api.deepseek.com")}/models`,
    headers: { Authorization: `Bearer ${key}` },
  }),
  openai: (key, baseUrl) => ({
    url: `${trimSlash(baseUrl ?? "https://api.openai.com")}/v1/models`,
    headers: { Authorization: `Bearer ${key}` },
  }),
  claude: (key, baseUrl) => ({
    url: `${trimSlash(baseUrl ?? "https://api.anthropic.com")}/v1/models`,
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
  }),
  gemini: (key, baseUrl) => ({
    url: `${trimSlash(baseUrl ?? "https://generativelanguage.googleapis.com")}/v1beta/models?key=${encodeURIComponent(key)}`,
    headers: {},
  }),
};

async function probeLlm(provider: LlmProvider): Promise<ServiceTestResult> {
  const t = Date.now();
  const cfg = await getProviderConfig(provider);
  const key = cfg?.apiKey?.trim() ? cfg.apiKey : null;
  if (!key) {
    return { ok: false, detail: "No key set in the UI. Add one on AI Providers.", latencyMs: 0 };
  }
  try {
    const { url, headers } = LLM_PROBES[provider](key, cfg?.baseUrl ?? null);
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
    if (res.ok) {
      return { ok: true, detail: "Authenticated — key works.", latencyMs: Date.now() - t };
    }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, detail: `Auth rejected (HTTP ${res.status}) — check the key.`, latencyMs: Date.now() - t };
    }
    return { ok: false, detail: `HTTP ${res.status}.`, latencyMs: Date.now() - t };
  } catch (err) {
    return fail(err, t);
  }
}
