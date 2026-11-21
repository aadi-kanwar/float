/**
 * Points (the owner's rules, November 2026):
 *
 * - 1 point for every ₹1 of DRAWN money a resident repays. Fees and late
 *   fees never earn points.
 * - Given as soon as the admin confirms the payment, whatever day of the
 *   month it is (counted per payment, so it's live).
 * - If a payment is later reversed (or counts towards something else after
 *   a correction), its points are adjusted to match. Safe to run any number
 *   of times.
 * - What a point is worth in rupees is a setting (Settings → Rewards).
 * - Points expire N months after being earned (setting; 0 = never). Spending
 *   uses the points that expire soonest first; only unused points expire.
 * - Limit growth (optional) still follows on-time statements in a row.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { ledgerRows, notify, statementStatus, statementsOf, toRows, type StatementStatus } from "./account";
import { writeAudit } from "./audit";
import { replay, type MonthState } from "./ledger";
import { formatPaise } from "./money";
import { currentSettings } from "./settings";
import { IST_OFFSET_MS } from "./time";

type Db = Pick<QueryCtx, "db">;
type WDb = Pick<MutationCtx, "db">;

const ON_TIME: StatementStatus[] = ["paid_early", "paid_on_time"];
const ownCharges = (m: MonthState | undefined) => (m ? m.principal.charged + m.fee.charged + m.lateFee.charged : 0);

/** Each statement with its status and the on-time streak it ends (oldest first). */
export async function statementTimeline(ctx: Db, residentId: Id<"residents">, now = Date.now()) {
  const account = replay(toRows(await ledgerRows(ctx, residentId)));
  const statements = (await statementsOf(ctx, residentId)).sort((a, b) => (a.month < b.month ? -1 : 1));
  let streak = 0;
  const out: { statement: Doc<"statements">; status: StatementStatus; streak: number; month?: MonthState }[] = [];
  for (const s of statements) {
    const m = account.months.find((x) => x.month === s.month);
    if (ownCharges(m) === 0) continue; // nothing of its own: doesn't count either way
    const status = statementStatus(s, account.months, now);
    if (ON_TIME.includes(status)) streak += 1;
    else if (status === "paid_late" || status === "overdue") streak = 0;
    out.push({ statement: s, status, streak, month: m });
  }
  return out;
}

/** The resident's current on-time streak. */
export async function currentStreak(ctx: Db, residentId: Id<"residents">): Promise<number> {
  const timeline = await statementTimeline(ctx, residentId);
  const done = timeline.filter((t) => t.status !== "open");
  return done.length > 0 ? done[done.length - 1].streak : 0;
}

/** `ms` plus `n` calendar months (India time), the day clamped to the month's end. */
export function addMonthsMs(ms: number, n: number): number {
  const d = new Date(ms + IST_OFFSET_MS);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.getTime() - IST_OFFSET_MS;
}

/** Points for an amount of principal: 1 per whole rupee. */
export const pointsForPrincipal = (paise: number) => Math.floor(paise / 100);

/** What a number of points is worth in paise, at the setting's value (basis points of ₹1 per point). */
export const pointsValuePaise = (points: number, valueBasisPoints: number) => Math.floor((points * valueBasisPoints) / 100);

/**
 * Makes each repayment's points match the drawn money it paid off. Adds the
 * difference (up for a new payment, down if one was reversed).
 */
export async function syncRepaymentPoints(ctx: WDb, residentId: Id<"residents">, actorUserId: Id<"users"> | undefined): Promise<number> {
  const now = Date.now();
  const settings = await currentSettings(ctx);
  const entries = await ledgerRows(ctx, residentId);
  const account = replay(toRows(entries));
  const expected = new Map<string, number>();
  for (const e of entries) if (e.type === "repayment") expected.set(e._id, 0);
  for (const a of account.allocations) if (a.bucket === "principal" && expected.has(a.creditId)) expected.set(a.creditId, expected.get(a.creditId)! + a.amountPaise);
  const given = new Map<string, number>();
  for (const p of await pointsRows(ctx, residentId)) if (p.sourceEntryId) given.set(p.sourceEntryId, (given.get(p.sourceEntryId) ?? 0) + p.points);
  let added = 0;
  for (const [entryId, principalPaise] of expected) {
    const diff = pointsForPrincipal(principalPaise) - (given.get(entryId) ?? 0);
    if (diff === 0) continue;
    const sourceEntryId = entryId as Id<"ledgerEntries">;
    if (diff > 0) {
      await ctx.db.insert("pointsLedger", {
        residentId,
        type: "earned",
        points: diff,
        sourceEntryId,
        expiresAt: settings.pointsExpiryMonths > 0 ? addMonthsMs(now, settings.pointsExpiryMonths) : undefined,
        reason: "For your repayment",
        createdAt: now,
      });
      await notify(ctx, residentId, {
        kind: "points_earned",
        title: `You earned ${diff.toLocaleString("en-IN")} ${settings.pointsName}`,
        body: `For repaying ${formatPaise(diff * 100)} of money drawn.`,
        href: "/me/points",
      });
      added += diff;
    } else {
      await ctx.db.insert("pointsLedger", { residentId, type: "manual", points: diff, sourceEntryId, reason: "Payment corrected or reversed", createdAt: now, createdBy: actorUserId });
    }
    await writeAudit(ctx, { actorUserId, action: diff > 0 ? "points.earned" : "points.clawed_back", entityType: "ledgerEntries", entityId: entryId, residentId, metadata: { points: diff } });
  }
  return added;
}

