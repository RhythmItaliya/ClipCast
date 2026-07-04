/**
 * Friendly error messages for every network / connection failure the client
 * can hit. Safe to import from both client and server code.
 */

export const FRIENDLY_MESSAGES = {
  offline:
    "You appear to be offline. Check your internet connection and try again.",
  network:
    "Connection problem — we couldn't reach the server. Check your internet and try again.",
  timeout: "The server is taking too long to respond. Please try again.",
  unauthorized: "Your session has expired. Please log in again.",
  tooMany: "You're doing that too fast. Wait a moment and try again.",
  server: "Something went wrong on our side. Please try again in a minute.",
  unknown: "Something unexpected went wrong. Please try again.",
  storage:
    "We couldn't reach our file storage. Please try again in a moment.",
  conflict:
    "This action conflicts with an existing record. Please refresh and try again.",
  payloadTooLarge:
    "That file is too large for the server to accept. Try a smaller file.",
  parseFailed:
    "The server returned an unexpected response. Please try again.",
  sessionExpired:
    "Your session has expired. Please log in again to continue.",
} as const;

/** True when the browser reports no connectivity (always false on server). */
export function isOffline(): boolean {
  return typeof navigator !== "undefined" && !navigator.onLine;
}

/**
 * Map any thrown value (fetch TypeError, AbortError, HTTP status…) to a
 * message a non-technical user can act on.
 */
export function getFriendlyErrorMessage(error: unknown): string {
  if (isOffline()) return FRIENDLY_MESSAGES.offline;

  if (error instanceof DOMException && error.name === "AbortError") {
    return FRIENDLY_MESSAGES.timeout;
  }
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return FRIENDLY_MESSAGES.timeout;
  }
  // fetch() network failures surface as TypeError in every browser
  if (error instanceof TypeError) return FRIENDLY_MESSAGES.network;

  if (error instanceof Error) {
    const msg = error.message.toLowerCase();

    // ── Network / connectivity ────────────────────────────────────────
    if (
      msg.includes("failed to fetch") ||
      msg.includes("network") ||
      msg.includes("econnrefused") ||
      msg.includes("econnreset") ||
      msg.includes("fetch failed") ||
      msg.includes("cors") ||
      msg.includes("load failed")
    ) {
      return FRIENDLY_MESSAGES.network;
    }

    // ── Timeout ───────────────────────────────────────────────────────
    if (msg.includes("timeout") || msg.includes("timed out")) {
      return FRIENDLY_MESSAGES.timeout;
    }

    // ── Auth ──────────────────────────────────────────────────────────
    if (msg.includes("unauthorized") || msg.includes("unauthenticated")) {
      return FRIENDLY_MESSAGES.unauthorized;
    }
    if (msg.includes("session") && msg.includes("expired")) {
      return FRIENDLY_MESSAGES.sessionExpired;
    }

    // ── Rate-limiting ────────────────────────────────────────────────
    if (msg.includes("too many") || msg.includes("rate limit")) {
      return FRIENDLY_MESSAGES.tooMany;
    }

    // ── Payload / storage ────────────────────────────────────────────
    if (msg.includes("payload too large") || msg.includes("entity too large")) {
      return FRIENDLY_MESSAGES.payloadTooLarge;
    }
    if (
      msg.includes("s3") ||
      msg.includes("storage") ||
      msg.includes("bucket") ||
      msg.includes("nosuchkey")
    ) {
      return FRIENDLY_MESSAGES.storage;
    }

    // ── Database unique constraint (Prisma P2002) ────────────────────
    if (msg.includes("unique constraint") || msg.includes("p2002")) {
      return FRIENDLY_MESSAGES.conflict;
    }

    // ── JSON parse failures ──────────────────────────────────────────
    if (msg.includes("json") && (msg.includes("parse") || msg.includes("unexpected token"))) {
      return FRIENDLY_MESSAGES.parseFailed;
    }
  }

  return FRIENDLY_MESSAGES.unknown;
}

/** Friendly message for a non-ok HTTP response. */
export function messageForStatus(status: number): string {
  if (status === 401 || status === 403) return FRIENDLY_MESSAGES.unauthorized;
  if (status === 408 || status === 504) return FRIENDLY_MESSAGES.timeout;
  if (status === 413) return FRIENDLY_MESSAGES.payloadTooLarge;
  if (status === 429) return FRIENDLY_MESSAGES.tooMany;
  if (status >= 500) return FRIENDLY_MESSAGES.server;
  return FRIENDLY_MESSAGES.unknown;
}

/**
 * fetch() wrapper with a timeout and friendly error translation.
 * Throws Error(friendlyMessage) so callers can `toast.error(err.message)`.
 */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 30_000,
): Promise<Response> {
  if (isOffline()) throw new Error(FRIENDLY_MESSAGES.offline);
  try {
    return await fetch(input, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new Error(getFriendlyErrorMessage(err));
  }
}
