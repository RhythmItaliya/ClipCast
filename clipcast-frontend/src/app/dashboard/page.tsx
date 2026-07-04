import { ArrowRight, Film, Play, Sparkles } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { YoutubeIcon } from "~/components/brand";
import {
  CreditsLeftLink,
  LiveUsageProvider,
  UsageStatTiles,
} from "~/components/dashboard/live-usage-stats";
import { QueueTable } from "~/components/dashboard/queue-table";
import { Uploader } from "~/components/dashboard/uploader";
import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { getQueueFiles } from "~/server/queue";
import { getUsageStats } from "~/server/usage";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const [queueFiles, recentClips, usage] = await Promise.all([
    getQueueFiles(session.user.id),
    db.clip.findMany({
      where: { userId: session.user.id },
      select: {
        id: true,
        s3Key: true,
        clipMode: true,
        title: true,
        createdAt: true,
        uploadedFile: { select: { displayName: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 3,
    }),
    getUsageStats(session.user.id),
  ]);

  return (
    <LiveUsageProvider
      initialCredits={usage.creditsRemaining}
      initialUploadsToday={usage.uploadsToday}
      initialActiveJobs={usage.activeJobs}
    >
      <div className="space-y-5">
        {/* Hero */}
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="border-border from-brand/25 via-brand/5 relative overflow-hidden rounded-3xl border bg-gradient-to-br to-transparent p-5 lg:col-span-2">
            <div className="bg-brand/20 absolute -top-10 -right-10 size-52 rounded-full blur-3xl" />
            <div className="relative flex h-full flex-col justify-between gap-4">
              <div className="text-brand flex items-center gap-2 text-xs font-medium">
                <Sparkles className="size-3.5" /> AI CLIPPING ENGINE
              </div>
              <div className="max-w-lg space-y-1.5">
                <h2 className="text-xl leading-tight font-semibold tracking-tight sm:text-2xl">
                  Drop a podcast. Get ten viral moments before your coffee cools.
                </h2>
                <p className="text-muted-foreground text-sm">
                  Auto-transcribe, detect hooks, reframe to 9:16, and caption —
                  one credit per minute.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <a
                  href="#uploader"
                  className="bg-brand text-brand-foreground inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold hover:opacity-90"
                >
                  Start clipping <ArrowRight className="size-4" />
                </a>
                <CreditsLeftLink />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1">
            <UsageStatTiles />
          </div>
        </section>

        {/* Uploader + aside */}
        <section
          id="uploader"
          className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_320px]"
        >
          <Uploader />

          <aside className="space-y-4">
            <div className="border-border bg-surface/60 rounded-3xl border p-5">
              <div className="text-muted-foreground flex items-center gap-2 text-xs font-semibold tracking-widest uppercase">
                <Film className="size-3.5" /> Recent output
              </div>
              <div className="mt-3 space-y-2">
                {recentClips.length === 0 ? (
                  <p className="text-muted-foreground py-4 text-center text-xs">
                    Your latest clips will show up here.
                  </p>
                ) : (
                  recentClips.map((c) => (
                    <Link
                      key={c.id}
                      href="/dashboard/clips"
                      className="bg-background/50 hover:bg-background flex items-center gap-3 rounded-xl p-2.5 transition-colors"
                    >
                      <div className="bg-brand-soft text-brand grid size-10 shrink-0 place-items-center rounded-lg">
                        <Play className="size-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">
                          {c.title ?? clipTitle(c.s3Key, c.clipMode)}
                        </div>
                        <div className="text-muted-foreground truncate text-xs">
                          {c.uploadedFile?.displayName ?? "Deleted source"}
                        </div>
                      </div>
                    </Link>
                  ))
                )}
              </div>
            </div>

            <Link
              href="/dashboard/youtube"
              className="group border-border bg-surface/60 hover:bg-surface flex items-center gap-3 rounded-3xl border p-4 transition-colors"
            >
              <div className="bg-brand-soft text-brand grid size-10 place-items-center rounded-xl">
                <YoutubeIcon className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">Auto-clip your channel</div>
                <div className="text-muted-foreground text-xs">
                  Daily CRON at 09:00 UTC
                </div>
              </div>
              <ArrowRight className="text-muted-foreground size-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </aside>
        </section>

        {/* Queue (latest 3) */}
        <QueueTable
          initialFiles={queueFiles}
          compact
          description="Latest 3 jobs — see all in Queue."
        />
      </div>
    </LiveUsageProvider>
  );
}

function clipTitle(s3Key: string, clipMode: string): string {
  const base = s3Key.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "Clip";
  const pretty = base.replace(/[_-]+/g, " ").trim();
  return pretty.length > 1
    ? pretty.charAt(0).toUpperCase() + pretty.slice(1)
    : `${clipMode} clip`;
}
