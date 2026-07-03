import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AdminShell } from "~/components/admin/shell";
import { auth } from "~/server/auth";
import { db } from "~/server/db";

/**
 * Admin layout — server-side role guard.
 * Redirects non-admins to /dashboard instead of showing a 403,
 * so regular users don't even know /admin exists.
 */
export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await auth();

  // Not logged in → send to login
  if (!session?.user?.id) {
    redirect("/login");
  }

  // Not an admin → silently redirect to dashboard
  if (session.user.role !== "ADMIN") {
    redirect("/dashboard");
  }

  // Re-fetch user from DB to get fresh name/email (session may be stale)
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { email: true, name: true },
  });

  if (!user) {
    redirect("/login");
  }

  return (
    <AdminShell email={user.email} name={user.name}>
      {children}
    </AdminShell>
  );
}
