import { Loader2 } from "lucide-react";
import { LogoMark, Wordmark } from "~/components/brand";

// Shown while post-login's server component resolves the session and
// figures out where to redirect (dashboard vs admin) — without this the
// browser sits on a blank white tab for that round-trip.
export default function Loading() {
  return (
    <div className="bg-studio-grid flex min-h-svh flex-col items-center justify-center gap-6 p-6 text-center">
      <div className="flex items-center gap-2">
        <LogoMark />
        <Wordmark />
      </div>
      <div className="text-muted-foreground flex items-center gap-2 text-sm">
        <Loader2 className="size-4 animate-spin" />
        Signing you in…
      </div>
    </div>
  );
}
