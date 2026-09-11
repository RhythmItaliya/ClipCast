import { auth } from "~/server/auth";

/**
 * Throws unless the caller is an ADMIN. Returns the admin's id + email so
 * callers can attribute audit-log entries. Shared by every admin server action.
 */
export async function requireAdmin(): Promise<{ id: string; email: string }> {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    throw new Error("Unauthorized: admin access required.");
  }
  return { id: session.user.id, email: session.user.email ?? "" };
}
