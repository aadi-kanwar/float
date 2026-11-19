/**
 * Monthly statements and late fees.
 *
 * - On the last day of each month at 23:59 (India time) every resident with
 *   something owed or drawn gets a statement for that month. Its figures are
 *   saved as they are then and never change. The deadline is the same for
 *   everything on it, whenever in the month it was drawn.
 * - From the day after the deadline, a late fee is added once per day while
 *   anything on that statement is unpaid, up to the cap. Each late fee is
 *   its own ledger row, one per statement per day, so the job can run any
 *   number of times without charging twice. Days missed (e.g. while a
 *   payment waited for confirmation) are filled in later if still owed.
 */
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { accountSummary, ledgerRows, notify, statementStatus, statementsOf, toRows } from "./lib/account";
import { appError } from "./lib/errors";
import { adminQuery, internalMutation, residentQuery } from "./lib/functions";
import { monthOutstanding, replay, voidIds, type LedgerRow } from "./lib/ledger";
import { formatPaise } from "./lib/money";
import { inScope, residentsInScope } from "./lib/org";
import { awardPoints, expirePoints } from "./lib/points";
import { currentSettings } from "./lib/settings";
import { dueDateFor, endOfDay, istDate, istMonth, istStartOfDay, shiftDate, shiftMonth, statementTime } from "./lib/time";
import type { SettingsValues } from "./lib/validators";

type Ctx = Pick<MutationCtx, "db">;

