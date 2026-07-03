"use client";

import { RefreshCw, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { LogoMark, Wordmark } from "~/components/brand";
import { Button } from "~/components/ui/button";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app-error]", error);
  }, [error]);

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
          An unexpected error stopped this page from loading. It's not you —
          try again, and if it keeps happening check your connection or come
          back in a minute.
        </p>
      </div>
      <div className="flex gap-3">
        <Button onClick={reset}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Try again
        </Button>
        <Button variant="outline" asChild>
          <Link href="/dashboard">Go to dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
