"use client";

import { Loader2, Mail, X } from "lucide-react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { requestLoginOtp } from "~/actions/otp";
import { AuthInput } from "~/components/auth-ui";
import { FRIENDLY_MESSAGES, getFriendlyErrorMessage, isOffline } from "~/lib/errors";

/**
 * Alternative sign-in method: email a one-time code instead of using a
 * password. Two-step modal — request a code, then enter it — rather than a
 * separate page, since it's a lightweight detour from the main login form.
 */
export function OtpLoginModal() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const reset = () => {
    setOpen(false);
    setStep("email");
    setEmail("");
    setCode("");
    setError(null);
  };

  const handleRequestCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending) return;
    if (isOffline()) {
      setError(FRIENDLY_MESSAGES.offline);
      return;
    }
    setSending(true);
    setError(null);
    try {
      const res = await requestLoginOtp(email);
      if (res.success) {
        setStep("code");
      } else {
        setError(res.error ?? "Could not send a code. Please try again.");
      }
    } catch (err) {
      setError(getFriendlyErrorMessage(err));
    } finally {
      setSending(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (verifying) return;
    if (isOffline()) {
      setError(FRIENDLY_MESSAGES.offline);
      return;
    }
    setVerifying(true);
    setError(null);
    try {
      const result = await signIn("email-otp", {
        email,
        code,
        redirect: false,
      });
      if (result?.error) {
        setError("Incorrect or expired code. Please try again.");
      } else {
        // /post-login checks role server-side and sends admins to /admin,
        // everyone else to /dashboard — same as the password sign-in path.
        router.push("/post-login");
      }
    } catch {
      setError(FRIENDLY_MESSAGES.network);
    } finally {
      setVerifying(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-brand text-sm font-medium hover:underline"
      >
        Sign in with a code instead
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[200] grid place-items-center bg-black/50 p-4 backdrop-blur-sm"
          onClick={reset}
        >
          <div
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            className="border-border bg-surface w-full max-w-sm rounded-3xl border p-6 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">
                {step === "email" ? "Sign in with a code" : "Enter your code"}
              </h2>
              <button
                type="button"
                onClick={reset}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>

            {step === "email" ? (
              <form onSubmit={handleRequestCode} className="mt-4 space-y-4">
                <p className="text-muted-foreground text-sm">
                  We&apos;ll email you a 6-digit code to sign in.
                </p>
                <AuthInput
                  label="Email"
                  type="email"
                  placeholder="you@studio.com"
                  icon={<Mail className="size-4" />}
                  autoComplete="email"
                  autoFocus
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                {error && (
                  <p className="bg-destructive/10 text-destructive rounded-xl p-3 text-sm">
                    {error}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={sending}
                  className="bg-brand text-brand-foreground flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-60"
                >
                  {sending && <Loader2 className="size-4 animate-spin" />}
                  {sending ? "Sending…" : "Send code"}
                </button>
              </form>
            ) : (
              <form onSubmit={handleVerify} className="mt-4 space-y-4">
                <p className="text-muted-foreground text-sm">
                  Enter the code sent to <strong>{email}</strong>.
                </p>
                <AuthInput
                  label="6-digit code"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="123456"
                  autoFocus
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
                {error && (
                  <p className="bg-destructive/10 text-destructive rounded-xl p-3 text-sm">
                    {error}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={verifying}
                  className="bg-brand text-brand-foreground flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-60"
                >
                  {verifying && <Loader2 className="size-4 animate-spin" />}
                  {verifying ? "Verifying…" : "Verify & sign in"}
                </button>
                <button
                  type="button"
                  onClick={() => setStep("email")}
                  className="text-muted-foreground w-full text-center text-xs hover:underline"
                >
                  Use a different email
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
