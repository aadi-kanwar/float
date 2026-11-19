/**
 * Points (shown everywhere under the admin's chosen name, Settings →
 * "Name of the points"). See convex/lib/points.ts for how they are earned.
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
import { currentRules, currentStreak, ensureRules, lots, pointsRows, statementTimeline, type Rule } from "./lib/points";
import { currentSettings } from "./lib/settings";
import { vPointsRuleType } from "./lib/validators";

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

function describeRules(rules: Rule[]) {
  return rules.map((r) => ({
    type: r.type,
    pointsPer100: r.pointsPer100 ?? null,
    multiplierPct: r.multiplierPct ?? null,
    streakLength: r.streakLength ?? null,
    enabled: r.enabled,
  }));
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
  const awards = await ctx.db
    .query("pointsAwards")
    .withIndex("by_resident_month", (q) => q.eq("residentId", residentId))
    .collect();
  const recent = timeline.slice(-6).map((t) => ({
    month: t.statement.month,
    status: t.status,
    points: awards.find((a) => a.month === t.statement.month && a.clawedBackAt === undefined)?.points ?? 0,
  }));
  return { balance, streak: await currentStreak(ctx, residentId), expiring, history: history(rows), recent };
}

/** The resident's own points page. */
export const mine = residentQuery({
  args: {},
  handler: async (ctx) => {
    const settings = await currentSettings(ctx);
    const rules = await currentRules(ctx);
    return {
      pointsName: settings.pointsName,
      expiryMonths: settings.pointsExpiryMonths,
      dueDay: settings.dueDayOfMonth,
      rules: describeRules(rules.filter((r) => r.enabled)),
      ...(await summaryFor(ctx, ctx.resident.resident._id)),
    };
  },
});

// ---- Admin -----------------------------------------------------------------

export const residentPoints = adminQuery({
  args: { residentId: v.id("residents") },
  handler: async (ctx, { residentId }) => ({ pointsName: (await currentSettings(ctx)).pointsName, ...(await summaryFor(ctx, residentId)) }),
});

export const rules = adminQuery({
  args: {},
  handler: async (ctx) => {
    const saved = await ctx.db.query("pointsRules").withIndex("by_sortOrder").collect();
    const list = saved.length > 0 ? saved.map((r) => ({ ruleId: r._id as string | null, ...r })) : (await currentRules(ctx)).map((r) => ({ ruleId: null, ...r }));
    return list.map((r) => ({ ruleId: r.ruleId, ...describeRules([r])[0] }));
  },
});

function checkRule(r: { type: string; pointsPer100?: number; multiplierPct?: number; streakLength?: number }) {
  const int = (n: number | undefined, min: number, max: number, what: string) => {
    if (n === undefined || !Number.isInteger(n) || n < min || n > max) throw appError("INVALID_INPUT", `${what} must be a whole number from ${min} to ${max}.`);
    return n;
  };
  if (r.type === "base") return { pointsPer100: int(r.pointsPer100, 0, 1000, "Points per ₹100") };
  if (r.type === "early") return { multiplierPct: int(r.multiplierPct, 100, 1000, "The multiplier (%)") };
  return { multiplierPct: int(r.multiplierPct, 100, 1000, "The multiplier (%)"), streakLength: int(r.streakLength, 2, 60, "The streak length") };
}

/** Adds a rule (no index) or changes the one at `index` in the list. */
export const saveRule = adminMutation({
  args: {
    index: v.optional(v.number()),
    type: vPointsRuleType,
    pointsPer100: v.optional(v.number()),
    multiplierPct: v.optional(v.number()),
    streakLength: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await ensureRules(ctx);
    const values = checkRule(args);
    if (args.index !== undefined) {
      const rule = (await ctx.db.query("pointsRules").withIndex("by_sortOrder").collect())[args.index];
      if (!rule) throw appError("NOT_FOUND");
      if (rule.type !== args.type) throw appError("INVALID_INPUT", "A rule's kind can't change. Add a new rule instead.");
      const before = { pointsPer100: rule.pointsPer100, multiplierPct: rule.multiplierPct, streakLength: rule.streakLength };
      await ctx.db.patch(rule._id, values);
      await writeAudit(ctx, { actorUserId: ctx.admin.userId, action: "points.rule_changed", entityType: "pointsRules", entityId: rule._id, metadata: { type: rule.type, before, after: values } });
      return rule._id;
    }
    const last = await ctx.db.query("pointsRules").withIndex("by_sortOrder").order("desc").first();
    const id = await ctx.db.insert("pointsRules", { type: args.type, ...values, enabled: true, sortOrder: (last?.sortOrder ?? 0) + 1, createdAt: Date.now() });
    await writeAudit(ctx, { actorUserId: ctx.admin.userId, action: "points.rule_added", entityType: "pointsRules", entityId: id, metadata: { after: { type: args.type, ...values } } });
    return id;
  },
});

/** Turns a rule on or off. `index` is its place in the list (rules may still be the unsaved defaults). */
export const setRuleEnabled = adminMutation({
  args: { index: v.number(), enabled: v.boolean() },
  handler: async (ctx, { index, enabled }) => {
    await ensureRules(ctx);
    const list = await ctx.db.query("pointsRules").withIndex("by_sortOrder").collect();
    const rule = list[index];
    if (!rule) throw appError("NOT_FOUND");
    if (rule.enabled === enabled) return null;
    await ctx.db.patch(rule._id, { enabled });
    await writeAudit(ctx, { actorUserId: ctx.admin.userId, action: enabled ? "points.rule_enabled" : "points.rule_disabled", entityType: "pointsRules", entityId: rule._id, metadata: { type: rule.type, before: !enabled, after: enabled } });
    return null;
  },
});

/** Moves a rule up (-1) or down (+1) in the list. */
export const moveRule = adminMutation({
  args: { index: v.number(), by: v.union(v.literal(-1), v.literal(1)) },
  handler: async (ctx, { index, by }) => {
    await ensureRules(ctx);
    const list = await ctx.db.query("pointsRules").withIndex("by_sortOrder").collect();
    const a = list[index];
    const b = list[index + by];
    if (!a || !b) return null;
    // Re-number everything so the order is unambiguous.
    const order = [...list];
    order[index] = b;
    order[index + by] = a;
    for (const [i, r] of order.entries()) if (r.sortOrder !== i) await ctx.db.patch(r._id, { sortOrder: i });
    await writeAudit(ctx, { actorUserId: ctx.admin.userId, action: "points.rules_reordered", entityType: "pointsRules", entityId: a._id, metadata: { before: index, after: index + by } });
    return null;
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
