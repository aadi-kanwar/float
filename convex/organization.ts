/**
 * Admin: the organisation and its properties, as in Dine, Staff and Crate.
 * Float runs ONE organisation. The first admin names it with its first
 * property (unless the Livoza Hub's sync already created it); properties are
 * then added and renamed in Settings. Residents belong to one property.
 */
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { writeAudit } from "./lib/audit";
import { appError } from "./lib/errors";
import { adminMutation, adminQuery } from "./lib/functions";
import { activeProperties, checkName, findOrganization, MAX_PROPERTIES } from "./lib/org";

async function insertProperty(ctx: Pick<MutationCtx, "db">, organization: Doc<"organizations">, rawName: string, actorUserId: Doc<"users">["_id"]) {
  const name = checkName(rawName, "The property name");
  const existing = await activeProperties(ctx);
  if (existing.length >= MAX_PROPERTIES) throw appError("INVALID_INPUT", `An organisation can have at most ${MAX_PROPERTIES} properties.`);
  if (existing.some((p) => p.name.toLowerCase() === name.toLowerCase())) throw appError("CONFLICT", "There's already a property with that name.");
  const propertyId = await ctx.db.insert("properties", { organizationId: organization._id, name, status: "active", createdAt: Date.now() });
  await writeAudit(ctx, { actorUserId, action: "property.added", entityType: "properties", entityId: propertyId, metadata: { name } });
  return propertyId;
}

async function requireOrganization(ctx: Pick<MutationCtx, "db">) {
  const organization = await findOrganization(ctx);
  if (organization === null) throw appError("INVALID_INPUT", "Set up your organisation first.");
  return organization;
}

/** Creates THE organisation with its first property. Works once. */
export const create = adminMutation({
  args: { name: v.string(), propertyName: v.string() },
  handler: async (ctx, args) => {
    if ((await findOrganization(ctx)) !== null) throw appError("CONFLICT", "The organisation is already set up.");
    const name = checkName(args.name, "The organisation name");
    const organizationId = await ctx.db.insert("organizations", { name, status: "active", createdBy: ctx.admin.userId, createdAt: Date.now() });
    await writeAudit(ctx, { actorUserId: ctx.admin.userId, action: "organization.created", entityType: "organizations", entityId: organizationId, metadata: { name } });
    const organization = (await ctx.db.get(organizationId))!;
    // Properties made before the organisation existed join it.
    for (const p of await ctx.db.query("properties").collect()) if (p.organizationId === undefined) await ctx.db.patch(p._id, { organizationId });
    const propertyId = await insertProperty(ctx, organization, args.propertyName, ctx.admin.userId);
    return { organizationId, propertyId };
  },
});

/** The organisation and its properties, with how many current residents each has. */
export const get = adminQuery({
  args: {},
  handler: async (ctx) => {
    const organization = await findOrganization(ctx);
    if (organization === null) return null;
    const residents = await ctx.db.query("residents").withIndex("by_status_name", (q) => q.eq("status", "active")).collect();
    return {
      name: organization.name,
      properties: (await activeProperties(ctx)).map((p) => ({
        propertyId: p._id,
        name: p.name,
        fromHub: p.hubPropertyId !== undefined,
        residents: residents.filter((r) => r.propertyId === p._id).length,
      })),
      unassignedResidents: residents.filter((r) => r.propertyId === undefined).length,
    };
  },
});

export const rename = adminMutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const organization = await requireOrganization(ctx);
    const name = checkName(args.name, "The organisation name");
    if (name === organization.name) return null;
    await ctx.db.patch(organization._id, { name });
    await writeAudit(ctx, { actorUserId: ctx.admin.userId, action: "organization.renamed", entityType: "organizations", entityId: organization._id, metadata: { before: organization.name, after: name } });
    return null;
  },
});

export const addProperty = adminMutation({
  args: { name: v.string() },
  handler: async (ctx, args) => await insertProperty(ctx, await requireOrganization(ctx), args.name, ctx.admin.userId),
});

export const renameProperty = adminMutation({
  args: { targetPropertyId: v.id("properties"), name: v.string() },
  handler: async (ctx, args) => {
    const property = await ctx.db.get(args.targetPropertyId);
    if (property === null || property.status !== "active") throw appError("NOT_FOUND", "That property wasn't found.");
    const name = checkName(args.name, "The property name");
    if (name === property.name) return null;
    if ((await activeProperties(ctx)).some((p) => p._id !== property._id && p.name.toLowerCase() === name.toLowerCase()))
      throw appError("CONFLICT", "There's already a property with that name.");
    await ctx.db.patch(property._id, { name });
    await writeAudit(ctx, { actorUserId: ctx.admin.userId, action: "property.renamed", entityType: "properties", entityId: property._id, metadata: { before: property.name, after: name } });
    return null;
  },
});
