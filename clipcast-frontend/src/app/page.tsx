/**
 * Root route ("/") — renders no UI of its own. Sends unauthenticated visitors
 * to /login and signed-in users to their role's home (dashboard vs admin).
 */
import { redirect } from "next/navigation";
import { homePathForRole } from "~/lib/roles";
import { auth } from "~/server/auth";

export default async function HomePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  redirect(homePathForRole(session.user.role));
}
