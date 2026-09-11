/**
 * 404 page (Next.js `not-found.tsx`) — branded fallback for unmatched routes
 * and explicit `notFound()` calls.
 */
import Link from "next/link";
import { LogoMark, Wordmark } from "~/components/brand";
import { Button } from "~/components/ui/button";

export default function NotFound() {
  return (
    <div className="bg-studio-grid flex min-h-svh flex-col items-center justify-center gap-6 p-6 text-center">
      <div className="flex items-center gap-2">
        <LogoMark />
        <Wordmark />
      </div>
      <h1 className="font-display text-gradient-brand text-7xl font-bold">
        404
      </h1>
      <div className="space-y-2">
        <h2 className="font-display text-2xl font-bold">
          This clip doesn't exist
        </h2>
        <p className="text-muted-foreground max-w-md text-sm">
          The page you're looking for was moved, deleted, or never made the
          final cut.
        </p>
      </div>
      <Button asChild>
        <Link href="/dashboard">Back to the studio</Link>
      </Button>
    </div>
  );
}
