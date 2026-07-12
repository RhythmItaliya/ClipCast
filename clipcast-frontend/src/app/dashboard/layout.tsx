import {
  dehydrate,
  HydrationBoundary,
  QueryClient,
} from "@tanstack/react-query";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { ForceLogout } from "~/components/force-logout";
import { DashboardShell } from "~/components/dashboard/shell";
import { QueryProvider } from "~/components/query-provider";
import { QUEUE_STATUS_KEY } from "~/lib/queue-status";
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

  // Seed TanStack Query's cache server-side with the same shape
  // /api/queue-status returns, so the first client paint has live data with
  // no loading state and no duplicate fetch. From then on the shared
  // useQueueStatus query owns polling; every dashboard section subscribes
  // to just the slice it renders.
  const queryClient = new QueryClient();
  queryClient.setQueryData(QUEUE_STATUS_KEY, {
    uploadedFiles: queueFiles,
    credits: usage.creditsRemaining,
    uploadsToday: usage.uploadsToday,
    activeJobs: usage.activeJobs,
  });

  return (
    <QueryProvider>
      <HydrationBoundary state={dehydrate(queryClient)}>
        <DashboardShell
          email={user.email}
          name={user.name}
          isAdmin={session.user.role === "ADMIN"}
        >
          {children}
        </DashboardShell>
      </HydrationBoundary>
    </QueryProvider>
  );
}
