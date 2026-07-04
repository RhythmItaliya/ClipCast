"use client";

import "~/styles/globals.css";

import { RefreshCw, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { LogoMark, Wordmark } from "~/components/brand";
import { Button } from "~/components/ui/button";

// Same reasoning as src/app/error.tsx: cap manual retries so a deterministic
// crash can't be spammed forever, then send the user somewhere that works.
const MAX_RETRIES = 2;

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const retryCount = useRef(0);
  const [autoRedirecting, setAutoRedirecting] = useState(false);

  useEffect(() => {
    console.error("[global-error]", error);
    if (retryCount.current >= MAX_RETRIES) {
      setAutoRedirecting(true);
      // Plain navigation, not next/navigation's router: the root layout
      // itself crashed, so app routing context can't be relied on here.
      window.location.href = "/dashboard";
    }
  }, [error]);

  const handleRetry = () => {
    retryCount.current += 1;
    reset();
  };

  const retriesExhausted = retryCount.current >= MAX_RETRIES;

  // Root-level boundary: renders its own <html>/<body>, and imports
  // globals.css directly above rather than relying on the root layout
  // (which is what just crashed) to have loaded it.
  return (
    <html lang="en">
      <body className="bg-studio-grid flex min-h-svh flex-col items-center justify-center gap-6 p-6 text-center">
        <div className="flex items-center gap-2">
          <LogoMark />
          <Wordmark />
        </div>
        <div className="bg-destructive/10 text-destructive flex h-16 w-16 items-center justify-center rounded-2xl">
          <TriangleAlert className="h-8 w-8" />
        </div>
        <div className="space-y-2">
          <h1 className="font-display text-2xl font-bold">
            ClipCast hit a snag
          </h1>
          <p className="text-muted-foreground max-w-md text-sm">
            {retriesExhausted || autoRedirecting
              ? "This keeps failing, so we're taking you back to your dashboard."
              : "A critical error occurred. Please try again, and if the problem persists, check your internet connection."}
          </p>
        </div>
        <div className="flex gap-3">
          {!retriesExhausted && (
            <Button onClick={handleRetry}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Try again
            </Button>
          )}
          <Button variant="outline" asChild>
            <a href="/dashboard">Go to dashboard</a>
          </Button>
        </div>
      </body>
    </html>
  );
}
