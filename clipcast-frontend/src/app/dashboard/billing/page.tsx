import { Sparkles } from "lucide-react";
import { getMyCreditTransactions } from "~/actions/stripe";
import { BillingTiers } from "~/components/dashboard/billing-tiers";

export default async function BillingPage() {
  const transactions = await getMyCreditTransactions();

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

      <BillingTiers />

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

      <section className="border-border bg-surface/40 rounded-3xl border p-7">
        <h2 className="text-sm font-semibold">Transaction history</h2>
        <p className="text-muted-foreground mt-1 text-xs">
          Every credit purchase and job charge, newest first.
        </p>
        {transactions.length === 0 ? (
          <p className="text-muted-foreground py-8 text-center text-sm">
            No credit activity yet — new purchases and job charges will show
            up here as they happen.
          </p>
        ) : (
          <div className="border-border divide-border mt-4 divide-y rounded-2xl border">
            {transactions.map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
              >
                <div className="min-w-0">
                  <div className="font-medium">{t.description ?? t.type}</div>
                  <div className="text-muted-foreground text-xs">
                    {new Date(t.createdAt).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}{" "}
                    · balance after: {t.balanceAfter}
                  </div>
                </div>
                <span
                  className={`shrink-0 font-semibold ${
                    t.amount >= 0 ? "text-brand" : "text-destructive"
                  }`}
                >
                  {t.amount >= 0 ? "+" : ""}
                  {t.amount}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
