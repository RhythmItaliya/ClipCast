/** The notification toggles a user can flip in Settings. */
export type NotificationPref =
  | "clipReady"
  | "weeklySummary"
  | "jobFailed"
  | "productUpdates";

/** Current values of every notification toggle. */
export type NotificationPrefs = Record<NotificationPref, boolean>;

/** Clip appearance settings: active-word caption highlight color
 * ("#RRGGBB", null = brand default) and optional personal watermark
 * (null/empty = no watermark burned into clips). */
export type ClipAppearance = {
  captionColor: string | null;
  watermarkText: string | null;
};
