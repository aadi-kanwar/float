/**
 * Money views and admin overrides.
 *
 * Overrides each need a reason and are audit-logged:
 * - waive a fee or late fee (whole or part) on one month
 * - reverse a ledger row (a new reversing row; history is never edited)
 */
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { accountSummary, type Summary } from "./lib/account";
import { requireReason, writeAudit } from "./lib/audit";
import { appError } from "./lib/errors";
import { adminMutation, adminQuery, residentMutation, residentQuery } from "./lib/functions";
import { bucketOutstanding, voidIds } from "./lib/ledger";
import { formatPaise, rupeesToPaise } from "./lib/money";
import { afterCredit } from "./lib/rewards";
import { currentSettings } from "./lib/settings";
import { DAY_MS, istDate, istMonth, istStartOfDay, shiftMonth } from "./lib/time";
import { toRows } from "./lib/account";
import { inScope, residentsInScope } from "./lib/org";

function headline(s: Summary) {
  return {
    outstandingPaise: s.outstandingPaise,
    creditBalancePaise: s.creditBalancePaise,
    limitPaise: s.limitPaise,
    pendingDrawsPaise: s.pendingDrawsPaise,
    principalOwedPaise: s.principalOwedPaise,
    availablePaise: s.availablePaise,
    overdue: s.overdue,
    overduePaise: s.overduePaise,
    nextDue: s.nextDue,
    unbilledPaise: s.unbilledPaise,
  };
}

function ledgerView(entries: Doc<"ledgerEntries">[]) {
  const cancelled = voidIds(toRows(entries));
  const reversedBy = new Map(entries.filter((e) => e.reversesEntryId).map((e) => [e.reversesEntryId as string, e._id]));
  return entries
    .map((e) => ({
      entryId: e._id,
      type: e.type,
      amountPaise: e.amountPaise,
      cycleMonth: e.cycleMonth ?? null,
      bucket: e.bucket ?? null,
      forDate: e.forDate ?? null,
      effectiveAt: e.effectiveAt,
      createdAt: e.createdAt,
      note: e.note ?? null,
      reversesEntryId: e.reversesEntryId ?? null,
      reversed: cancelled.has(e._id) && e.type !== "reversal",
      canReverse: e.type !== "reversal" && !reversedBy.has(e._id),
    }))
    .sort((a, b) => b.effectiveAt - a.effectiveAt || b.createdAt - a.createdAt);
}

/** The resident's own Home figures. */
export const mySummary = residentQuery({
  args: {},
  handler: async (ctx) => {
    const { resident } = ctx.resident;
    const settings = await currentSettings(ctx);
    const s = await accountSummary(ctx, resident, settings);
    const pendingClaims = (
      await ctx.db
        .query("repaymentClaims")
        .withIndex("by_resident_submittedAt", (q) => q.eq("residentId", resident._id))
        .collect()
    )
      .filter((c) => c.status === "pending")
      .reduce((sum, c) => sum + c.amountPaise, 0);
    return {
      ...headline(s),
      pendingClaimsPaise: pendingClaims,
      paused: resident.paused,
      frozen: settings.freezeWhenOverdue && s.overdue,
      dueDay: settings.dueDayOfMonth,
      thisMonth: istMonth(Date.now()),
    };
  },
});

/** The resident's activity: ledger rows, draw requests and payments, newest first. */
export const myActivity = residentQuery({
  args: {},
  handler: async (ctx) => {
    const { resident } = ctx.resident;
    const s = await accountSummary(ctx, resident, await currentSettings(ctx));
    return ledgerView(s.entries).map((e) => ({ ...e, canReverse: false }));
  },
});

/** Admin: one resident's money (their page). */
export const residentAccount = adminQuery({
  args: { residentId: v.id("residents") },
  handler: async (ctx, { residentId }) => {
    const resident = await ctx.db.get(residentId);
    if (resident === null) throw appError("NOT_FOUND");
    const s = await accountSummary(ctx, resident, await currentSettings(ctx));
    return {
      ...headline(s),
      ledger: ledgerView(s.entries),
      statements: s.statements.map((x) => ({
        month: x.statement.month,
        dueDate: x.statement.dueDate,
        totalDuePaise: x.statement.totalDuePaise,
        status: x.status,
        outstandingPaise: x.outstandingPaise,
        lateFeesSoFarPaise: x.lateFeesSoFarPaise,
      })),
      /** Months with a fee or late fee left to waive. */
      waivable: s.account.months
        .map((m) => ({ month: m.month, feePaise: bucketOutstanding(m, "fee"), lateFeePaise: bucketOutstanding(m, "lateFee") }))
        .filter((m) => m.feePaise > 0 || m.lateFeePaise > 0),
    };
  },
});

