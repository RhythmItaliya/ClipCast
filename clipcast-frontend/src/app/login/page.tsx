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
      <Suspense>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
