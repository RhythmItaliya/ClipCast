import { Music, Scissors } from "lucide-react";
import { redirect } from "next/navigation";
import { getClipGroups } from "~/actions/clips";
import { ClipsGrid } from "~/components/dashboard/clips-grid";
import { auth } from "~/server/auth";
import { db } from "~/server/db";

export const metadata = {
  title: "Library — ClipCast",
  description: "Every clip and audio mix you've generated.",
};

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ clipsPage?: string; audioPage?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const { clipsPage: clipsParam, audioPage: audioParam } = await searchParams;
  const clipsPage = Math.max(1, parseInt(clipsParam ?? "1", 10) || 1);
  const audioPage = Math.max(1, parseInt(audioParam ?? "1", 10) || 1);

  // Clips and audio are kept in their OWN tables here, never mixed.
  const [clips, audio, user] = await Promise.all([
    getClipGroups(clipsPage, undefined, "clip"),
    getClipGroups(audioPage, undefined, "audio"),
    db.user.findUnique({
      where: { id: session.user.id },
      select: { youtubeChannelId: true },
    }),
  ]);
  const youtubeConnected = !!user?.youtubeChannelId;

  return (
    <div className="space-y-10">
      {/* Video clips */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Scissors className="text-brand size-5" />
          <h2 className="text-lg font-semibold tracking-tight">Clips</h2>
          {clips.total > 0 && (
            <span className="text-muted-foreground text-xs">
              {clips.total} source{clips.total !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        <ClipsGrid
          groups={clips.groups}
          youtubeConnected={youtubeConnected}
          page={clipsPage}
          pageSize={clips.pageSize}
          total={clips.total}
          basePath="/dashboard/clips"
          pageParam="clipsPage"
        />
      </section>

      {/* Audio mixes */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Music className="text-brand size-5" />
          <h2 className="text-lg font-semibold tracking-tight">Audio</h2>
          {audio.total > 0 && (
            <span className="text-muted-foreground text-xs">
              {audio.total} mix{audio.total !== 1 ? "es" : ""}
            </span>
          )}
        </div>
        <ClipsGrid
          groups={audio.groups}
          page={audioPage}
          pageSize={audio.pageSize}
          total={audio.total}
          basePath="/dashboard/clips"
          pageParam="audioPage"
        />
      </section>
    </div>
  );
}
