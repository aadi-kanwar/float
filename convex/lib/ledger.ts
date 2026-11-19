/**
 * The ledger engine. What a resident owes is NEVER stored: it is worked out
 * here, every time, by replaying their ledger rows in the order they took
 * effect. Pure functions (no database), so they are easy to test.
 *
 * Rows:
 *   draw, fee, lateFee        charges, each belonging to a month ("cycle")
 *   repayment, depositAdjustment
 *                             credits: paid off oldest month first, and in
 *                             each month late fees -> fees -> principal
 *   waiver                    removes part of one month's fee or late fee
 *   reversal                  cancels one earlier row completely: the row
 *                             and its reversal are both left out of the sums
 *                             (history keeps both)
 *
 * A credit bigger than everything owed is kept as a credit balance and used
 * on the next charge.
 */

export type Bucket = "lateFee" | "fee" | "principal";
/** The order a payment clears a month's charges. */
export const PAY_ORDER: Bucket[] = ["lateFee", "fee", "principal"];

export type LedgerType =
  | "draw"
  | "fee"
  | "lateFee"
  | "repayment"
  | "waiver"
  | "reversal"
  | "depositAdjustment";

export type LedgerRow = {
  id: string;
  type: LedgerType;
  amountPaise: number;
  /** Charges and waivers: the month they belong to. */
  cycleMonth?: string;
  /** Waivers: which part they waive. */
  bucket?: "fee" | "lateFee";
  /** Reversals: the row they cancel. */
  reversesEntryId?: string;
  effectiveAt: number;
  createdAt: number;
};

export type BucketState = { charged: number; paid: number; waived: number };

export type MonthState = {
  month: string;
  principal: BucketState;
  fee: BucketState;
  lateFee: BucketState;
  /** When everything charged to this month was last fully cleared (null if something is owed). */
  clearedAt: number | null;
};

export type Allocation = { creditId: string; month: string; bucket: Bucket; amountPaise: number; at: number };

export type Account = {
  months: MonthState[];
  outstandingPaise: number;
  creditBalancePaise: number;
  allocations: Allocation[];
};

const CHARGE_BUCKET: Partial<Record<LedgerType, Bucket>> = { draw: "principal", fee: "fee", lateFee: "lateFee" };

const remaining = (b: BucketState) => b.charged - b.paid - b.waived;
export const monthOutstanding = (m: MonthState) => remaining(m.principal) + remaining(m.fee) + remaining(m.lateFee);
export const bucketOutstanding = (m: MonthState, bucket: Bucket) => remaining(m[bucket]);

const empty = (month: string): MonthState => ({
  month,
  principal: { charged: 0, paid: 0, waived: 0 },
  fee: { charged: 0, paid: 0, waived: 0 },
  lateFee: { charged: 0, paid: 0, waived: 0 },
  clearedAt: null,
});

/** Ids of rows that are cancelled by a reversal, and the reversals themselves. */
export function voidIds(rows: LedgerRow[]): Set<string> {
  const ids = new Set<string>();
  for (const r of rows) {
    if (r.type === "reversal" && r.reversesEntryId) {
      ids.add(r.id);
      ids.add(r.reversesEntryId);
    }
  }
  return ids;
}

/**
 * Replays the ledger. `asOf` keeps only rows that took effect at or before
 * it; `extraCredits` adds pretend payments (e.g. repayments still waiting
 * for the admin) to answer "would this be paid if they're confirmed?".
 */
export function replay(
  rows: LedgerRow[],
  options: { asOf?: number; extraCredits?: { amountPaise: number; effectiveAt: number }[] } = {},
): Account {
  const cancelled = voidIds(rows);
  const live: LedgerRow[] = rows.filter(
    (r) => !cancelled.has(r.id) && (options.asOf === undefined || r.effectiveAt <= options.asOf),
  );
  for (const [i, c] of (options.extraCredits ?? []).entries()) {
    if (options.asOf === undefined || c.effectiveAt <= options.asOf)
      live.push({ id: `pending-${i}`, type: "repayment", amountPaise: c.amountPaise, effectiveAt: c.effectiveAt, createdAt: c.effectiveAt });
  }
  live.sort((a, b) => a.effectiveAt - b.effectiveAt || a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));

  const months = new Map<string, MonthState>();
  const monthOf = (m: string) => {
    if (!months.has(m)) months.set(m, empty(m));
    return months.get(m)!;
  };
  const allocations: Allocation[] = [];
  let credit = 0;

  const settle = (state: MonthState, at: number) => {
    const owed = monthOutstanding(state);
    if (owed === 0 && state.clearedAt === null) state.clearedAt = at;
    if (owed > 0) state.clearedAt = null;
  };

  /** Pays `amount` off the oldest months first; returns what's left over. */
  const pay = (creditId: string, amount: number, at: number): number => {
    let left = amount;
    const ordered = [...months.values()].sort((a, b) => (a.month < b.month ? -1 : 1));
    for (const state of ordered) {
      for (const bucket of PAY_ORDER) {
        if (left === 0) break;
        const take = Math.min(left, remaining(state[bucket]));
        if (take > 0) {
          state[bucket].paid += take;
          left -= take;
          allocations.push({ creditId, month: state.month, bucket, amountPaise: take, at });
        }
      }
      settle(state, at);
      if (left === 0) break;
    }
    return left;
  };

  for (const row of live) {
    const chargeBucket = CHARGE_BUCKET[row.type];
    if (chargeBucket) {
      const state = monthOf(row.cycleMonth!);
      state[chargeBucket].charged += row.amountPaise;
      settle(state, row.effectiveAt);
      if (credit > 0) credit = pay(`credit-balance`, credit, row.effectiveAt);
    } else if (row.type === "waiver") {
      const state = monthOf(row.cycleMonth!);
      const bucket = row.bucket ?? "fee";
      state[bucket].waived += Math.min(row.amountPaise, Math.max(0, remaining(state[bucket])));
      settle(state, row.effectiveAt);
    } else if (row.type === "repayment" || row.type === "depositAdjustment") {
      credit += pay(row.id, row.amountPaise, row.effectiveAt);
    }
  }

  const list = [...months.values()].sort((a, b) => (a.month < b.month ? -1 : 1));
  return {
    months: list,
    outstandingPaise: list.reduce((sum, m) => sum + monthOutstanding(m), 0),
    creditBalancePaise: credit,
    allocations,
  };
}
