import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import type { SettingsValues } from "./validators";

/** The defaults, used until an admin saves Settings for the first time. */
export const DEFAULT_SETTINGS: SettingsValues = {
  defaultLimitPaise: 500_000, // ₹5,000
  minDrawPaise: 10_000, // ₹100
  feeBasisPoints: 500, // 5%
  dueDayOfMonth: 5,
  lateFeePerDayPaise: 10_000, // ₹100
  lateFeeCapPaise: null,
  requireDrawApproval: true,
  freezeWhenOverdue: true,
  dueSoonDays: 2,
  pointsName: "Points",
  pointValueBasisPoints: 100, // 1 point = 1% of ₹1
  pointsExpiryMonths: 12,
  limitGrowthEnabled: false,
};

export async function settingsRow(ctx: Pick<QueryCtx, "db">): Promise<Doc<"settings"> | null> {
  return await ctx.db
    .query("settings")
    .withIndex("by_key", (q) => q.eq("key", "current"))
    .unique();
}

/** The settings in force now (defaults filled in for anything missing). */
export async function currentSettings(
  ctx: Pick<QueryCtx, "db">,
): Promise<Required<SettingsValues> & { version: number }> {
  const row = await settingsRow(ctx);
  return { ...(DEFAULT_SETTINGS as Required<SettingsValues>), ...(row?.values ?? {}), version: row?.version ?? 0 };
}

/** A plain-language problem with new settings, or null if they are fine. */
export function settingsProblem(s: SettingsValues): string | null {
  const wholeRupees = (p: number) => Number.isInteger(p) && p % 100 === 0;
  if (!wholeRupees(s.defaultLimitPaise) || s.defaultLimitPaise < 0 || s.defaultLimitPaise > 10_000_000)
    return "The default limit must be whole rupees, up to ₹1,00,000.";
  if (!wholeRupees(s.minDrawPaise) || s.minDrawPaise < 100) return "The minimum draw must be at least ₹1, in whole rupees.";
  if (!Number.isInteger(s.feeBasisPoints) || s.feeBasisPoints < 0 || s.feeBasisPoints > 5000)
    return "The fee must be between 0% and 50%.";
  if (!Number.isInteger(s.dueDayOfMonth) || s.dueDayOfMonth < 1 || s.dueDayOfMonth > 28)
    return "The deadline day must be between the 1st and the 28th.";
  if (!wholeRupees(s.lateFeePerDayPaise) || s.lateFeePerDayPaise < 0) return "The late fee must be whole rupees.";
  if (s.lateFeeCapPaise !== null && (!wholeRupees(s.lateFeeCapPaise) || s.lateFeeCapPaise < 0))
    return "The late fee cap must be whole rupees.";
  if (!Number.isInteger(s.dueSoonDays) || s.dueSoonDays < 0 || s.dueSoonDays > 10)
    return "The reminder must be 0 to 10 days before.";
  const name = s.pointsName.trim();
  if (name.length < 1 || name.length > 24) return "The points name must be 1 to 24 characters.";
  const value = s.pointValueBasisPoints ?? 100;
  if (!Number.isInteger(value) || value < 0 || value > 10_000) return "A point's value must be 0% to 100% of ₹1 (up to 2 decimals).";
  if (!Number.isInteger(s.pointsExpiryMonths) || s.pointsExpiryMonths < 0 || s.pointsExpiryMonths > 120)
    return "Points expiry must be 0 (never) to 120 months.";
  return null;
}
