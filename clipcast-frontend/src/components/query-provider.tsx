"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

/**
 * One QueryClient per browser session (created lazily inside the component
 * so an SSR pass never shares a client between requests). TanStack Query's
 * defaults do the heavy lifting the app previously hand-rolled:
 * - structural sharing: refetched data that hasn't changed keeps the same
 *   object identity, so subscribed components don't re-render at all
 * - tracked queries + select: components re-render only for the slice of a
 *   query they actually read
 * - refetchIntervalInBackground=false: polling pauses in hidden tabs
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Navigating between dashboard pages remounts consumers; treat
            // data as fresh briefly so each mount doesn't refire the fetch
            // the poll interval just made.
            staleTime: 5_000,
            retry: 1,
          },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
