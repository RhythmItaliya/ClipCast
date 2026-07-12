"use server";

import { hashPassword } from "~/lib/auth";
import { signupSchema, type SignupFormValues } from "~/schemas/auth";
import { auth } from "~/server/auth";
import { db } from "~/server/db";
import Stripe from "stripe";
import { env } from "~/env";

import type { ActionResult, NotificationPref } from "~/types";

export async function signUp(data: SignupFormValues): Promise<ActionResult> {
  const validationResult = signupSchema.safeParse(data);
  if (!validationResult.success) {
    return {
      success: false,
      error: validationResult.error.issues[0]?.message ?? "Invalid input",
    };
  }

  const { email, password } = validationResult.data;

  try {
    const existingUser = await db.user.findUnique({ where: { email } });

    if (existingUser) {
      return {
        success: false,
        error: "Email already in use",
      };
    }

    const hashedPassword = await hashPassword(password);

    let stripeCustomerId: string | null = null;
    try {
      if (
        env.STRIPE_SECRET_KEY &&
        !env.STRIPE_SECRET_KEY.includes("placeholder")
      ) {
        const stripe = new Stripe(env.STRIPE_SECRET_KEY);
        const stripeCustomer = await stripe.customers.create({
          email: email.toLowerCase(),
        });
        stripeCustomerId = stripeCustomer.id;
      }
    } catch (stripeError) {
      console.warn(
        "Stripe customer creation failed, continuing without:",
        stripeError,
      );
    }

    await db.user.create({
      data: {
        email,
        password: hashedPassword,
        stripeCustomerId,
      },
    });

    return { success: true };
  } catch {
    return { success: false, error: "We couldn't create your account right now. Please try again, or use a different email address." };
  }
}

/** Update the signed-in user's display name. */
export async function updateProfile(name: string): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return {
      success: false,
      error: "Your session has expired. Please log in again.",
    };
  }

  const trimmed = name.trim();
  if (!trimmed) return { success: false, error: "Name can't be empty." };
  if (trimmed.length > 100) {
    return { success: false, error: "Name is too long (max 100 characters)." };
  }

  try {
    await db.user.update({
      where: { id: session.user.id },
      data: { name: trimmed },
    });
    return { success: true };
  } catch {
    return { success: false, error: "Could not save your profile." };
  }
}

const NOTIFICATION_FIELDS = {
  clipReady: "notifyClipReady",
  weeklySummary: "notifyWeeklySummary",
  jobFailed: "notifyJobFailed",
  productUpdates: "notifyProductUpdates",
} as const satisfies Record<NotificationPref, string>;

/** Persists a single notification toggle from the Settings page. */
export async function updateNotificationPref(
  pref: NotificationPref,
  enabled: boolean,
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return {
      success: false,
      error: "Your session has expired. Please log in again.",
    };
  }

  try {
    await db.user.update({
      where: { id: session.user.id },
      data: { [NOTIFICATION_FIELDS[pref]]: enabled },
    });
    return { success: true };
  } catch {
    return { success: false, error: "Could not save that preference." };
  }
}

/**
 * Persists the clip-appearance settings: the caption highlight color
 * (null = brand default) and the optional watermark text (null/empty = no
 * watermark burned into clips).
 */
export async function updateClipAppearance(opts: {
  captionColor: string | null;
  watermarkText: string | null;
}): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return {
      success: false,
      error: "Your session has expired. Please log in again.",
    };
  }

  const color = opts.captionColor?.trim() ?? null;
  if (color !== null && !/^#[0-9a-fA-F]{6}$/.test(color)) {
    return { success: false, error: "Pick a valid color." };
  }
  const watermark = opts.watermarkText?.trim().slice(0, 40) || null;

  try {
    await db.user.update({
      where: { id: session.user.id },
      data: { captionColor: color, watermarkText: watermark },
    });
    return { success: true };
  } catch {
    return { success: false, error: "Could not save clip appearance." };
  }
}

/**
 * Permanently delete the signed-in user's account. Uploaded files, clips,
 * OAuth accounts and sessions are removed via cascading deletes.
 */
export async function deleteAccount(): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return {
      success: false,
      error: "Your session has expired. Please log in again.",
    };
  }

  try {
    // Posts have no cascade rule on the user relation — clear them first.
    await db.post.deleteMany({ where: { createdById: session.user.id } });
    await db.user.delete({ where: { id: session.user.id } });
    return { success: true };
  } catch (err) {
    console.error("[auth] deleteAccount failed:", err);
    return { success: false, error: "Could not delete your account." };
  }
}