/** Makes `month`'s statement for one resident (if there's activity and it isn't made yet). */
export async function generateStatement(
  ctx: Ctx,
  resident: Doc<"residents">,
  month: string,
  settings: SettingsValues,
  now: number,
): Promise<Id<"statements"> | null> {
  const existing = await ctx.db
    .query("statements")
    .withIndex("by_resident_month", (q) => q.eq("residentId", resident._id).eq("month", month))
    .unique();
  if (existing !== null) return null;
  const account = replay(toRows(await ledgerRows(ctx, resident._id)));
  const current = account.months.find((m) => m.month === month);
  const earlier = account.months.filter((m) => m.month < month);
  const earlierOwed = earlier.reduce((sum, m) => sum + monthOutstanding(m), 0);
  const hasActivity = (current !== undefined && current.principal.charged + current.fee.charged > 0) || earlierOwed > 0;
  if (!hasActivity) return null;

  const lateFees = earlier.reduce((sum, m) => sum + m.lateFee.charged - m.lateFee.paid - m.lateFee.waived, 0);
  const dueDate = dueDateFor(month, settings.dueDayOfMonth);
  const id = await ctx.db.insert("statements", {
    residentId: resident._id,
    month,
    generatedAt: now,
    dueDate,
    dueAt: endOfDay(dueDate),
    drawnPaise: current?.principal.charged ?? 0,
    feesPaise: current ? current.fee.charged - current.fee.waived : 0,
    paidThisMonthPaise: current ? current.principal.paid + current.fee.paid + current.lateFee.paid : 0,
    carriedOverPaise: earlierOwed - lateFees,
    lateFeesPaise: lateFees,
    totalDuePaise: (current ? monthOutstanding(current) : 0) + earlierOwed,
  });
  const total = (current ? monthOutstanding(current) : 0) + earlierOwed;
  await notify(ctx, resident._id, {
    kind: "statement_ready",
    title: "Your statement is ready",
    body: total > 0 ? `${formatPaise(total)} is due by ${dueDate.slice(8)} ${monthName(dueDate)}.` : "Everything is already paid. Thank you!",
    href: "/me/statements",
    key: `statement:${month}`,
  });
  // Paid before the statement was made: early points are given now.
  await awardPoints(ctx, resident._id, undefined);
  return id;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthName = (date: string) => MONTHS[Number(date.slice(5, 7)) - 1];

/** Statements for every resident: last month (catch-up) and, once it's 23:59 on the last day, this month. */
export async function closeMonths(ctx: Ctx, now: number): Promise<number> {
  const settings = await currentSettings(ctx);
  const thisMonth = istMonth(now);
  const months = [shiftMonth(thisMonth, -1)];
  if (now >= statementTime(thisMonth)) months.push(thisMonth);
  let made = 0;
  for (const resident of await ctx.db.query("residents").collect()) {
    for (const month of months) if ((await generateStatement(ctx, resident, month, settings, now)) !== null) made += 1;
  }
  return made;
}

/**
 * Late fees for one resident, up to and including `today`, plus "due soon"
 * and "overdue" notices. Safe to run any number of times.
 */
export async function applyLateFees(ctx: Ctx, resident: Doc<"residents">, settings: SettingsValues, now: number): Promise<number> {
  const today = istDate(now);
  const entries = await ledgerRows(ctx, resident._id);
  const rows: LedgerRow[] = toRows(entries);
  const claims = (
    await ctx.db
      .query("repaymentClaims")
      .withIndex("by_resident_submittedAt", (q) => q.eq("residentId", resident._id))
      .collect()
  ).filter((c) => c.status === "pending");
  let charged = 0;
  for (const s of await statementsOf(ctx, resident._id)) {
    const owedNow = replay(rows).months.find((m) => m.month === s.month);
    const outstanding = owedNow ? monthOutstanding(owedNow) : 0;
    if (outstanding > 0 && today >= shiftDate(s.dueDate, -settings.dueSoonDays) && today <= s.dueDate)
      await notify(ctx, resident._id, {
        kind: "due_soon",
        title: "Payment due soon",
        body: `${formatPaise(outstanding)} is due by ${s.dueDate.slice(8)} ${monthName(s.dueDate)}.`,
        href: "/me/statements",
        key: `dueSoon:${s.month}`,
      });
    if (today <= s.dueDate) continue;

    const existing = entries.filter((e) => e.type === "lateFee" && e.cycleMonth === s.month);
    const days = new Set(existing.map((e) => e.forDate));
    const cancelled = voidIds(rows);
    let capUsed = existing.filter((e) => !cancelled.has(e._id)).reduce((sum, e) => sum + e.amountPaise, 0);
    for (let day = shiftDate(s.dueDate, 1); day <= today; day = shiftDate(day, 1)) {
      if (days.has(day)) continue; // already charged (or charged and reversed by an admin): never again
      const asOf = istStartOfDay(day) - 1; // owed at the end of the day before
      const confirmed = replay(rows, { asOf }).months.find((m) => m.month === s.month);
      if (!confirmed || monthOutstanding(confirmed) === 0) continue;
      const extra = claims.filter((c) => c.submittedAt <= asOf).map((c) => ({ amountPaise: c.amountPaise, effectiveAt: c.submittedAt }));
      const ifConfirmed = replay(rows, { asOf, extraCredits: extra }).months.find((m) => m.month === s.month);
      if (ifConfirmed && monthOutstanding(ifConfirmed) === 0) break; // wait for the admin to confirm or reject
      let amount = settings.lateFeePerDayPaise;
      if (settings.lateFeeCapPaise !== null) amount = Math.min(amount, settings.lateFeeCapPaise - capUsed);
      if (amount <= 0) break;
      const effectiveAt = istStartOfDay(day);
      const id = await ctx.db.insert("ledgerEntries", {
        residentId: resident._id,
        type: "lateFee",
        amountPaise: amount,
        cycleMonth: s.month,
        forDate: day,
        effectiveAt,
        createdAt: now,
      });
      rows.push({ id, type: "lateFee", amountPaise: amount, cycleMonth: s.month, effectiveAt, createdAt: now });
      capUsed += amount;
      charged += 1;
    }
    const after = replay(rows).months.find((m) => m.month === s.month);
    if (after && monthOutstanding(after) > 0)
      await notify(ctx, resident._id, {
        kind: "overdue",
        title: "Payment overdue",
        body: `Your ${monthName(`${s.month}-01`)} statement is overdue. A late fee of ${formatPaise(settings.lateFeePerDayPaise)} is added each day until it's paid.`,
        href: "/me/statements",
        key: `overdue:${s.month}`,
      });
  }
  return charged;
}

/** Scheduled 23:59 India time, every day (it acts on the last day of the month). */
export const monthEndJob = internalMutation({
  args: {},
  handler: async (ctx) => ({ statements: await closeMonths(ctx, Date.now()) }),
});

/** Scheduled 00:05 India time: catch-up statements, late fees, reminders, points expiry. */
export const dailyJob = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const statements = await closeMonths(ctx, now);
    const settings = await currentSettings(ctx);
    let lateFees = 0;
    let pointsExpired = 0;
    for (const resident of await ctx.db.query("residents").collect()) {
      lateFees += await applyLateFees(ctx, resident, settings, now);
      pointsExpired += await expirePoints(ctx, resident._id, now);
    }
    return { statements, lateFees, pointsExpired };
  },
});

