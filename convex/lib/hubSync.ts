import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { PHONE_PASSWORD_PROVIDER } from "../auth";
import { endSessions } from "../residents";
import { writeAudit } from "./audit";
import { theOrganization } from "./org";
import type { HubPerson, HubPropertyRef } from "./ssoTicket";

/**
 * Livoza Hub: the hub owns people, their profile types and PGs. This file
 * makes Float match what the hub says ("make it so") for a sign-in ticket
 * or a sync. Running it twice changes nothing more.
 *
 * Roles the hub gives Float (its tools.config.ts): admin for Admins,
 * resident for Residents, nothing for Warden/Manager and Staff.
 *
 * Safety rules:
 * - An admin from the hub NEVER changes a resident account here, and a
 *   resident from the hub never changes an admin account. If the same
 *   number is one kind here and the other kind in the hub, nothing is
 *   changed and the sign-in is refused; the admin sorts it out by hand.
 * - Switched off in the hub (or no Float role any more): the account is
 *   switched off and signed out. Its money history and anything owed stay.
 * - Limit and pause are Float's own; the hub never sets them.
 */

type Db = Pick<MutationCtx, "db">;

export type FloatRole = "admin" | "resident";
const asFloatRole = (role: string | null): FloatRole | null => (role === "admin" || role === "resident" ? role : null);

/** The PG for a hub property: linked, or an unlinked one with the same name, or a new one. */
export async function ensureHubProperty(ctx: Db, ref: HubPropertyRef, organizationName?: string): Promise<Doc<"properties">> {
  const organization = await theOrganization(ctx, organizationName || undefined);
  let property = await ctx.db
    .query("properties")
    .withIndex("by_hubPropertyId", (q) => q.eq("hubPropertyId", ref.id))
    .first();
  const all = await ctx.db.query("properties").collect();
  if (property === null)
    property = all.find((p) => p.hubPropertyId === undefined && p.name.trim().toLowerCase() === ref.name.trim().toLowerCase()) ?? null;
  if (property === null) {
    const id = await ctx.db.insert("properties", { organizationId: organization._id, name: ref.name || "PG", status: "active", createdAt: Date.now(), hubPropertyId: ref.id });
    await writeAudit(ctx, { actorUserId: undefined, action: "hub.property_linked", entityType: "properties", entityId: id, metadata: { hubPropertyId: ref.id, created: true } });
    return (await ctx.db.get(id))!;
  }
  const patch: Partial<Doc<"properties">> = {};
  if (property.hubPropertyId !== ref.id) patch.hubPropertyId = ref.id;
  if (ref.name && property.name !== ref.name && !all.some((p) => p._id !== property!._id && p.name.toLowerCase() === ref.name.toLowerCase())) patch.name = ref.name;
  if (property.status !== "active") patch.status = "active";
  if (property.organizationId === undefined) patch.organizationId = organization._id;
  if (Object.keys(patch).length > 0) {
    await ctx.db.patch(property._id, patch);
    if (patch.hubPropertyId)
      await writeAudit(ctx, { actorUserId: undefined, action: "hub.property_linked", entityType: "properties", entityId: property._id, metadata: { hubPropertyId: ref.id } });
  }
  return (await ctx.db.get(property._id))!;
}

async function findUser(ctx: Db, person: Pick<HubPerson, "hubUserId" | "phone">): Promise<Doc<"users"> | null> {
  const byHub = await ctx.db
    .query("users")
    .withIndex("by_hubUserId", (q) => q.eq("hubUserId", person.hubUserId))
    .first();
  if (byHub !== null) return byHub;
  return await ctx.db
    .query("users")
    .withIndex("phone", (q) => q.eq("phone", person.phone))
    .first();
}

export type ApplyResult = { userId: Id<"users"> | null; refused: boolean };

/**
 * Makes Float match the hub for one person. Returns their account (null
 * when they have no account and no access here), or `refused` when the
 * safety rule above stopped it.
 */
