/**
 * Repayments. The resident pays by UPI outside the app and taps "I've
 * paid"; it counts only once an admin confirms it. When confirmed, it counts
 * from the moment the resident said they paid (for late fees and points).
 * An admin can also record a repayment directly.
 *
 * Payments clear the oldest statement first; in each, late fees, then fees,
 * then the amount drawn (convex/lib/ledger.ts).
 */
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { accountSummary, notify } from "./lib/account";
import { writeAudit } from "./lib/audit";
import { appError } from "./lib/errors";
import { adminMutation, adminQuery, residentMutation, residentQuery } from "./lib/functions";
import { formatPaise, rupeesToPaise } from "./lib/money";
import { afterCredit } from "./lib/rewards";
import { inScope, residentsInScope } from "./lib/org";
import { currentSettings } from "./lib/settings";

const cleanText = (text: string | undefined, max: number) => {
  const t = (text ?? "").trim();
  if (t.length > max) throw appError("INVALID_INPUT", `Use at most ${max} characters.`);
  return t.length > 0 ? t : undefined;
};

async function pendingClaimsPaise(ctx: Pick<MutationCtx, "db">, residentId: Id<"residents">) {
  return (
    await ctx.db
      .query("repaymentClaims")
      .withIndex("by_resident_submittedAt", (q) => q.eq("residentId", residentId))
      .collect()
  )
    .filter((c) => c.status === "pending")
    .reduce((sum, c) => sum + c.amountPaise, 0);
}

export const claim = residentMutation({
  args: { amountRupees: v.number(), upiRef: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { resident, userId } = ctx.resident;
    const amountPaise = rupeesToPaise(args.amountRupees);
    if (amountPaise <= 0) throw appError("INVALID_INPUT", "Enter the amount you paid.");
    const summary = await accountSummary(ctx, resident, await currentSettings(ctx));
    const waiting = await pendingClaimsPaise(ctx, resident._id);
    const owed = summary.outstandingPaise - waiting;
    if (amountPaise > owed)
      throw appError(
        "INVALID_INPUT",
        owed > 0 ? `You owe ${formatPaise(owed)} (after payments waiting to be confirmed).` : "You don't owe anything right now.",
      );
    const now = Date.now();
    const upiRef = cleanText(args.upiRef, 60);
    const id = await ctx.db.insert("repaymentClaims", { residentId: resident._id, amountPaise, upiRef, status: "pending", submittedAt: now });
    await writeAudit(ctx, {
      actorUserId: userId,
      action: "repayment.claimed",
      entityType: "repaymentClaims",
      entityId: id,
      residentId: resident._id,
      metadata: { after: { amountPaise, upiRef: upiRef ?? null } },
    });
    return id;
  },
});

export const mine = residentQuery({
  args: {},
  handler: async (ctx) =>
    (
      await ctx.db
        .query("repaymentClaims")
        .withIndex("by_resident_submittedAt", (q) => q.eq("residentId", ctx.resident.resident._id))
        .order("desc")
        .take(100)
    ).map(publicClaim),
});

function publicClaim(c: Doc<"repaymentClaims">) {
  return {
    claimId: c._id,
    amountPaise: c.amountPaise,
    upiRef: c.upiRef ?? null,
    status: c.status,
    submittedAt: c.submittedAt,
    decidedAt: c.decidedAt ?? null,
    note: c.note ?? null,
  };
}

// ---- Admin -----------------------------------------------------------------

export const queue = adminQuery({
  args: { status: v.optional(v.union(v.literal("pending"), v.literal("confirmed"), v.literal("rejected"))), propertyId: v.optional(v.id("properties")) },
  handler: async (ctx, { status = "pending", propertyId }) => {
    const scope = await residentsInScope(ctx, propertyId);
    const rows = await ctx.db
      .query("repaymentClaims")
      .withIndex("by_status_submittedAt", (q) => q.eq("status", status))
      .order(status === "pending" ? "asc" : "desc")
      .take(200);
    const out = [];
    for (const c of rows.filter((x) => inScope(scope, x.residentId))) {
      const r = await ctx.db.get(c.residentId);
      out.push({ ...publicClaim(c), residentId: c.residentId, residentName: r?.name ?? "Unknown", roomNumber: r?.roomNumber ?? null });
    }
    return out;
  },
});

