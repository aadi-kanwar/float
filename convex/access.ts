import { v } from "convex/values";
import { internalQuery, requireAdmin, requireUser } from "./lib/functions";

/**
 * Permission checks for actions (signedInAction / adminAction in
 * lib/functions.ts) and for the login provider. Internal: never callable
 * from a browser. They run with the caller's own login.
 */

export const viewerForAction = internalQuery({
  args: {},
  returns: v.object({ userId: v.id("users"), phone: v.string(), mustChangePassword: v.boolean() }),
  handler: async (ctx) => {
    const { userId, user } = await requireUser(ctx);
    return { userId, phone: user.phone ?? "", mustChangePassword: user.mustChangePassword === true };
  },
});

export const adminForAction = internalQuery({
  args: {},
  returns: v.object({ userId: v.id("users") }),
  handler: async (ctx) => {
    const { userId } = await requireAdmin(ctx);
    return { userId };
  },
});

/** Only set-up, enabled accounts may sign in (a resident also needs an active residents row). */
export const canSignIn = internalQuery({
  args: { userId: v.id("users") },
  returns: v.boolean(),
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    if (user === null || user.role === undefined || user.disabled === true) return false;
    if (user.role === "admin") return true;
    const resident = await ctx.db
      .query("residents")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    return resident !== null && resident.status === "active";
  },
});
