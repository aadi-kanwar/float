/**
 * Admin: residents (the Residents screen).
 *
 * Residents come from two places:
 * - the Livoza Hub (residents sign up there; the hub's sync and sign-in
 *   tickets create them here, see convex/lib/hubSync.ts), or
 * - an admin here, with a temporary password the resident must change at
 *   first sign-in (Float's own login, kept as a backup until HUB_ONLY=true).
 *
 * Deposit, credit limit and pause are Float's own and only an admin sets
 * them. Every change is audit-logged with old and new values; overrides
 * need a reason. Passwords are never logged.
 */
import { invalidateSessions, modifyAccountCredentials } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { PHONE_PASSWORD_PROVIDER } from "./auth";
import { createLogin, temporaryPassword } from "./lib/accounts";
import { requireReason, writeAudit } from "./lib/audit";
import { appError } from "./lib/errors";
import {
  adminAction,
  adminMutation,
  adminQuery,
  internalMutation,
  internalQuery,
} from "./lib/functions";
import { displayNameSchema, normalizePhone, passwordProblem } from "./lib/inputRules";
import { rupeesToPaise } from "./lib/money";
import { currentSettings } from "./lib/settings";

type Db = Pick<QueryCtx, "db">;

const MAX_DEPOSIT_PAISE = 10_000_000; // ₹1,00,000

export async function loadResident(ctx: Db, residentId: Id<"residents">): Promise<Doc<"residents">> {
  const resident = await ctx.db.get(residentId);
  if (resident === null) throw appError("NOT_FOUND");
  return resident;
}

function cleanRoom(room: string | undefined): string | undefined {
  const text = (room ?? "").trim();
  if (text.length > 20) throw appError("INVALID_INPUT", "Use at most 20 characters for the room.");
  return text.length > 0 ? text : undefined;
}

function depositPaise(rupees: number): number {
  const paise = rupeesToPaise(rupees);
  if (paise < 0 || paise > MAX_DEPOSIT_PAISE)
    throw appError("INVALID_INPUT", "The deposit must be between ₹0 and ₹1,00,000.");
  return paise;
}

async function checkProperty(ctx: Db, propertyId: Id<"properties"> | undefined) {
  if (propertyId === undefined) return;
  const property = await ctx.db.get(propertyId);
  if (property === null || property.status !== "active")
    throw appError("INVALID_INPUT", "That PG wasn't found.");
}

/** Signs an account out everywhere, at once (mutations can't call invalidateSessions). */
export async function endSessions(ctx: Pick<MutationCtx, "db">, userId: Id<"users">): Promise<number> {
  const sessions = await ctx.db
    .query("authSessions")
    .withIndex("userId", (q) => q.eq("userId", userId))
    .collect();
  for (const session of sessions) {
    const tokens = await ctx.db
      .query("authRefreshTokens")
      .withIndex("sessionIdAndParentRefreshTokenId", (q) => q.eq("sessionId", session._id))
      .collect();
    for (const token of tokens) await ctx.db.delete(token._id);
    await ctx.db.delete(session._id);
  }
  return sessions.length;
}

