import type { QueueStatusData } from "~/types";

/**
 * Shared queue-status query contract, in a plain module (NOT "use client")
 * so both sides can import it at runtime:
 * - the dashboard layout (server component) seeds the TanStack Query cache
 *   under this key via HydrationBoundary
 * - the client hook (~/hooks/use-queue-status) reads/polls under it
 *
 * It must not live in the "use client" hook file: value imports from a
 * client module into a server component become client-reference proxies,
 * and touching one server-side throws at request time (this exact mistake
 * took down /dashboard with "Something went wrong").
 */
export const QUEUE_STATUS_KEY = ["queue-status"] as const;

export type { QueueStatusData };
