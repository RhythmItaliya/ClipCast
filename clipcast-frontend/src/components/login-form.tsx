"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Lock, Mail } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn, signOut } from "next-auth/react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { AuthInput, OrDivider, SocialButtons } from "~/components/auth-ui";
import { FRIENDLY_MESSAGES, isOffline } from "~/lib/errors";
import { cn } from "~/lib/utils";
import { loginSchema, type LoginFormValues } from "~/schemas/auth";

/** Map next-auth error codes (?error=…) to messages a user can act on. */
function friendlyAuthError(code: string): string {
  switch (code) {
    case "SessionExpired":
      return "Your session has expired. Please log in again.";
    case "OAuthAccountNotLinked":
      return "This email is already registered with a different sign-in method. Try email + password or the provider you used before.";
    case "AccessDenied":
      return "Access was denied. Please try again or use another sign-in method.";
    case "OAuthSignin":
    case "OAuthCallback":
    case "OAuthCreateAccount":
      return "Could not sign in with that provider. Check your connection and try again.";
    case "Configuration":
      return "Sign-in is temporarily misconfigured. Please try email + password.";
    default:
      return "Could not sign you in. Please try again.";
  }
}

export function LoginForm({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<string | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const code = searchParams.get("error");
    if (!code) return;
    if (code === "SessionExpired") void signOut({ redirect: false });
    setError(friendlyAuthError(code));
  }, [searchParams]);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormValues>({ resolver: zodResolver(loginSchema) });

  const onSubmit = async (data: LoginFormValues) => {
    if (isOffline()) {
      setError(FRIENDLY_MESSAGES.offline);
      return;
    }
    try {
      setIsSubmitting(true);
      setError(null);

      const signInResult = await signIn("credentials", {
        email: data.email,
        password: data.password,
        redirect: false,
      });

      if (signInResult?.error) {
        setError("Invalid email or password.");
      } else {
        // /post-login checks role server-side and sends admins to /admin,
        // everyone else to /dashboard.
        router.push("/post-login");
      }
    } catch {
      setError(
        isOffline() ? FRIENDLY_MESSAGES.offline : FRIENDLY_MESSAGES.network,
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOAuth = async (provider: "google" | "discord") => {
    if (isOffline()) {
      setError(FRIENDLY_MESSAGES.offline);
      return;
    }
    setError(null);
    setOauthLoading(provider);
    try {
      await signIn(provider, { redirectTo: "/post-login" });
    } catch {
      setError(FRIENDLY_MESSAGES.network);
      setOauthLoading(null);
    }
  };

  const busy = isSubmitting || oauthLoading !== null;

  return (
    <div className={cn("flex flex-col", className)} {...props}>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Sign in to keep clipping your podcasts.
        </p>
      </div>

      <SocialButtons
        mode="login"
        loading={oauthLoading}
        disabled={busy}
        onSelect={handleOAuth}
      />
      <OrDivider />

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <AuthInput
          label="Email"
          type="email"
          placeholder="you@studio.com"
          icon={<Mail className="size-4" />}
          autoComplete="email"
          required
          error={errors.email?.message}
          {...register("email")}
        />
        <AuthInput
          label="Password"
          type="password"
          placeholder="••••••••"
          icon={<Lock className="size-4" />}
          autoComplete="current-password"
          required
          error={errors.password?.message}
          {...register("password")}
        />

        {error && (
          <p className="bg-destructive/10 text-destructive rounded-xl p-3 text-sm">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="bg-brand text-brand-foreground mt-2 flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {isSubmitting && <Loader2 className="size-4 animate-spin" />}
          {isSubmitting ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <div className="mt-8 text-center text-sm">
        Don&apos;t have an account?{" "}
        <Link href="/signup" className="text-brand font-medium hover:underline">
          Create one
        </Link>
      </div>
    </div>
  );
}
