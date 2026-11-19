/**
 * Points: earning, streaks, expiry and limit growth.
 *
 * - Earned only on PRINCIPAL repaid (never fees or late fees), for a
 *   statement fully paid by its deadline, once per statement.
 * - Paid before the statement was made (in the same month): early bonus.
 * - Streak: on-time statements in a row (statements with nothing of their
 *   own are skipped). A late or overdue statement resets it to 0.
 * - Points expire N months after being earned (setting; 0 = never). Spending
 *   uses the points that expire soonest first; only unused points expire.
 * - If a payment is reversed and a statement is no longer paid on time, the
 *   points it earned are taken back.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { ledgerRows, notify, statementStatus, statementsOf, toRows, type StatementStatus } from "./account";
import { writeAudit } from "./audit";
import { replay, type MonthState } from "./ledger";
import { formatPaise } from "./money";
import { currentSettings } from "./settings";
import { IST_OFFSET_MS } from "./time";
import type { PointsRuleType } from "./validators";

type Db = Pick<QueryCtx, "db">;
type WDb = Pick<MutationCtx, "db">;

export type Rule = {
  type: PointsRuleType;
  pointsPer100?: number;
  multiplierPct?: number;
  streakLength?: number;
  enabled: boolean;
  sortOrder: number;
};

/** Used until the admin changes the rules (then they are saved). */
export const DEFAULT_RULES: Rule[] = [
  { type: "base", pointsPer100: 5, enabled: true, sortOrder: 0 },
  { type: "early", multiplierPct: 200, enabled: true, sortOrder: 1 },
  { type: "streak", streakLength: 3, multiplierPct: 125, enabled: true, sortOrder: 2 },
  { type: "streak", streakLength: 6, multiplierPct: 150, enabled: true, sortOrder: 3 },
];

export async function currentRules(ctx: Db): Promise<(Rule & { _id?: Id<"pointsRules"> })[]> {
  const saved = await ctx.db.query("pointsRules").withIndex("by_sortOrder").collect();
  return saved.length > 0 ? saved : DEFAULT_RULES;
}

/** Saves the default rules the first time an admin edits them. */
export async function ensureRules(ctx: WDb): Promise<void> {
  if ((await ctx.db.query("pointsRules").first()) !== null) return;
  for (const r of DEFAULT_RULES) await ctx.db.insert("pointsRules", { ...r, createdAt: Date.now() });
}

/**
 * Points for one statement: floor(principal ₹ / 100 × base × multipliers).
 * Integer maths: multipliers are percentages.
 */
export function pointsFor(principalPaise: number, early: boolean, streak: number, rules: Rule[]) {
  const on = rules.filter((r) => r.enabled);
  const base = on.filter((r) => r.type === "base").reduce((sum, r) => sum + (r.pointsPer100 ?? 0), 0);
  const earlyPct = early ? Math.max(100, ...on.filter((r) => r.type === "early").map((r) => r.multiplierPct ?? 100)) : 100;
  const streakRule = on
    .filter((r) => r.type === "streak" && (r.streakLength ?? Infinity) <= streak)
    .sort((a, b) => (b.streakLength ?? 0) - (a.streakLength ?? 0))[0];
  const streakPct = streakRule?.multiplierPct ?? 100;
  // principalPaise / 10_000 = hundreds of rupees
  const points = Math.floor((principalPaise * base * earlyPct * streakPct) / (10_000 * 100 * 100));
  return { points, base, earlyPct, streakPct };
}

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

/**
 * Gives points for every statement that is now paid on time and hasn't had
 * them yet, and takes them back from any that no longer is. Safe to run any
 * number of times. Runs after every payment, waiver, reversal or deposit
 * settlement, and when statements are made.
 */
export async function awardPoints(ctx: WDb, residentId: Id<"residents">, actorUserId: Id<"users"> | undefined): Promise<number> {
  const now = Date.now();
  const settings = await currentSettings(ctx);
  const rules = await currentRules(ctx);
  const resident = await ctx.db.get(residentId);
  if (resident === null) return 0;
  let given = 0;
  for (const t of await statementTimeline(ctx, residentId, now)) {
    const month = t.statement.month;
    const award = await ctx.db
      .query("pointsAwards")
      .withIndex("by_resident_month", (q) => q.eq("residentId", residentId).eq("month", month))
      .unique();
    const onTime = ON_TIME.includes(t.status);
    if (award === null && onTime) {
      const early = t.status === "paid_early";
      const principalPaise = t.month ? t.month.principal.paid : 0;
      const { points } = pointsFor(principalPaise, early, t.streak, rules);
      await ctx.db.insert("pointsAwards", { residentId, month, points, streak: t.streak, early, principalPaise, createdAt: now });
      if (points > 0) {
        await ctx.db.insert("pointsLedger", {
          residentId,
          type: "earned",
          points,
          statementMonth: month,
          expiresAt: settings.pointsExpiryMonths > 0 ? addMonthsMs(now, settings.pointsExpiryMonths) : undefined,
          reason: `${early ? "Paid early" : "Paid on time"}${t.streak >= 2 ? `, ${t.streak} in a row` : ""}`,
          createdAt: now,
        });
        await notify(ctx, residentId, {
          kind: "points_earned",
          title: `You earned ${points} ${settings.pointsName}`,
          body: `For paying your statement ${early ? "early" : "on time"}${t.streak >= 2 ? ` (${t.streak} in a row)` : ""}.`,
          href: "/me/points",
        });
        given += points;
      }
      await writeAudit(ctx, {
        actorUserId,
        action: "points.earned",
        entityType: "pointsAwards",
        entityId: month,
        residentId,
        metadata: { month, points, streak: t.streak, early, principalPaise },
      });
      if (settings.limitGrowthEnabled) await growLimit(ctx, resident, t.streak, actorUserId);
    } else if (award !== null && !onTime && award.clawedBackAt === undefined && t.status !== "open") {
      // The statement is no longer paid on time (e.g. a payment was reversed).
      await ctx.db.patch(award._id, { clawedBackAt: now });
      if (award.points > 0)
        await ctx.db.insert("pointsLedger", {
          residentId,
          type: "manual",
          points: -award.points,
          reason: `Taken back: the ${month} statement is no longer paid on time`,
          createdAt: now,
          createdBy: actorUserId,
        });
      await writeAudit(ctx, {
        actorUserId,
        action: "points.clawed_back",
        entityType: "pointsAwards",
        entityId: month,
        residentId,
        metadata: { month, points: award.points },
      });
    }
  }
  return given;
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
