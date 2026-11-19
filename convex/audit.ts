/** Admin: the audit log (who did what, when, old → new). Read-only. */
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { adminQuery } from "./lib/functions";

async function describe(ctx: Pick<QueryCtx, "db">, rows: Doc<"auditLog">[]) {
  const names = new Map<string, string>();
  const nameOf = async (id: string | undefined, load: () => Promise<{ name?: string } | null>) => {
    if (!id) return null;
    if (!names.has(id)) names.set(id, (await load())?.name ?? "Unknown");
    return names.get(id)!;
  };
  const out = [];
  for (const r of rows) {
    out.push({
      auditId: r._id,
      action: r.action,
      actorName: await nameOf(r.actorUserId, () => ctx.db.get(r.actorUserId!)),
      residentId: r.residentId ?? null,
      residentName: await nameOf(r.residentId, () => ctx.db.get(r.residentId!)),
      entityType: r.entityType,
      reason: r.reason ?? null,
      metadata: (r.metadata ?? null) as Record<string, unknown> | null,
      createdAt: r.createdAt,
    });
  }
  return out;
}

/** Newest first, page by page; optionally one resident or one kind of action. */
export const list = adminQuery({
  args: {
    paginationOpts: paginationOptsValidator,
    residentId: v.optional(v.id("residents")),
    action: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const base = args.residentId
      ? ctx.db.query("auditLog").withIndex("by_resident_createdAt", (q) => q.eq("residentId", args.residentId))
      : args.action
        ? ctx.db.query("auditLog").withIndex("by_action_createdAt", (q) => q.eq("action", args.action!))
        : ctx.db.query("auditLog").withIndex("by_createdAt");
    const result = await base.order("desc").paginate(args.paginationOpts);
    return { ...result, page: await describe(ctx, result.page) };
  },
});