/** Every resident, filtered. Amounts owed are added in the money engine. */
export const list = adminQuery({
  args: {
    search: v.optional(v.string()),
    propertyId: v.optional(v.id("properties")),
    status: v.optional(v.union(v.literal("active"), v.literal("left"))),
    paused: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const status = args.status ?? "active";
    const rows =
      args.propertyId !== undefined
        ? await ctx.db
            .query("residents")
            .withIndex("by_property_status", (q) => q.eq("propertyId", args.propertyId).eq("status", status))
            .collect()
        : await ctx.db
            .query("residents")
            .withIndex("by_status_name", (q) => q.eq("status", status))
            .collect();
    const needle = (args.search ?? "").trim().toLowerCase();
    const digits = needle.replace(/\D/g, "");
    const properties = new Map((await ctx.db.query("properties").collect()).map((p) => [p._id, p.name]));
    const settings = await currentSettings(ctx);
    const result = [];
    for (const r of rows) {
      if (args.paused !== undefined && r.paused !== args.paused) continue;
      if (
        needle.length > 0 &&
        !r.name.toLowerCase().includes(needle) &&
        !(r.roomNumber ?? "").toLowerCase().includes(needle) &&
        !(digits.length >= 3 && r.phone.includes(digits))
      )
        continue;
      const user = await ctx.db.get(r.userId);
      result.push({
        residentId: r._id,
        name: r.name,
        phone: r.phone,
        roomNumber: r.roomNumber ?? null,
        propertyName: r.propertyId ? (properties.get(r.propertyId) ?? null) : null,
        depositPaise: r.depositPaise,
        limitPaise: r.limitPaise ?? settings.defaultLimitPaise,
        ownLimit: r.limitPaise !== undefined,
        paused: r.paused,
        fromHub: user?.ssoManaged === true,
        disabled: user?.disabled === true,
      });
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  },
});

/** One resident's details and recent changes (the per-resident page). */
export const get = adminQuery({
  args: { residentId: v.id("residents") },
  handler: async (ctx, { residentId }) => {
    const r = await loadResident(ctx, residentId);
    const user = await ctx.db.get(r.userId);
    const property = r.propertyId ? await ctx.db.get(r.propertyId) : null;
    const settings = await currentSettings(ctx);
    const hasPassword =
      (await ctx.db
        .query("authAccounts")
        .withIndex("providerAndAccountId", (q) =>
          q.eq("provider", PHONE_PASSWORD_PROVIDER).eq("providerAccountId", r.phone),
        )
        .first()) !== null;
    const history = await ctx.db
      .query("auditLog")
      .withIndex("by_resident_createdAt", (q) => q.eq("residentId", residentId))
      .order("desc")
      .take(50);
    return {
      residentId: r._id,
      name: r.name,
      phone: r.phone,
      roomNumber: r.roomNumber ?? null,
      propertyId: r.propertyId ?? null,
      propertyName: property?.name ?? null,
      depositPaise: r.depositPaise,
      limitPaise: r.limitPaise ?? settings.defaultLimitPaise,
      ownLimit: r.limitPaise !== undefined,
      paused: r.paused,
      status: r.status,
      fromHub: user?.ssoManaged === true,
      disabled: user?.disabled === true,
      mustChangePassword: user?.mustChangePassword === true,
      hasPassword,
      createdAt: r.createdAt,
      history: history.map((h) => ({
        id: h._id,
        action: h.action,
        reason: h.reason ?? null,
        metadata: h.metadata ?? null,
        createdAt: h.createdAt,
      })),
    };
  },
});

/** Creates a resident with the temporary password the admin chose (changed at first sign-in). */
export const create = adminAction({
  args: {
    name: v.string(),
    phone: v.string(),
    roomNumber: v.optional(v.string()),
    propertyId: v.optional(v.id("properties")),
    depositRupees: v.number(),
    temporaryPassword: v.string(),
  },
  handler: async (ctx, args): Promise<{ residentId: Id<"residents"> }> => {
    const phone = normalizePhone(args.phone);
    if (phone === null) throw appError("INVALID_PHONE");
    const name = displayNameSchema.safeParse(args.name);
    if (!name.success) throw appError("INVALID_INPUT", name.error.issues[0]?.message);
    const problem = passwordProblem(args.temporaryPassword, phone);
    if (problem !== null) throw appError("WEAK_PASSWORD", problem);
    const details = {
      name: name.data,
      phone,
      roomNumber: cleanRoom(args.roomNumber),
      propertyId: args.propertyId,
      depositPaise: depositPaise(args.depositRupees),
    };
    await ctx.runQuery(internal.residents.checkNewResident, { phone, propertyId: args.propertyId });
    let userId: Id<"users">;
    try {
      userId = await createLogin(ctx, phone, args.temporaryPassword);
    } catch {
      throw appError("CONFLICT", "That mobile number already has an account.");
    }
    try {
      const residentId: Id<"residents"> = await ctx.runMutation(internal.residents.setUpResident, {
        userId,
        actorUserId: ctx.admin.userId,
        ...details,
      });
      return { residentId };
    } catch (error) {
      await ctx.runMutation(internal.residents.removeLogin, { userId });
      throw error;
    }
  },
});

export const checkNewResident = internalQuery({
  args: { phone: v.string(), propertyId: v.optional(v.id("properties")) },
  handler: async (ctx, { phone, propertyId }) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("phone", (q) => q.eq("phone", phone))
      .first();
    if (existing !== null) throw appError("CONFLICT", "That mobile number already has an account.");
    await checkProperty(ctx, propertyId);
    return null;
  },
});

