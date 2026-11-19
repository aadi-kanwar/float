import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { istMonth } from "./time";

/** The period a per-resident limit counts in: this month, this semester (Jan–Jun / Jul–Dec) or ever. */
export function periodStart(limit: Doc<"perks">["perResident"], now = Date.now()): string | null {
  const month = istMonth(now);
  if (limit.kind === "per_month") return month;
  if (limit.kind === "per_semester") return `${month.slice(0, 4)}-${Number(month.slice(5, 7)) <= 6 ? "01" : "07"}`;
  return null;
}

/** How many of this perk the resident has redeemed in the limit's period (rejected and cancelled don't count). */
export async function usedInPeriod(ctx: Pick<QueryCtx, "db">, residentId: Id<"residents">, perk: Doc<"perks">, now = Date.now()): Promise<number> {
  const start = periodStart(perk.perResident, now);
  const rows = await ctx.db
    .query("redemptions")
    .withIndex("by_resident_perk", (q) => q.eq("residentId", residentId).eq("perkId", perk._id))
    .collect();
  return rows.filter(
    (r) =>
      r.status !== "rejected" &&
      r.status !== "cancelled" &&
      (start === null ||
        (perk.perResident.kind === "per_month" ? istMonth(r.createdAt) === start : istMonth(r.createdAt) >= start && istMonth(r.createdAt) < `${start.slice(0, 4)}-${start.endsWith("01") ? "07" : "13"}`)),
  ).length;
}