// ---- Reading ---------------------------------------------------------------

async function detail(ctx: Pick<QueryCtx, "db">, resident: Doc<"residents">, month: string) {
  const s = await ctx.db
    .query("statements")
    .withIndex("by_resident_month", (q) => q.eq("residentId", resident._id).eq("month", month))
    .unique();
  const entries = await ledgerRows(ctx, resident._id);
  const rows = toRows(entries);
  const account = replay(rows);
  const cancelled = voidIds(rows);
  const m = account.months.find((x) => x.month === month);
  const lines = entries
    .filter((e) => e.cycleMonth === month && (e.type === "draw" || e.type === "fee" || e.type === "lateFee" || e.type === "waiver"))
    .map((e) => ({ type: e.type, amountPaise: e.amountPaise, at: e.effectiveAt, forDate: e.forDate ?? null, bucket: e.bucket ?? null, reversed: cancelled.has(e._id) }));
  const payments = account.allocations
    .filter((a) => a.month === month)
    .map((a) => ({ bucket: a.bucket, amountPaise: a.amountPaise, at: a.at }));
  return {
    month,
    statement: s && {
      generatedAt: s.generatedAt,
      dueDate: s.dueDate,
      drawnPaise: s.drawnPaise,
      feesPaise: s.feesPaise,
      paidThisMonthPaise: s.paidThisMonthPaise,
      carriedOverPaise: s.carriedOverPaise,
      lateFeesPaise: s.lateFeesPaise,
      totalDuePaise: s.totalDuePaise,
      status: statementStatus(s, account.months, Date.now()),
    },
    outstandingPaise: m ? monthOutstanding(m) : 0,
    lateFeesSoFarPaise: m ? m.lateFee.charged - m.lateFee.waived : 0,
    lines: lines.sort((a, b) => a.at - b.at),
    payments,
  };
}

/** The resident's own statements (newest first) and this month so far. */
export const mine = residentQuery({
  args: {},
  handler: async (ctx) => {
    const { resident } = ctx.resident;
    const summary = await accountSummary(ctx, resident, await currentSettings(ctx));
    return {
      statements: summary.statements.map((s) => ({
        month: s.statement.month,
        dueDate: s.statement.dueDate,
        totalDuePaise: s.statement.totalDuePaise,
        status: s.status,
        outstandingPaise: s.outstandingPaise,
        lateFeesSoFarPaise: s.lateFeesSoFarPaise,
      })),
      unbilledPaise: summary.unbilledPaise,
    };
  },
});

export const myDetail = residentQuery({
  args: { month: v.string() },
  handler: async (ctx, { month }) => {
    if (!/^\d{4}-\d{2}$/.test(month)) throw appError("INVALID_INPUT");
    return await detail(ctx, ctx.resident.resident, month);
  },
});

export const residentDetail = adminQuery({
  args: { residentId: v.id("residents"), month: v.string() },
  handler: async (ctx, { residentId, month }) => {
    const resident = await ctx.db.get(residentId);
    if (resident === null || !/^\d{4}-\d{2}$/.test(month)) throw appError("NOT_FOUND");
    return await detail(ctx, resident, month);
  },
});

/** Admin: every statement for a month with its status now. */
export const byMonth = adminQuery({
  args: { month: v.string(), propertyId: v.optional(v.id("properties")) },
  handler: async (ctx, { month, propertyId }) => {
    const now = Date.now();
    const scope = await residentsInScope(ctx, propertyId);
    const out = [];
    for (const s of (await ctx.db.query("statements").withIndex("by_month", (q) => q.eq("month", month)).collect()).filter((x) => inScope(scope, x.residentId))) {
      const resident = await ctx.db.get(s.residentId);
      const account = replay(toRows(await ledgerRows(ctx, s.residentId)));
      const m = account.months.find((x) => x.month === month);
      out.push({
        residentId: s.residentId,
        residentName: resident?.name ?? "Unknown",
        roomNumber: resident?.roomNumber ?? null,
        dueDate: s.dueDate,
        totalDuePaise: s.totalDuePaise,
        drawnPaise: s.drawnPaise,
        feesPaise: s.feesPaise,
        outstandingPaise: m ? monthOutstanding(m) : 0,
        lateFeesSoFarPaise: m ? m.lateFee.charged - m.lateFee.waived : 0,
        status: statementStatus(s, account.months, now),
      });
    }
    return out.sort((a, b) => a.residentName.localeCompare(b.residentName));
  },
});
