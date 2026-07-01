import { Inngest } from "inngest";

// Create a client to send and receive events.
// In local dev the Inngest dev server runs on :8288.
// INNGEST_BASE_URL is picked up automatically by the SDK when set, so we only
// need to set it explicitly as a fallback here for environments where the env
// var may not be present.
export const inngest = new Inngest({
  id: "clipcast-frontend",
  eventKey: process.env.INNGEST_EVENT_KEY ?? "local",
  baseUrl:
    process.env.INNGEST_BASE_URL ??
    (process.env.NODE_ENV !== "production"
      ? "http://127.0.0.1:8288"
      : undefined),
});
