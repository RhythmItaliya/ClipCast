"use server";

import { revalidatePath } from "next/cache";
import { db } from "~/server/db";
import {
  deleteProviderKey,
  getProviderKeyStatuses,
  setProviderConfig,
  type ProviderConfigStatus,
} from "~/server/provider-keys";
import { requireAdmin } from "~/server/require-admin";
import {
  LLM_PROVIDERS,
  getLlmProvider,
  setLlmProviderSetting,
  type LlmProvider,
} from "~/server/settings";
import { LLM_EFFORTS, PROVIDERS_WITH_EFFORT } from "~/lib/llm-providers";

/** Best-effort audit trail write — never let a logging failure fail the mutation. */
async function logAdminAction(
  admin: { id: string; email: string },
  action: string,
  targetType: string,
  targetId?: string,
  detail?: string,
) {
  await db.adminAuditLog
    .create({
      data: { adminId: admin.id, adminEmail: admin.email, action, targetType, targetId, detail },
    })
    .catch((err) => console.warn("[admin audit] failed to log", err));
}

// ── AI provider setting ───────────────────────────────────────────────────────

/** The active LLM provider for the AI crew (admin-only read). */
export async function getLlmProviderSetting(): Promise<LlmProvider> {
  await requireAdmin();
  return getLlmProvider();
}

/** Switch the AI crew's LLM provider (deepseek/gemini/claude). Live — the next
 * job picks it up; no redeploy. */
export async function setLlmProvider(
  provider: LlmProvider,
): Promise<{ success: boolean; error?: string }> {
  const admin = await requireAdmin();
  if (!LLM_PROVIDERS.includes(provider)) {
    return { success: false, error: "Invalid provider." };
  }
  await setLlmProviderSetting(provider);
  await logAdminAction(admin, "set_llm_provider", "setting", "llm_provider", provider);
  revalidatePath("/admin");
  revalidatePath("/admin/providers");
  return { success: true };
}

// ── Provider API keys ─────────────────────────────────────────────────────────

/** Config status for every provider (admin-only). Never returns the API key. */
export async function getProviderKeys(): Promise<ProviderConfigStatus[]> {
  await requireAdmin();
  return getProviderKeyStatuses();
}

/** Store (encrypted) an API key for a provider. Live — the next job uses it. */
export async function saveProviderApiKey(
  provider: LlmProvider,
  apiKey: string,
): Promise<{ success: boolean; error?: string }> {
  const admin = await requireAdmin();
  if (!LLM_PROVIDERS.includes(provider)) {
    return { success: false, error: "Invalid provider." };
  }
  if (typeof apiKey !== "string" || apiKey.trim().length < 8) {
    return { success: false, error: "That key looks too short." };
  }
  try {
    // Only touches the key; model/effort/baseUrl are preserved by the merge.
    await setProviderConfig(provider, { apiKey });
  } catch (err) {
    // Most likely SETTINGS_ENCRYPTION_KEY is missing/invalid.
    return {
      success: false,
      error: err instanceof Error ? err.message : "Couldn't save the key.",
    };
  }
  await logAdminAction(admin, "provider_key.set", "setting", provider);
  revalidatePath("/admin/providers");
  return { success: true };
}

/**
 * Save a provider's non-secret settings — model id, effort (Claude only), and a
 * custom endpoint/base URL. Never touches the API key. A blank field clears it
 * (the backend falls back to its default). Live — the next job uses them.
 */
export async function saveProviderConfig(
  provider: LlmProvider,
  config: { model?: string; effort?: string; baseUrl?: string },
): Promise<{ success: boolean; error?: string }> {
  const admin = await requireAdmin();
  if (!LLM_PROVIDERS.includes(provider)) {
    return { success: false, error: "Invalid provider." };
  }

  const model = (config.model ?? "").trim();
  const baseUrl = (config.baseUrl ?? "").trim();
  let effort = (config.effort ?? "").trim();

  if (model.length > 100) {
    return { success: false, error: "That model id looks too long." };
  }
  if (baseUrl) {
    let ok = false;
    try {
      const u = new URL(baseUrl);
      ok = u.protocol === "http:" || u.protocol === "https:";
    } catch {
      ok = false;
    }
    if (!ok) {
      return { success: false, error: "Endpoint must be a valid http(s) URL." };
    }
  }
  // Effort only applies to providers that support it (Anthropic). Ignore it for
  // the others, and reject an unknown value.
  if (!PROVIDERS_WITH_EFFORT.includes(provider)) {
    effort = "";
  } else if (effort && !(LLM_EFFORTS as readonly string[]).includes(effort)) {
    return { success: false, error: "Invalid effort level." };
  }

  try {
    await setProviderConfig(provider, { model, effort, baseUrl });
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Couldn't save settings.",
    };
  }
  await logAdminAction(admin, "provider_config.set", "setting", provider);
  revalidatePath("/admin/providers");
  return { success: true };
}

