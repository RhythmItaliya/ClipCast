"use client";

import {
  Film,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Shield,
  Users,
} from "lucide-react";
import { signOut } from "next-auth/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { LogoMark, Wordmark } from "~/components/brand";

// Admin-only navigation items
const nav = [
  {
    title: "Overview",
    to: "/admin",
    icon: LayoutDashboard,
    description: "Platform stats at a glance.",
  },
  {
    title: "Users",
    to: "/admin/users",
    icon: Users,
    description: "Manage users, credits, and roles.",
  },
  {
    title: "Jobs",
    to: "/admin/jobs",
    icon: ListChecks,
    description: "All processing jobs across all users.",
  },
  {
    title: "Clips",
    to: "/admin/clips",
    icon: Film,
    description: "All rendered clips across all users.",
  },
] as const;

export function AdminShell({
  children,
  email,
  name,
}: {
  children: ReactNode;
  email: string;
  name: string | null;
}) {
  const pathname = usePathname();
  const current =
    nav.find((n) => n.to === pathname) ??
    nav.find((n) => n.to !== "/admin" && pathname.startsWith(n.to)) ??
    nav[0];
  const displayName = name ?? email.split("@")[0] ?? "Admin";

  return (
    <div className="bg-background text-foreground selection:bg-brand/30 h-screen overflow-hidden">
      <div className="flex h-full">
        {/* ── Sidebar ── */}
        <aside className="border-border bg-sidebar hidden h-full w-64 shrink-0 flex-col border-r lg:flex">
          {/* Logo */}
          <div className="border-border flex h-16 items-center gap-2.5 border-b px-6">
            <LogoMark className="size-8 rounded-lg" />
            <div className="flex flex-col">
              <Wordmark />
              {/* Admin badge below the wordmark */}
              <span className="text-brand -mt-0.5 flex items-center gap-1 text-[10px] font-semibold tracking-widest uppercase">
                <Shield className="size-2.5" /> Admin
              </span>
            </div>
          </div>

          {/* Nav links */}
          <nav className="flex-1 space-y-1 p-3">
            <div className="text-muted-foreground px-3 pt-3 pb-2 text-[10px] font-semibold tracking-widest uppercase">
              Admin Panel
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
                  <Icon className="size-4" />
                  <span>{item.title}</span>
                  {active && (
                    <span className="bg-brand ml-auto size-1.5 rounded-full" />
                  )}
                </Link>
              );
            })}
          </nav>

          {/* Back to app link */}
          <div className="border-border border-t p-3">
            <Link
              href="/dashboard"
              className="text-muted-foreground hover:bg-surface hover:text-foreground flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
            >
              <LayoutDashboard className="size-4" />
              Back to App
            </Link>
          </div>

          {/* User footer */}
          <div className="border-border border-t p-3">
            <div className="flex items-center gap-3 rounded-lg p-2">
              <div className="bg-brand-soft text-brand ring-brand/20 grid size-9 place-items-center rounded-full ring-1">
                <span className="text-xs font-semibold uppercase">
                  {displayName.charAt(0)}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{displayName}</div>
                <div className="text-muted-foreground truncate text-xs">
                  {email}
                </div>
              </div>
              <button
                type="button"
                title="Sign out"
                onClick={() => signOut({ redirectTo: "/login" })}
                className="text-muted-foreground hover:bg-surface hover:text-destructive grid size-8 place-items-center rounded-md"
              >
                <LogOut className="size-4" />
              </button>
            </div>
          </div>
        </aside>

        {/* ── Main content ── */}
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
              {/* Shield badge in top-right */}
              <div className="bg-brand-soft text-brand flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold">
                <Shield className="size-3" /> Admin
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
                      active ? "bg-brand-soft text-brand" : "text-muted-foreground"
                    }`}
                  >
                    <Icon className="size-4" /> {item.title}
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
