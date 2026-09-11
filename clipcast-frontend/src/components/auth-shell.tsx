import Link from "next/link";
import type { ReactNode } from "react";
import { LogoMark, Wordmark } from "~/components/brand";

/**
 * Split-panel layout shared by the login and signup pages: a marketing/brand
 * panel on the left (hidden on small screens) and the auth form (children) on
 * the right. Server component — no interactivity of its own.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="bg-background text-foreground min-h-screen">
      <div className="grid min-h-screen grid-cols-1 lg:grid-cols-2">
        {/* Left brand panel */}
        <div className="from-brand/10 via-background to-background relative hidden overflow-hidden bg-gradient-to-br lg:block">
          <div className="relative flex h-full flex-col justify-between p-10">
            <Link href="/" className="flex items-center gap-2.5">
              <LogoMark />
              <Wordmark className="text-base" />
            </Link>
            <div>
              <blockquote className="max-w-md text-2xl leading-snug font-medium tracking-tight">
                &ldquo;Turn every episode into a week of shareable clips —
                automatically.&rdquo;
              </blockquote>
              <div className="text-muted-foreground mt-4 text-sm">
                Trusted by creators, podcasters and studios.
              </div>
            </div>
          </div>
        </div>

        {/* Right form panel */}
        <div className="flex items-center justify-center px-6 py-12 sm:px-10">
          <div className="w-full max-w-md">
            <Link
              href="/"
              className="mb-8 inline-flex items-center gap-2 lg:hidden"
            >
              <LogoMark className="size-8" />
              <span className="text-sm font-semibold">ClipCast</span>
            </Link>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
