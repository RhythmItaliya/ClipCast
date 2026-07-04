import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { ForceLogout } from "~/components/force-logout";
import { DashboardShell } from "~/components/dashboard/shell";
import { LiveUsageProvider } from "~/components/dashboard/live-usage-stats";
import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { getQueueFiles } from "~/server/queue";
import { getUsageStats } from "~/server/usage";

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const [user, usage, queueFiles] = await Promise.all([
    db.user.findUnique({
      where: { id: session.user.id },
      select: { email: true, name: true },
    }),
    getUsageStats(session.user.id),
    getQueueFiles(session.user.id),
  ]);

  if (!user) {
    return <ForceLogout />;
  }

  return (
    // Mounted once here (not per-page) so every credit/usage display in the
    // whole dashboard — sidebar, topbar, Overview's hero, the queue table —
    // shares this single poll instead of each maintaining its own
    // independent snapshot that can drift out of sync with the others.
    <LiveUsageProvider
      initialCredits={usage.creditsRemaining}
      initialUploadsToday={usage.uploadsToday}
      initialActiveJobs={usage.activeJobs}
      initialFiles={queueFiles}
    >
      <DashboardShell
        email={user.email}
        name={user.name}
        isAdmin={session.user.role === "ADMIN"}
      >
        {children}
      </DashboardShell>
    </LiveUsageProvider>
  );
}
