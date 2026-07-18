import { Music } from "lucide-react";
import { redirect } from "next/navigation";
import { getClipGroups } from "~/actions/clips";
import { AudioStudioClient } from "~/components/dashboard/audio-studio-client";
import { ClipsGrid } from "~/components/dashboard/clips-grid";
import { auth } from "~/server/auth";

export default async function AudioStudioPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const { page: pageParam } = await searchParams;
  const page = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);
  // Only AUDIO outputs here — clip (video) jobs stay on the Clips page.
  const { groups, total, pageSize } = await getClipGroups(page, undefined, "audio");

  // The dashboard shell already renders the page title + description in the top
  // bar (see the nav table in shell.tsx), so this page renders only its content.
  return (
    <div className="space-y-10">
      <AudioStudioClient />

      {groups.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <Music className="text-brand size-5" />
            <h2 className="text-lg font-semibold tracking-tight">Your mixes</h2>
          </div>
          <ClipsGrid
            groups={groups}
            page={page}
            pageSize={pageSize}
            total={total}
            basePath="/dashboard/audio"
          />
        </section>
      )}
    </div>
  );
}
