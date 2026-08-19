"use client";

import { useCallback, useState } from "react";
import { getClipThumbnailUrls } from "~/actions/clips";

/**
 * Presigns a set of clip thumbnails on demand and caches the result, so a
 * collapsible clip group only signs its thumbnails the first time it's
 * expanded (never on page load, and never twice). Thumbnails are non-essential
 * — on failure the cards fall back to their gradient placeholder.
 */
export function useLazyThumbnails() {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (clipIds: string[]) => {
      if (loaded || loading || clipIds.length === 0) return;
      setLoading(true);
      try {
        setUrls(await getClipThumbnailUrls(clipIds));
      } catch {
          console.warn("Failed to load clip thumbnails");
        // Non-fatal — leave the cards on their placeholder.
      } finally {
        setLoaded(true);
        setLoading(false);
      }
    },
    [loaded, loading],
  );

  return { urls, loading, load };
}
