import type { QueryCtx } from "../_generated/server";

/** Used until the admin writes their own terms (version 0). */
export const DEFAULT_TERMS = `Float lets you draw small amounts of pocket money against your security deposit.

1. Each draw has a fee (shown before you confirm). The fee is not charged on late fees.
2. Everything drawn in a month is on that month's statement, made on the last day of the month.
3. Pay the statement by the deadline shown (the 5th of the next month unless the office says otherwise). After the deadline a late fee is added every day until it's paid.
4. Pay by UPI to the office, then tap "I've paid". It counts once the office confirms it.
5. If dues stay unpaid, the office may settle them from your security deposit.
6. The office can change your limit or pause your access.`;

export async function currentTerms(ctx: Pick<QueryCtx, "db">): Promise<{ version: number; text: string; createdAt: number | null }> {
  const latest = await ctx.db.query("termsVersions").withIndex("by_version").order("desc").first();
  return latest ? { version: latest.version, text: latest.text, createdAt: latest.createdAt } : { version: 0, text: DEFAULT_TERMS, createdAt: null };
}