async function addRepayment(
  ctx: Pick<MutationCtx, "db">,
  args: { residentId: Id<"residents">; amountPaise: number; effectiveAt: number; adminId: Id<"users">; claimId?: Id<"repaymentClaims">; note?: string },
) {
  const now = Date.now();
  const entryId = await ctx.db.insert("ledgerEntries", {
    residentId: args.residentId,
    type: "repayment",
    amountPaise: args.amountPaise,
    repaymentClaimId: args.claimId,
    effectiveAt: args.effectiveAt,
    createdAt: now,
    createdBy: args.adminId,
    note: args.note,
  });
  await notify(ctx, args.residentId, {
    kind: "repayment_confirmed",
    title: "Payment confirmed",
    body: `Your payment of ${formatPaise(args.amountPaise)} is confirmed. Thank you!`,
    href: "/me/statements",
  });
  await afterCredit(ctx, args.residentId, args.adminId);
  return entryId;
}

export const confirm = adminMutation({
  args: { claimId: v.id("repaymentClaims") },
  handler: async (ctx, { claimId }) => {
    const c = await ctx.db.get(claimId);
    if (c === null) throw appError("NOT_FOUND");
    if (c.status !== "pending") throw appError("CONFLICT", "This payment was already handled.");
    await ctx.db.patch(c._id, { status: "confirmed", decidedAt: Date.now(), decidedBy: ctx.admin.userId });
    const entryId = await addRepayment(ctx, {
      residentId: c.residentId,
      amountPaise: c.amountPaise,
      effectiveAt: c.submittedAt,
      adminId: ctx.admin.userId,
      claimId: c._id,
      note: c.upiRef ? `UPI ref ${c.upiRef}` : undefined,
    });
    await writeAudit(ctx, {
      actorUserId: ctx.admin.userId,
      action: "repayment.confirmed",
      entityType: "repaymentClaims",
      entityId: c._id,
      residentId: c.residentId,
      metadata: { before: { status: "pending" }, after: { status: "confirmed" }, amountPaise: c.amountPaise, ledgerEntryId: entryId },
    });
    return null;
  },
});

export const reject = adminMutation({
  args: { claimId: v.id("repaymentClaims"), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const c = await ctx.db.get(args.claimId);
    if (c === null) throw appError("NOT_FOUND");
    if (c.status !== "pending") throw appError("CONFLICT", "This payment was already handled.");
    const note = cleanText(args.note, 200);
    await ctx.db.patch(c._id, { status: "rejected", decidedAt: Date.now(), decidedBy: ctx.admin.userId, note });
    await writeAudit(ctx, {
      actorUserId: ctx.admin.userId,
      action: "repayment.rejected",
      entityType: "repaymentClaims",
      entityId: c._id,
      residentId: c.residentId,
      reason: note,
      metadata: { before: { status: "pending" }, after: { status: "rejected" }, amountPaise: c.amountPaise },
    });
    await notify(ctx, c.residentId, {
      kind: "repayment_rejected",
      title: "Payment not confirmed",
      body: `Your payment of ${formatPaise(c.amountPaise)} couldn't be confirmed.${note ? ` Note: ${note}` : ""}`,
      href: "/me/activity",
    });
    return null;
  },
});

/** The admin records a payment they received (counts from now). */
export const record = adminMutation({
  args: { residentId: v.id("residents"), amountRupees: v.number(), upiRef: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const resident = await ctx.db.get(args.residentId);
    if (resident === null) throw appError("NOT_FOUND");
    const amountPaise = rupeesToPaise(args.amountRupees);
    if (amountPaise <= 0) throw appError("INVALID_INPUT", "Enter the amount received.");
    const summary = await accountSummary(ctx, resident, await currentSettings(ctx));
    if (amountPaise > summary.outstandingPaise)
      throw appError("INVALID_INPUT", `They owe ${formatPaise(summary.outstandingPaise)}.`);
    const upiRef = cleanText(args.upiRef, 60);
    const entryId = await addRepayment(ctx, {
      residentId: resident._id,
      amountPaise,
      effectiveAt: Date.now(),
      adminId: ctx.admin.userId,
      note: upiRef ? `UPI ref ${upiRef}` : undefined,
    });
    await writeAudit(ctx, {
      actorUserId: ctx.admin.userId,
      action: "repayment.recorded",
      entityType: "ledgerEntries",
      entityId: entryId,
      residentId: resident._id,
      metadata: { after: { amountPaise, upiRef: upiRef ?? null } },
    });
    return null;
  },
});
