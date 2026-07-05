"use client";

import { Bell, Loader2, Mail, Paintbrush, Trash2, User } from "lucide-react";
import { signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState, type InputHTMLAttributes, type ReactNode } from "react";
import { toast } from "sonner";
import {
  deleteAccount,
  updateClipAppearance,
  updateNotificationPref,
  updateProfile,
  type NotificationPref,
} from "~/actions/auth";
import { useConfirm } from "~/components/ui/confirm-dialog";
import {
  FRIENDLY_MESSAGES,
  getFriendlyErrorMessage,
  isOffline,
} from "~/lib/errors";

export type NotificationPrefs = {
  clipReady: boolean;
  weeklySummary: boolean;
  jobFailed: boolean;
  productUpdates: boolean;
};

export type ClipAppearance = {
  captionColor: string | null;
  watermarkText: string | null;
};

export function SettingsClient({
  name,
  email,
  notifications,
  clipAppearance,
}: {
  name: string | null;
  email: string;
  notifications: NotificationPrefs;
  clipAppearance: ClipAppearance;
}) {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <ProfileSection initialName={name} email={email} />
      <ClipAppearanceSection initial={clipAppearance} />
      <NotificationsSection initial={notifications} />
      <DangerZoneSection />
    </div>
  );
}

// Brand indigo first (the default when nothing is picked), then a spread of
// caption-highlight colors that stay readable under white pill text.
const CAPTION_COLORS = [
  { hex: "#6366F1", label: "Indigo (default)" },
  { hex: "#22C55E", label: "Green" },
  { hex: "#EAB308", label: "Yellow" },
  { hex: "#EF4444", label: "Red" },
  { hex: "#EC4899", label: "Pink" },
  { hex: "#F97316", label: "Orange" },
  { hex: "#06B6D4", label: "Cyan" },
  { hex: "#8B5CF6", label: "Purple" },
] as const;

