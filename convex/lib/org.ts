import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { appError } from "./errors";

type Db = Pick<QueryCtx, "db">;

export const MAX_NAME_LENGTH = 60;
export const MAX_PROPERTIES = 50;

/** A tidy organisation or property name (spaces collapsed), or INVALID_INPUT. */
export function checkName(raw: string, what: string): string {
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length < 2) throw appError("INVALID_INPUT", `${what} needs at least 2 characters.`);
  if (name.length > MAX_NAME_LENGTH) throw appError("INVALID_INPUT", `${what} can be at most ${MAX_NAME_LENGTH} characters.`);
  return name;
}

/** Float's organisation (the oldest active one), or null before it is set up. */
export async function findOrganization(ctx: Db): Promise<Doc<"organizations"> | null> {
  return await ctx.db
    .query("organizations")
    .filter((q) => q.eq(q.field("status"), "active"))
    .order("asc")
    .first();
}

/** The organisation, made if there's none yet (the hub's sync names it). */
export async function theOrganization(ctx: Pick<MutationCtx, "db">, name = "Livoza"): Promise<Doc<"organizations">> {
  const existing = await findOrganization(ctx);
  if (existing !== null) return existing;
  const id = await ctx.db.insert("organizations", { name, status: "active", createdAt: Date.now() });
  return (await ctx.db.get(id))!;
}

/** Active properties, by name. */
export async function activeProperties(ctx: Db): Promise<Doc<"properties">[]> {
  return (await ctx.db.query("properties").withIndex("by_status", (q) => q.eq("status", "active")).collect()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

/**
 * Which residents an admin screen covers: everyone (null) or the residents
 * of one property. Checks the property exists.
 */
export async function residentsInScope(ctx: Db, propertyId: Id<"properties"> | undefined): Promise<Set<string> | null> {
  if (propertyId === undefined) return null;
  const property = await ctx.db.get(propertyId);
  if (property === null) throw appError("NOT_FOUND", "That property wasn't found.");
  const rows = await ctx.db
    .query("residents")
    .withIndex("by_property_status", (q) => q.eq("propertyId", propertyId))
    .collect();
  return new Set(rows.map((r) => r._id as string));
}

export const inScope = (scope: Set<string> | null, residentId: string) => scope === null || scope.has(residentId);
