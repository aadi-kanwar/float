/**
 * Admin: the single Settings record. Every save makes a new version (kept
 * for ever) and an audit row with the old and new values. Changes apply to
 * future events only: past rows keep the amounts they were made with.
 */
import { v } from "convex/values";
import { writeAudit } from "./lib/audit";
import { appError } from "./lib/errors";
import { adminMutation, adminQuery, viewerQuery } from "./lib/functions";
import { DEFAULT_SETTINGS, currentSettings, settingsProblem, settingsRow } from "./lib/settings";
import { vSettingsValues } from "./lib/validators";

export const get = adminQuery({
  args: {},
  handler: async (ctx) => {
    const current = await currentSettings(ctx);
    const { version, ...values } = current;
    return { version, values, defaults: DEFAULT_SETTINGS };
  },
});

/** Older versions, newest first. */
export const history = adminQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("settingsVersions").withIndex("by_version").order("desc").take(50);
    return rows.map((r) => ({ version: r.version, values: r.values, changedAt: r.changedAt, reason: r.reason ?? null }));
  },
});

/** What residents may know: the points name. */
export const publicInfo = viewerQuery({
  args: {},
  handler: async (ctx) => {
    if (ctx.viewer === null) return null;
    const s = await currentSettings(ctx);
    return { pointsName: s.pointsName };
  },
});

export const save = adminMutation({
  args: { values: vSettingsValues, expectedVersion: v.number(), reason: v.optional(v.string()) },
  handler: async (ctx, { values, expectedVersion, reason }) => {
    const clean = { ...values, pointsName: values.pointsName.trim() };
    const problem = settingsProblem(clean);
    if (problem !== null) throw appError("INVALID_INPUT", problem);
    const row = await settingsRow(ctx);
    const current = await currentSettings(ctx);
    if (current.version !== expectedVersion)
      throw appError("CONFLICT", "Someone else saved Settings a moment ago. Reload and try again.");
    const before: Omit<typeof current, "version"> = { ...current };
    delete (before as { version?: number }).version;
    const changed = (Object.keys(clean) as (keyof typeof clean)[]).filter(
      (k) => JSON.stringify(before[k]) !== JSON.stringify(clean[k]),
    );
    if (changed.length === 0) return { version: current.version };
    const version = current.version + 1;
    const now = Date.now();
    const note = reason?.trim() || undefined;
    if (row === null) {
      await ctx.db.insert("settings", { key: "current", version, values: clean, updatedAt: now, updatedBy: ctx.admin.userId });
    } else {
      await ctx.db.patch(row._id, { version, values: clean, updatedAt: now, updatedBy: ctx.admin.userId });
    }
    await ctx.db.insert("settingsVersions", { version, values: clean, changedBy: ctx.admin.userId, changedAt: now, reason: note });
    await writeAudit(ctx, {
      actorUserId: ctx.admin.userId,
      action: "settings.changed",
      entityType: "settings",
      entityId: String(version),
      reason: note,
      metadata: {
        before: Object.fromEntries(changed.map((k) => [k, before[k]])),
        after: Object.fromEntries(changed.map((k) => [k, clean[k]])),
      },
    });
    return { version };
  },
});
