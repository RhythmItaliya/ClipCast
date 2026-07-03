# ClipCast 01: Environment & accounts

Before running anything, you need accounts with 7 external services. Everything
is configured through **one file at the repo root**: `.env`.

## Why one shared `.env`

- The frontend loads it via `@next/env`'s `loadEnvConfig('..')` in
  `clipcast-frontend/next.config.js` (note the `'..'`, one directory up from
  the frontend, i.e. the repo root).
- The backend's `clipcast-backend/scripts/setup_modal_secret.py` reads the same
  file with `python-dotenv` and pushes the relevant keys into a Modal Secret
  (Modal containers can't read your local `.env` directly; see
  [09-deployment.md](09-deployment.md)).
- One file means no "which `.env` do I edit" confusion, and no risk of the two
  halves drifting out of sync on shared values like `S3_BUCKET_NAME`.

`.env` is gitignored. `.env.example` is the committed template. Copy it:

```bash
cp .env.example .env
```

## Accounts you need

| Service | What it's for | Where to get credentials |
|---|---|---|
| [Supabase](https://supabase.com) | Postgres database | Project Settings → Database → Connection string (get both the pooled `6543` URL and the direct `5432` URL) |
| [AWS](https://aws.amazon.com) | S3 bucket for source videos + rendered clips | IAM user with S3 read/write, plus a bucket |
| [Modal](https://modal.com) | GPU/CPU cloud compute for the backend | `modal token new` (CLI auth, not an env var) |
| [Stripe](https://stripe.com) | Credit-pack checkout + webhook | Dashboard → Developers → API keys; create 3 one-time Prices for the credit packs |
| [Discord Developer Portal](https://discord.com/developers/applications) | OAuth login option | New Application → OAuth2 → Client ID/Secret |
| [Google Cloud Console](https://console.cloud.google.com/apis/credentials) | OAuth login *and* the YouTube channel-connect feature | OAuth client credentials; add redirect URI `{BASE_URL}/api/youtube/callback` |
| [Google AI Studio](https://aistudio.google.com) | Gemini API key (moment selection) | Get API key |

## Every variable, and who reads it

Validated centrally in `clipcast-frontend/src/env.js` (Zod schema; the app
refuses to boot with a missing required var, so this file is the ground truth
if this table ever drifts).

| Variable | Read by | Purpose |
|---|---|---|
| `AUTH_SECRET` | frontend | NextAuth JWT signing secret (`npx auth secret` to generate) |
| `DATABASE_URL` | frontend (Prisma) | Pooled (port 6543) Postgres URL, used at runtime |
| `DIRECT_URL` | frontend (Prisma) | Direct (port 5432) Postgres URL, used for `prisma db push`/migrations |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_REGION` | frontend + both Modal apps | S3 access |
| `S3_BUCKET_NAME` | frontend + both Modal apps | Shared bucket for sources + clips |
| `AUTH_DISCORD_ID` / `AUTH_DISCORD_SECRET` | frontend | Discord OAuth |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | frontend | Google OAuth (login) + YouTube channel connect, both optional; the provider is only registered if both are set |
| `PROCESS_VIDEO_ENDPOINT` | frontend | The processor Modal app's public URL |
| `DOWNLOAD_VIDEO_ENDPOINT` | frontend | The downloader Modal app's public URL (optional; a missing value fails only YouTube jobs, not the whole app) |
| `PROCESS_VIDEO_ENDPOINT_AUTH` | frontend + both Modal apps | Shared bearer token protecting both Modal endpoints |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | frontend | Stripe API + webhook signature verification |
| `STRIPE_SMALL_CREDIT_PACK` / `_MEDIUM_` / `_LARGE_` | frontend | Stripe Price IDs for the 3 credit packs |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | frontend (client) | Stripe.js publishable key |
| `BASE_URL` | frontend | Used to build OAuth redirect URIs and Stripe success URLs |
| `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` | frontend | `"local"`/`"local"` for local dev; real values from the Inngest Cloud dashboard in production |
| `GEMINI_API_KEY` | processor (Modal) | Gemini moment-selection calls |
| `YT_DLP_PATH` | downloader (Modal, local dev only) | Path to the `yt-dlp` binary |
| `YT_DLP_PROXY` | downloader (Modal) | Optional paid residential proxy override; see [`clipcast-backend/apps/downloader/README.md`](../clipcast-backend/apps/downloader/README.md) |

If you add a new variable, update **both** `.env.example` and
`clipcast-frontend/src/env.js` (server/client schema + `runtimeEnv` mapping),
or the app will throw at startup.

## How to implement this from scratch

This project uses [`@t3-oss/env-nextjs`](https://www.npmjs.com/package/@t3-oss/env-nextjs)
instead of reading `process.env.X` directly everywhere, specifically so a typo
or a missing var fails loudly at boot instead of producing `undefined` deep
inside some unrelated request handler months later.

**Step 1: install it** (already in `package.json`, but if starting fresh):

```bash
npm install @t3-oss/env-nextjs zod
```

**Step 2: write the schema.** This is the actual file,
`clipcast-frontend/src/env.js`; every var the app touches is declared once,
split into `server` (only readable in server code) and `client` (must be
prefixed `NEXT_PUBLIC_` and is bundled into the browser):

```js
import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  server: {
    AUTH_SECRET:
      process.env.NODE_ENV === "production" ? z.string() : z.string().optional(),
    DATABASE_URL: z.string().url(),
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    AWS_ACCESS_KEY_ID: z.string(),
    AWS_SECRET_ACCESS_KEY: z.string(),
    AWS_REGION: z.string(),
    S3_BUCKET_NAME: z.string(),
    AUTH_DISCORD_ID: z.string(),
    AUTH_DISCORD_SECRET: z.string(),
    PROCESS_VIDEO_ENDPOINT: z.string(),
    // Optional so a missing backend URL can't take down the whole frontend;
    // only YouTube jobs fail, with a targeted error.
    DOWNLOAD_VIDEO_ENDPOINT: z.string().url().optional(),
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
  },
  client: {
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string(),
  },
  // Next.js edge runtimes can't destructure process.env as a plain object,
  // so every var must be listed explicitly here too.
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
    PROCESS_VIDEO_ENDPOINT_AUTH: process.env.PROCESS_VIDEO_ENDPOINT_AUTH,
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
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
  },
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
```

**Step 3: use it.** Everywhere else in the codebase, import `{ env }` from
`~/env` and read `env.SOME_VAR`, never `process.env.SOME_VAR` directly in
application code. That's what makes the schema authoritative: if you forget to
add a var here, TypeScript won't let you reference it, and if the deployed
environment is missing a required one, the app throws a clear Zod error on
boot instead of a confusing failure three requests later.

**Step 4: adding a new variable later.** Three places, every time:
1. Add it to `.env.example` (documented, placeholder value).
2. Add it to `src/env.js`, both the `server`/`client` schema *and*
   `runtimeEnv` (easy to forget the second one; the var will silently read as
   `undefined` if you do).
3. Add it to `.env` locally (and wherever the app is actually deployed).

## Next

[02-database-schema.md](02-database-schema.md): set up Postgres with Prisma.
