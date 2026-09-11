# ClipCast

<div align="center">

![Next.js](https://img.shields.io/badge/Next.js-000000?style=for-the-badge&logo=next.js&logoColor=white)
![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-2D3748?style=for-the-badge&logo=prisma&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/Postgres-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-3FCF8E?style=for-the-badge&logo=supabase&logoColor=white)
![NextAuth](https://img.shields.io/badge/Auth.js-000000?style=for-the-badge&logo=auth0&logoColor=white)
![TailwindCSS](https://img.shields.io/badge/Tailwind_CSS-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)
![Stripe](https://img.shields.io/badge/Stripe-635BFF?style=for-the-badge&logo=stripe&logoColor=white)
![Inngest](https://img.shields.io/badge/Inngest-000000?style=for-the-badge&logo=inngest&logoColor=white)
![Modal](https://img.shields.io/badge/Modal-00D2B8?style=for-the-badge)
![AWS S3](https://img.shields.io/badge/AWS_S3-569A31?style=for-the-badge&logo=amazons3&logoColor=white)
![Python](https://img.shields.io/badge/Python-3776AB?style=for-the-badge&logo=python&logoColor=white)
![FFmpeg](https://img.shields.io/badge/FFmpeg-007808?style=for-the-badge&logo=ffmpeg&logoColor=white)
![Google Gemini](https://img.shields.io/badge/Gemini-8E75B2?style=for-the-badge&logo=googlegemini&logoColor=white)

</div>

ClipCast is an AI podcast clipper. Upload a long-form video, or just paste a
YouTube link, and it hands back a set of short vertical clips: automatically
transcribed, automatically selected and viral-ranked by an LLM, captioned, and
reframed to 9:16, ready to post as Shorts, Reels, or TikToks. It also has an
**Audio Studio** that generates original instrumentals from a prompt or mashes
up two YouTube tracks — both driven by a multi-agent AI production crew.

The project is split into two halves:

- **The web app**, the Next.js frontend, in the `clipcast-frontend` folder.
  It handles sign-in, billing, uploads, the Audio Studio, and the admin panel.
  See [clipcast-frontend/README.md](clipcast-frontend/README.md).
- **The processing backend**, four Python apps that run on Modal's cloud GPUs,
  in the `clipcast-backend` folder: a downloader, the clip processor, the audio
  mixer, and the ACE-Step music composer. The LLM work runs on DeepSeek
  (default), Gemini, or Claude — switchable in the admin panel. See
  [clipcast-backend/README.md](clipcast-backend/README.md).

## Getting started

1. Install the frontend's dependencies:
   ```bash
   cd clipcast-frontend && npm install && cd ..
   ```
2. Install the backend helper scripts' dependencies (only needed if you'll
   run the backend's setup/test scripts yourself):
   ```bash
   pip install -r clipcast-backend/requirements.txt
   ```
3. Copy the environment template and fill in real values. See
   [docs/01-environment-and-accounts.md](docs/01-environment-and-accounts.md)
   for what every value is and where to get it:
   ```bash
   cp .env.example .env
   ```
4. Start everything that's meant to run on your machine:
   ```bash
   ./start.sh
   ```

`start.sh` launches the frontend and its background job worker together. It
never runs the video-processing backend locally; that always runs on Modal's
cloud, even in development.

| Service | Address |
|---|---|
| The web app | http://localhost:3000 |
| Background job dashboard (Inngest) | http://localhost:8288 |
| Video processing backend | runs on Modal's cloud, not on your machine |

## Test account

Testing is done through a single seeded test user, exercising the real pipeline
end to end (upload/URL → Inngest → Modal → credits → queue) rather than any
direct-Modal harness. Create or top it up with:

```bash
cd clipcast-frontend && npx tsx prisma/seed-test-user.ts
```

That upserts `tester@clipcast.local` / `Tester@1234` with 1000 credits (override
via `TEST_USER_EMAIL` / `TEST_USER_PASSWORD` / `TEST_USER_CREDITS`). Sign in at
`/login` with that email + password (or the "sign in with a code" email-OTP
flow), then submit audio or clip jobs. The seeded user is a regular `USER`; to
reach `/admin`, promote an account's `role` to `ADMIN` (via Prisma Studio,
`npm run db:studio`, or another admin).

## Learn how it all works

Never seen this codebase before? [docs/](docs/) is a staged, numbered
walkthrough of the whole system, written to be read start to finish. Begin
at [docs/00-overview.md](docs/00-overview.md).

Prefer pictures? [docs/excalidraw/](docs/excalidraw/) has one diagram per
major flow: the overall system design, the processing pipeline, credits and
billing, video processing, and YouTube ingestion. [docs/diagrams/](docs/diagrams/)
has the formal diagram set: use case, system architecture, flowchart,
activity, sequence, class, ER, and data flow (Level 0 and Level 1).