function ClipAppearanceSection({ initial }: { initial: ClipAppearance }) {
  // null means "brand default" — visually the same swatch as #6366F1, but
  // stored as null so a future brand-color change applies automatically.
  const [color, setColor] = useState<string | null>(initial.captionColor);
  const [watermark, setWatermark] = useState(initial.watermarkText ?? "");
  const [saving, setSaving] = useState(false);

  const selectedHex = (color ?? CAPTION_COLORS[0].hex).toUpperCase();

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (isOffline()) {
      toast.error(FRIENDLY_MESSAGES.offline);
      return;
    }
    setSaving(true);
    try {
      const res = await updateClipAppearance({
        captionColor: color,
        watermarkText: watermark.trim() || null,
      });
      if (res.success) {
        toast.success("Clip appearance saved.", {
          description: "New clips will use these settings.",
        });
      } else {
        toast.error("Couldn't save clip appearance", {
          description: res.error,
        });
      }
    } catch (err) {
      toast.error("Couldn't save clip appearance", {
        description: getFriendlyErrorMessage(err),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="border-border bg-surface/60 rounded-3xl border p-6">
      <header className="mb-5 flex items-center gap-3">
        <span className="bg-brand-soft text-brand grid size-9 place-items-center rounded-xl">
          <Paintbrush className="size-4" />
        </span>
        <div>
          <h2 className="text-base font-semibold">Clip appearance</h2>
          <p className="text-muted-foreground text-xs">
            How captions and branding look on your rendered clips.
          </p>
        </div>
      </header>

      <form onSubmit={handleSave} className="space-y-5">
        <div>
          <span className="mb-2 block text-xs font-medium">
            Caption highlight color
          </span>
          <p className="text-muted-foreground mb-3 text-xs">
            The color behind the word being spoken.
          </p>
          <div className="flex flex-wrap gap-2">
            {CAPTION_COLORS.map((c, i) => {
              const isSelected =
                selectedHex === c.hex.toUpperCase() &&
                (i !== 0 || color === null || color.toUpperCase() === c.hex);
              return (
                <button
                  key={c.hex}
                  type="button"
                  title={c.label}
                  onClick={() => setColor(i === 0 ? null : c.hex)}
                  className={`size-9 rounded-full transition-transform hover:scale-110 ${
                    isSelected
                      ? "ring-foreground ring-2 ring-offset-2"
                      : "ring-border ring-1"
                  }`}
                  style={{ backgroundColor: c.hex }}
                />
              );
            })}
          </div>
        </div>

        <div>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium">
              Watermark text (optional)
            </span>
            <input
              value={watermark}
              onChange={(e) => setWatermark(e.target.value)}
              maxLength={40}
              placeholder="e.g. @yourhandle"
              className="border-border bg-background focus:border-brand w-full rounded-xl border px-3 py-2.5 text-sm outline-none"
            />
          </label>
          <p className="text-muted-foreground mt-1.5 text-xs">
            Shown small and semi-transparent in the top corner of your clips.
            Leave empty for no watermark.
          </p>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="bg-brand text-brand-foreground flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold hover:opacity-90 disabled:opacity-60"
          >
            {saving && <Loader2 className="size-4 animate-spin" />}
            Save appearance
          </button>
        </div>
      </form>
    </section>
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

function NotificationsSection({ initial }: { initial: NotificationPrefs }) {
  const items: {
    pref: NotificationPref;
    title: string;
    desc: string;
  }[] = [
    {
      pref: "clipReady",
      title: "Clip ready",
      desc: "Email me when a clip is finished rendering.",
    },
    {
      pref: "weeklySummary",
      title: "Weekly summary",
      desc: "A recap of your top clips every Monday.",
    },
    {
      pref: "jobFailed",
      title: "Job failed",
      desc: "Alert me when a processing job fails.",
    },
    {
      pref: "productUpdates",
      title: "Product updates",
      desc: "New features, tips and improvements.",
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
            key={it.pref}
            pref={it.pref}
            title={it.title}
            desc={it.desc}
            defaultOn={initial[it.pref]}
          />
        ))}
      </div>
    </section>
  );
}

function ToggleRow({
  pref,
  title,
  desc,
  defaultOn,
}: {
  pref: NotificationPref;
  title: string;
  desc: string;
  defaultOn: boolean;
}) {
  const [on, setOn] = useState(defaultOn);
  const [saving, setSaving] = useState(false);

  const handleToggle = async () => {
    if (saving) return;
    const next = !on;
    setOn(next); // optimistic
    setSaving(true);
    try {
      const res = await updateNotificationPref(pref, next);
      if (!res.success) {
        setOn(!next); // revert
        toast.error("Couldn't save that preference", {
          description: res.error,
        });
      }
    } catch (err) {
      setOn(!next);
      toast.error("Couldn't save that preference", {
        description: getFriendlyErrorMessage(err),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center justify-between gap-6 py-4">
      <div className="min-w-0">
        <div className="text-sm font-medium">{title}</div>
        <div className="text-muted-foreground text-xs">{desc}</div>
      </div>
      <button
        type="button"
        onClick={handleToggle}
        disabled={saving}
        role="switch"
        aria-checked={on}
        aria-label={title}
        className={`ring-border relative h-5 w-9 shrink-0 rounded-full ring-1 transition-colors disabled:cursor-wait disabled:opacity-60 ${
          on ? "bg-brand" : "bg-surface-2"
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 size-4 rounded-full transition-all ${
            on
              ? "bg-brand-foreground translate-x-4"
              : "bg-foreground translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}

function DangerZoneSection() {
  const confirm = useConfirm();
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (deleting) return;
    const ok = await confirm({
      title: "Delete your account?",
      description:
        "Permanently delete your account, all uploads and all clips. This can't be undone.",
      confirmLabel: "Delete account",
      destructive: true,
    });
    if (!ok) return;
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
