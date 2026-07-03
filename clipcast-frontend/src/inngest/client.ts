import { Inngest } from "inngest";

// Create a client to send and receive events.
// - eventKey: used to send events to Inngest
// - signingKey: required for Inngest to verify webhook delivery in production
// Both values come from the Inngest dashboard → Settings → API Keys.
export const inngest = new Inngest({
  id: "clipcast-frontend",
  eventKey: process.env.INNGEST_EVENT_KEY ?? "local",
  // signingKey is read automatically from INNGEST_SIGNING_KEY env var by the
  // SDK when serve() is called — no need to set it here explicitly. It is used
  // to verify inbound webhook signatures so unauthorized callers cannot trigger
  // your functions.
});
