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
});
export type SettingsValues = Infer<typeof vSettingsValues>;
