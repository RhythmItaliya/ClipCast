"use client";

/**
 * Dashboard chrome: fixed sidebar + topbar + mobile nav around the routed page
 * content. Highlights the active nav item, shows the live credit balance, and
 * handles sign-out. Client component — it reads the current path (usePathname),
 * subscribes to live-polled credits, and drives the interactive sign-out flow.
 */

import {
  Coins,
  CreditCard,
  HelpCircle,
  LayoutDashboard,
  LibraryBig,
  ListChecks,
  LogOut,
  Loader2,
  Settings,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { signOut } from "next-auth/react";
import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ComponentType, type ReactNode } from "react";
import { LogoMark, Wordmark, YoutubeIcon } from "~/components/brand";
import { useConfirm } from "~/components/ui/confirm-dialog";
import { useQueueStatus } from "~/hooks/use-queue-status";

// Must render inside a <Link>'s children — useLinkStatus reports whether
// that specific link's navigation is still pending, so each nav item can
// show its own spinner instead of the icon while the route transitions.
function NavIcon({
  icon: Icon,
  className,
}: {
  icon: ComponentType<{ className?: string }>;
  className: string;
}) {
  const { pending } = useLinkStatus();
  return pending ? (
    <Loader2 className={`${className} animate-spin`} />
  ) : (
    <Icon className={className} />
  );
}

const nav = [
  {
    title: "Overview",
    to: "/dashboard",
    icon: LayoutDashboard,
    description: "Turn long-form podcasts into share-ready clips.",
  },
  {
    title: "Library",
    to: "/dashboard/clips",
    icon: LibraryBig,
    description: "Every clip and audio mix you've generated.",
  },
  {
    title: "Audio Studio",
    to: "/dashboard/audio",
    icon: Sparkles,
    description: "Generate music or mash up two songs into a beat-matched mix.",
  },
  {
    title: "Queue",
    to: "/dashboard/queue",
    icon: ListChecks,
    description: "Processing jobs across your workspace.",
  },
  {
    title: "YouTube",
    to: "/dashboard/youtube",
    icon: YoutubeIcon,
    description: "Connect your channel to auto-pull and clip your videos.",
  },
  {
    title: "Billing",
    to: "/dashboard/billing",
    icon: CreditCard,
    description: "One-time credit packs. No subscription.",
  },
  {
    title: "Settings",
    to: "/dashboard/settings",
    icon: Settings,
    description: "Manage your profile and account.",
  },
] as const;

