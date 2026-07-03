# ClipCast 05: Uploads & the processing queue

Two ways to submit a job, one queue that handles both.

## Path A: direct upload

1. Client asks `generateUploadUrl()` (`src/actions/s3.ts`) for a place to put
   the file. This action: validates the file server-side
   (`validateUploadFile()` in `src/server/usage.ts`: extension, content type,
   4GB max, from `src/lib/limits.ts`), checks usage limits
   (`checkUsageLimits()`, see below), creates an `UploadedFile` row
   (`uploaded: false`), and returns a **presigned S3 PUT URL** (10 min expiry).
2. The browser uploads the file straight to S3 using that URL; the file never
   passes through the Next.js server.
3. Once the browser confirms the upload, `processVideo()`
   (`src/actions/generation.ts`) marks the row `uploaded: true` and sends the
   Inngest event.

## Path B: YouTube URL

`processYoutubeVideo()` (`src/actions/generation.ts`) validates the URL shape,
re-checks usage limits, creates the `UploadedFile` row directly (no S3
presign needed; Modal's downloader will write the source itself), and sends
the same Inngest event with a `youtubeUrl` instead of relying on a pre-uploaded
S3 key.

## Server-side usage limits

`checkUsageLimits()` / `getUsageStats()` (`src/server/usage.ts`), constants in
`src/lib/limits.ts`, enforced here, *not* just mirrored client-side for UX:

- `MAX_UPLOADS_PER_DAY` (10): counts `UploadedFile` rows created in the last
  rolling 24h.
- `MAX_ACTIVE_JOBS` (2): counts rows currently `queued`/`processing`.
- `MIN_CREDITS_TO_SUBMIT` (1): credits must be positive to start any job.

## The Inngest function: `processVideoFn`

`src/inngest/functions.ts`. Listens for `"process-video-events"`. Key design
choices, each mapping to a `step.run()`/`step.fetch()` call so Inngest can
replay individual steps safely on retry rather than re-running the whole
function:

- **`concurrency: { limit: 1, key: "event.data.userId" }`**: one active job
  per user at a time (aligned with `MAX_ACTIVE_JOBS` at the DB layer).
- **`cancelOn`**: listens for a `"cancel-job-events"` event matching the same
  `uploadedFileId`, so the `/api/cancel-job` route can stop an in-flight run.
- **`onFailure`**: if the whole function throws/exhausts retries, the
  `UploadedFile` is marked `failed` so it never sits in `processing` forever.
- **Credit gate** (`check-credits`, `get-video-duration` steps): direct
  uploads use a stored/estimated duration to gate up front; YouTube jobs don't
  know their duration until Modal downloads the file, so they only require
  a minimum of 1 credit up front, then true-up after the fact (see below).
- **YouTube download phase**: `postCloudDownloader()` (bottom of
  `functions.ts`) submits to the downloader Modal endpoint, which returns
  immediately with a `call_id`; the function then polls Modal's async result
  endpoint in a loop of individual `step.run()` calls (**not** a `setTimeout`
  inside one step; Inngest has no in-step sleep primitive, so each poll is
  its own replayable step).
- **GPU processing call**: `step.fetch()` (not plain `fetch()`) posts to the
  processor's `process_video` endpoint. `step.fetch` is Inngest's own
  primitive specifically because it tolerates the multi-minute processing time
  without hitting a serverless function's execution timeout.
- **After Modal responds**: `update-exact-duration` (true-up the real duration
  now that it's known), `create-clips-in-db` (one `Clip` row per rendered
  output), `deduct-credits` (charge `ceil(duration / 60)` credits, minimum 1),
  then `set-status-processed`, or `set-status-no-credits` if the true-up
  reveals the user can't actually afford the job.

## Live status in the UI

`/api/queue-status` polls current job state for the dashboard's queue table
(`src/components/dashboard/queue-table.tsx`), which self-adjusts its polling
interval: 10s while a job is young, 30s once it's been processing a while (GPU
rendering is slow, no need to hammer the DB).

## The daily YouTube auto-clip cron: partially built

`dailyClipScheduler` (`src/inngest/functions.ts`, `cron: "0 9 * * *"`) finds
every user with a connected YouTube channel and non-zero credits. **As of this
writing it only logs those users** and does not yet call the YouTube Data API
for their latest video or fire a processing event (see the `NOTE`/`Future`
comments in that function). The channel-connect OAuth plumbing
(`src/actions/youtube.ts`, `/dashboard/youtube` UI) is complete; wiring this
cron up to actually submit a job is the remaining piece.

## How to build it from scratch

**Step 1: the presigned upload action** (`src/actions/s3.ts`):

```ts
"use server";
export async function generateUploadUrl(fileInfo: { filename: string; contentType: string; size?: number }) {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "Your session has expired. Please log in again." };

  const fileError = validateUploadFile(fileInfo);   // extension/type/size, never trust the client
  if (fileError) return { success: false, error: fileError };

  const limitError = await checkUsageLimits(session.user.id);
  if (limitError) return { success: false, error: limitError };

  const s3Client = new S3Client({ region: env.AWS_REGION, credentials: { /* ... */ } });
  const key = `${uuidv4()}/original.${fileInfo.filename.split(".").pop()}`;
  const command = new PutObjectCommand({ Bucket: env.S3_BUCKET_NAME, Key: key, ContentType: fileInfo.contentType });
  const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 600 });

  const { id } = await db.uploadedFile.create({
    data: { userId: session.user.id, s3Key: key, displayName: fileInfo.filename, uploaded: false },
    select: { id: true },
  });

  return { success: true, signedUrl, key, uploadedFileId: id };
}
```

