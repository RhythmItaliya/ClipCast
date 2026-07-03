import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { ForceLogout } from "~/components/force-logout";
import { DashboardShell } from "~/components/dashboard/shell";
import { auth } from "~/server/auth";
import { db } from "~/server/db";

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { credits: true, email: true, name: true },
  });

  if (!user) {
    return <ForceLogout />;
  }

  return (
    <DashboardShell credits={user.credits} email={user.email} name={user.name}>
      {children}
    </DashboardShell>
  );
}
