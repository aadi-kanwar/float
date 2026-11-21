/**
 * Points (shown everywhere under the admin's chosen name, Settings →
 * "Name of the points"). 1 point per ₹1 of drawn money repaid, given when
 * the payment is confirmed; see convex/lib/points.ts.
 */
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { requireReason, writeAudit } from "./lib/audit";
import { appError } from "./lib/errors";
import { adminMutation, adminQuery, residentQuery } from "./lib/functions";
import { notify } from "./lib/account";
import { rupeesToPaise } from "./lib/money";
import { residentsInScope } from "./lib/org";
import { currentStreak, lots, pointsRows, pointsValuePaise, statementTimeline } from "./lib/points";
import { currentSettings } from "./lib/settings";

function history(rows: Awaited<ReturnType<typeof pointsRows>>) {
  return rows
    .map((r) => ({
      id: r._id,
      type: r.type,
      points: r.points,
      statementMonth: r.statementMonth ?? null,
      expiresAt: r.expiresAt ?? null,
      reason: r.reason ?? null,
      createdAt: r.createdAt,
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

async function summaryFor(ctx: Parameters<typeof currentStreak>[0], residentId: Id<"residents">) {
  const rows = await pointsRows(ctx, residentId);
  const now = Date.now();
  const { balance, lots: pool } = lots(rows);
  const expiring = pool
    .filter((l) => l.expiresAt !== null && l.expiresAt > now && l.left > 0)
    .map((l) => ({ points: l.left, expiresAt: l.expiresAt! }))
    .slice(0, 5);
  const timeline = await statementTimeline(ctx, residentId, now);
  const recent = timeline.slice(-6).map((t) => ({ month: t.statement.month, status: t.status, points: 0 }));
  return { balance, streak: await currentStreak(ctx, residentId), expiring, history: history(rows), recent };
}

/** The resident's own points page. */
export const mine = residentQuery({
  args: {},
  handler: async (ctx) => {
    const settings = await currentSettings(ctx);
    const summary = await summaryFor(ctx, ctx.resident.resident._id);
    return {
      pointsName: settings.pointsName,
      expiryMonths: settings.pointsExpiryMonths,
      /** Basis points of ₹1 that one point is worth. */
      pointValueBasisPoints: settings.pointValueBasisPoints,
      balanceValuePaise: pointsValuePaise(Math.max(0, summary.balance), settings.pointValueBasisPoints),
      ...summary,
    };
  },
});

// ---- Admin -----------------------------------------------------------------

export const residentPoints = adminQuery({
  args: { residentId: v.id("residents") },
  handler: async (ctx, { residentId }) => {
    const settings = await currentSettings(ctx);
    const summary = await summaryFor(ctx, residentId);
    return { pointsName: settings.pointsName, balanceValuePaise: pointsValuePaise(Math.max(0, summary.balance), settings.pointValueBasisPoints), ...summary };
  },
});

/** The admin gives (+) or takes (−) points, with a reason. A deduction can't take the balance below 0. */
export const adjust = adminMutation({
  args: { residentId: v.id("residents"), points: v.number(), reason: v.string() },
  handler: async (ctx, args) => {
    const reason = requireReason(args.reason);
    if (!Number.isInteger(args.points) || args.points === 0 || Math.abs(args.points) > 1_000_000)
      throw appError("INVALID_INPUT", "Enter a whole number of points (not 0).");
    const resident = await ctx.db.get(args.residentId);
    if (resident === null) throw appError("NOT_FOUND");
    const rows = await pointsRows(ctx, resident._id);
    const before = rows.reduce((sum, r) => sum + r.points, 0);
    if (before + args.points < 0) throw appError("INVALID_INPUT", `They have ${before} points; you can take at most ${Math.max(0, before)}.`);
    const now = Date.now();
    const id = await ctx.db.insert("pointsLedger", { residentId: resident._id, type: "manual", points: args.points, reason, createdAt: now, createdBy: ctx.admin.userId });
    await writeAudit(ctx, {
      actorUserId: ctx.admin.userId,
      action: args.points > 0 ? "points.granted" : "points.deducted",
      entityType: "pointsLedger",
      entityId: id,
      residentId: resident._id,
      reason,
      metadata: { points: args.points, before, after: before + args.points },
    });
    const name = (await currentSettings(ctx)).pointsName;
    await notify(ctx, resident._id, {
      kind: args.points > 0 ? "points_granted" : "points_deducted",
      title: args.points > 0 ? `You got ${args.points} ${name}` : `${-args.points} ${name} taken off`,
      body: reason,
      href: "/me/points",
    });
    return null;
  },
});

/** Every points change, newest first (the points ledger). */
export const ledger = adminQuery({
  args: { paginationOpts: paginationOptsValidator, propertyId: v.optional(v.id("properties")) },
  handler: async (ctx, { paginationOpts, propertyId }) => {
    const scope = await residentsInScope(ctx, propertyId);
    if (scope !== null && scope.size === 0) return { page: [], isDone: true, continueCursor: "" };
    const page = await ctx.db
      .query("pointsLedger")
      .withIndex("by_createdAt")
      .filter((q) => (scope === null ? true : q.or(...[...scope].map((id) => q.eq(q.field("residentId"), id as Id<"residents">)))))
      .order("desc")
      .paginate(paginationOpts);
    const names = new Map<string, string>();
    const out = [];
    for (const r of page.page) {
      if (!names.has(r.residentId)) names.set(r.residentId, (await ctx.db.get(r.residentId))?.name ?? "Unknown");
      out.push({ id: r._id, residentId: r.residentId, residentName: names.get(r.residentId)!, type: r.type, points: r.points, reason: r.reason ?? null, statementMonth: r.statementMonth ?? null, createdAt: r.createdAt });
    }
    return { ...page, page: out };
  },
});

// ---- Limit growth ------------------------------------------------------------

export const limitRules = adminQuery({
  args: {},
  handler: async (ctx) => ({
    enabled: (await currentSettings(ctx)).limitGrowthEnabled,
    rules: (await ctx.db.query("limitRules").collect()).map((r) => ({
      ruleId: r._id,
      streakLength: r.streakLength,
      raisePaise: r.raisePaise,
      maxPaise: r.maxPaise,
      enabled: r.enabled,
    })),
  }),
});

export const saveLimitRule = adminMutation({
  args: {
    ruleId: v.optional(v.id("limitRules")),
    streakLength: v.number(),
    raiseRupees: v.number(),
    maxRupees: v.number(),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    if (!Number.isInteger(args.streakLength) || args.streakLength < 1 || args.streakLength > 60)
      throw appError("INVALID_INPUT", "The streak must be 1 to 60 statements.");
    const raisePaise = rupeesToPaise(args.raiseRupees);
    const maxPaise = rupeesToPaise(args.maxRupees);
    if (raisePaise <= 0 || maxPaise <= 0 || maxPaise > 10_000_000) throw appError("INVALID_INPUT", "Enter amounts above ₹0 (the maximum up to ₹1,00,000).");
    const values = { streakLength: args.streakLength, raisePaise, maxPaise, enabled: args.enabled };
    if (args.ruleId) {
      const rule = await ctx.db.get(args.ruleId);
      if (rule === null) throw appError("NOT_FOUND");
      await ctx.db.patch(rule._id, values);
      await writeAudit(ctx, {
        actorUserId: ctx.admin.userId,
        action: "limit_rule.changed",
        entityType: "limitRules",
        entityId: rule._id,
        metadata: { before: { streakLength: rule.streakLength, raisePaise: rule.raisePaise, maxPaise: rule.maxPaise, enabled: rule.enabled }, after: values },
      });
      return rule._id;
    }
    const id = await ctx.db.insert("limitRules", { ...values, createdAt: Date.now() });
    await writeAudit(ctx, { actorUserId: ctx.admin.userId, action: "limit_rule.added", entityType: "limitRules", entityId: id, metadata: { after: values } });
    return id;
  },
});
