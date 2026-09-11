"use server";

import { auth } from "~/server/auth";
import { db } from "~/server/db";
import type { ProductionLog, ProductionLogEntry } from "~/types";

/**
 * The multi-agent production transcript for a job the caller owns (docs/17).
 * Returns null if the job isn't theirs or doesn't exist; an empty `entries`
 * array for jobs that ran before the crew existed.
 */
export async function getProductionLog(
  uploadedFileId: string,
): Promise<ProductionLog | null> {
  const session = await auth();
  if (!session?.user?.id) return null;

  const file = await db.uploadedFile.findUnique({
    where: { id: uploadedFileId, userId: session.user.id },
    select: { displayName: true, productionLog: true },
  });
  if (!file) return null;

  const entries = Array.isArray(file.productionLog)
    ? (file.productionLog as unknown as ProductionLogEntry[])
    : [];
  return { title: file.displayName ?? "Production", entries };
}
