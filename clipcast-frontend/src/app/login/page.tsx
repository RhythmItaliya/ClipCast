/**
 * Login route — redirects already-signed-in users to the dashboard, otherwise
 * renders the login form inside the shared auth shell.
 */
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AuthShell } from "~/components/auth-shell";
import { LoginForm } from "~/components/login-form";
import { auth } from "~/server/auth";

export default async function Page() {
  const session = await auth();

  if (session) {
    redirect("/dashboard");
  }

  return (
    <AuthShell>
      {/* LoginForm reads useSearchParams (e.g. ?callbackUrl, ?error); Next
          requires a Suspense boundary around it to avoid deopting the route. */}
      <Suspense>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
