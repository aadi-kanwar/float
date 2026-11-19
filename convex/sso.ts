/**
 * Livoza Hub single sign-on, once the hub's signature has been checked
 * (convex/lib/ssoTicket.ts, the `hub-sso` provider in convex/auth.ts and the
 * web endpoints in convex/http.ts). The same pattern as Crate, Staff and
 * Dine. See convex/lib/hubSync.ts for what changes here.
 */
import { v } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import { writeAudit } from "./lib/audit";
import { internalMutation, viewerQuery } from "./lib/functions";
import { applyHubPerson, ensureHubProperty, exportForHub } from "./lib/hubSync";
import { SSO_SESSION_MS, SSO_USED_TICKET_RETENTION_MS } from "./lib/ssoTicket";

/** One use per ticket or request: false if this `jti` was seen before (and records it otherwise). */
async function spendJti(ctx: Pick<MutationCtx, "db">, jti: string, now: number): Promise<boolean> {
  const used = await ctx.db
    .query("ssoUsedTickets")
    .withIndex("by_jti", (q) => q.eq("jti", jti))
    .first();
  if (used !== null) return false;
  await ctx.db.insert("ssoUsedTickets", { jti, usedAt: now });
  return true;
}

const vHubPerson = {
  hubUserId: v.string(),
  phone: v.string(),
  name: v.string(),
  profileType: v.union(v.literal("admin"), v.literal("warden"), v.literal("staff"), v.literal("resident")),
  role: v.union(v.string(), v.null()),
  properties: v.union(v.literal("all"), v.array(v.object({ id: v.string(), name: v.string() }))),
  roomNumber: v.union(v.string(), v.null()),
};

/**
 * A sign-in ticket: Float is made to match the hub, then a 12-hour login
 * opens. Spent first, so even a refused ticket can't be used again.
 */
export const acceptPersonTicket = internalMutation({
  args: { jti: v.string(), ...vHubPerson },
  returns: v.union(v.null(), v.object({ userId: v.id("users"), sessionId: v.id("authSessions") })),
  handler: async (ctx, { jti, ...person }) => {
    const now = Date.now();
    if (!(await spendJti(ctx, jti, now))) return null;
    const { userId, refused } = await applyHubPerson(ctx, person, { active: true, revoke: false });
    if (userId === null || refused) return null;
    const user = await ctx.db.get(userId);
    if (user === null || user.disabled === true || user.role === undefined) return null;
    const sessionId = await ctx.db.insert("authSessions", { userId, expirationTime: now + SSO_SESSION_MS });
    await writeAudit(ctx, {
      actorUserId: userId,
      action: "sso.signed_in",
      entityType: "users",
      entityId: userId,
      metadata: { hubUserId: person.hubUserId, role: person.role },
    });
    return { userId, sessionId };
  },
});

/** A change from the hub's sync (a person or a PG). False if the request was already used. */
export const applySync = internalMutation({
  args: {
    jti: v.string(),
    person: v.optional(v.object({ ...vHubPerson, active: v.boolean(), revoke: v.boolean() })),
    property: v.optional(v.object({ id: v.string(), name: v.string() })),
  },
  returns: v.boolean(),
  handler: async (ctx, { jti, person, property }) => {
    if (!(await spendJti(ctx, jti, Date.now()))) return false;
    if (person) {
      const { active, revoke, ...rest } = person;
      await applyHubPerson(ctx, rest, { active, revoke });
    }
    if (property) await ensureHubProperty(ctx, property);
    return true;
  },
});

/** Everyone and every PG, for the hub's import. Null if the request was already used. */
export const exportForImport = internalMutation({
  args: { jti: v.string() },
  handler: async (ctx, { jti }) => {
    if (!(await spendJti(ctx, jti, Date.now()))) return null;
    return await exportForHub(ctx);
  },
});

/** Scheduled: forgets used tickets older than 10 minutes (they expired long before). */
export const deleteOldTickets = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const cutoff = Date.now() - SSO_USED_TICKET_RETENTION_MS;
    for (const row of await ctx.db.query("ssoUsedTickets").withIndex("by_usedAt", (q) => q.lt("usedAt", cutoff)).take(500))
      await ctx.db.delete(row._id);
    return null;
  },
});

/** The hub's address, for the "open it again from the Livoza Hub" button. Not secret. */
export const hubOrigin = viewerQuery({
  args: {},
  returns: v.union(v.string(), v.null()),
  handler: async () => process.env.HUB_ORIGIN ?? null,
});

/**
 * Whether Float's own sign-in is switched off (HUB_ONLY=true, once everyone
 * uses the Livoza Hub), and where to send people instead.
 */
export const hubSettings = viewerQuery({
  args: {},
  returns: v.object({ hubOnly: v.boolean(), openUrl: v.union(v.string(), v.null()) }),
  handler: async () => {
    const origin = process.env.HUB_ORIGIN ?? null;
    return { hubOnly: process.env.HUB_ONLY === "true" && origin !== null, openUrl: origin ? `${origin}/open/float` : null };
  },
});