/**
 * Limit growth only (points no longer depend on statements): each statement
 * that becomes paid on time is judged once; when the on-time streak reaches
 * a rule's number, the limit goes up.
 */
export async function awardPoints(ctx: WDb, residentId: Id<"residents">, actorUserId: Id<"users"> | undefined): Promise<number> {
  const added = await syncRepaymentPoints(ctx, residentId, actorUserId);
  const settings = await currentSettings(ctx);
  const resident = await ctx.db.get(residentId);
  if (resident === null) return added;
  for (const t of await statementTimeline(ctx, residentId)) {
    if (!ON_TIME.includes(t.status)) continue;
    const judged = await ctx.db
      .query("pointsAwards")
      .withIndex("by_resident_month", (q) => q.eq("residentId", residentId).eq("month", t.statement.month))
      .unique();
    if (judged !== null) continue;
    await ctx.db.insert("pointsAwards", { residentId, month: t.statement.month, points: 0, streak: t.streak, early: t.status === "paid_early", principalPaise: t.month?.principal.paid ?? 0, createdAt: Date.now() });
    if (settings.limitGrowthEnabled) await growLimit(ctx, (await ctx.db.get(residentId))!, t.streak, actorUserId);
  }
  return added;
}

/** Limit growth: each time the streak reaches a multiple of a rule's length, raise the limit (up to its maximum). */
async function growLimit(ctx: WDb, resident: Doc<"residents">, streak: number, actorUserId: Id<"users"> | undefined) {
  if (streak <= 0) return;
  const settings = await currentSettings(ctx);
  const rules = (await ctx.db.query("limitRules").collect()).filter((r) => r.enabled && streak % r.streakLength === 0);
  let limit = resident.limitPaise ?? settings.defaultLimitPaise;
  const before = limit;
  for (const r of rules) if (limit < r.maxPaise) limit = Math.min(limit + r.raisePaise, r.maxPaise);
  if (limit <= before) return;
  await ctx.db.patch(resident._id, { limitPaise: limit });
  await writeAudit(ctx, {
    actorUserId,
    action: "resident.limit_raised",
    entityType: "residents",
    entityId: resident._id,
    residentId: resident._id,
    reason: `${streak} on-time statements in a row`,
    metadata: { before, after: limit },
  });
  await notify(ctx, resident._id, {
    kind: "limit_raised",
    title: "Your limit went up",
    body: `For ${streak} on-time statements in a row, your limit is now ${formatPaise(limit)}.`,
    href: "/me",
  });
}

// ---- Balance and expiry ----------------------------------------------------

export type PointsRow = Pick<Doc<"pointsLedger">, "_id" | "type" | "points" | "expiresAt" | "lotId" | "refundOf" | "createdAt">;

/**
 * Which earned points are still unused. Expired rows come off their own
 * lot; everything spent comes off the lots that expire soonest. A refunded
 * redemption and its refund cancel out.
 */
export function lots(rows: PointsRow[]) {
  const refunded = new Set(rows.filter((r) => r.type === "refunded" && r.refundOf).flatMap((r) => [r._id as string, r.refundOf as string]));
  const live = rows.filter((r) => !refunded.has(r._id));
  const balance = rows.reduce((sum, r) => sum + r.points, 0);
  const pool = live
    .filter((r) => r.points > 0)
    .map((r) => ({ id: r._id, expiresAt: r.expiresAt ?? null, left: r.points, createdAt: r.createdAt }));
  for (const e of live.filter((r) => r.type === "expired")) {
    const lot = pool.find((l) => l.id === e.lotId);
    if (lot) lot.left = Math.max(0, lot.left + e.points);
  }
  pool.sort((a, b) => (a.expiresAt ?? Infinity) - (b.expiresAt ?? Infinity) || a.createdAt - b.createdAt);
  let spend = -live.filter((r) => r.points < 0 && r.type !== "expired").reduce((sum, r) => sum + r.points, 0);
  for (const lot of pool) {
    const take = Math.min(spend, lot.left);
    lot.left -= take;
    spend -= take;
  }
  return { balance, lots: pool };
}

export async function pointsRows(ctx: Db, residentId: Id<"residents">) {
  return await ctx.db
    .query("pointsLedger")
    .withIndex("by_resident_createdAt", (q) => q.eq("residentId", residentId))
    .collect();
}

export async function pointsBalance(ctx: Db, residentId: Id<"residents">): Promise<number> {
  return (await pointsRows(ctx, residentId)).reduce((sum, r) => sum + r.points, 0);
}

/** Expires unused points whose time has come. Safe to run any number of times. */
export async function expirePoints(ctx: WDb, residentId: Id<"residents">, now = Date.now()): Promise<number> {
  const rows = await pointsRows(ctx, residentId);
  let expired = 0;
  for (const lot of lots(rows).lots) {
    if (lot.expiresAt === null || lot.expiresAt > now || lot.left <= 0) continue;
    await ctx.db.insert("pointsLedger", { residentId, type: "expired", points: -lot.left, lotId: lot.id, createdAt: now });
    expired += lot.left;
  }
  return expired;
}