async function loadResident(ctx: Pick<QueryCtx, "db">, id: Id<"residents">) {
  const r = await ctx.db.get(id);
  if (r === null) throw appError("NOT_FOUND");
  return r;
}

/** Waive all or part of one month's fee or late fee. */
export const waive = adminMutation({
  args: {
    residentId: v.id("residents"),
    month: v.string(),
    bucket: v.union(v.literal("fee"), v.literal("lateFee")),
    amountRupees: v.union(v.number(), v.null()), // null = all of it
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const reason = requireReason(args.reason);
    const resident = await loadResident(ctx, args.residentId);
    const s = await accountSummary(ctx, resident, await currentSettings(ctx));
    const m = s.account.months.find((x) => x.month === args.month);
    const left = m ? bucketOutstanding(m, args.bucket) : 0;
    if (left === 0) throw appError("CONFLICT", "There's nothing of that left to waive.");
    const amountPaise = args.amountRupees === null ? left : rupeesToPaise(args.amountRupees);
    if (amountPaise <= 0 || amountPaise > left) throw appError("INVALID_INPUT", `You can waive up to ${formatPaise(left)}.`);
    const now = Date.now();
    const id = await ctx.db.insert("ledgerEntries", {
      residentId: resident._id,
      type: "waiver",
      amountPaise,
      cycleMonth: args.month,
      bucket: args.bucket,
      effectiveAt: now,
      createdAt: now,
      createdBy: ctx.admin.userId,
      note: reason,
    });
    await writeAudit(ctx, {
      actorUserId: ctx.admin.userId,
      action: "ledger.waived",
      entityType: "ledgerEntries",
      entityId: id,
      residentId: resident._id,
      reason,
      metadata: { month: args.month, bucket: args.bucket, amountPaise, before: left, after: left - amountPaise },
    });
    await afterCredit(ctx, resident._id, ctx.admin.userId);
    return null;
  },
});

/** Cancels one ledger row with a reversing row. Each row can be reversed once. */
export const reverse = adminMutation({
  args: { entryId: v.id("ledgerEntries"), reason: v.string() },
  handler: async (ctx, args) => {
    const reason = requireReason(args.reason);
    const entry = await ctx.db.get(args.entryId);
    if (entry === null) throw appError("NOT_FOUND");
    if (entry.type === "reversal") throw appError("CONFLICT", "A reversal can't be reversed. Add the right row again instead.");
    const already = await ctx.db
      .query("ledgerEntries")
      .withIndex("by_reverses", (q) => q.eq("reversesEntryId", entry._id))
      .first();
    if (already !== null) throw appError("CONFLICT", "This row was already reversed.");
    const now = Date.now();
    const id = await ctx.db.insert("ledgerEntries", {
      residentId: entry.residentId,
      type: "reversal",
      amountPaise: entry.amountPaise,
      cycleMonth: entry.cycleMonth,
      reversesEntryId: entry._id,
      effectiveAt: now,
      createdAt: now,
      createdBy: ctx.admin.userId,
      note: reason,
    });
    await writeAudit(ctx, {
      actorUserId: ctx.admin.userId,
      action: "ledger.reversed",
      entityType: "ledgerEntries",
      entityId: id,
      residentId: entry.residentId,
      reason,
      metadata: { reversed: { entryId: entry._id, type: entry.type, amountPaise: entry.amountPaise, cycleMonth: entry.cycleMonth ?? null } },
    });
    await afterCredit(ctx, entry.residentId, ctx.admin.userId);
    return null;
  },
});

// ---- Notifications (residents) ---------------------------------------------

export const myNotifications = residentQuery({
  args: {},
  handler: async (ctx) =>
    (
      await ctx.db
        .query("notifications")
        .withIndex("by_resident_createdAt", (q) => q.eq("residentId", ctx.resident.resident._id))
        .order("desc")
        .take(100)
    ).map((n) => ({ id: n._id, kind: n.kind, title: n.title, body: n.body, href: n.href ?? null, createdAt: n.createdAt, read: n.readAt !== undefined })),
});

export const unreadCount = residentQuery({
  args: {},
  handler: async (ctx) =>
    (
      await ctx.db
        .query("notifications")
        .withIndex("by_resident_createdAt", (q) => q.eq("residentId", ctx.resident.resident._id))
        .order("desc")
        .take(100)
    ).filter((n) => n.readAt === undefined).length,
});

export const markAllRead = residentMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    for (const n of await ctx.db
      .query("notifications")
      .withIndex("by_resident_createdAt", (q) => q.eq("residentId", ctx.resident.resident._id))
      .collect())
      if (n.readAt === undefined) await ctx.db.patch(n._id, { readAt: now });
    return null;
  },
});