export function DashboardShell({
  children,
  email,
  name,
  isAdmin = false,
}: {
  children: ReactNode;
  email: string;
  name: string | null;
  isAdmin?: boolean;
}) {
  const pathname = usePathname();
  const current =
    nav.find((n) => n.to === pathname) ??
    nav.find((n) => n.to !== "/dashboard" && pathname.startsWith(n.to)) ??
    nav[0];
  const displayName = name ?? email.split("@")[0] ?? "Creator";

  const confirm = useConfirm();
  const [signingOut, setSigningOut] = useState(false);
  const handleSignOut = async () => {
    const ok = await confirm({
      title: "Sign out of ClipCast?",
      confirmLabel: "Sign out",
    });
    if (!ok) return;
    setSigningOut(true);
    try {
      await signOut({ redirectTo: "/login" });
    } catch {
      setSigningOut(false);
    }
  };

  return (
    <div className="bg-background text-foreground selection:bg-brand/30 h-screen overflow-hidden">
      <div className="flex h-full">
        {/* Sidebar */}
        <aside className="border-border bg-sidebar hidden h-full w-64 shrink-0 flex-col border-r lg:flex">
          <div className="border-border flex h-16 items-center gap-2.5 border-b px-6">
            <LogoMark className="size-8 rounded-lg" />
            <Wordmark />
          </div>

          <nav className="flex-1 space-y-1 p-3">
            <div className="text-muted-foreground px-3 pt-3 pb-2 text-[10px] font-semibold tracking-widest uppercase">
              Workspace
            </div>
            {nav.map((item) => {
              const active = pathname === item.to;
              const Icon = item.icon;
              return (
                <Link
                  key={item.to}
                  href={item.to}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    active
                      ? "bg-brand-soft text-brand"
                      : "text-muted-foreground hover:bg-surface hover:text-foreground"
                  }`}
                >
                  <NavIcon icon={Icon} className="size-4" />
                  <span>{item.title}</span>
                  {active && (
                    <span className="bg-brand ml-auto size-1.5 rounded-full" />
                  )}
                </Link>
              );
            })}
          </nav>

          <CreditBalanceCard />

          {isAdmin && (
            <div className="px-3 pb-1">
              <Link
                href="/admin"
                className="border-brand/20 bg-brand-soft text-brand hover:opacity-90 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-opacity"
              >
                <ShieldCheck className="size-4" />
                Admin panel
              </Link>
            </div>
          )}

          <div className="border-border border-t p-3">
            <div className="flex items-center gap-3 rounded-lg p-2">
              <div className="bg-brand-soft text-brand ring-brand/20 grid size-9 place-items-center rounded-full ring-1">
                <span className="text-xs font-semibold uppercase">
                  {displayName.charAt(0)}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  {displayName}
                </div>
                <div className="text-muted-foreground truncate text-xs">
                  {email}
                </div>
              </div>
              <button
                type="button"
                title="Sign out"
                onClick={handleSignOut}
                disabled={signingOut}
                className="text-muted-foreground hover:bg-surface hover:text-destructive grid size-8 place-items-center rounded-md disabled:opacity-50"
              >
                {signingOut ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <LogOut className="size-4" />
                )}
              </button>
            </div>
          </div>
        </aside>

        {/* Main */}
        <div className="flex h-full min-w-0 flex-1 flex-col">
          {/* Topbar */}
          <header className="border-border bg-background/70 shrink-0 border-b backdrop-blur-xl">
            <div className="flex h-16 items-center gap-4 px-6 lg:px-10">
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-lg font-semibold tracking-tight">
                  {current.title}
                </h1>
                <p className="text-muted-foreground truncate text-xs">
                  {current.description}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  href="/dashboard/settings"
                  className="border-border bg-surface text-muted-foreground hover:text-foreground grid size-9 place-items-center rounded-lg border"
                  title="Settings"
                >
                  <HelpCircle className="size-4" />
                </Link>
                <button
                  type="button"
                  title="Sign out"
                  onClick={handleSignOut}
                  disabled={signingOut}
                  className="border-border bg-surface text-muted-foreground hover:text-destructive grid size-9 place-items-center rounded-lg border disabled:opacity-50 lg:hidden"
                >
                  {signingOut ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <LogOut className="size-4" />
                  )}
                </button>
                <TopbarCreditsPill />
              </div>
            </div>
          </header>

          {/* Mobile nav pill */}
          <div className="border-border bg-background shrink-0 border-b px-4 py-3 lg:hidden">
            <nav className="flex gap-1 overflow-x-auto">
              {nav.map((item) => {
                const active = pathname === item.to;
                const Icon = item.icon;
                return (
                  <Link
                    key={item.to}
                    href={item.to}
                    className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium ${
                      active
                        ? "bg-brand-soft text-brand"
                        : "text-muted-foreground"
                    }`}
                  >
                    <NavIcon icon={Icon} className="size-4" /> {item.title}
                  </Link>
                );
              })}
            </nav>
          </div>

          <main className="flex-1 overflow-y-auto px-6 py-6 lg:px-10 lg:py-8">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}

// Self-subscribing credit displays: only these two leaf components (not the
// whole shell — sidebar, nav, topbar) re-render when the live-polled credit
// balance changes.
function CreditBalanceCard() {
  const { data: credits = 0 } = useQueueStatus((d) => d.credits);
  const creditPct = Math.max(0, Math.min(100, credits));
  return (
    <div className="border-border bg-surface m-3 rounded-2xl border p-4">
      <div className="text-muted-foreground flex items-center gap-2 text-xs font-medium">
        <Sparkles className="text-brand size-3.5" />
        Credit balance
      </div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="text-2xl font-semibold tracking-tight">
          {credits}
        </span>
        <span className="text-muted-foreground text-xs">credits</span>
      </div>
      <div className="bg-surface-2 mt-3 h-1.5 overflow-hidden rounded-full">
        <div
          className="bg-brand h-full rounded-full"
          style={{ width: `${creditPct}%` }}
        />
      </div>
      <Link
        href="/dashboard/billing"
        className="bg-brand text-brand-foreground mt-4 flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-opacity hover:opacity-90"
      >
        <Coins className="size-3.5" /> Get more credits
      </Link>
    </div>
  );
}

function TopbarCreditsPill() {
  const { data: credits = 0 } = useQueueStatus((d) => d.credits);
  return (
    <Link
      href="/dashboard/billing"
      className="border-border bg-surface hidden items-center gap-2 rounded-lg border px-3 py-1.5 md:flex"
    >
      <Coins className="text-brand size-3.5" />
      <span className="text-sm font-medium">{credits} credits</span>
    </Link>
  );
}