export const setUpResident = internalMutation({
  args: {
    userId: v.id("users"),
    actorUserId: v.id("users"),
    name: v.string(),
    phone: v.string(),
    roomNumber: v.optional(v.string()),
    propertyId: v.optional(v.id("properties")),
    depositPaise: v.number(),
  },
  returns: v.id("residents"),
  handler: async (ctx, { userId, actorUserId, ...details }) => {
    await checkProperty(ctx, details.propertyId);
    await ctx.db.patch(userId, { name: details.name, role: "resident", mustChangePassword: true });
    const residentId = await ctx.db.insert("residents", {
      userId,
      ...details,
      paused: false,
      status: "active",
      createdAt: Date.now(),
    });
    await writeAudit(ctx, {
      actorUserId,
      action: "resident.created",
      entityType: "residents",
      entityId: residentId,
      residentId,
      metadata: { after: details },
    });
    return residentId;
  },
});

/** Undoes a half-made login (internal: only when setting it up failed). */
export const removeLogin = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    for (const account of await ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", (q) => q.eq("userId", userId))
      .collect()) {
      await ctx.db.delete(account._id);
    }
    const user = await ctx.db.get(userId);
    if (user !== null && user.role === undefined) await ctx.db.delete(userId);
    return null;
  },
});

/** Name, room and PG. (For hub residents the hub's next sync wins for name and room.) */
export const update = adminMutation({
  args: {
    residentId: v.id("residents"),
    name: v.string(),
    roomNumber: v.optional(v.string()),
    propertyId: v.optional(v.id("properties")),
  },
  handler: async (ctx, args) => {
    const r = await loadResident(ctx, args.residentId);
    const name = displayNameSchema.safeParse(args.name);
    if (!name.success) throw appError("INVALID_INPUT", name.error.issues[0]?.message);
    await checkProperty(ctx, args.propertyId);
    const before = { name: r.name, roomNumber: r.roomNumber, propertyId: r.propertyId };
    const after = { name: name.data, roomNumber: cleanRoom(args.roomNumber), propertyId: args.propertyId };
    if (JSON.stringify(before) === JSON.stringify(after)) return null;
    await ctx.db.patch(r._id, after);
    await ctx.db.patch(r.userId, { name: after.name });
    await writeAudit(ctx, {
      actorUserId: ctx.admin.userId,
      action: "resident.updated",
      entityType: "residents",
      entityId: r._id,
      residentId: r._id,
      metadata: { before, after },
    });
    return null;
  },
});

/** The recorded security deposit (e.g. it was entered wrongly, or topped up). */
export const setDeposit = adminMutation({
  args: { residentId: v.id("residents"), depositRupees: v.number(), reason: v.string() },
  handler: async (ctx, args) => {
    const r = await loadResident(ctx, args.residentId);
    const reason = requireReason(args.reason);
    const after = depositPaise(args.depositRupees);
    if (after === r.depositPaise) return null;
    await ctx.db.patch(r._id, { depositPaise: after });
    await writeAudit(ctx, {
      actorUserId: ctx.admin.userId,
      action: "resident.deposit_changed",
      entityType: "residents",
      entityId: r._id,
      residentId: r._id,
      reason,
      metadata: { before: r.depositPaise, after },
    });
    return null;
  },
});