// ---- Admin overview --------------------------------------------------------

export const overview = adminQuery({
  args: { propertyId: v.optional(v.id("properties")) },
  handler: async (ctx, { propertyId }) => {
    const scope = await residentsInScope(ctx, propertyId);
    const settings = await currentSettings(ctx);
    const now = Date.now();
    const month = istMonth(now);
    const lastMonth = shiftMonth(month, -1);
    let outstanding = 0;
    let overdueCount = 0;
    let overdueAmount = 0;
    let pendingDraws = 0;
    let available = 0;
    const statusCounts: Record<string, number> = { open: 0, paid_early: 0, paid_on_time: 0, paid_late: 0, overdue: 0 };
    const residents = (await ctx.db.query("residents").collect()).filter((r) => inScope(scope, r._id));
    for (const r of residents) {
      const s = await accountSummary(ctx, r, settings, now);
      outstanding += s.outstandingPaise;
      pendingDraws += s.pendingDrawsPaise;
      if (r.status === "active" && !r.paused) available += s.roomPaise;
      if (s.overdue) {
        overdueCount += 1;
        overdueAmount += s.overduePaise;
      }
      const last = s.statements.find((x) => x.statement.month === lastMonth);
      if (last) statusCounts[last.status] += 1;
    }

    // Money out and in for the last 6 months (India months), from the ledger.
    const months = Array.from({ length: 6 }, (_, i) => shiftMonth(month, i - 5));
    const series = new Map(months.map((m) => [m, { month: m, drawnPaise: 0, repaidPaise: 0, feesPaise: 0 }]));
    const since = istStartOfDay(`${months[0]}-01`);
    const recent = await ctx.db.query("ledgerEntries").withIndex("by_createdAt", (q) => q.gte("createdAt", since)).collect();
    const reversals = await ctx.db.query("ledgerEntries").withIndex("by_type_createdAt", (q) => q.eq("type", "reversal")).collect();
    const reversed = new Set<string>(reversals.map((e) => e.reversesEntryId as string));
    for (const e of recent) {
      if (reversed.has(e._id) || e.type === "reversal" || !inScope(scope, e.residentId)) continue;
      const bucket = series.get(istMonth(e.effectiveAt));
      if (!bucket) continue;
      if (e.type === "draw") bucket.drawnPaise += e.amountPaise;
      if (e.type === "repayment") bucket.repaidPaise += e.amountPaise;
      if (e.type === "fee") bucket.feesPaise += e.amountPaise;
      if (e.type === "waiver" && e.bucket === "fee") bucket.feesPaise -= e.amountPaise;
    }
    const thisMonth = series.get(month)!;

    const mine = <T extends { residentId: string }>(rows: T[]) => rows.filter((r) => inScope(scope, r.residentId)).length;
    const drawsPending = mine(await ctx.db.query("drawRequests").withIndex("by_status_requestedAt", (q) => q.eq("status", "requested")).collect());
    const drawsToSend = mine(await ctx.db.query("drawRequests").withIndex("by_status_requestedAt", (q) => q.eq("status", "approved")).collect());
    const repaymentsPending = mine(await ctx.db.query("repaymentClaims").withIndex("by_status_submittedAt", (q) => q.eq("status", "pending")).collect());
    const redemptionsPending = mine(await ctx.db.query("redemptions").withIndex("by_status_createdAt", (q) => q.eq("status", "requested")).collect());
    return {
      redemptionsPending,
      residents: residents.filter((r) => r.status === "active").length,
      outstandingPaise: outstanding,
      overdueCount,
      overduePaise: overdueAmount,
      pendingDrawsPaise: pendingDraws,
      availablePaise: available,
      feesThisMonthPaise: thisMonth.feesPaise,
      monthly: [...series.values()],
      lastMonth,
      lastMonthStatuses: statusCounts,
      drawsPending,
      drawsToSend,
      repaymentsPending,
    };
  },
});

// ---- Admin calendar ----------------------------------------------------------

export type CalendarKind =
  | "draw_sent"
  | "draw_asked"
  | "payment"
  | "statement"
  | "due"
  | "late_fee"
  | "joined"
  | "perk";

/**
 * Everything that happened (or is due) on each day of a month, India time:
 * money sent, draws asked, payments, statements made,
 * deadlines, late fees, new residents (and perks, once the store exists).
 */
