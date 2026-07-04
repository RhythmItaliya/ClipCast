import { redirect } from "next/navigation";
import { homePathForRole } from "~/lib/roles";
import { auth } from "~/server/auth";

// Shared landing spot for both the credentials and OAuth sign-in flows.
// OAuth's signIn() redirects server-side before any client code runs, so the
// role-based decision has to live in a page, not in the login form.
export default async function PostLoginPage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  redirect(homePathForRole(session.user.role));
}
