# ClipCast 11: Email & notifications

## Transport (`src/server/mail.ts`)

`sendMail({to, subject, html})` tries, in order:

1. **SMTP** when `SMTP_HOST`/`SMTP_USER`/`SMTP_PASSWORD` are set (Gmail +
   app password in dev). From is forced to `ClipCast <SMTP_USER>` because
   Gmail rewrites mismatched senders. Port 465, TLS.
2. **Resend** when `RESEND_API_KEY` is set (`EMAIL_FROM` default
   `ClipCast <onboarding@resend.dev>`).
3. **Console log** otherwise — the app never crashes for missing mail config.

## Everything is queued, never inline

Callers use `queueEmail()`, which emits an Inngest `email/send` event handled
by `sendEmailFn` (3 retries). A slow or failing provider can never block or
fail the mutation that triggered the email. Inside `processVideoFn`, sends
are wrapped in their own `step.run` so Inngest's replay memoization can't
double-send.

## What gets sent, and when

| Email | Trigger | Respects toggle |
|---|---|---|
| Sign-in code (OTP) | `requestLoginOtp` action | — (auth) |
| Clips are ready | `notify-clip-ready` step after `set-status-processed` | `notifyClipReady` |
| Job failed | no-clips branch + fatal catch (`notify-job-failed*` steps) | `notifyJobFailed` |
| Weekly summary | `weeklySummaryScheduler` cron, Mondays 09:00 UTC, users with clips in last 7 days | `notifyWeeklySummary` |
| Product updates | persisted toggle only — no broadcast feature yet | `notifyProductUpdates` |

Toggles live on `User` (`notify*` booleans), edited in Settings →
Notifications via `updateNotificationPref` (optimistic UI, reverts on error).

## Email OTP sign-in

- `LoginOtp` table: bcrypt `codeHash`, 10-min expiry, 5-attempt cap,
  single-use `consumedAt`, 60s resend cooldown, never reveals whether an
  email is registered.
- `src/server/otp.ts` is the single verification authority; NextAuth's
  `"email-otp"` CredentialsProvider calls `verifyAndConsumeLoginOtp` inside
  `authorize()` — the real auth boundary, not a bypassable client check.
- UI: "Sign in with a code instead" modal on the login page
  (`otp-login-modal.tsx`): email step → code step → `signIn("email-otp")`.
