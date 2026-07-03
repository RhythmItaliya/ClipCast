"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Lock, Mail } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { signUp } from "~/actions/auth";
import { AuthInput, OrDivider, SocialButtons } from "~/components/auth-ui";
import { FRIENDLY_MESSAGES, isOffline } from "~/lib/errors";
import { cn } from "~/lib/utils";
import { signupSchema, type SignupFormValues } from "~/schemas/auth";

export function SignupForm({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<string | null>(null);
  const router = useRouter();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SignupFormValues>({ resolver: zodResolver(signupSchema) });

  const onSubmit = async (data: SignupFormValues) => {
    if (isOffline()) {
      toast.error(FRIENDLY_MESSAGES.offline);
      return;
    }
    try {
      setIsSubmitting(true);

      const result = await signUp(data);

      if (!result.success) {
        toast.error(result.error ?? "An error occurred during signup");
        return;
      }

      toast.success("Account created!", {
        description: "You have 10 free credits. Please log in.",
      });
      router.push("/login");
    } catch {
      toast.error(
        isOffline() ? FRIENDLY_MESSAGES.offline : FRIENDLY_MESSAGES.network,
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOAuth = async (provider: "google" | "discord") => {
    if (isOffline()) {
      toast.error(FRIENDLY_MESSAGES.offline);
      return;
    }
    setOauthLoading(provider);
    try {
      await signIn(provider, { redirectTo: "/dashboard" });
    } catch {
      toast.error(FRIENDLY_MESSAGES.network);
      setOauthLoading(null);
    }
  };

  const busy = isSubmitting || oauthLoading !== null;

  return (
    <div className={cn("flex flex-col", className)} {...props}>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          Create your account
        </h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Start turning podcasts into share-ready clips — 10 free credits
          included.
        </p>
      </div>

      <SocialButtons
        mode="register"
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
          placeholder="At least 8 characters"
          icon={<Lock className="size-4" />}
          autoComplete="new-password"
          required
          error={errors.password?.message}
          {...register("password")}
        />

        <button
          type="submit"
          disabled={busy}
          className="bg-brand text-brand-foreground mt-2 flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {isSubmitting && <Loader2 className="size-4 animate-spin" />}
          {isSubmitting ? "Creating account…" : "Create account"}
        </button>
      </form>

      <div className="mt-8 text-center text-sm">
        Already have an account?{" "}
        <Link href="/login" className="text-brand font-medium hover:underline">
          Sign in
        </Link>
      </div>
    </div>
  );
}
