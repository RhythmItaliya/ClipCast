import { hashPassword, comparePasswords } from "~/lib/auth";
import { db } from "~/server/db";

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const OTP_RESEND_COOLDOWN_MS = 60 * 1000; // 1 minute between requests
const OTP_MAX_ATTEMPTS = 5;

function generateCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/**
 * Creates and stores a new login code for the given (already normalized)
 * email. Returns null if the account is rate-limited, otherwise the raw
 * code to email. Caller (the "request a code" action) decides whether to
 * actually send it.
 */
export async function createLoginOtp(email: string): Promise<string | null> {
  const recent = await db.loginOtp.findFirst({
    where: { email },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (
    recent &&
    Date.now() - recent.createdAt.getTime() < OTP_RESEND_COOLDOWN_MS
  ) {
    return null;
  }

  const code = generateCode();
  const codeHash = await hashPassword(code);

  await db.loginOtp.create({
    data: {
      email,
      codeHash,
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
    },
  });

  return code;
}

/**
 * The single source of truth for checking a login code — used by
 * next-auth's "email-otp" CredentialsProvider.authorize(), which is the
 * actual authentication boundary (a session is only minted if this
 * returns true). Consumes the code on success so it can't be replayed.
 */
export async function verifyAndConsumeLoginOtp(
  email: string,
  code: string,
): Promise<boolean> {
  const otp = await db.loginOtp.findFirst({
    where: { email, consumedAt: null },
    orderBy: { createdAt: "desc" },
  });

  if (!otp || otp.expiresAt < new Date() || otp.attempts >= OTP_MAX_ATTEMPTS) {
    return false;
  }

  const valid = await comparePasswords(code.trim(), otp.codeHash);
  if (!valid) {
    await db.loginOtp.update({
      where: { id: otp.id },
      data: { attempts: { increment: 1 } },
    });
    return false;
  }

  await db.loginOtp.update({
    where: { id: otp.id },
    data: { consumedAt: new Date() },
  });
  return true;
}
