/** A channel candidate parked in User.youtubePendingChannels while the user
 * picks which of their Google account's channels to connect. */
export type PendingYouTubeChannel = { id: string; title: string };

/** One video from the connected channel's uploads playlist. */
export type YouTubeVideo = {
  id: string;
  title: string;
  description: string;
  thumbnailUrl: string;
  publishedAt: string;
  duration: string;
  viewCount: string;
  url: string;
};
