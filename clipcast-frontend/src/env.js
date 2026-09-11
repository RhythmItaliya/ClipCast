import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  /**
   * Specify your server-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars.
   */
  server: {
    AUTH_SECRET:
      process.env.NODE_ENV === "production"
        ? z.string()
        : z.string().optional(),
    DATABASE_URL: z.string().url(),
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    AWS_ACCESS_KEY_ID: z.string(),
    AWS_SECRET_ACCESS_KEY: z.string(),
    AWS_REGION: z.string(),
    S3_BUCKET_NAME: z.string(),
    AUTH_DISCORD_ID: z.string(),
    AUTH_DISCORD_SECRET: z.string(),
    PROCESS_VIDEO_ENDPOINT: z.string(),
    // Optional at app startup so a missing backend URL cannot take down the
    // entire frontend. YouTube jobs report a targeted configuration error.
    DOWNLOAD_VIDEO_ENDPOINT: z.string().url().optional(),
    // TEMP — local yt-dlp fallback: set to http://localhost:3000/api/local-download
    // to enable. Remove once Modal downloader is fixed or a residential proxy
    // is configured. Must never be set to a public URL.
    LOCAL_DOWNLOAD_ENDPOINT: z.string().url().optional(),
    // Fast, download-free duration lookup used to gate credits before the
    // full download starts. Optional — falls back to the old minimum-credit
    // gate if unset, rather than blocking YouTube jobs entirely.
    YOUTUBE_DURATION_ENDPOINT: z.string().url().optional(),
    // Audio Studio (mixer) Modal endpoint — generate + mashup. Optional so a
    // missing URL can't take down the frontend; audio jobs report a targeted
    // configuration error, exactly like DOWNLOAD_VIDEO_ENDPOINT.
    PROCESS_AUDIO_ENDPOINT: z.string().url().optional(),
    PROCESS_VIDEO_ENDPOINT_AUTH: z.string(),
    STRIPE_SECRET_KEY: z.string(),
    STRIPE_SMALL_CREDIT_PACK: z.string(),
    STRIPE_MEDIUM_CREDIT_PACK: z.string(),
    STRIPE_LARGE_CREDIT_PACK: z.string(),
    BASE_URL: z.string(),
    STRIPE_WEBHOOK_SECRET: z.string(),
    INNGEST_EVENT_KEY: z.string(),
    INNGEST_SIGNING_KEY: z.string(),
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    YT_DLP_PATH: z.string().optional(),
    YT_DLP_PROXY: z.string().optional(),
    // Netscape-format cookies.txt (exported from a signed-in YouTube browser),
    // pasted as one string. Used by the local yt-dlp fallback to get past
    // "confirm you're not a bot". Optional — omitted when unset.
    YT_DLP_COOKIES: z.string().optional(),
    // Optional so the app runs without email configured — sends are
    // logged instead of dispatched until a real key is added.
    RESEND_API_KEY: z.string().optional(),
    EMAIL_FROM: z.string().default("ClipCast <onboarding@resend.dev>"),
    SMTP_HOST: z.string().optional(),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    // 32-byte key (64 hex chars) used to encrypt provider API keys at rest
    // (AES-256-GCM) so they can be managed from the admin UI. Optional at
    // startup; key operations throw a clear error if it's missing.
    SETTINGS_ENCRYPTION_KEY: z.string().optional(),
  },

  /**
   * Specify your client-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars. To expose them to the client, prefix them with
   * `NEXT_PUBLIC_`.
   */
  client: {
    // NEXT_PUBLIC_CLIENTVAR: z.string(),
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string(),
  },

  /**
   * You can't destruct `process.env` as a regular object in the Next.js edge runtimes (e.g.
   * middlewares) or client-side so we need to destruct manually.
   */
  runtimeEnv: {
    AUTH_SECRET: process.env.AUTH_SECRET,
    DATABASE_URL: process.env.DATABASE_URL,
    NODE_ENV: process.env.NODE_ENV,
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
    AWS_REGION: process.env.AWS_REGION,
    S3_BUCKET_NAME: process.env.S3_BUCKET_NAME,
    AUTH_DISCORD_ID: process.env.AUTH_DISCORD_ID,
    AUTH_DISCORD_SECRET: process.env.AUTH_DISCORD_SECRET,
    PROCESS_VIDEO_ENDPOINT: process.env.PROCESS_VIDEO_ENDPOINT,
    DOWNLOAD_VIDEO_ENDPOINT: process.env.DOWNLOAD_VIDEO_ENDPOINT,
    LOCAL_DOWNLOAD_ENDPOINT: process.env.LOCAL_DOWNLOAD_ENDPOINT,
    YOUTUBE_DURATION_ENDPOINT: process.env.YOUTUBE_DURATION_ENDPOINT,
    PROCESS_AUDIO_ENDPOINT: process.env.PROCESS_AUDIO_ENDPOINT,
    PROCESS_VIDEO_ENDPOINT_AUTH: process.env.PROCESS_VIDEO_ENDPOINT_AUTH,
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_SMALL_CREDIT_PACK: process.env.STRIPE_SMALL_CREDIT_PACK,
    STRIPE_MEDIUM_CREDIT_PACK: process.env.STRIPE_MEDIUM_CREDIT_PACK,
    STRIPE_LARGE_CREDIT_PACK: process.env.STRIPE_LARGE_CREDIT_PACK,
    BASE_URL: process.env.BASE_URL,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    INNGEST_EVENT_KEY: process.env.INNGEST_EVENT_KEY,
    INNGEST_SIGNING_KEY: process.env.INNGEST_SIGNING_KEY,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    YT_DLP_PATH: process.env.YT_DLP_PATH,
    YT_DLP_PROXY: process.env.YT_DLP_PROXY,
    YT_DLP_COOKIES: process.env.YT_DLP_COOKIES,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    EMAIL_FROM: process.env.EMAIL_FROM,
    SMTP_HOST: process.env.SMTP_HOST,
    SMTP_USER: process.env.SMTP_USER,
    SMTP_PASSWORD: process.env.SMTP_PASSWORD,
    SETTINGS_ENCRYPTION_KEY: process.env.SETTINGS_ENCRYPTION_KEY,
  },
  /**
   * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially
   * useful for Docker builds.
   */
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  /**
   * Makes it so that empty strings are treated as undefined. `SOME_VAR: z.string()` and
   * `SOME_VAR=''` will throw an error.
   */
  emptyStringAsUndefined: true,
});
