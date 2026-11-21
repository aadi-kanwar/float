import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  vDrawStatus,
  vPaymentMode,
  vLedgerType,
  vPerkField,
  vPerkLimit,
  vPerkVisibility,
  vPointsEntryType,
  vPointsRuleType,
  vRedemptionStatus,
  vRole,
  vSettingsValues,
} from "./lib/validators";

/**
 * Float: pocket money for PG residents, with points and a
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

  /**
   * Organisation → properties, as in Dine, Staff and Crate. Float runs ONE
   * organisation: the first admin names it with its first property, or the
   * Livoza Hub's sync creates it (with the hub's organisation name).
   */
  organizations: defineTable({
    name: v.string(),
    status: v.union(v.literal("active"), v.literal("archived")),
    createdBy: v.optional(v.id("users")),
    createdAt: v.number(),
  }),

  /** The PGs. Added in Settings or by the Livoza Hub's sync (which links them by id). */
  properties: defineTable({
    /** Always set for new rows (older test rows may lack it). */
    organizationId: v.optional(v.id("organizations")),
    name: v.string(), // unique within the organisation (case-insensitive)
    status: v.union(v.literal("active"), v.literal("archived")),
    createdAt: v.number(),
    hubPropertyId: v.optional(v.string()),
  })
    .index("by_status", ["status"])
    .index("by_org_status", ["organizationId", "status"])
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

  /** One per resident account: their PG details, limit and how to pay them. */
  residents: defineTable({
    userId: v.id("users"), // unique
    name: v.string(), // kept in step with users.name
    phone: v.string(), // E.164, kept in step with users.phone
    propertyId: v.optional(v.id("properties")),
    roomNumber: v.optional(v.string()),
    /** No longer used (Float has no deposits). Kept only so older rows stay valid. */
    depositPaise: v.optional(v.number()),
    /** Where the admin sends their money: a UPI ID and/or a photo of their UPI QR code. */
    upiId: v.optional(v.string()),
    upiQrId: v.optional(v.id("_storage")),
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

  // ---- Money -------------------------------------------------------------

  /**
   * Every money event, never edited or deleted (append-only). Amounts are
   * positive paise; the type says whether it is owed or paid. What anyone
   * owes is worked out from these rows (convex/lib/ledger.ts).
   */
  ledgerEntries: defineTable({
    residentId: v.id("residents"),
    type: vLedgerType,
    amountPaise: v.number(),
    /** Charges and waivers: the month ("YYYY-MM") whose statement they belong to. */
    cycleMonth: v.optional(v.string()),
    /** Waivers: the part they waive. */
    bucket: v.optional(v.union(v.literal("fee"), v.literal("lateFee"))),
    /** Late fees: the India date they are for (one per statement per day). */
    forDate: v.optional(v.string()),
    /** Reversals: the row they cancel (each row can be reversed once). */
    reversesEntryId: v.optional(v.id("ledgerEntries")),
    drawRequestId: v.optional(v.id("drawRequests")),
    repaymentClaimId: v.optional(v.id("repaymentClaims")),
    /** When it counts (for repayments: when the resident said they paid). */
    effectiveAt: v.number(),
    createdAt: v.number(),
    createdBy: v.optional(v.id("users")), // absent for scheduled jobs
    note: v.optional(v.string()),
  })
    .index("by_resident_effectiveAt", ["residentId", "effectiveAt"])
    .index("by_type_createdAt", ["type", "createdAt"])
    .index("by_reverses", ["reversesEntryId"])
    .index("by_lateFee_day", ["residentId", "cycleMonth", "forDate"])
    .index("by_createdAt", ["createdAt"]),

  /** A resident asks to draw money. Counts against their limit from the moment it's asked. */
  drawRequests: defineTable({
    residentId: v.id("residents"),
    amountPaise: v.number(),
    /** The fee worked out with the settings when it was asked (kept as is). */
    feePaise: v.number(),
    status: vDrawStatus,
    requestedAt: v.number(),
    decidedAt: v.optional(v.number()),
    decidedBy: v.optional(v.id("users")),
    disbursedAt: v.optional(v.number()),
    disbursedBy: v.optional(v.id("users")),
    /** How the admin sent it. */
    paymentMode: v.optional(vPaymentMode),
    /** UTR / reference number (optional). */
    upiRef: v.optional(v.string()),
    note: v.optional(v.string()),
    termsVersion: v.number(),
  })
    .index("by_status_requestedAt", ["status", "requestedAt"])
    .index("by_resident_requestedAt", ["residentId", "requestedAt"]),

  /** "I've paid": counts only once an admin confirms it. */
  repaymentClaims: defineTable({
    residentId: v.id("residents"),
    amountPaise: v.number(),
    upiRef: v.optional(v.string()),
    status: v.union(v.literal("pending"), v.literal("confirmed"), v.literal("rejected")),
    submittedAt: v.number(),
    decidedAt: v.optional(v.number()),
    decidedBy: v.optional(v.id("users")),
    note: v.optional(v.string()),
  })
    .index("by_status_submittedAt", ["status", "submittedAt"])
    .index("by_resident_submittedAt", ["residentId", "submittedAt"]),

  /**
   * One per resident per month: the figures as they were when it was made
   * (never changed afterwards). Whether it's paid is worked out live.
   */
  statements: defineTable({
    residentId: v.id("residents"),
    month: v.string(), // "YYYY-MM"
    generatedAt: v.number(),
    dueDate: v.string(), // "YYYY-MM-DD"
    dueAt: v.number(), // the end of dueDate, India time
    drawnPaise: v.number(),
    feesPaise: v.number(),
    paidThisMonthPaise: v.number(),
    carriedOverPaise: v.number(),
    lateFeesPaise: v.number(),
    totalDuePaise: v.number(),
  })
    .index("by_resident_month", ["residentId", "month"])
    .index("by_month", ["month"]),

  termsVersions: defineTable({
    version: v.number(), // 1, 2, …
    text: v.string(),
    createdAt: v.number(),
    createdBy: v.id("users"),
  }).index("by_version", ["version"]),

  termsAcceptances: defineTable({
    residentId: v.id("residents"),
    version: v.number(),
    acceptedAt: v.number(),
  }).index("by_resident_version", ["residentId", "version"]),

  /** In-app notifications. `key` makes each one-off notice unique (e.g. "overdue:2027-04"). */
  notifications: defineTable({
    residentId: v.id("residents"),
    kind: v.string(),
    title: v.string(),
    body: v.string(),
    href: v.optional(v.string()),
    key: v.optional(v.string()),
    createdAt: v.number(),
    readAt: v.optional(v.number()),
  })
    .index("by_resident_createdAt", ["residentId", "createdAt"])
    .index("by_resident_key", ["residentId", "key"]),

  // ---- Points --------------------------------------------------------------

  /**
   * NO LONGER USED (points are now 1 per ₹1 repaid). Kept only so older
   * saved rules stay valid. Was: how points are earned (admin-editable). Points are earned only on the
   * principal repaid on a statement paid in full by its deadline:
   *   base    pointsPer100: points per ₹100 of principal
   *   early   multiplierPct (200 = 2×) when paid before the statement is made
   *   streak  multiplierPct after `streakLength` on-time statements in a row
   *           (the highest one reached applies)
   * Multipliers multiply together.
   */
  pointsRules: defineTable({
    type: vPointsRuleType,
    pointsPer100: v.optional(v.number()),
    multiplierPct: v.optional(v.number()),
    streakLength: v.optional(v.number()),
    enabled: v.boolean(),
    sortOrder: v.number(),
    createdAt: v.number(),
  }).index("by_sortOrder", ["sortOrder"]),

  /**
   * Every points change, never edited or deleted (append-only). `points` is
   * signed: + earned/refunded/grants, − redeemed/expired/deductions. A
   * balance is always the sum.
   */
  pointsLedger: defineTable({
    residentId: v.id("residents"),
    type: vPointsEntryType,
    points: v.number(),
    /** Earned: the statement month it was for. */
    statementMonth: v.optional(v.string()),
    /** Earned: when unused points expire (absent = never). */
    expiresAt: v.optional(v.number()),
    /** Expired: the earned row whose unused points expired. */
    lotId: v.optional(v.id("pointsLedger")),
    /** Earned: the repayment (ledger row) the points are for. */
    sourceEntryId: v.optional(v.id("ledgerEntries")),
    /** Refunded: the redeemed row it gives back. */
    refundOf: v.optional(v.id("pointsLedger")),
    redemptionId: v.optional(v.string()),
    reason: v.optional(v.string()),
    createdAt: v.number(),
    createdBy: v.optional(v.id("users")),
  })
    .index("by_resident_createdAt", ["residentId", "createdAt"])
    .index("by_createdAt", ["createdAt"])
    .index("by_type_expiresAt", ["type", "expiresAt"]),

  /** One per resident per statement judged for points (makes awarding safe to repeat). */
  pointsAwards: defineTable({
    residentId: v.id("residents"),
    month: v.string(),
    points: v.number(),
    streak: v.number(),
    early: v.boolean(),
    principalPaise: v.number(),
    createdAt: v.number(),
    /** Set if the payment was later reversed and the points taken back. */
    clawedBackAt: v.optional(v.number()),
  }).index("by_resident_month", ["residentId", "month"]),

  /** "After N on-time statements in a row, raise the limit by X, up to Y." Used only when limit growth is on. */
  limitRules: defineTable({
    streakLength: v.number(),
    raisePaise: v.number(),
    maxPaise: v.number(),
    enabled: v.boolean(),
    createdAt: v.number(),
  }),

  // ---- Perk Store ----------------------------------------------------------

  perkCategories: defineTable({
    name: v.string(),
    sortOrder: v.number(),
    archived: v.boolean(),
    createdAt: v.number(),
  }).index("by_sortOrder", ["sortOrder"]),

  /** A card in the Perk Store, built by the admin. */
  perks: defineTable({
    title: v.string(),
    summary: v.string(), // short description on the card
    details: v.string(), // longer text on the perk's page
    icon: v.string(), // an icon name from the store's list
    imageId: v.optional(v.id("_storage")),
    categoryId: v.optional(v.id("perkCategories")),
    costPoints: v.number(),
    /** null = unlimited; otherwise how many are left (goes down on redeeming, back up on reject/cancel). */
    stockLeft: v.union(v.number(), v.null()),
    perResident: vPerkLimit,
    availableFrom: v.optional(v.string()), // YYYY-MM-DD, India time
    availableTo: v.optional(v.string()),
    visibility: vPerkVisibility,
    fields: v.array(vPerkField),
    fulfilmentNote: v.optional(v.string()),
    sortOrder: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_visibility_sortOrder", ["visibility", "sortOrder"])
    .index("by_sortOrder", ["sortOrder"]),

  /** A resident's redemption, with every status change kept in `history`. */
  redemptions: defineTable({
    residentId: v.id("residents"),
    perkId: v.id("perks"),
    perkTitle: v.string(), // as it was when redeemed
    costPoints: v.number(),
    answers: v.array(v.object({ label: v.string(), value: v.string() })),
    status: vRedemptionStatus,
    history: v.array(
      v.object({
        status: vRedemptionStatus,
        at: v.number(),
        by: v.union(v.literal("resident"), v.literal("admin")),
        byUserId: v.optional(v.id("users")),
        note: v.optional(v.string()),
        /** A code, link or other details the resident uses to claim the perk. */
        info: v.optional(v.string()),
      }),
    ),
    /** The latest code / link / details for the resident (shown prominently). */
    redeemInfo: v.optional(v.string()),
    /** The points row that paid for it, and the refund (if any). */
    pointsEntryId: v.id("pointsLedger"),
    refundEntryId: v.optional(v.id("pointsLedger")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_status_createdAt", ["status", "createdAt"])
    .index("by_resident_createdAt", ["residentId", "createdAt"])
    .index("by_perk_createdAt", ["perkId", "createdAt"])
    .index("by_resident_perk", ["residentId", "perkId"])
    .index("by_createdAt", ["createdAt"]),

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
