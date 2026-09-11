/** One processing job as rendered in the queue UI — mirrors the
 * /api/queue-status JSON payload exactly (dates as ISO strings) so the same
 * shape flows from server seed to client cache. */
export type QueueFile = {
  id: string;
  s3Key: string;
  filename: string;
  youtubeUrl: string | null;
  /** Every YouTube source URL (an audio mashup has 2+); each opens in its own
   * tab from the queue row. Empty for uploaded-file jobs. */
  sourceUrls: string[];
  /** "clip" | "audio" — decides whether the row shows a clip mode or an audio
   * mode, keeping the two job kinds visually separate. */
  jobType: string;
  /** "mashup" | "generate" for audio jobs; null for clip jobs. */
  audioMode: string | null;
  status: string;
  clipMode: string | null;
  isPreview: boolean | null;
  clipsCount: number;
  errorMessage: string | null;
  processingSummary: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Full payload of /api/queue-status — the shared dashboard query. */
export type QueueStatusData = {
  uploadedFiles: QueueFile[];
  credits: number;
  uploadsToday: number;
  activeJobs: number;
};