export async function applyHubPerson(ctx: Db, person: HubPerson, options: { active: boolean; revoke: boolean }): Promise<ApplyResult> {
  const role = options.active ? asFloatRole(person.role) : null;
  let user = await findUser(ctx, person);
  if (user === null && role === null) return { userId: null, refused: false };

  if (user !== null && role !== null && user.role !== undefined && user.role !== role) {
    await writeAudit(ctx, {
      actorUserId: undefined,
      action: "hub.role_conflict",
      entityType: "users",
      entityId: user._id,
      metadata: { hubUserId: person.hubUserId, floatRole: user.role, hubRole: role },
    });
    return { userId: user._id, refused: true };
  }

  if (user === null) {
    const id = await ctx.db.insert("users", { phone: person.phone, name: person.name });
    user = (await ctx.db.get(id))!;
  }
  const userId = user._id;

  if (role === null) {
    await ctx.db.patch(userId, { disabled: true, hubUserId: person.hubUserId, ssoManaged: true });
    const ended = await endSessions(ctx, userId);
    await writeAudit(ctx, { actorUserId: undefined, action: "hub.person_synced", entityType: "users", entityId: userId, metadata: { hubUserId: person.hubUserId, role: null, sessionsEnded: ended } });
    return { userId, refused: false };
  }

  await ctx.db.patch(userId, {
    hubUserId: person.hubUserId,
    ssoManaged: true,
    name: person.name,
    role,
    disabled: undefined,
    mustChangePassword: undefined,
  });

  let residentId: Id<"residents"> | undefined;
  if (role === "resident") {
    const ref = person.properties === "all" ? undefined : person.properties[0];
    const property = ref ? await ensureHubProperty(ctx, ref) : null;
    const existing = await ctx.db
      .query("residents")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    const details = { name: person.name, phone: person.phone, roomNumber: person.roomNumber ?? undefined, propertyId: property?._id };
    if (existing === null) {
      residentId = await ctx.db.insert("residents", { userId, ...details, paused: false, status: "active", createdAt: Date.now() });
      await writeAudit(ctx, { actorUserId: undefined, action: "resident.created", entityType: "residents", entityId: residentId, residentId, metadata: { after: { ...details, fromHub: true } } });
    } else {
      residentId = existing._id;
      const before = { name: existing.name, phone: existing.phone, roomNumber: existing.roomNumber, propertyId: existing.propertyId };
      if (JSON.stringify(before) !== JSON.stringify(details) || existing.status !== "active") {
        await ctx.db.patch(existing._id, { ...details, status: "active" });
        await writeAudit(ctx, { actorUserId: undefined, action: "resident.updated", entityType: "residents", entityId: existing._id, residentId, metadata: { before, after: details, fromHub: true } });
      }
    }
  } else {
    for (const ref of person.properties === "all" ? [] : person.properties) await ensureHubProperty(ctx, ref);
  }

  let sessionsEnded = 0;
  if (options.revoke) sessionsEnded = await endSessions(ctx, userId);
  await writeAudit(ctx, {
    actorUserId: undefined,
    action: "hub.person_synced",
    entityType: "users",
    entityId: userId,
    residentId,
    metadata: { hubUserId: person.hubUserId, role, sessionsEnded },
  });
  return { userId, refused: false };
}

/**
 * Everyone and every PG, for the hub's one-time import. Password hashes go
 * only to the hub (which uses the same hashing).
 */
export async function exportForHub(ctx: Pick<QueryCtx, "db">) {
  const properties = (await ctx.db.query("properties").collect())
    .filter((p) => p.status === "active")
    .map((p) => ({ toolPropertyId: p._id as string, name: p.name, hubPropertyId: p.hubPropertyId ?? null }));
  const people = [];
  for (const user of await ctx.db.query("users").collect()) {
    if (!user.phone || user.disabled === true || user.role === undefined) continue;
    const resident =
      user.role === "resident"
        ? await ctx.db
            .query("residents")
            .withIndex("by_userId", (q) => q.eq("userId", user._id))
            .unique()
        : null;
    if (user.role === "resident" && (resident === null || resident.status !== "active")) continue;
    const account = await ctx.db
      .query("authAccounts")
      .withIndex("providerAndAccountId", (q) => q.eq("provider", PHONE_PASSWORD_PROVIDER).eq("providerAccountId", user.phone!))
      .first();
    people.push({
      phone: user.phone,
      name: user.name ?? "",
      hubType: user.role,
      toolPropertyIds: resident?.propertyId ? [resident.propertyId as string] : [],
      active: true,
      passwordHash: account?.secret ?? null,
      roomNumber: resident?.roomNumber ?? null,
    });
  }
  return { properties, people };
}
