/**
 * The ONLY place in the backend allowed to use Convex's raw `query`,
 * `mutation`, `action` and internal builders. Every other file builds its
 * functions from the wrappers here, so no function can skip the permission
 * checks. (Enforced by ESLint and by convex/tests/enforcement.test.ts.)
 *
 * Wrappers that browsers can call:
 *   viewerQuery                - signed in or not; ctx.viewer is null when signed out
 *   signedInAction             - any signed-in account (password change)
 *   adminQuery/Mutation/Action - admins only (ctx.admin)
 *   residentQuery/Mutation     - residents only (ctx.resident): their OWN
 *                                residents row. Identity always comes from
 *                                the login, never from arguments, so a
 *                                resident can never reach anyone else's data.
 *
 * Everyone must have changed a temporary password first.
 *
 * Internal wrappers (never callable from a browser; only from other backend
 * functions, crons or the owner via the Convex dashboard / CLI):
 *   internalQuery, internalMutation, internalAction
 *
 * Every mutation wrapper makes the history tables append-only: patch,
 * replace or delete on them throws.
 */
import { getAuthSessionId, getAuthUserId } from "@convex-dev/auth/server";
import { makeFunctionReference } from "convex/server";
import {
  customAction,
  customCtx,
  customMutation,
  customQuery,
} from "convex-helpers/server/customFunctions";
import { wrapDatabaseWriter } from "convex-helpers/server/rowLevelSecurity";
import type { DataModel, Doc, Id } from "../_generated/dataModel";
import {
  action as rawAction,
  httpAction as rawHttpAction,
  internalAction as rawInternalAction,
  internalMutation as rawInternalMutation,
  internalQuery as rawInternalQuery,
  mutation as rawMutation,
  query as rawQuery,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import { appError } from "./errors";

type ReadCtx = Pick<QueryCtx, "db" | "auth">;

export type SignedInViewer = { userId: Id<"users">; user: Doc<"users"> };

/**
 * The signed-in account, or null. Identity always comes from the session,
 * never from arguments. The session must still exist: a password reset or
 * change deletes other sessions, and their tokens stop working at once.
 */
export async function getViewer(ctx: ReadCtx): Promise<SignedInViewer | null> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) return null;
  const sessionId = await getAuthSessionId(ctx);
  if (sessionId === null) return null;
  const session = await ctx.db.get(sessionId);
  if (session === null) return null;
  // Livoza Hub logins last 12 hours; end every login exactly on time.
  if (session.expirationTime < Date.now()) return null;
  const user = await ctx.db.get(userId);
  if (user === null) return null;
  return { userId, user };
}

export async function requireUser(ctx: ReadCtx): Promise<SignedInViewer> {
  const viewer = await getViewer(ctx);
  if (viewer === null) throw appError("NOT_SIGNED_IN");
  if (viewer.user.disabled) throw appError("ACCOUNT_DISABLED");
  return viewer;
}

export async function requireAdmin(ctx: ReadCtx): Promise<SignedInViewer> {
  const viewer = await requireUser(ctx);
  if (viewer.user.role !== "admin") throw appError("FORBIDDEN");
  if (viewer.user.mustChangePassword) throw appError("PASSWORD_CHANGE_REQUIRED");
  return viewer;
}

export type ResidentViewer = SignedInViewer & { resident: Doc<"residents"> };

/** A resident with a residents row. Paused residents pass (they can still see and repay). */
export async function requireResident(ctx: ReadCtx): Promise<ResidentViewer> {
  const viewer = await requireUser(ctx);
  if (viewer.user.role !== "resident") throw appError("FORBIDDEN");
  if (viewer.user.mustChangePassword) throw appError("PASSWORD_CHANGE_REQUIRED");
  const resident = await ctx.db
    .query("residents")
    .withIndex("by_userId", (q) => q.eq("userId", viewer.userId))
    .unique();
  if (resident === null || resident.status !== "active") throw appError("FORBIDDEN");
  return { ...viewer, resident };
}

// ---------------------------------------------------------------------------
// Append-only tables: history is never edited or deleted.
// ---------------------------------------------------------------------------

const APPEND_ONLY_TABLES = ["auditLog", "settingsVersions", "ledgerEntries", "termsVersions", "termsAcceptances", "pointsLedger"] as const;

const appendOnlyRules = Object.fromEntries(
  APPEND_ONLY_TABLES.map((table) => [table, { modify: async () => false }]),
);

/** Exported for tests; every mutation wrapper below uses it. */
export function guardedDb(ctx: MutationCtx): MutationCtx["db"] {
  return wrapDatabaseWriter<MutationCtx, DataModel>(ctx, ctx.db, appendOnlyRules);
}

// ---------------------------------------------------------------------------
// Public wrappers (callable from the browser).
// ---------------------------------------------------------------------------

export const viewerQuery = customQuery(
  rawQuery,
  customCtx(async (ctx) => ({ viewer: await getViewer(ctx) })),
);

export const adminQuery = customQuery(
  rawQuery,
  customCtx(async (ctx) => ({ admin: await requireAdmin(ctx) })),
);

export const adminMutation = customMutation(
  rawMutation,
  customCtx(async (ctx) => ({ admin: await requireAdmin(ctx), db: guardedDb(ctx) })),
);

export const residentQuery = customQuery(
  rawQuery,
  customCtx(async (ctx) => ({ resident: await requireResident(ctx) })),
);

export const residentMutation = customMutation(
  rawMutation,
  customCtx(async (ctx) => ({ resident: await requireResident(ctx), db: guardedDb(ctx) })),
);

// Actions have no database access, so they check the caller through these
// internal queries (convex/access.ts), which run the same helpers as above.

export type ActionViewer = {
  userId: Id<"users">;
  phone: string;
  mustChangePassword: boolean;
};
export type ActionAdmin = { userId: Id<"users"> };

const viewerForAction = makeFunctionReference<"query", Record<string, never>, ActionViewer>(
  "access:viewerForAction",
);
const adminForAction = makeFunctionReference<"query", Record<string, never>, ActionAdmin>(
  "access:adminForAction",
);

export const signedInAction = customAction(
  rawAction,
  customCtx(async (ctx) => ({ viewer: await ctx.runQuery(viewerForAction, {}) })),
);

export const adminAction = customAction(
  rawAction,
  customCtx(async (ctx) => ({ admin: await ctx.runQuery(adminForAction, {}) })),
);

// ---------------------------------------------------------------------------
// Internal wrappers (never callable from the browser).
// ---------------------------------------------------------------------------

export const internalQuery = rawInternalQuery;

export const internalMutation = customMutation(
  rawInternalMutation,
  customCtx(async (ctx) => ({ db: guardedDb(ctx) })),
);

export const internalAction = rawInternalAction;

/**
 * Web endpoints (convex/http.ts). They have no login, so each one must check
 * who is calling before doing anything: they accept only requests signed by
 * the Livoza Hub.
 */
export const hubSignedHttpAction = rawHttpAction;
