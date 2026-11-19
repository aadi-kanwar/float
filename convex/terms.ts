/**
 * The terms residents accept before drawing. Versioned: a new version must
 * be accepted again before the next draw. Each acceptance records the
 * version and time.
 */
import { v } from "convex/values";
import { writeAudit } from "./lib/audit";
import { appError } from "./lib/errors";
import { adminMutation, adminQuery, residentMutation, residentQuery } from "./lib/functions";
import { currentTerms } from "./lib/terms";

export const current = adminQuery({
  args: {},
  handler: async (ctx) => await currentTerms(ctx),
});

export const save = adminMutation({
  args: { text: v.string() },
  handler: async (ctx, { text }) => {
    const clean = text.trim();
    if (clean.length < 20 || clean.length > 20_000) throw appError("INVALID_INPUT", "Write between 20 and 20,000 characters.");
    const before = await currentTerms(ctx);
    if (before.text === clean) return { version: before.version };
    const version = before.version + 1;
    await ctx.db.insert("termsVersions", { version, text: clean, createdAt: Date.now(), createdBy: ctx.admin.userId });
    await writeAudit(ctx, {
      actorUserId: ctx.admin.userId,
      action: "terms.changed",
      entityType: "termsVersions",
      entityId: String(version),
      metadata: { before: { version: before.version }, after: { version } },
    });
    return { version };
  },
});

/** The terms, and whether this resident has accepted this version. */
export const mine = residentQuery({
  args: {},
  handler: async (ctx) => {
    const terms = await currentTerms(ctx);
    const accepted = await ctx.db
      .query("termsAcceptances")
      .withIndex("by_resident_version", (q) => q.eq("residentId", ctx.resident.resident._id).eq("version", terms.version))
      .first();
    return { ...terms, acceptedAt: accepted?.acceptedAt ?? null };
  },
});

export const accept = residentMutation({
  args: { version: v.number() },
  handler: async (ctx, { version }) => {
    const terms = await currentTerms(ctx);
    if (terms.version !== version) throw appError("CONFLICT", "The terms were just updated. Please read them again.");
    const residentId = ctx.resident.resident._id;
    const existing = await ctx.db
      .query("termsAcceptances")
      .withIndex("by_resident_version", (q) => q.eq("residentId", residentId).eq("version", version))
      .first();
    if (existing !== null) return null;
    await ctx.db.insert("termsAcceptances", { residentId, version, acceptedAt: Date.now() });
    await writeAudit(ctx, {
      actorUserId: ctx.resident.userId,
      action: "terms.accepted",
      entityType: "termsAcceptances",
      entityId: String(version),
      residentId,
    });
    return null;
  },
});
