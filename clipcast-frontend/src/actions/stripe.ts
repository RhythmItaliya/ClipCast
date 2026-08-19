"use server";

import { redirect } from "next/navigation";
import Stripe from "stripe";
import { env } from "~/env";
import { auth } from "~/server/auth";
import { db } from "~/server/db";

const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
  apiVersion: "2026-04-22.dahlia",
});

import type { CreditTransactionRow, PriceId } from "~/types";

const PRICE_IDS: Record<PriceId, string> = {
  small: env.STRIPE_SMALL_CREDIT_PACK,
  medium: env.STRIPE_MEDIUM_CREDIT_PACK,
  large: env.STRIPE_LARGE_CREDIT_PACK,
};

export async function createCheckoutSession(priceId: PriceId) {
  const serverSession = await auth();

  const user = await db.user.findUniqueOrThrow({
    where: {
      id: serverSession?.user.id,
    },
    select: { stripeCustomerId: true },
  });

  if (!serverSession?.user?.id) {
    throw new Error("Your session has expired. Please log in again to purchase credits.");
  }

  const session = await stripe.checkout.sessions.create({
    line_items: [{ price: PRICE_IDS[priceId], quantity: 1 }],
    customer: user.stripeCustomerId || undefined,
    client_reference_id: serverSession.user.id,
    mode: "payment",
    
    success_url: `${env.BASE_URL}/dashboard?success=true`,
  });

  if (!session.url) {
    throw new Error("We couldn't open the checkout page. Please try again in a moment.");
  }

  redirect(session.url);
}

/** The signed-in user's own credit ledger — purchases and job charges, newest first. */
export async function getMyCreditTransactions(): Promise<CreditTransactionRow[]> {
  const serverSession = await auth();
  if (!serverSession?.user?.id) return [];

  return db.creditTransaction.findMany({
    where: { userId: serverSession.user.id },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: {
      id: true,
      type: true,
      amount: true,
      balanceAfter: true,
      description: true,
      createdAt: true,
    },
  });
}
