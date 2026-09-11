/** Client-safe service registry (no server/env imports) so the admin health
 * UI and the server-side probes can share the same definitions. */
export type ServiceGroup = "Core" | "Modal" | "LLM" | "Integrations";

export type ServiceDef = {
  id: string;
  label: string;
  group: ServiceGroup;
  description: string;
};

/** Config presence for a service — computed server-side, safe for the client. */
export type ServiceStatus = ServiceDef & {
  configured: boolean;
  note: string | null;
};

/** Result of a live "Test connection" probe. */
export type ServiceTestResult = {
  ok: boolean;
  detail: string;
  latencyMs: number;
};

export const SERVICE_GROUPS: ServiceGroup[] = [
  "Core",
  "Modal",
  "LLM",
  "Integrations",
];

export const SERVICES: ServiceDef[] = [
  {
    id: "database",
    label: "Database",
    group: "Core",
    description: "Supabase Postgres via Prisma.",
  },
  {
    id: "s3",
    label: "AWS S3",
    group: "Core",
    description: "Source uploads + rendered clips.",
  },
  {
    id: "modal-processor",
    label: "Processor (GPU)",
    group: "Modal",
    description: "clipcast — transcribe, clip, caption, reframe.",
  },
  {
    id: "modal-downloader",
    label: "Downloader",
    group: "Modal",
    description: "clipcast-downloader — YouTube → S3.",
  },
  {
    id: "modal-mixer",
    label: "Audio Mixer",
    group: "Modal",
    description: "clipcast-mixer — Audio Studio.",
  },
  {
    id: "modal-duration",
    label: "Duration lookup",
    group: "Modal",
    description: "Fast YouTube duration probe (credit gate).",
  },
  {
    id: "llm-deepseek",
    label: "DeepSeek",
    group: "LLM",
    description: "Chat completions.",
  },
  {
    id: "llm-gemini",
    label: "Gemini",
    group: "LLM",
    description: "generateContent.",
  },
  {
    id: "llm-claude",
    label: "Claude",
    group: "LLM",
    description: "Anthropic messages.",
  },
  {
    id: "llm-openai",
    label: "OpenAI",
    group: "LLM",
    description: "Chat completions.",
  },
  {
    id: "stripe",
    label: "Stripe",
    group: "Integrations",
    description: "Credit-pack billing.",
  },
  {
    id: "inngest",
    label: "Inngest",
    group: "Integrations",
    description: "Background job queue + crons.",
  },
];
