"use client";

import { Check, Loader2, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { createCheckoutSession, type PriceId } from "~/actions/stripe";
import {
  FRIENDLY_MESSAGES,
  getFriendlyErrorMessage,
  isOffline,
} from "~/lib/errors";

const tiers: {
  name: string;
  price: string;
  unit: string;
  save: string | null;
  tagline: string;
  features: string[];
  cta: string;
  popular: boolean;
  priceId: PriceId;
}[] = [
  {
    name: "Small",
    price: "$9.99",
    unit: "50 credits",
    save: null,
    tagline: "Occasional creators",
    features: ["50 processing credits", "Never expires", "Download all clips"],
    cta: "Buy 50 credits",
    popular: false,
    priceId: "small",
  },
  {
    name: "Medium",
    price: "$24.99",
    unit: "150 credits",
    save: "Save 17%",
    tagline: "Regular podcasters",
    features: ["150 processing credits", "Never expires", "Download all clips"],
    cta: "Buy 150 credits",
    popular: true,
    priceId: "medium",
  },
  {
    name: "Large",
    price: "$69.99",
    unit: "500 credits",
    save: "Save 30%",
    tagline: "Studios & agencies",
    features: ["500 processing credits", "Never expires", "Download all clips"],
    cta: "Buy 500 credits",
    popular: false,
    priceId: "large",
  },
];

export default function BillingPage() {
  const [buying, setBuying] = useState<PriceId | null>(null);

  const handleBuy = async (priceId: PriceId) => {
    if (buying) return;
    if (isOffline()) {
      toast.error(FRIENDLY_MESSAGES.offline);
      return;
    }
    setBuying(priceId);
    try {
      // Redirects to Stripe Checkout on success.
      await createCheckoutSession(priceId);
    } catch (e) {
      // next/navigation redirect() throws internally — let it through.
      if (e && typeof e === "object" && "digest" in e) throw e;
      toast.error("Couldn't open checkout", {
        description: getFriendlyErrorMessage(e),
      });
      setBuying(null);
    }
  };

  return (
    <div className="space-y-10">
      <div className="text-center">
        <div className="border-border bg-surface text-brand mx-auto inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium">
          <Sparkles className="size-3.5" /> Pay once. Clip forever.
        </div>
        <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
          Buy Credits
        </h2>
        <p className="text-muted-foreground mx-auto mt-2 max-w-xl text-sm">
          Purchase credits to generate more podcast clips. The more you buy,
          the better the value.
        </p>
      </div>

      <section className="grid grid-cols-1 gap-5 md:grid-cols-3">
        {tiers.map((tier) => (
          <div
            key={tier.name}
            className={`relative flex flex-col rounded-3xl border p-7 transition-transform hover:-translate-y-0.5 ${
              tier.popular
                ? "border-brand from-brand/10 to-surface/60 ring-brand/40 bg-gradient-to-b ring-2"
                : "border-border bg-surface/60"
            }`}
          >
            {tier.popular && (
              <span className="bg-brand text-brand-foreground absolute -top-3 left-1/2 -translate-x-1/2 rounded-full px-3 py-1 text-[10px] font-bold tracking-widest uppercase">
                Most Popular
              </span>
            )}
            <div className="space-y-1">
              <div className="text-muted-foreground text-[11px] font-semibold tracking-widest uppercase">
                {tier.tagline}
              </div>
              <h3 className="text-lg font-semibold">{tier.name}</h3>
            </div>

            <div className="mt-6 flex items-baseline gap-2">
              <span className="text-4xl font-semibold tracking-tight">
                {tier.price}
              </span>
              {tier.save && (
                <span className="bg-brand-soft text-brand rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase">
                  {tier.save}
                </span>
              )}
            </div>
            <div className="text-muted-foreground mt-1 text-xs">
              {tier.unit}
            </div>

            <ul className="border-border mt-6 flex-1 space-y-3 border-t pt-6">
              {tier.features.map((f) => (
                <li key={f} className="flex items-center gap-2.5 text-sm">
                  <span className="bg-brand-soft text-brand grid size-5 place-items-center rounded-full">
                    <Check className="size-3" />
                  </span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>

            <button
              onClick={() => handleBuy(tier.priceId)}
              disabled={buying !== null}
              className={`mt-8 flex items-center justify-center gap-2 rounded-full py-2.5 text-sm font-semibold transition-opacity disabled:opacity-60 ${
                tier.popular
                  ? "bg-brand text-brand-foreground hover:opacity-90"
                  : "bg-surface-2 text-foreground ring-border hover:bg-surface ring-1"
              }`}
            >
              {buying === tier.priceId && (
                <Loader2 className="size-4 animate-spin" />
              )}
              {tier.cta}
            </button>
          </div>
        ))}
      </section>

      <section className="border-border bg-surface/40 rounded-3xl border p-7">
        <h2 className="text-sm font-semibold">How credits work</h2>
        <ul className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          {[
            "1 credit = 1 minute of podcast processing",
            "Around 1 clip is generated per 5 minutes of source",
            "Credits never expire and can be used anytime",
            "Longer podcasts require more credits based on duration",
            "All packages are one-time purchases (no subscription)",
          ].map((item) => (
            <li
              key={item}
              className="text-muted-foreground flex items-start gap-3 text-sm"
            >
              <span className="bg-brand mt-1.5 size-1.5 shrink-0 rounded-full" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
