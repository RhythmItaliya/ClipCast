"use client";

import { RefreshCw, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { LogoMark, Wordmark } from "~/components/brand";
import { Button } from "~/components/ui/button";

// Give the user a couple of manual retries before giving up on this page.
// A crash that's actually deterministic (same bug every render) would
// otherwise let "Try again" be clicked forever, spamming the same
// console.error and any backend calls the page makes on every render.
const MAX_RETRIES = 2;

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();
  // A ref, not state: it must persist across `reset()` calls without
  // itself triggering a re-render, and this boundary component stays
  // mounted across resets (only its children remount), so the count
  // survives from one failed attempt to the next.
  const retryCount = useRef(0);
  const [autoRedirecting, setAutoRedirecting] = useState(false);

  useEffect(() => {
    console.error("[app-error]", error);
    // Fires again every time a retry attempt crashes with a new error.
    // Once we've already given this page its retries and it's still
    // failing, stop offering more and send the user somewhere that works.
    if (retryCount.current >= MAX_RETRIES) {
      setAutoRedirecting(true);
      router.replace("/dashboard");
    }
  }, [error, router]);

  const handleRetry = () => {
    retryCount.current += 1;
    reset();
  };

  const retriesExhausted = retryCount.current >= MAX_RETRIES;

  return (
    <div className="bg-studio-grid flex min-h-svh flex-col items-center justify-center gap-6 p-6 text-center">
      <div className="flex items-center gap-2">
        <LogoMark />
        <Wordmark />
      </div>
      <div className="bg-destructive/10 text-destructive flex h-16 w-16 items-center justify-center rounded-2xl">
        <TriangleAlert className="h-8 w-8" />
      </div>
      <div className="space-y-2">
        <h1 className="font-display text-2xl font-bold">
          Something went wrong
        </h1>
        <p className="text-muted-foreground max-w-md text-sm">
          {retriesExhausted || autoRedirecting
            ? "This page keeps failing to load, so we're taking you back to your dashboard."
            : "An unexpected error stopped this page from loading. It's not you, try again, and if it keeps happening check your connection or come back in a minute."}
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
          <Link href="/dashboard">Go to dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
