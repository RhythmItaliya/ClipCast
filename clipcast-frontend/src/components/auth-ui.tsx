"use client";

import { Loader2 } from "lucide-react";
import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { DiscordIcon, GoogleIcon } from "~/components/brand";

type AuthInputProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: ReactNode;
  icon?: ReactNode;
  error?: string;
};

export const AuthInput = forwardRef<HTMLInputElement, AuthInputProps>(
  function AuthInput({ label, hint, icon, error, className = "", ...rest }, ref) {
    return (
      <label className="block">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-foreground text-xs font-medium">{label}</span>
          {hint}
        </div>
        <div className="relative">
          {icon && (
            <span className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 -translate-y-1/2">
              {icon}
            </span>
          )}
          <input
            ref={ref}
            {...rest}
            className={`border-border bg-surface/60 placeholder:text-muted-foreground focus:border-brand focus:bg-background w-full rounded-xl border px-3 py-2.5 text-sm transition-colors outline-none ${
              icon ? "pl-9" : ""
            } ${className}`}
          />
        </div>
        {error && <p className="text-destructive mt-1.5 text-xs">{error}</p>}
      </label>
    );
  },
);

export function SocialButtons({
  mode = "login",
  loading,
  disabled,
  onSelect,
}: {
  mode?: "login" | "register";
  loading: string | null;
  disabled?: boolean;
  onSelect: (provider: "google" | "discord") => void;
}) {
  const label = mode === "login" ? "Continue" : "Sign up";
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <button
        type="button"
        disabled={disabled}
        onClick={() => onSelect("google")}
        className="border-border bg-surface hover:bg-surface-2 flex items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors disabled:opacity-60"
      >
        {loading === "google" ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <GoogleIcon className="size-4" />
        )}{" "}
        {label} with Google
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onSelect("discord")}
        className="border-border bg-surface hover:bg-surface-2 flex items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors disabled:opacity-60"
      >
        {loading === "discord" ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <DiscordIcon className="size-4" />
        )}{" "}
        {label} with Discord
      </button>
    </div>
  );
}

export function OrDivider() {
  return (
    <div className="text-muted-foreground my-6 flex items-center gap-3 text-xs tracking-widest uppercase">
      <div className="bg-border h-px flex-1" />
      or
      <div className="bg-border h-px flex-1" />
    </div>
  );
}
