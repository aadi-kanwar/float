import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { bucketOutstanding, replay, monthOutstanding, voidIds, type Account, type LedgerRow, type MonthState } from "./ledger";
import type { SettingsValues } from "./validators";
import { istMonth, shiftMonth } from "./time";

type Db = Pick<QueryCtx, "db">;

export async function ledgerRows(ctx: Db, residentId: Id<"residents">): Promise<Doc<"ledgerEntries">[]> {
  return await ctx.db
    .query("ledgerEntries")
    .withIndex("by_resident_effectiveAt", (q) => q.eq("residentId", residentId))
    .collect();
}

export function toRows(entries: Doc<"ledgerEntries">[]): LedgerRow[] {
  return entries.map((e) => ({
    id: e._id,
    type: e.type,
    amountPaise: e.amountPaise,
    cycleMonth: e.cycleMonth,
    bucket: e.bucket,
    reversesEntryId: e.reversesEntryId,
    effectiveAt: e.effectiveAt,
    createdAt: e.createdAt,
  }));
}

export async function statementsOf(ctx: Db, residentId: Id<"residents">): Promise<Doc<"statements">[]> {
  return await ctx.db
    .query("statements")
    .withIndex("by_resident_month", (q) => q.eq("residentId", residentId))
    .collect();
}

/**
 * The month new charges go to: this India month, unless its statement has
 * already been made (e.g. money sent a minute after 23:59 on the last day),
 * then the next one.
 */
export async function openCycleMonth(ctx: Db, residentId: Id<"residents">, now = Date.now()): Promise<string> {
  let month = istMonth(now);
  for (;;) {
    const made = await ctx.db
      .query("statements")
      .withIndex("by_resident_month", (q) => q.eq("residentId", residentId).eq("month", month))
      .unique();
    if (made === null) return month;
    month = shiftMonth(month, 1);
  }
}

export type StatementStatus = "open" | "paid_early" | "paid_on_time" | "paid_late" | "overdue";

/**
 * A statement's state now, from the replayed ledger. A statement is judged
 * on its own month's charges (late fees for older months run on those
 * months). One with nothing of its own (only older dues carried over) is
 * overdue while those older dues are unpaid.
 */
export function statementStatus(statement: Doc<"statements">, months: MonthState[], now: number): StatementStatus {
  const month = months.find((m) => m.month === statement.month);
  const ownCharges = month ? month.principal.charged + month.fee.charged + month.lateFee.charged : 0;
  if (ownCharges === 0) {
    const earlier = months.filter((m) => m.month < statement.month).reduce((sum, m) => sum + monthOutstanding(m), 0);
    return earlier > 0 ? "overdue" : "paid_on_time";
  }
  const owed = monthOutstanding(month!);
  if (owed > 0) return now > statement.dueAt ? "overdue" : "open";
  const clearedAt = month!.clearedAt ?? statement.generatedAt;
  if (clearedAt <= statement.generatedAt) return "paid_early";
  return clearedAt <= statement.dueAt ? "paid_on_time" : "paid_late";
}

/** Whole rupees only (draws are in whole rupees). */
const wholeRupees = (paise: number) => Math.max(0, Math.floor(paise / 100) * 100);

export type Summary = Awaited<ReturnType<typeof accountSummary>>;

/**
 * Everything about a resident's money, worked out from the ledgers:
 * owed, deposit left, limit, room to draw, overdue state and statements.
 */
export async function accountSummary(
  ctx: Db,
  resident: Doc<"residents">,
  settings: SettingsValues,
  now = Date.now(),
) {
  const entries = await ledgerRows(ctx, resident._id);
  const account: Account = replay(toRows(entries));
  const cancelled = voidIds(toRows(entries));
  const depositUsed = entries
    .filter((e) => e.type === "depositAdjustment" && !cancelled.has(e._id))
    .reduce((sum, e) => sum + e.amountPaise, 0);
  const depositBalancePaise = resident.depositPaise - depositUsed;

  const pending = await ctx.db
    .query("drawRequests")
    .withIndex("by_resident_requestedAt", (q) => q.eq("residentId", resident._id))
    .collect();
  const pendingDrawsPaise = pending
    .filter((d) => d.status === "requested" || d.status === "approved")
    .reduce((sum, d) => sum + d.amountPaise, 0);

  const ownLimit = resident.limitPaise ?? settings.defaultLimitPaise;
  const limitPaise = settings.limitCappedByDeposit ? Math.max(0, Math.min(ownLimit, depositBalancePaise)) : ownLimit;
  // Only money drawn counts against the limit: fees and late fees never do
  // (the owner's rule: with a ₹5,000 limit a resident can draw the full ₹5,000).
  const principalOwedPaise = account.months.reduce((sum, m) => sum + bucketOutstanding(m, "principal"), 0);
  const usedPaise = principalOwedPaise + pendingDrawsPaise;
  const roomPaise = Math.max(0, limitPaise - usedPaise);

  const statements = (await statementsOf(ctx, resident._id)).sort((a, b) => (a.month < b.month ? 1 : -1));
  const byMonth = new Map(account.months.map((m) => [m.month, m]));
  const withStatus = statements.map((s) => {
    const m = byMonth.get(s.month);
    return {
      statement: s,
      status: statementStatus(s, account.months, now),
      outstandingPaise: m ? monthOutstanding(m) : 0,
      lateFeesSoFarPaise: m ? m.lateFee.charged - m.lateFee.waived : 0,
      clearedAt: m?.clearedAt ?? null,
    };
  });
  const overdue = withStatus.filter((s) => s.status === "overdue");
  const open = withStatus.filter((s) => s.status === "open").sort((a, b) => a.statement.dueAt - b.statement.dueAt);
  const generated = new Set(statements.map((s) => s.month));
  const unbilledPaise = account.months.filter((m) => !generated.has(m.month)).reduce((sum, m) => sum + monthOutstanding(m), 0);

  return {
    account,
    entries,
    outstandingPaise: account.outstandingPaise,
    creditBalancePaise: account.creditBalancePaise,
    depositBalancePaise,
    limitPaise,
    /** Draws asked or approved but not sent yet (amount only, no fee). */
    pendingDrawsPaise,
    /** Money drawn and not repaid yet (no fees): what uses the limit. */
    principalOwedPaise,
    roomPaise,
    availablePaise: wholeRupees(roomPaise),
    statements: withStatus,
    overdue: overdue.length > 0,
    overduePaise: overdue.reduce((sum, s) => sum + s.outstandingPaise, 0),
    /** The next deadline with money owed on it, if any. */
    nextDue: open[0]
      ? { dueDate: open[0].statement.dueDate, dueAt: open[0].statement.dueAt, fromAt: open[0].statement.generatedAt, amountPaise: open[0].outstandingPaise, month: open[0].statement.month }
      : null,
    /** Owed for months whose statement isn't made yet (due on the deadline after the next statement). */
    unbilledPaise,
  };
}

/** Adds an in-app notification. With a `key`, it's added only once. */
export async function notify(
  ctx: Pick<MutationCtx, "db">,
  residentId: Id<"residents">,
  n: { kind: string; title: string; body: string; href?: string; key?: string },
): Promise<void> {
  if (n.key) {
    const existing = await ctx.db
      .query("notifications")
      .withIndex("by_resident_key", (q) => q.eq("residentId", residentId).eq("key", n.key))
      .first();
    if (existing !== null) return;
  }
  await ctx.db.insert("notifications", { residentId, ...n, createdAt: Date.now() });
}
