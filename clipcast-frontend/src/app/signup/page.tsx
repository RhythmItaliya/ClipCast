import { redirect } from "next/navigation";
import { AuthShell } from "~/components/auth-shell";
import { SignupForm } from "~/components/signup-form";
import { auth } from "~/server/auth";

export default async function Page() {
  const session = await auth();

  if (session) {
    redirect("/dashboard");
  }

  return (
    <AuthShell>
      <SignupForm />
    </AuthShell>
  );
}
