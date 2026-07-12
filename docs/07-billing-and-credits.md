# ClipCast 07: Billing & credits

## The credit model

Every `User` has a `credits` integer balance (default 10 on signup; see
`signUp()` in `src/actions/auth.ts`). One credit = one minute of source video,
rounded up, minimum 1 credit per job. Direct uploads are gated on an
estimated/stored duration up front; YouTube jobs true-up the exact charge after
Modal reports the real duration (see
[05-uploads-and-queue.md](05-uploads-and-queue.md)).

## Buying credits

Three fixed one-time packs (small/medium/large; Stripe Price IDs in `.env`:
`STRIPE_SMALL_CREDIT_PACK`, `_MEDIUM_`, `_LARGE_`). Flow:

1. `createCheckoutSession(priceId)` (`src/actions/stripe.ts`) creates a Stripe
   Checkout Session (`mode: "payment"`), attaching the signed-in user's id as
   `client_reference_id` (this is how the webhook knows *which* user paid,
   without needing them to already have a `stripeCustomerId`), and redirects
   the browser to Stripe's hosted checkout page.
2. On success, Stripe redirects back to `/dashboard?success=true` and
   separately fires a webhook.
3. `app/api/stripe/webhook/route.ts` handles `checkout.session.completed`:
   verifies the Stripe signature, resolves which pack was purchased (matching
   the line item's price ID against the three env-configured price IDs) to
   figure out how many credits to grant, resolves the target user (by
   `client_reference_id`, falling back to `stripeCustomerId` lookup for
   subsequent purchases), increments `User.credits`, and, since the admin
   billing view was added, writes a `Purchase` ledger row.

## Webhook idempotency

Stripe retries webhooks automatically on any non-2xx response or timeout.
Before the `Purchase` ledger existed, a retry would have **silently
double-credited** the user (there was nothing to detect "I already processed
this session"). The webhook now checks for an existing `Purchase` with the
same `stripeSessionId` *before* doing anything else, and returns `200`
immediately if found, so a Stripe retry is a safe no-op rather than a double
charge or (after the `Purchase` table was added) a crash on that column's
unique constraint.

## Local development

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

prints a `whsec_…` value; put it in `STRIPE_WEBHOOK_SECRET`. `start.sh` runs
this automatically if the Stripe CLI is installed and logged in.

## The `Purchase` ledger

Beyond powering `/admin/billing` (see next page), it's also the source of
truth an admin can point to for "why does this user have N credits": the
per-user detail page shows the last 10 purchases alongside credits/role/ban
controls.

## How to build it from scratch

**Step 1: install and create the 3 Stripe Prices** (Stripe Dashboard →
Products, one-time price each), then put the price IDs in `.env` as
`STRIPE_SMALL_CREDIT_PACK` / `_MEDIUM_` / `_LARGE_`.

```bash
npm install stripe
```

**Step 2: create the checkout session** (`src/actions/stripe.ts`, real
code):

```ts
"use server";
const stripe = new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: "2026-04-22.dahlia" });

const PRICE_IDS: Record<PriceId, string> = {
  small: env.STRIPE_SMALL_CREDIT_PACK,
  medium: env.STRIPE_MEDIUM_CREDIT_PACK,
  large: env.STRIPE_LARGE_CREDIT_PACK,
};

export async function createCheckoutSession(priceId: PriceId) {
  const serverSession = await auth();
  if (!serverSession?.user?.id) throw new Error("Your session has expired. Please log in again.");

  const user = await db.user.findUniqueOrThrow({ where: { id: serverSession.user.id }, select: { stripeCustomerId: true } });

  const session = await stripe.checkout.sessions.create({
    line_items: [{ price: PRICE_IDS[priceId], quantity: 1 }],
    customer: user.stripeCustomerId || undefined,
    client_reference_id: serverSession.user.id,   // how the webhook knows who paid
    mode: "payment",
    success_url: `${env.BASE_URL}/dashboard?success=true`,
  });

  if (!session.url) throw new Error("We couldn't open the checkout page. Please try again.");
  redirect(session.url);
}
```

**Step 3: the webhook**, `src/app/api/stripe/webhook/route.ts` (the actual
current implementation, idempotency guard included):

```ts
export async function POST(req: Request) {
  const body = await req.text();
  const signature = req.headers.get("stripe-signature") ?? "";
  const event = stripe.webhooks.constructEvent(body, signature, env.STRIPE_WEBHOOK_SECRET);

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const customerId = session.customer as string;
    const userId = session.client_reference_id;

    // Idempotency: Stripe retries on any non-2xx/timeout. Without this check,
    // a retry would double-credit the user before crashing on the unique
    // stripeSessionId constraint below.
    const alreadyProcessed = await db.purchase.findUnique({ where: { stripeSessionId: session.id } });
    if (alreadyProcessed) return new NextResponse(null, { status: 200 });

    const retrieved = await stripe.checkout.sessions.retrieve(session.id, { expand: ["line_items"] });
    const priceId = retrieved.line_items?.data[0]?.price?.id;

    let creditsToAdd = 0, pack = "";
    if (priceId === env.STRIPE_SMALL_CREDIT_PACK) { creditsToAdd = 50; pack = "small"; }
    else if (priceId === env.STRIPE_MEDIUM_CREDIT_PACK) { creditsToAdd = 150; pack = "medium"; }
    else if (priceId === env.STRIPE_LARGE_CREDIT_PACK) { creditsToAdd = 500; pack = "large"; }

    let resolvedUserId = userId;
    if (resolvedUserId) {
      await db.user.update({ where: { id: resolvedUserId }, data: { credits: { increment: creditsToAdd }, stripeCustomerId: customerId } });
    } else {
      const updated = await db.user.update({ where: { stripeCustomerId: customerId }, data: { credits: { increment: creditsToAdd } }, select: { id: true } });
      resolvedUserId = updated.id;
    }

    await db.purchase.create({
      data: { userId: resolvedUserId, stripeSessionId: session.id, stripeCustomerId: customerId,
              priceId, pack, credits: creditsToAdd, amountTotal: session.amount_total ?? 0, currency: session.currency ?? "usd" },
    });
  }
  return new NextResponse(null, { status: 200 });
}
```

**Step 4: local testing.** `stripe listen --forward-to localhost:3000/api/stripe/webhook`
prints a `whsec_...`; put it in `STRIPE_WEBHOOK_SECRET`, then trigger a test
purchase from `/dashboard/billing` using [Stripe's test card numbers](https://stripe.com/docs/testing).

## Diagram

[`excalidraw/02-credits-and-billing.excalidraw`](excalidraw/02-credits-and-billing.excalidraw):
the spend loop and the buy loop side by side, plus why the ledger makes the
webhook idempotent.

## Next

[08-admin-panel.md](08-admin-panel.md): the operational side, managing users,
jobs, clips, revenue, and an audit trail of what admins have done.

## Pricing modifiers & the ledger (current rules)

`src/lib/credits.ts` is the single source of truth:
`creditsForDuration(seconds, { clipMode, isPreview })` — 1 credit/min
rounded up, 1-credit floor even for unknown durations, a 0.05s jitter
allowance so an exactly-3:00 video never bills as 4 minutes, **x1.5 for
"All" mode** (it fans out ~5 Gemini passes) and **x0.5 for preview jobs**
(480p, no speaker detection). Both the upfront gate and the final deduction
call it; deductions are clamped at a 0 balance.

Every balance change writes a `CreditTransaction` row (signed amount +
`balanceAfter`): Stripe purchases (inside one `$transaction` with the
increment and the `Purchase` row — a partial failure can't credit without a
ledger trace), job charges, and admin adjustments. Users see it on
Billing → Transaction history; admins see any user's ledger on the user
detail page.
