import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const YOUTUBE_TOKEN_REFRESH_THRESHOLD_MS = 5 * 60 * 1000;

// UI Notification Durations
export const TOAST_DURATION_SHORT = 4000;
export const TOAST_DURATION_MEDIUM = 5000;
export const TOAST_DURATION_LONG = 6000;
