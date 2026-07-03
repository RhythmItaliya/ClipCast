import { redirect } from "next/navigation";
import { SettingsClient } from "~/components/dashboard/settings-client";
import { auth } from "~/server/auth";
import { db } from "~/server/db";

export const metadata = {
  title: "Settings — ClipCast",
  description: "Manage your profile and notification preferences.",
};

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { name: true, email: true },
  });
  if (!user) redirect("/login");

  return <SettingsClient name={user.name} email={user.email} />;
}
