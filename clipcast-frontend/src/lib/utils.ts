import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** The shadcn/ui class-name helper: clsx flattens conditional class lists, then
 * tailwind-merge resolves conflicting Tailwind utilities so the last one wins
 * (e.g. `cn("px-2", "px-4")` -> "px-4"). Used everywhere for component styling. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Refresh a YouTube OAuth access token when it's within 5 minutes of expiring,
 * so an API call never races a token that lapses mid-request. */
export const YOUTUBE_TOKEN_REFRESH_THRESHOLD_MS = 5 * 60 * 1000;

/** Formats a Stripe amount (integer cents) as a localized currency string. */
export function formatCents(cents: number, currency = "usd"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

// UI Notification Durations
export const TOAST_DURATION_SHORT = 4000;
export const TOAST_DURATION_MEDIUM = 5000;
export const TOAST_DURATION_LONG = 6000;
