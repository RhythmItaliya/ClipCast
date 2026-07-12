/** Credit pack tiers — keys of the Stripe price-id env mapping. */
export type PriceId = "small" | "medium" | "large";

/** One row of a user's credit ledger (purchases, job charges, admin
 * adjustments), as shown in the Billing transaction history. */
export type CreditTransactionRow = {
  id: string;
  type: string;
  amount: number;
  balanceAfter: number;
  description: string | null;
  createdAt: Date;
};
