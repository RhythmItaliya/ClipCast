/**
 * Central home for the project's shared/domain types. Anything used by more
 * than one module (or crossing the server/client boundary) belongs here, in
 * a plain type-only module — never inside a "use client" or "use server"
 * file, where runtime imports of values would break or types get duplicated
 * per consumer.
 *
 * Purely-local component prop types stay next to their component.
 */
export type { ActionResult } from "./api";
export type { QueueFile, QueueStatusData } from "./queue";
export type { ClipItem, ClipGroup } from "./clips";
export type { PendingYouTubeChannel, YouTubeVideo } from "./youtube";
export type { PriceId, CreditTransactionRow } from "./billing";
export type {
  NotificationPref,
  NotificationPrefs,
  ClipAppearance,
} from "./settings";
export type { AdminUser, AdminJob, AdminClip } from "./admin";
