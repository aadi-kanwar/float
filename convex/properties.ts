/**
 * Admin: the PGs. Normally they arrive from the Livoza Hub's sync; an admin
 * can also add or rename one here (the hub links it by name later).
 */
import { v } from "convex/values";
import { writeAudit } from "./lib/audit";
import { appError } from "./lib/errors";
import { adminMutation, adminQuery } from "./lib/functions";

function cleanName(name: string): string {
  const text = name.trim();
  if (text.length < 2 || text.length > 80) throw appError("INVALID_INPUT", "Use 2 to 80 characters.");
  return text;
}

export const list = adminQuery({
  args: {},
  handler: async (ctx) =>
    (await ctx.db.query("properties").withIndex("by_status", (q) => q.eq("status", "active")).collect())
      .map((p) => ({ propertyId: p._id, name: p.name, fromHub: p.hubPropertyId !== undefined }))
      .sort((a, b) => a.name.localeCompare(b.name)),
});

export const add = adminMutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const name = cleanName(args.name);
    const all = await ctx.db.query("properties").collect();
    if (all.some((p) => p.name.toLowerCase() === name.toLowerCase()))
      throw appError("CONFLICT", "A PG with that name already exists.");
    const id = await ctx.db.insert("properties", { name, status: "active", createdAt: Date.now() });
    await writeAudit(ctx, {
      actorUserId: ctx.admin.userId,
      action: "property.added",
      entityType: "properties",
      entityId: id,
      metadata: { after: { name } },
    });
    return id;
  },
});

export const rename = adminMutation({
  args: { propertyId: v.id("properties"), name: v.string() },
  handler: async (ctx, args) => {
    const property = await ctx.db.get(args.propertyId);
    if (property === null) throw appError("NOT_FOUND");
    const name = cleanName(args.name);
    if (name === property.name) return null;
    const all = await ctx.db.query("properties").collect();
    if (all.some((p) => p._id !== property._id && p.name.toLowerCase() === name.toLowerCase()))
      throw appError("CONFLICT", "A PG with that name already exists.");
    await ctx.db.patch(property._id, { name });
    await writeAudit(ctx, {
      actorUserId: ctx.admin.userId,
      action: "property.renamed",
      entityType: "properties",
      entityId: property._id,
      metadata: { before: { name: property.name }, after: { name } },
    });
    return null;
  },
});
