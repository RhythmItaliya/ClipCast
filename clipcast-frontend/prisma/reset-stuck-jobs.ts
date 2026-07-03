/**
 * Run once at local dev startup (see start.sh) to clean up jobs left in
 * "queued"/"processing" by a previous ungraceful shutdown — their Inngest
 * run is gone, so they'd otherwise sit stuck forever. Matches the same
 * semantics as the admin panel's "Reset All Stuck" button
 * (resetAllStuckJobs() in src/actions/admin.ts): mark them failed rather
 * than silently re-queuing, since there's no way to know if it's safe to
 * resume them.
 */
import path from "node:path";
import { PrismaClient } from "@prisma/client";

// Invoked directly via `tsx` (see start.sh), not through Next.js, so the
// repo-root .env isn't loaded automatically the way @next/env does it for
// the app itself — load it explicitly here.
try {
  process.loadEnvFile(path.resolve(import.meta.dirname, "../../.env"));
} catch (err) {
  console.warn("[reset-stuck-jobs] could not load .env (continuing anyway):", err);
}

const db = new PrismaClient();

async function main() {
  const result = await db.uploadedFile.updateMany({
    where: { status: { in: ["queued", "processing"] } },
    data: { status: "failed", errorMessage: "Reset on dev server restart." },
  });
  if (result.count > 0) {
    console.log(`[reset-stuck-jobs] marked ${result.count} stuck job(s) as failed.`);
  }
}

main()
  .catch((err) => {
    console.error("[reset-stuck-jobs] failed:", err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