/** Remove a provider's stored API key. */
export async function removeProviderApiKey(
  provider: LlmProvider,
): Promise<{ success: boolean; error?: string }> {
  const admin = await requireAdmin();
  if (!LLM_PROVIDERS.includes(provider)) {
    return { success: false, error: "Invalid provider." };
  }
  await deleteProviderKey(provider);
  await logAdminAction(admin, "provider_key.remove", "setting", provider);
  revalidatePath("/admin/providers");
  return { success: true };
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
  const admin = await requireAdmin();

  if (!Number.isInteger(delta) || delta === 0) {
    return { success: false, error: "Delta must be a non-zero integer." };
  }

  try {
    const updated = await db.user.update({
      where: { id: userId },
      data: { credits: { increment: delta } },
      select: { credits: true, email: true },
    });
    await db.creditTransaction.create({
      data: {
        userId,
        type: "admin_adjust",
        amount: delta,
        balanceAfter: updated.credits,
        description: `Adjusted by admin ${admin.email}`,
      },
    });
    await logAdminAction(
      admin,
      "credits.adjust",
      "user",
      userId,
      `${delta > 0 ? "+" : ""}${delta} credits → ${updated.email}`,
    );
    revalidatePath("/admin/users");
    revalidatePath(`/admin/users/${userId}`);
    return { success: true, newCredits: updated.credits };
  } catch {
    return { success: false, error: "User not found or DB error." };
  }
}

/** Ban or unban a user. Banned users cannot sign in. */
export async function setUserBanned(userId: string, banned: boolean) {
  const admin = await requireAdmin();

  try {
    const updated = await db.user.update({
      where: { id: userId },
      data: { banned },
      select: { email: true },
    });
    await logAdminAction(admin, banned ? "user.ban" : "user.unban", "user", userId, updated.email);
    revalidatePath("/admin/users");
    revalidatePath(`/admin/users/${userId}`);
    return { success: true };
  } catch {
    return { success: false, error: "User not found or DB error." };
  }
}

/** Promote or demote a user's role. */
export async function setUserRole(userId: string, role: "USER" | "ADMIN") {
  const admin = await requireAdmin();

  // Prevent admins from demoting themselves.
  if (userId === admin.id && role === "USER") {
    return { success: false, error: "You cannot demote yourself." };
  }

  try {
    const updated = await db.user.update({
      where: { id: userId },
      data: { role },
      select: { email: true },
    });
    await logAdminAction(
      admin,
      role === "ADMIN" ? "user.promote" : "user.demote",
      "user",
      userId,
      updated.email,
    );
    revalidatePath("/admin/users");
    revalidatePath(`/admin/users/${userId}`);
    return { success: true };
  } catch {
    return { success: false, error: "User not found or DB error." };
  }
}

/** Full profile + recent activity for the admin user detail page. */
export async function getAdminUserDetail(userId: string) {
  await requireAdmin();

  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      banned: true,
      credits: true,
      createdAt: true,
      stripeCustomerId: true,
      youtubeChannelId: true,
      youtubeChannelName: true,
      _count: { select: { clips: true, uploadedFiles: true, purchases: true } },
    },
  });
  if (!user) return null;

  const [jobs, clips, purchases, transactions] = await Promise.all([
    db.uploadedFile.findMany({
      where: { userId },
      take: 10,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        displayName: true,
        youtubeUrl: true,
        status: true,
        createdAt: true,
        _count: { select: { clips: true } },
      },
    }),
    db.clip.findMany({
      where: { userId },
      take: 10,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        s3Key: true,
        clipMode: true,
        createdAt: true,
        uploadedFile: { select: { displayName: true } },
      },
    }),
    db.purchase.findMany({
      where: { userId },
      take: 10,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        pack: true,
        credits: true,
        amountTotal: true,
        currency: true,
        createdAt: true,
      },
    }),
    db.creditTransaction.findMany({
      where: { userId },
      take: 20,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        type: true,
        amount: true,
        balanceAfter: true,
        description: true,
        createdAt: true,
      },
    }),
  ]);

  return { user, jobs, clips, purchases, transactions };
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
        internalErrorDetail: true,
        processingSummary: true,
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

