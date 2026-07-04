"use server";

import { db } from "~/server/db";
import { otpEmailHtml, queueEmail } from "~/server/mail";
import { createLoginOtp } from "~/server/otp";

type ActionResult = { success: boolean; error?: string };

/**
 * Requests a sign-in code emailed to the given address. Always returns
 * success for unknown/banned accounts too (never reveals whether the email
 * has an account), except for rate-limiting — actual verification happens
 * in next-auth's "email-otp" provider, not here.
 */
export async function requestLoginOtp(emailRaw: string): Promise<ActionResult> {
  const email = emailRaw.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return { success: false, error: "Enter a valid email address." };
  }

  const user = await db.user.findUnique({
    where: { email },
    select: { banned: true },
  });
  if (!user || user.banned) {
    return { success: true };
  }

  const code = await createLoginOtp(email);
  if (!code) {
    return {
      success: false,
      error: "Please wait a moment before requesting another code.",
    };
  }

  await queueEmail({
    to: email,
    subject: "Your ClipCast sign-in code",
    html: otpEmailHtml(code),
  });

  return { success: true };
}
