import nodemailer, { type Transporter } from "nodemailer";
import { Resend } from "resend";
import { env } from "~/env";
import { inngest } from "~/inngest/client";

const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

// SMTP takes priority when configured — set up directly against a real
// mailbox (e.g. Gmail + an app password), no third-party API account
// needed. Resend is the fallback if SMTP isn't set, then console-only
// logging if neither is.
let smtpTransporter: Transporter | null = null;
if (env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASSWORD) {
  smtpTransporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: 465,
    secure: true,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
  });
}

const BRAND = "#4f46e5"; // matches --brand in globals.css

function layout(bodyHtml: string): string {
  return `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#111827;">
      <div style="font-weight:700;font-size:18px;color:${BRAND};margin-bottom:24px;">ClipCast</div>
      ${bodyHtml}
      <p style="margin-top:32px;font-size:12px;color:#6b7280;">
        You're receiving this because of your ClipCast notification settings.
        Manage them anytime in Settings → Notifications.
      </p>
    </div>
  `;
}

/**
 * Actually sends the email — SMTP first if configured, then Resend, then a
 * console-only no-op. Never call this directly from a request path or
 * Inngest step that isn't already inside its own durable function/step —
 * use queueEmail() below so a slow/failing mail provider can never block or
 * fail the caller (job processing, sign-up, etc).
 */
export async function sendMail(opts: {
  to: string;
  subject: string;
  html: string;
}): Promise<{ sent: boolean }> {
  if (smtpTransporter) {
    try {
      await smtpTransporter.sendMail({
        // Gmail (and most real mailboxes) reject or silently rewrite a
        // From address that doesn't match the authenticated account, so
        // this ignores EMAIL_FROM's Resend-oriented default and always
        // sends as the actual SMTP account when going through SMTP.
        from: `ClipCast <${env.SMTP_USER}>`,
        to: opts.to,
        subject: opts.subject,
        html: opts.html,
      });
      return { sent: true };
    } catch (error) {
      console.error(`[mail] SMTP send failed for ${opts.to}:`, error);
      return { sent: false };
    }
  }

  if (resend) {
    const { error } = await resend.emails.send({
      from: env.EMAIL_FROM,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
    });
    if (error) {
      console.error(`[mail] Resend send failed for ${opts.to}:`, error);
      return { sent: false };
    }
    return { sent: true };
  }

  console.log(`[mail] (no SMTP or Resend configured) would send to ${opts.to}: ${opts.subject}`);
  return { sent: false };
}

/**
 * Queues an email through Inngest instead of sending inline — so a mutation
 * (job finishing, signup, requesting an OTP) never waits on an external
 * mail API, and a transient provider failure gets Inngest's own retries
 * instead of silently dropping the email.
 */
export async function queueEmail(opts: {
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  await inngest.send({ name: "email/send", data: opts });
}

export function otpEmailHtml(code: string): string {
  return layout(`
    <p style="font-size:14px;margin-bottom:8px;">Your ClipCast sign-in code:</p>
    <div style="font-size:32px;font-weight:700;letter-spacing:6px;color:${BRAND};margin:16px 0;">${code}</div>
    <p style="font-size:13px;color:#6b7280;">This code expires in 10 minutes. If you didn't request it, you can ignore this email.</p>
  `);
}

export function clipReadyEmailHtml(opts: {
  sourceTitle: string;
  clipCount: number;
}): string {
  return layout(`
    <h1 style="font-size:18px;margin:0 0 12px;">Your clips are ready</h1>
    <p style="font-size:14px;">
      ${opts.clipCount} clip${opts.clipCount === 1 ? "" : "s"} finished rendering from
      <strong>${opts.sourceTitle}</strong>.
    </p>
    <a href="${env.BASE_URL}/dashboard/clips"
       style="display:inline-block;margin-top:16px;background:${BRAND};color:#fff;text-decoration:none;padding:10px 20px;border-radius:9999px;font-size:14px;font-weight:600;">
      View clips
    </a>
  `);
}

export function jobFailedEmailHtml(opts: {
  sourceTitle: string;
  reason: string;
}): string {
  return layout(`
    <h1 style="font-size:18px;margin:0 0 12px;">A processing job failed</h1>
    <p style="font-size:14px;"><strong>${opts.sourceTitle}</strong> couldn't be processed:</p>
    <p style="font-size:14px;color:#b91c1c;margin:8px 0;">${opts.reason}</p>
    <a href="${env.BASE_URL}/dashboard/queue"
       style="display:inline-block;margin-top:16px;background:${BRAND};color:#fff;text-decoration:none;padding:10px 20px;border-radius:9999px;font-size:14px;font-weight:600;">
      View queue
    </a>
  `);
}

export function weeklySummaryEmailHtml(opts: {
  clipTitles: string[];
}): string {
  const items = opts.clipTitles
    .map((t) => `<li style="font-size:14px;margin-bottom:4px;">${t}</li>`)
    .join("");
  return layout(`
    <h1 style="font-size:18px;margin:0 0 12px;">Your week in clips</h1>
    <p style="font-size:14px;">${opts.clipTitles.length} new clip${opts.clipTitles.length === 1 ? "" : "s"} this week:</p>
    <ul style="padding-left:18px;margin:12px 0;">${items}</ul>
    <a href="${env.BASE_URL}/dashboard/clips"
       style="display:inline-block;margin-top:16px;background:${BRAND};color:#fff;text-decoration:none;padding:10px 20px;border-radius:9999px;font-size:14px;font-weight:600;">
      View all clips
    </a>
  `);
}
