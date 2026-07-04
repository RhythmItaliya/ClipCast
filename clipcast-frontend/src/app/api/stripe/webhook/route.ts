// stripe listen --forward-to localhost:3000/api/webhooks/stripe

import { NextResponse } from "next/server";
import Stripe from "stripe";
import { env } from "~/env";
import { db } from "~/server/db";

const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
  apiVersion: "2026-04-22.dahlia",
});

const webhookSecret = env.STRIPE_WEBHOOK_SECRET;

export async function POST(req: Request) {
  try {
    const body = await req.text();
    const signature = req.headers.get("stripe-signature") ?? "";

    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    } catch (error) {
      console.error("Webhook signature verification failed", error);
      return new NextResponse("Webhook signature verification failed", {
        status: 400,
      });
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const customerId = session.customer as string;

      const userId = session.client_reference_id;

      // Stripe retries this webhook on timeout/non-2xx; without this guard a
      // retry would double-credit the user before failing on the unique
      // stripeSessionId constraint below.
      const alreadyProcessed = await db.purchase.findUnique({
        where: { stripeSessionId: session.id },
        select: { id: true },
      });
      if (alreadyProcessed) {
        return new NextResponse(null, { status: 200 });
      }

      const retreivedSession = await stripe.checkout.sessions.retrieve(
        session.id,
        { expand: ["line_items"] },
      );

      const lineItems = retreivedSession.line_items;
      if (lineItems && lineItems.data.length > 0) {
        const priceId = lineItems.data[0]?.price?.id ?? undefined;

        if (priceId) {
          let creditsToAdd = 0;
          let pack = "";

          if (priceId === env.STRIPE_SMALL_CREDIT_PACK) {
            creditsToAdd = 50;
            pack = "small";
          } else if (priceId === env.STRIPE_MEDIUM_CREDIT_PACK) {
            creditsToAdd = 150;
            pack = "medium";
          } else if (priceId === env.STRIPE_LARGE_CREDIT_PACK) {
            creditsToAdd = 500;
            pack = "large";
          }

          // Resolve the target user first (read-only) so the actual writes
          // below — increment, Purchase row, CreditTransaction row — can all
          // go in one $transaction. These three used to run as separate
          // sequential awaits: if anything interrupted execution between
          // them (a thrown error, a dev-server restart mid-request), credits
          // could get incremented with no Purchase/CreditTransaction ever
          // written to back it up, and the alreadyProcessed guard above
          // would then hide the gap from any Stripe retry since no
          // partial retry can re-run just the missing piece. Atomic now —
          // either all three happen, or none do.
          let resolvedUserId = userId ?? null;
          if (!resolvedUserId) {
            const existing = await db.user.findUniqueOrThrow({
              where: { stripeCustomerId: customerId },
              select: { id: true },
            });
            resolvedUserId = existing.id;
          }

          if (pack && resolvedUserId) {
            await db.$transaction(async (tx) => {
              const updated = await tx.user.update({
                where: { id: resolvedUserId! },
                data: {
                  credits: { increment: creditsToAdd },
                  stripeCustomerId: customerId,
                },
                select: { credits: true },
              });

              const purchase = await tx.purchase.create({
                data: {
                  userId: resolvedUserId!,
                  stripeSessionId: session.id,
                  stripeCustomerId: customerId,
                  priceId,
                  pack,
                  credits: creditsToAdd,
                  amountTotal: session.amount_total ?? 0,
                  currency: session.currency ?? "usd",
                },
              });

              await tx.creditTransaction.create({
                data: {
                  userId: resolvedUserId!,
                  type: "purchase",
                  amount: creditsToAdd,
                  balanceAfter: updated.credits,
                  purchaseId: purchase.id,
                  description: `${pack[0]!.toUpperCase()}${pack.slice(1)} credit pack`,
                },
              });
            });
          }
        }
      }
    }

    return new NextResponse(null, { status: 200 });
  } catch (error) {
    console.error("Error processing webhook:", error);
    return new NextResponse("Webhook error", { status: 500 });
  }
}
