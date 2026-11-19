import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { vRole, vSettingsValues } from "./lib/validators";

/**
 * Float: deposit-backed pocket money for PG residents, with points and a
 * perk store.
 *
 * Two roles only: admin and resident. Money is integer paise. Times are
 * milliseconds; every date rule uses Asia/Kolkata.
 *
 * Balances and amounts owed are never stored as one editable number: they
 * are always worked out from the ledgers. History is never edited or
 * deleted; corrections are new, reversing rows.
 *
 * Convex has no unique constraints: every "one per X" rule is enforced in
 * the mutation that inserts the row.
 */
export default defineSchema({
  ...authTables,

  // Livoza Hub sign-in tickets and requests already used (by their one-time
  // `jti`), so none can be used twice. Rows older than 10 minutes are deleted.
  ssoUsedTickets: defineTable({
    jti: v.string(), // unique
    usedAt: v.number(),
  })
    .index("by_jti", ["jti"])
    .index("by_usedAt", ["usedAt"]),

  /** The PGs. Added here or by the Livoza Hub's sync (which links them by id). */
  properties: defineTable({
    name: v.string(), // unique (case-insensitive)
    status: v.union(v.literal("active"), v.literal("archived")),
    createdAt: v.number(),
    hubPropertyId: v.optional(v.string()),
  })
    .index("by_status", ["status"])
    .index("by_hubPropertyId", ["hubPropertyId"]),

  // Convex Auth's users table, plus the account's role.
  users: defineTable({
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()), // E.164: the login identifier
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    /** Absent until the account is set up (by an admin, the seed, or the hub). */
    role: v.optional(vRole),
    /** Set when an admin created the account or reset its password. */
    mustChangePassword: v.optional(v.boolean()),
    /** Switched off (e.g. by the Livoza Hub): can't sign in. History is kept. */
    disabled: v.optional(v.boolean()),
    /** True once the person has signed in or been synced through the Livoza Hub. */
    ssoManaged: v.optional(v.boolean()),
    /** The person's id in the Livoza Hub. */
    hubUserId: v.optional(v.string()),
  })
    .index("email", ["email"])
    .index("phone", ["phone"])
    .index("by_hubUserId", ["hubUserId"])
    .index("by_role", ["role"]),

  /** One per resident account: their PG details, deposit and limit. */
  residents: defineTable({
    userId: v.id("users"), // unique
    name: v.string(), // kept in step with users.name
    phone: v.string(), // E.164, kept in step with users.phone
    propertyId: v.optional(v.id("properties")),
    roomNumber: v.optional(v.string()),
    /** The security deposit recorded for them (deposit adjustments are ledger rows). */
    depositPaise: v.number(),
    /** Their own credit limit, set by an admin; absent = the default from Settings. */
    limitPaise: v.optional(v.number()),
    /** Paused: no new draws or redemptions; they can still see and repay. */
    paused: v.boolean(),
    status: v.union(v.literal("active"), v.literal("left")),
    createdAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_phone", ["phone"])
    .index("by_status_name", ["status", "name"])
    .index("by_property_status", ["propertyId", "status"]),

  /**
   * The single Settings record (key "current"). Every change also adds a
   * row to settingsVersions, which is never edited.
   */
  settings: defineTable({
    key: v.literal("current"),
    version: v.number(),
    values: vSettingsValues,
    updatedAt: v.number(),
    updatedBy: v.optional(v.id("users")),
  }).index("by_key", ["key"]),

  settingsVersions: defineTable({
    version: v.number(),
    values: vSettingsValues,
    changedBy: v.optional(v.id("users")),
    changedAt: v.number(),
    reason: v.optional(v.string()),
  }).index("by_version", ["version"]),

  // Sign-in abuse protection: failed attempts per phone.
  authAttemptLimits: defineTable({
    key: v.string(),
    windowStart: v.number(),
    count: v.number(),
  }).index("by_key", ["key"]),

  // Append-only log of every change. Never store passwords or tokens here.
  auditLog: defineTable({
    actorUserId: v.optional(v.id("users")), // absent for the CLI, crons and the hub
    action: v.string(),
    entityType: v.string(),
    entityId: v.string(),
    /** The resident the change is about, if any (for their page and filters). */
    residentId: v.optional(v.id("residents")),
    reason: v.optional(v.string()),
    metadata: v.optional(v.any()), // e.g. { before, after }
    createdAt: v.number(),
  })
    .index("by_createdAt", ["createdAt"])
    .index("by_entity", ["entityType", "entityId"])
    .index("by_resident_createdAt", ["residentId", "createdAt"])
    .index("by_action_createdAt", ["action", "createdAt"]),
});