/**
 * Full detail for one job (admin) — every field plus the multi-agent
 * production log, so an admin can see WHO/WHAT/WHY/HOW each step ran (which
 * crew role, real model vs fallback + model name) and the full error context.
 */
export async function getAdminJob(id: string) {
  await requireAdmin();

  return db.uploadedFile.findUnique({
    where: { id },
    select: {
      id: true,
      displayName: true,
      youtubeUrl: true,
      status: true,
      jobType: true,
      clipMode: true,
      audioMode: true,
      audioGenre: true,
      isPreview: true,
      duration: true,
      errorMessage: true,
      internalErrorDetail: true,
      processingSummary: true,
      productionLog: true,
      createdAt: true,
      updatedAt: true,
      user: { select: { id: true, email: true, name: true } },
      _count: { select: { clips: true } },
    },
  });
}

/** Reset all stuck (queued / processing) jobs to failed. */
export async function resetAllStuckJobs() {
  const admin = await requireAdmin();

  try {
    const result = await db.uploadedFile.updateMany({
      where: { status: { in: ["queued", "processing"] } },
      data: { status: "failed", errorMessage: "Cancelled by admin." },
    });
    await logAdminAction(admin, "job.reset_all", "job", undefined, `${result.count} job(s)`);
    revalidatePath("/admin/jobs");
    return { success: true, count: result.count };
  } catch {
    return { success: false, error: "Failed to reset jobs." };
  }
}

/** Reset a single stuck job to failed. */
export async function resetSingleJob(jobId: string) {
  const admin = await requireAdmin();

  try {
    await db.uploadedFile.update({
      where: { id: jobId },
      data: { status: "failed", errorMessage: "Cancelled by admin." },
    });
    await logAdminAction(admin, "job.reset", "job", jobId);
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
        title: true,
        duration: true,
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
  const admin = await requireAdmin();

  try {
    await db.clip.delete({ where: { id: clipId } });
    await logAdminAction(admin, "clip.delete", "clip", clipId);
    revalidatePath("/admin/clips");
    return { success: true };
  } catch {
    return { success: false, error: "Clip not found or DB error." };
  }
}

// ── Billing ──────────────────────────────────────────────────────────────────

/** Aggregate revenue stats shown on the admin billing page. */
export async function getAdminRevenueStats() {
  await requireAdmin();

  const agg = await db.purchase.aggregate({
    _sum: { amountTotal: true, credits: true },
    _count: true,
  });

  return {
    totalRevenueCents: agg._sum.amountTotal ?? 0,
    totalCreditsSold: agg._sum.credits ?? 0,
    totalPurchases: agg._count,
  };
}

/** Paginated purchase ledger for the admin billing page. */
export async function getAdminPurchases(page = 1, pageSize = 30) {
  await requireAdmin();

  const skip = (page - 1) * pageSize;
  const [purchases, total] = await Promise.all([
    db.purchase.findMany({
      skip,
      take: pageSize,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        pack: true,
        credits: true,
        amountTotal: true,
        currency: true,
        createdAt: true,
        user: { select: { id: true, email: true, name: true } },
      },
    }),
    db.purchase.count(),
  ]);

  return { purchases, total, page, pageSize };
}

// ── Audit log ────────────────────────────────────────────────────────────────

/** Paginated admin activity log. */
export async function getAdminAuditLog(page = 1, pageSize = 30) {
  await requireAdmin();

  const skip = (page - 1) * pageSize;
  const [entries, total] = await Promise.all([
    db.adminAuditLog.findMany({
      skip,
      take: pageSize,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        adminEmail: true,
        action: true,
        targetType: true,
        targetId: true,
        detail: true,
        createdAt: true,
      },
    }),
    db.adminAuditLog.count(),
  ]);

  return { entries, total, page, pageSize };
}
