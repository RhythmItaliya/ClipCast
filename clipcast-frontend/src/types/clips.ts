/** One rendered clip as displayed in the clips grid. */
export type ClipItem = {
  id: string;
  title: string;
  clipMode: string;
  isPreview: boolean;
  duration?: number | null;
  thumbnailUrl?: string | null;
  createdAt: string;
  youtubeVideoId?: string | null;
  // "video" (default) or "audio" — Audio Studio outputs (see docs/14) render
  // an inline audio player instead of a <video> element.
  mediaType?: string | null;
};

/** Clips grouped by their source video. */
export type ClipGroup = {
  id: string;
  title: string;
  clips: ClipItem[];
};