/** This resident's own credit limit, or back to the default (null). */
export const setLimit = adminMutation({
  args: { residentId: v.id("residents"), limitRupees: v.union(v.number(), v.null()), reason: v.string() },
  handler: async (ctx, args) => {
    const r = await loadResident(ctx, args.residentId);
    const reason = requireReason(args.reason);
    let after: number | undefined;
    if (args.limitRupees !== null) {
      after = rupeesToPaise(args.limitRupees);
      if (after < 0 || after > MAX_DEPOSIT_PAISE)
        throw appError("INVALID_INPUT", "The limit must be between ₹0 and ₹1,00,000.");
    }
    if (after === r.limitPaise) return null;
    await ctx.db.patch(r._id, { limitPaise: after });
    await writeAudit(ctx, {
      actorUserId: ctx.admin.userId,
      action: "resident.limit_changed",
      entityType: "residents",
      entityId: r._id,
      residentId: r._id,
      reason,
      metadata: { before: r.limitPaise ?? null, after: after ?? null },
    });
    return null;
  },
});

/** Pause (no new draws or redemptions; they can still see and repay) or resume. */
export const setPaused = adminMutation({
  args: { residentId: v.id("residents"), paused: v.boolean(), reason: v.string() },
  handler: async (ctx, args) => {
    const r = await loadResident(ctx, args.residentId);
    const reason = requireReason(args.reason);
    if (r.paused === args.paused) return null;
    await ctx.db.patch(r._id, { paused: args.paused });
    await writeAudit(ctx, {
      actorUserId: ctx.admin.userId,
      action: args.paused ? "resident.paused" : "resident.resumed",
      entityType: "residents",
      entityId: r._id,
      residentId: r._id,
      reason,
      metadata: { before: r.paused, after: args.paused },
    });
    return null;
  },
});

/** Gives a resident a new temporary password (shown once) and signs them out everywhere. */
export const resetPassword = adminAction({
  args: { residentId: v.id("residents") },
  handler: async (ctx, { residentId }): Promise<{ temporaryPassword: string }> => {
    const target = await ctx.runQuery(internal.residents.resetTarget, { residentId });
    const password = temporaryPassword();
    await modifyAccountCredentials(ctx, {
      provider: PHONE_PASSWORD_PROVIDER,
      account: { id: target.phone, secret: password },
    });
    await invalidateSessions(ctx, { userId: target.userId });
    await ctx.runMutation(internal.residents.recordReset, {
      residentId,
      userId: target.userId,
      actorUserId: ctx.admin.userId,
    });
    return { temporaryPassword: password };
  },
});

export const resetTarget = internalQuery({
  args: { residentId: v.id("residents") },
  returns: v.object({ phone: v.string(), userId: v.id("users") }),
  handler: async (ctx, { residentId }) => {
    const r = await loadResident(ctx, residentId);
    const account = await ctx.db
      .query("authAccounts")
      .withIndex("providerAndAccountId", (q) =>
        q.eq("provider", PHONE_PASSWORD_PROVIDER).eq("providerAccountId", r.phone),
      )
      .first();
    if (account === null || account.userId !== r.userId)
      throw appError(
        "CONFLICT",
        "This resident signs in through the Livoza Hub. Reset their password in the hub.",
      );
    return { phone: r.phone, userId: r.userId };
  },
});

export const recordReset = internalMutation({
  args: { residentId: v.id("residents"), userId: v.id("users"), actorUserId: v.id("users") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, { mustChangePassword: true });
    await writeAudit(ctx, {
      actorUserId: args.actorUserId,
      action: "resident.password_reset",
      entityType: "residents",
      entityId: args.residentId,
      residentId: args.residentId,
    });
    return null;
  },
});
