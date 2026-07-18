/**
 * Create (or top up) a dedicated TEST USER for exercising the real pipeline —
 * instead of the old direct-Modal test harnesses that created throwaway folders.
 *
 *   npx tsx prisma/seed-test-user.ts
 *
 * Then sign in as that email (email OTP) and submit audio/clip jobs through the
 * normal app flow, so tests go through the exact production path (server action
 * -> Inngest -> Modal -> credits -> queue). Credits are added directly here so
 * the test user never needs a purchase. Override via env:
 *   TEST_USER_EMAIL=... TEST_USER_CREDITS=... npx tsx prisma/seed-test-user.ts
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const EMAIL = process.env.TEST_USER_EMAIL ?? "tester@clipcast.local";
const CREDITS = Number(process.env.TEST_USER_CREDITS ?? 1000);

async function main() {
  const user = await db.user.upsert({
    where: { email: EMAIL },
    update: { credits: CREDITS, banned: false },
    create: {
      email: EMAIL,
      name: "ClipCast Tester",
      credits: CREDITS,
      role: "USER",
    },
    select: { id: true, email: true, credits: true },
  });
  console.log("Test user ready:", user);
  console.log(`Sign in with email OTP as ${EMAIL}, then submit jobs normally.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => void db.$disconnect());