The browser then does a plain `PUT` of the file bytes to `signedUrl`; the
Next.js server is never in that data path.

**Step 2: usage limits, the single source of truth** (`src/lib/limits.ts` +
`src/server/usage.ts`):

```ts
// src/lib/limits.ts
export const LIMITS = {
  MAX_FILE_SIZE_BYTES: 500 * 1024 * 1024,
  ALLOWED_EXTENSIONS: ["mp4"],
  MAX_UPLOADS_PER_DAY: 10,
  MAX_ACTIVE_JOBS: 2,
  MIN_CREDITS_TO_SUBMIT: 1,
} as const;

export function getUsageBlockReason(stats: UsageStats): string | null {
  if (stats.creditsRemaining < LIMITS.MIN_CREDITS_TO_SUBMIT) return "You're out of credits. Buy a credit pack to keep clipping.";
  if (stats.activeJobs >= LIMITS.MAX_ACTIVE_JOBS) return `You already have ${stats.activeJobs} jobs running...`;
  if (stats.uploadsToday >= LIMITS.MAX_UPLOADS_PER_DAY) return `Daily limit reached...`;
  return null;
}
```

```ts
// src/server/usage.ts
export async function getUsageStats(userId: string): Promise<UsageStats> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [user, uploadsToday, activeJobs] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { credits: true } }),
    db.uploadedFile.count({ where: { userId, createdAt: { gte: since } } }),
    db.uploadedFile.count({ where: { userId, status: { in: ["queued", "processing"] } } }),
  ]);
  return { creditsRemaining: user?.credits ?? 0, uploadsToday, activeJobs };
}

export async function checkUsageLimits(userId: string): Promise<string | null> {
  return getUsageBlockReason(await getUsageStats(userId));
}
```

Both submission actions (`processVideo`, `processYoutubeVideo` in
`src/actions/generation.ts`) call `checkUsageLimits()` before doing anything
else. The client-side disabled state on the uploader button is UX only; this
is the real gate.

**Step 3: the Inngest function skeleton** (`src/inngest/functions.ts`).
The shape that makes retries and cancellation safe:

```ts
export const processVideoFn = inngest.createFunction(
  {
    id: "process-video",
    retries: 1,
    concurrency: { limit: 1, key: "event.data.userId" }, // one active job per user
    cancelOn: [{ event: "cancel-job-events", match: "data.uploadedFileId" }],
    onFailure: async ({ event }) => {
      const uploadedFileId = event.data.event?.data?.uploadedFileId;
      if (uploadedFileId) await db.uploadedFile.update({ where: { id: uploadedFileId }, data: { status: "failed" } });
    },
  },
  { event: "process-video-events" },
  async ({ event, step }) => {
    const { uploadedFileId, userId, youtubeUrl, clipMode = "qa", previewOnly = false } = event.data;

    const { credits, s3Key } = await step.run("check-credits", async () => {
      const f = await db.uploadedFile.findUniqueOrThrow({
        where: { id: uploadedFileId },
        select: { user: { select: { id: true, credits: true } }, s3Key: true },
      });
      return { userId: f.user.id, credits: f.user.credits, s3Key: f.s3Key };
    });

    // ... get-video-duration, set-status-processing steps ...

    if (youtubeUrl) {
      const submitted = await step.run("submit-youtube-download", () =>
        postCloudDownloader({ youtube_url: youtubeUrl, s3_key: s3Key }));
      // poll submitted.data.call_id in a loop of step.run() calls until done
    }

    const modalResponse = await step.fetch(env.PROCESS_VIDEO_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.PROCESS_VIDEO_ENDPOINT_AUTH}` },
      body: JSON.stringify({ s3_key: s3Key, clip_mode: clipMode, preview_only: previewOnly }),
    });

    const modalData = await modalResponse.json(); // { duration, clips: [{ s3_key, thumbnail_s3_key, title, duration }, ...] }

    await step.run("create-clips-in-db", async () => {
      const clips = modalData.clips ?? [];
      if (clips.length > 0) {
        await db.clip.createMany({
          data: clips.map((c) => ({
            s3Key: c.s3_key, thumbnailS3Key: c.thumbnail_s3_key ?? null,
            title: c.title || null, duration: c.duration ?? null,
            clipMode, userId, uploadedFileId, isPreview: previewOnly,
          })),
        });
      }
    });
    await step.run("deduct-credits", async () => {
      const minutes = Math.max(1, Math.ceil(modalData.duration / 60));
      await db.user.update({ where: { id: userId }, data: { credits: { decrement: minutes } } });
    });
    await step.run("set-status-processed", async () =>
      db.uploadedFile.update({ where: { id: uploadedFileId }, data: { status: "processed" } }));
  },
);
```

(The real file also handles the "true-up reveals insufficient credits" branch,
setting `status: "no credits"` instead of deducting a negative balance,
and the YouTube polling loop in full; this is the shape to build from, not a
literal copy-paste.)

**Step 4: live status polling.** `/api/queue-status/route.ts` is a plain
route handler (not a server action, since the client polls it on an interval
rather than calling it in response to a user action) that re-queries
`getUsageStats`-adjacent data and returns fresh `UploadedFile` rows for the
signed-in user.

## Diagram

[`excalidraw/01-pipeline-overview.excalidraw`](excalidraw/01-pipeline-overview.excalidraw)
traces one job through every hop described above, numbered in order.

## Next

[06-video-processing-pipeline.md](06-video-processing-pipeline.md): what
happens once Modal receives the call.
