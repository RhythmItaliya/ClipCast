import { redirect } from "next/navigation";
import { auth } from "~/server/auth";

/**
 * Single landing spot both the credentials and OAuth sign-in flows redirect
 * to, so "where do I land after login" only has one answer, based on role,
 * regardless of which sign-in method was used. OAuth's `signIn()` redirects
 * server-side before any client code runs, so this can't be decided in the
 * login form itself for that flow — it has to be a page.
 */
export default async function PostLoginPage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  redirect(session.user.role === "ADMIN" ? "/admin" : "/dashboard");
}
