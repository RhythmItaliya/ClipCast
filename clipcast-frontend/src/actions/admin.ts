"use server";

import { revalidatePath } from "next/cache";
import { auth } from "~/server/auth";
import { db } from "~/server/db";

// ── Guard helper — throws if the caller is not an ADMIN ─────────────────────
async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    throw new Error("Unauthorized: admin access required.");
  }
  return session.user.id;
}

// ── Stats ────────────────────────────────────────────────────────────────────

/** Aggregate stats shown on the admin overview page. */
export async function getAdminStats() {
  await requireAdmin();

  const [totalUsers, totalClips, totalJobs, activeJobs, failedJobs, bannedUsers] =
    await Promise.all([
      db.user.count(),
      db.clip.count(),
      db.uploadedFile.count(),
      db.uploadedFile.count({ where: { status: { in: ["queued", "processing"] } } }),
      db.uploadedFile.count({ where: { status: "failed" } }),
      db.user.count({ where: { banned: true } }),
    ]);

  return { totalUsers, totalClips, totalJobs, activeJobs, failedJobs, bannedUsers };
}

// ── Users ────────────────────────────────────────────────────────────────────

/** Paginated user list for the admin users table. */
export async function getAdminUsers(page = 1, pageSize = 20) {
  await requireAdmin();

  const skip = (page - 1) * pageSize;
  const [users, total] = await Promise.all([
    db.user.findMany({
      skip,
      take: pageSize,
      orderBy: { id: "desc" },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        banned: true,
        credits: true,
        createdAt: true,
        _count: { select: { clips: true, uploadedFiles: true } },
      },
    }),
    db.user.count(),
  ]);

  return { users, total, page, pageSize };
}

/** Adjust a user's credit balance by a signed delta (positive = add, negative = deduct). */
export async function adjustUserCredits(userId: string, delta: number) {
  await requireAdmin();

  if (!Number.isInteger(delta) || delta === 0) {
    return { success: false, error: "Delta must be a non-zero integer." };
  }

  try {
    const updated = await db.user.update({
      where: { id: userId },
      data: { credits: { increment: delta } },
      select: { credits: true, email: true },
    });
    revalidatePath("/admin/users");
    return { success: true, newCredits: updated.credits };
  } catch {
    return { success: false, error: "User not found or DB error." };
  }
}

/** Ban or unban a user. Banned users cannot sign in. */
export async function setUserBanned(userId: string, banned: boolean) {
  await requireAdmin();

  try {
    await db.user.update({ where: { id: userId }, data: { banned } });
    revalidatePath("/admin/users");
    return { success: true };
  } catch {
    return { success: false, error: "User not found or DB error." };
  }
}

/** Promote or demote a user's role. */
export async function setUserRole(userId: string, role: "USER" | "ADMIN") {
  const callerId = await requireAdmin();

  // Prevent admins from demoting themselves.
  if (userId === callerId && role === "USER") {
    return { success: false, error: "You cannot demote yourself." };
  }

  try {
    await db.user.update({ where: { id: userId }, data: { role } });
    revalidatePath("/admin/users");
    return { success: true };
  } catch {
    return { success: false, error: "User not found or DB error." };
  }
}

// ── Jobs ─────────────────────────────────────────────────────────────────────

/** Paginated job list across all users. */
export async function getAdminJobs(
  page = 1,
  pageSize = 30,
  statusFilter?: string,
) {
  await requireAdmin();

  const skip = (page - 1) * pageSize;
  const where = statusFilter ? { status: statusFilter } : {};

  const [jobs, total] = await Promise.all([
    db.uploadedFile.findMany({
      skip,
      take: pageSize,
      where,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        displayName: true,
        youtubeUrl: true,
        status: true,
        clipMode: true,
        isPreview: true,
        errorMessage: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { clips: true } },
        user: { select: { id: true, email: true, name: true } },
      },
    }),
    db.uploadedFile.count({ where }),
  ]);

  return { jobs, total, page, pageSize };
}

/** Reset all stuck (queued / processing) jobs to failed. */
export async function resetAllStuckJobs() {
  await requireAdmin();

  try {
    const result = await db.uploadedFile.updateMany({
      where: { status: { in: ["queued", "processing"] } },
      data: { status: "failed", errorMessage: "Cancelled by admin." },
    });
    revalidatePath("/admin/jobs");
    return { success: true, count: result.count };
  } catch {
    return { success: false, error: "Failed to reset jobs." };
  }
}

/** Reset a single stuck job to failed. */
export async function resetSingleJob(jobId: string) {
  await requireAdmin();

  try {
    await db.uploadedFile.update({
      where: { id: jobId },
      data: { status: "failed", errorMessage: "Cancelled by admin." },
    });
    revalidatePath("/admin/jobs");
    return { success: true };
  } catch {
    return { success: false, error: "Job not found or DB error." };
  }
}

// ── Clips ────────────────────────────────────────────────────────────────────

/** Paginated clip list across all users. */
export async function getAdminClips(page = 1, pageSize = 30) {
  await requireAdmin();

  const skip = (page - 1) * pageSize;
  const [clips, total] = await Promise.all([
    db.clip.findMany({
      skip,
      take: pageSize,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        s3Key: true,
        clipMode: true,
        isPreview: true,
        createdAt: true,
        user: { select: { id: true, email: true, name: true } },
        uploadedFile: { select: { displayName: true } },
      },
    }),
    db.clip.count(),
  ]);

  return { clips, total, page, pageSize };
}

/** Delete a single clip record (does not remove from S3). */
export async function deleteAdminClip(clipId: string) {
  await requireAdmin();

  try {
    await db.clip.delete({ where: { id: clipId } });
    revalidatePath("/admin/clips");
    return { success: true };
  } catch {
    return { success: false, error: "Clip not found or DB error." };
  }
}
