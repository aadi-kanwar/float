import { v, type Infer } from "convex/values";

/** The two roles in Float. There are no other roles. */
export const vRole = v.union(v.literal("admin"), v.literal("resident"));
export type Role = Infer<typeof vRole>;

/**
 * Every admin-editable setting. Money in paise. A change applies to future
 * events only; it never rewrites past rows.
 */
export const vSettingsValues = v.object({
  // ---- Money ----
  /** Credit limit for a resident without their own limit. */
  defaultLimitPaise: v.number(),
  /** A resident's limit can't be more than their deposit (after adjustments). */
  limitCappedByDeposit: v.boolean(),
  minDrawPaise: v.number(),
  /** Fee on each draw in basis points (500 = 5%), rounded to the nearest rupee. */
  feeBasisPoints: v.number(),
  /** Day of the next month by which a statement must be paid (23:59 IST). */
  dueDayOfMonth: v.number(),
  lateFeePerDayPaise: v.number(),
  /** Most late fees one statement can get; null = no cap. */
  lateFeeCapPaise: v.union(v.number(), v.null()),
  /** Draws wait for an admin's approval (off = approved at once). */
  requireDrawApproval: v.boolean(),
  /** No new draws while anything is overdue. */
  freezeWhenOverdue: v.boolean(),
  /** "Due soon" notification this many days before the deadline. */
  dueSoonDays: v.number(),
  // ---- Points ----
  /** What the points are called everywhere in the app. */
  pointsName: v.string(),
  /** Points expire this many months after being earned (0 = never). */
  pointsExpiryMonths: v.number(),
  /** Raise limits automatically by the limit-growth rules (off by default). */
  limitGrowthEnabled: v.optional(v.boolean()),
});
export type SettingsValues = Infer<typeof vSettingsValues>;

export const vLedgerType = v.union(
  v.literal("draw"),
  v.literal("fee"),
  v.literal("lateFee"),
  v.literal("repayment"),
  v.literal("waiver"),
  v.literal("reversal"),
  v.literal("depositAdjustment"),
);

export const vDrawStatus = v.union(
  v.literal("requested"),
  v.literal("approved"),
  v.literal("disbursed"),
  v.literal("rejected"),
  v.literal("cancelled"),
);
export type DrawStatus = Infer<typeof vDrawStatus>;

export const vPointsRuleType = v.union(v.literal("base"), v.literal("early"), v.literal("streak"));
export type PointsRuleType = Infer<typeof vPointsRuleType>;

export const vPointsEntryType = v.union(
  v.literal("earned"),
  v.literal("redeemed"),
  v.literal("refunded"),
  v.literal("expired"),
  v.literal("manual"),
);

export const vRedemptionStatus = v.union(
  v.literal("requested"),
  v.literal("approved"),
  v.literal("in_progress"),
  v.literal("fulfilled"),
  v.literal("rejected"),
  v.literal("cancelled"),
);
export type RedemptionStatus = Infer<typeof vRedemptionStatus>;

/** How often one resident may redeem a perk. Semesters: Jan–Jun and Jul–Dec. */
export const vPerkLimit = v.union(
  v.object({ kind: v.literal("unlimited") }),
  v.object({ kind: v.literal("per_month"), count: v.number() }),
  v.object({ kind: v.literal("per_semester"), count: v.number() }),
  v.object({ kind: v.literal("total"), count: v.number() }),
);
export type PerkLimit = Infer<typeof vPerkLimit>;

/** A question the resident answers when redeeming (e.g. "Guest name"). */
export const vPerkField = v.object({
  key: v.string(),
  label: v.string(),
  type: v.union(v.literal("text"), v.literal("date"), v.literal("number"), v.literal("select")),
  options: v.optional(v.array(v.string())),
  required: v.boolean(),
});
export type PerkField = Infer<typeof vPerkField>;

export const vPerkVisibility = v.union(v.literal("active"), v.literal("hidden"), v.literal("archived"));