export const calendar = adminQuery({
  args: { month: v.string(), propertyId: v.optional(v.id("properties")) },
  handler: async (ctx, { month, propertyId }) => {
    const scope = await residentsInScope(ctx, propertyId);
    if (!/^\d{4}-\d{2}$/.test(month)) throw appError("INVALID_INPUT");
    const start = istStartOfDay(`${month}-01`);
    const end = istStartOfDay(`${shiftMonth(month, 1)}-01`);
    const names = new Map<string, string>();
    const nameOf = async (id: Id<"residents">) => {
      if (!names.has(id)) names.set(id, (await ctx.db.get(id))?.name ?? "Unknown");
      return names.get(id)!;
    };
    type Event = { date: string; kind: CalendarKind; residentId: Id<"residents"> | null; residentName: string | null; amountPaise: number | null; at: number; label: string };
    const events: Event[] = [];
    const push = async (kind: CalendarKind, at: number, residentId: Id<"residents"> | null, amountPaise: number | null, label: string, date?: string) =>
      events.push({ date: date ?? istDate(at), kind, residentId, residentName: residentId ? await nameOf(residentId) : null, amountPaise, at, label });

    const reversals = await ctx.db.query("ledgerEntries").withIndex("by_type_createdAt", (q) => q.eq("type", "reversal")).collect();
    const reversed = new Set<string>(reversals.map((e) => e.reversesEntryId as string));
    // Rows are found by when they were written; late fees and confirmed payments can count from earlier.
    const rows = await ctx.db
      .query("ledgerEntries")
      .withIndex("by_createdAt", (q) => q.gte("createdAt", start - 40 * DAY_MS))
      .collect();
    const lateByDay = new Map<string, { count: number; amount: number }>();
    for (const e of rows) {
      if (e.effectiveAt < start || e.effectiveAt >= end || reversed.has(e._id) || !inScope(scope, e.residentId)) continue;
      if (e.type === "draw") await push("draw_sent", e.effectiveAt, e.residentId, e.amountPaise, "Money sent");
      else if (e.type === "repayment") await push("payment", e.effectiveAt, e.residentId, e.amountPaise, "Payment");
      else if (e.type === "lateFee") {
        const day = e.forDate ?? istDate(e.effectiveAt);
        const x = lateByDay.get(day) ?? { count: 0, amount: 0 };
        lateByDay.set(day, { count: x.count + 1, amount: x.amount + e.amountPaise });
      }
    }
    for (const [day, x] of lateByDay)
      await push("late_fee", istStartOfDay(day), null, x.amount, `Late fees on ${x.count} ${x.count === 1 ? "statement" : "statements"}`, day);

    for (const status of ["requested", "approved", "disbursed", "rejected", "cancelled"] as const) {
      const asked = await ctx.db
        .query("drawRequests")
        .withIndex("by_status_requestedAt", (q) => q.eq("status", status).gte("requestedAt", start).lt("requestedAt", end))
        .collect();
      for (const d of asked.filter((x) => inScope(scope, x.residentId))) await push("draw_asked", d.requestedAt, d.residentId, d.amountPaise, "Draw asked");
    }

    // Statements made this month, and deadlines falling in this month.
    const made = (await ctx.db.query("statements").withIndex("by_month", (q) => q.eq("month", month)).collect()).filter((s) => inScope(scope, s.residentId));
    if (made.length > 0) {
      const at = Math.min(...made.map((s) => s.generatedAt));
      await push("statement", at, null, made.reduce((sum, s) => sum + s.totalDuePaise, 0), `${made.length} ${made.length === 1 ? "statement" : "statements"} made`);
    }
    const dueHere = (await ctx.db.query("statements").withIndex("by_month", (q) => q.eq("month", shiftMonth(month, -1))).collect()).filter((s) => inScope(scope, s.residentId));
    if (dueHere.length > 0)
      await push("due", dueHere[0].dueAt, null, dueHere.reduce((sum, s) => sum + s.totalDuePaise, 0), `Deadline for ${dueHere.length} ${dueHere.length === 1 ? "statement" : "statements"}`, dueHere[0].dueDate);
    else {
      // Before any statements exist, still show the coming deadline.
      const settings = await currentSettings(ctx);
      const date = `${month}-${String(settings.dueDayOfMonth).padStart(2, "0")}`;
      await push("due", istStartOfDay(date), null, null, "Repayment deadline", date);
    }

    for (const r of await ctx.db.query("residents").collect())
      if (r.createdAt >= start && r.createdAt < end && inScope(scope, r._id)) await push("joined", r.createdAt, r._id, null, "Resident added");

    const redeemed = await ctx.db
      .query("redemptions")
      .withIndex("by_createdAt", (q) => q.gte("createdAt", start).lt("createdAt", end))
      .collect();
    for (const r of redeemed.filter((x) => inScope(scope, x.residentId))) await push("perk", r.createdAt, r.residentId, null, `Perk: ${r.perkTitle}`);

    events.sort((a, b) => a.at - b.at);
    return { month, events };
  },
});
