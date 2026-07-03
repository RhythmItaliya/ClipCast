"use client";

import { Bell, Loader2, Mail, Trash2, User } from "lucide-react";
import { signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState, type InputHTMLAttributes, type ReactNode } from "react";
import { toast } from "sonner";
import { deleteAccount, updateProfile } from "~/actions/auth";
import {
  FRIENDLY_MESSAGES,
  getFriendlyErrorMessage,
  isOffline,
} from "~/lib/errors";

export function SettingsClient({
  name,
  email,
}: {
  name: string | null;
  email: string;
}) {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <ProfileSection initialName={name} email={email} />
      <NotificationsSection />
      <DangerZoneSection />
    </div>
  );
}

function ProfileSection({
  initialName,
  email,
}: {
  initialName: string | null;
  email: string;
}) {
  const [name, setName] = useState(initialName ?? "");
  const [saving, setSaving] = useState(false);
  const router = useRouter();
  const initial = (initialName ?? email).charAt(0).toUpperCase();

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (isOffline()) {
      toast.error(FRIENDLY_MESSAGES.offline);
      return;
    }
    setSaving(true);
    try {
      const res = await updateProfile(name);
      if (res.success) {
        toast.success("Profile saved.");
        router.refresh();
      } else {
        toast.error("Couldn't save profile", { description: res.error });
      }
    } catch (err) {
      toast.error("Couldn't save profile", {
        description: getFriendlyErrorMessage(err),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="border-border bg-surface/60 rounded-3xl border p-6">
      <header className="mb-6 flex items-center gap-4">
        <div className="bg-brand-soft text-brand ring-background grid size-16 place-items-center rounded-full text-xl font-semibold ring-2">
          {initial}
        </div>
        <div>
          <h2 className="text-base font-semibold">Profile</h2>
          <p className="text-muted-foreground text-xs">
            Update your personal details.
          </p>
        </div>
      </header>

      <form
        className="grid grid-cols-1 gap-4 sm:grid-cols-2"
        onSubmit={handleSave}
      >
        <Field
          label="Display name"
          icon={<User className="size-4" />}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          maxLength={100}
          className="sm:col-span-2"
        />
        <Field
          label="Email"
          type="email"
          icon={<Mail className="size-4" />}
          value={email}
          disabled
          title="Your email is your sign-in identity and can't be changed here."
          className="sm:col-span-2"
        />

        <div className="flex justify-end gap-2 pt-2 sm:col-span-2">
          <button
            type="button"
            onClick={() => setName(initialName ?? "")}
            disabled={saving}
            className="border-border bg-background hover:bg-surface rounded-xl border px-4 py-2 text-sm font-medium disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="bg-brand text-brand-foreground flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold hover:opacity-90 disabled:opacity-60"
          >
            {saving && <Loader2 className="size-4 animate-spin" />}
            Save changes
          </button>
        </div>
      </form>
    </section>
  );
}

function Field({
  label,
  icon,
  className = "",
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  icon?: ReactNode;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-xs font-medium">{label}</span>
      <div className="relative">
        {icon && (
          <span className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 -translate-y-1/2">
            {icon}
          </span>
        )}
        <input
          {...rest}
          className={`border-border bg-background focus:border-brand w-full rounded-xl border px-3 py-2.5 text-sm outline-none disabled:opacity-60 ${
            icon ? "pl-9" : ""
          }`}
        />
      </div>
    </label>
  );
}

function NotificationsSection() {
  const items = [
    {
      id: "n1",
      title: "Clip ready",
      desc: "Email me when a clip is finished rendering.",
      def: true,
    },
    {
      id: "n2",
      title: "Weekly summary",
      desc: "A recap of your top clips every Monday.",
      def: true,
    },
    {
      id: "n3",
      title: "Job failed",
      desc: "Alert me when a processing job fails.",
      def: true,
    },
    {
      id: "n4",
      title: "Product updates",
      desc: "New features, tips and improvements.",
      def: false,
    },
  ];
  return (
    <section className="border-border bg-surface/60 rounded-3xl border p-6">
      <header className="mb-5 flex items-center gap-3">
        <span className="bg-brand-soft text-brand grid size-9 place-items-center rounded-xl">
          <Bell className="size-4" />
        </span>
        <div>
          <h2 className="text-base font-semibold">Notifications</h2>
          <p className="text-muted-foreground text-xs">
            Choose what we email you about.
          </p>
        </div>
      </header>
      <div className="divide-border divide-y">
        {items.map((it) => (
          <ToggleRow
            key={it.id}
            title={it.title}
            desc={it.desc}
            defaultOn={it.def}
          />
        ))}
      </div>
    </section>
  );
}

function ToggleRow({
  title,
  desc,
  defaultOn,
}: {
  title: string;
  desc: string;
  defaultOn: boolean;
}) {
  const [on, setOn] = useState(defaultOn);
  return (
    <div className="flex items-center justify-between gap-6 py-4">
      <div className="min-w-0">
        <div className="text-sm font-medium">{title}</div>
        <div className="text-muted-foreground text-xs">{desc}</div>
      </div>
      <button
        type="button"
        onClick={() => setOn((v) => !v)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
          on ? "bg-brand" : "bg-surface-2"
        }`}
        aria-pressed={on}
      >
        <span
          className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform ${
            on ? "translate-x-5" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}

function DangerZoneSection() {
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (deleting) return;
    if (
      !window.confirm(
        "Permanently delete your account, all uploads and all clips? This can't be undone.",
      )
    )
      return;
    if (isOffline()) {
      toast.error(FRIENDLY_MESSAGES.offline);
      return;
    }
    setDeleting(true);
    try {
      const res = await deleteAccount();
      if (res.success) {
        toast.success("Account deleted. Goodbye!");
        await signOut({ redirectTo: "/login" });
      } else {
        toast.error("Couldn't delete account", { description: res.error });
        setDeleting(false);
      }
    } catch (e) {
      toast.error("Couldn't delete account", {
        description: getFriendlyErrorMessage(e),
      });
      setDeleting(false);
    }
  };

  return (
    <section className="border-destructive/30 bg-destructive/5 rounded-3xl border p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex gap-3">
          <span className="bg-destructive/10 text-destructive grid size-9 place-items-center rounded-xl">
            <Trash2 className="size-4" />
          </span>
          <div>
            <h2 className="text-base font-semibold">Delete account</h2>
            <p className="text-muted-foreground mt-1 max-w-sm text-xs">
              Permanently delete your account and all associated clips. This
              action can&apos;t be undone.
            </p>
          </div>
        </div>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="border-destructive/40 bg-background text-destructive hover:bg-destructive/10 flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium disabled:opacity-60"
        >
          {deleting && <Loader2 className="size-4 animate-spin" />}
          Delete account
        </button>
      </div>
    </section>
  );
}
