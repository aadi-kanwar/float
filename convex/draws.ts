/**
 * Drawing money. Money moves outside the app (the admin pays by UPI); here
 * it is only recorded.
 *
 *   resident asks  ->  requested  (or approved at once if approval is off)
 *   admin approves ->  approved
 *   admin sends it ->  disbursed: the principal and the fee go on the ledger
 *   admin rejects  ->  rejected     resident cancels (while requested) -> cancelled
 *
 * A request counts against the limit from the moment it is made. The fee is
 * worked out when it is asked and kept with the request.
 */
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { accountSummary, notify, openCycleMonth } from "./lib/account";
import { writeAudit } from "./lib/audit";
import { appError } from "./lib/errors";
import { adminMutation, adminQuery, residentMutation, residentQuery } from "./lib/functions";
import { drawFeePaise, formatPaise, rupeesToPaise } from "./lib/money";
import { inScope, residentsInScope } from "./lib/org";
import { currentSettings } from "./lib/settings";
import { currentTerms } from "./lib/terms";
import { vPaymentMode } from "./lib/validators";

const cleanText = (text: string | undefined, max: number) => {
  const t = (text ?? "").trim();
  if (t.length > max) throw appError("INVALID_INPUT", `Use at most ${max} characters.`);
  return t.length > 0 ? t : undefined;
};

/** What a draw of `amountRupees` would cost and whether it's allowed (the Draw screen's live preview). */
export const preview = residentQuery({
  args: { amountRupees: v.optional(v.number()) },
  handler: async (ctx, { amountRupees }) => {
    const { resident } = ctx.resident;
    const settings = await currentSettings(ctx);
    const summary = await accountSummary(ctx, resident, settings);
    const amountPaise = amountRupees !== undefined && Number.isInteger(amountRupees) && amountRupees > 0 ? amountRupees * 100 : 0;
    const feePaise = drawFeePaise(amountPaise, settings.feeBasisPoints);
    const terms = await currentTerms(ctx);
    const accepted = await ctx.db
      .query("termsAcceptances")
      .withIndex("by_resident_version", (q) => q.eq("residentId", resident._id).eq("version", terms.version))
      .first();
    return {
      amountPaise,
      feePaise,
      totalPaise: amountPaise + feePaise,
      feeBasisPoints: settings.feeBasisPoints,
      minDrawPaise: settings.minDrawPaise,
      availablePaise: summary.availablePaise,
      needsApproval: settings.requireDrawApproval,
      dueDay: settings.dueDayOfMonth,
      termsVersion: terms.version,
      termsAccepted: accepted !== null,
      paused: resident.paused,
      /** Whether the office knows where to send the money. */
      payoutSet: Boolean(resident.upiId || resident.upiQrId),
      frozen: settings.freezeWhenOverdue && summary.overdue,
    };
  },
});

/** The checks every new draw passes (also used by the tests). */
export async function checkDraw(
  ctx: Pick<MutationCtx, "db">,
  resident: Doc<"residents">,
  amountPaise: number,
): Promise<{ feePaise: number; termsVersion: number; needsApproval: boolean }> {
  const settings = await currentSettings(ctx);
  if (resident.paused) throw appError("PAUSED");
  const terms = await currentTerms(ctx);
  const accepted = await ctx.db
    .query("termsAcceptances")
    .withIndex("by_resident_version", (q) => q.eq("residentId", resident._id).eq("version", terms.version))
    .first();
  if (accepted === null) throw appError("TERMS_REQUIRED");
  if (amountPaise < settings.minDrawPaise)
    throw appError("INVALID_INPUT", `The smallest draw is ${formatPaise(settings.minDrawPaise)}.`);
  const summary = await accountSummary(ctx, resident, settings);
  if (settings.freezeWhenOverdue && summary.overdue) throw appError("OVERDUE_FROZEN");
  const feePaise = drawFeePaise(amountPaise, settings.feeBasisPoints);
  // Fees don't use the limit: only the amount drawn counts.
  if (amountPaise > summary.roomPaise) throw appError("LIMIT_EXCEEDED", `You can draw up to ${formatPaise(summary.availablePaise)} right now.`);
  return { feePaise, termsVersion: terms.version, needsApproval: settings.requireDrawApproval };
}

export const request = residentMutation({
  args: { amountRupees: v.number(), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { resident, userId } = ctx.resident;
    const amountPaise = rupeesToPaise(args.amountRupees);
    const { feePaise, termsVersion, needsApproval } = await checkDraw(ctx, resident, amountPaise);
    const now = Date.now();
    const id = await ctx.db.insert("drawRequests", {
      residentId: resident._id,
      amountPaise,
      feePaise,
      status: needsApproval ? "requested" : "approved",
      requestedAt: now,
      decidedAt: needsApproval ? undefined : now,
      note: cleanText(args.note, 200),
      termsVersion,
    });
    await writeAudit(ctx, {
      actorUserId: userId,
      action: needsApproval ? "draw.requested" : "draw.auto_approved",
      entityType: "drawRequests",
      entityId: id,
      residentId: resident._id,
      metadata: { after: { amountPaise, feePaise } },
    });
    if (!needsApproval)
      await notify(ctx, resident._id, {
        kind: "draw_approved",
        title: "Draw approved",
        body: `Your draw of ${formatPaise(amountPaise)} is approved. The office will send it by UPI.`,
        href: "/me/activity",
      });
    return id;
  },
});

export const cancel = residentMutation({
  args: { drawRequestId: v.id("drawRequests") },
  handler: async (ctx, { drawRequestId }) => {
    const draw = await ctx.db.get(drawRequestId);
    if (draw === null || draw.residentId !== ctx.resident.resident._id) throw appError("NOT_FOUND");
    if (draw.status !== "requested") throw appError("CONFLICT", "It can only be cancelled before the office approves it.");
    await ctx.db.patch(draw._id, { status: "cancelled", decidedAt: Date.now() });
    await writeAudit(ctx, {
      actorUserId: ctx.resident.userId,
      action: "draw.cancelled",
      entityType: "drawRequests",
      entityId: draw._id,
      residentId: draw.residentId,
      metadata: { before: { status: draw.status }, after: { status: "cancelled" } },
    });
    return null;
  },
});

export const mine = residentQuery({
  args: {},
  handler: async (ctx) =>
    (
      await ctx.db
        .query("drawRequests")
        .withIndex("by_resident_requestedAt", (q) => q.eq("residentId", ctx.resident.resident._id))
        .order("desc")
        .take(100)
    ).map(publicDraw),
});

function publicDraw(d: Doc<"drawRequests">) {
  return {
    drawRequestId: d._id,
    amountPaise: d.amountPaise,
    feePaise: d.feePaise,
    status: d.status,
    requestedAt: d.requestedAt,
    decidedAt: d.decidedAt ?? null,
    disbursedAt: d.disbursedAt ?? null,
    upiRef: d.upiRef ?? null,
    paymentMode: d.paymentMode ?? null,
    note: d.note ?? null,
  };
}

// ---- Admin -----------------------------------------------------------------

/** The queue: requested and approved (waiting to be sent), oldest first; or one status. */
export const queue = adminQuery({
  args: {
    status: v.optional(v.union(v.literal("waiting"), v.literal("disbursed"), v.literal("rejected"), v.literal("cancelled"))),
    propertyId: v.optional(v.id("properties")),
  },
  handler: async (ctx, { status = "waiting", propertyId }) => {
    const scope = await residentsInScope(ctx, propertyId);
    const rows =
      status === "waiting"
        ? [
            ...(await ctx.db.query("drawRequests").withIndex("by_status_requestedAt", (q) => q.eq("status", "requested")).collect()),
            ...(await ctx.db.query("drawRequests").withIndex("by_status_requestedAt", (q) => q.eq("status", "approved")).collect()),
          ].sort((a, b) => a.requestedAt - b.requestedAt)
        : await ctx.db
            .query("drawRequests")
            .withIndex("by_status_requestedAt", (q) => q.eq("status", status))
            .order("desc")
            .take(100);
    const out = [];
    for (const d of rows.filter((x) => inScope(scope, x.residentId))) {
      const r = await ctx.db.get(d.residentId);
      out.push({
        ...publicDraw(d),
        residentId: d.residentId,
        residentName: r?.name ?? "Unknown",
        roomNumber: r?.roomNumber ?? null,
        phone: r?.phone ?? "",
        upiId: r?.upiId ?? null,
        upiQrUrl: r?.upiQrId ? await ctx.storage.getUrl(r.upiQrId) : null,
      });
    }
    return out;
  },
});

async function loadDraw(ctx: Pick<MutationCtx, "db">, id: Id<"drawRequests">) {
  const d = await ctx.db.get(id);
  if (d === null) throw appError("NOT_FOUND");
  return d;
}

export const approve = adminMutation({
  args: { drawRequestId: v.id("drawRequests") },
  handler: async (ctx, { drawRequestId }) => {
    const d = await loadDraw(ctx, drawRequestId);
    if (d.status !== "requested") throw appError("CONFLICT", "This request isn't waiting for approval.");
    await ctx.db.patch(d._id, { status: "approved", decidedAt: Date.now(), decidedBy: ctx.admin.userId });
    await writeAudit(ctx, {
      actorUserId: ctx.admin.userId,
      action: "draw.approved",
      entityType: "drawRequests",
      entityId: d._id,
      residentId: d.residentId,
      metadata: { before: { status: d.status }, after: { status: "approved" }, amountPaise: d.amountPaise },
    });
    await notify(ctx, d.residentId, {
      kind: "draw_approved",
      title: "Draw approved",
      body: `Your draw of ${formatPaise(d.amountPaise)} is approved. The office will send it by UPI.`,
      href: "/me/activity",
    });
    return null;
  },
});

export const reject = adminMutation({
  args: { drawRequestId: v.id("drawRequests"), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const d = await loadDraw(ctx, args.drawRequestId);
    if (d.status !== "requested" && d.status !== "approved") throw appError("CONFLICT", "This request can't be rejected now.");
    const note = cleanText(args.note, 200);
    await ctx.db.patch(d._id, { status: "rejected", decidedAt: Date.now(), decidedBy: ctx.admin.userId, note: note ?? d.note });
    await writeAudit(ctx, {
      actorUserId: ctx.admin.userId,
      action: "draw.rejected",
      entityType: "drawRequests",
      entityId: d._id,
      residentId: d.residentId,
      reason: note,
      metadata: { before: { status: d.status }, after: { status: "rejected" }, amountPaise: d.amountPaise },
    });
    await notify(ctx, d.residentId, {
      kind: "draw_rejected",
      title: "Draw not approved",
      body: `Your draw of ${formatPaise(d.amountPaise)} wasn't approved.${note ? ` Note: ${note}` : ""}`,
      href: "/me/activity",
    });
    return null;
  },
});

/** The admin sent the money by UPI: it goes on the ledger now (principal and fee as separate rows). */
export const markDisbursed = adminMutation({
  args: { drawRequestId: v.id("drawRequests"), paymentMode: v.optional(vPaymentMode), upiRef: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const d = await loadDraw(ctx, args.drawRequestId);
    if (d.status !== "requested" && d.status !== "approved") throw appError("CONFLICT", "This draw can't be marked as sent.");
    const now = Date.now();
    const upiRef = cleanText(args.upiRef, 60);
    const cycleMonth = await openCycleMonth(ctx, d.residentId, now);
    await ctx.db.patch(d._id, {
      status: "disbursed",
      decidedAt: d.decidedAt ?? now,
      decidedBy: d.decidedBy ?? ctx.admin.userId,
      disbursedAt: now,
      disbursedBy: ctx.admin.userId,
      paymentMode: args.paymentMode ?? "upi",
      upiRef,
    });
    const base = { residentId: d.residentId, cycleMonth, drawRequestId: d._id, effectiveAt: now, createdAt: now, createdBy: ctx.admin.userId };
    await ctx.db.insert("ledgerEntries", { ...base, type: "draw", amountPaise: d.amountPaise });
    if (d.feePaise > 0) await ctx.db.insert("ledgerEntries", { ...base, type: "fee", amountPaise: d.feePaise });
    await writeAudit(ctx, {
      actorUserId: ctx.admin.userId,
      action: "draw.disbursed",
      entityType: "drawRequests",
      entityId: d._id,
      residentId: d.residentId,
      metadata: { before: { status: d.status }, after: { status: "disbursed", paymentMode: args.paymentMode ?? "upi", utr: upiRef ?? null }, amountPaise: d.amountPaise, feePaise: d.feePaise, cycleMonth },
    });
    await notify(ctx, d.residentId, {
      kind: "draw_disbursed",
      title: "Money sent",
      body: `${formatPaise(d.amountPaise)} has been sent to you${args.paymentMode === "cash" ? " in cash" : ""}${upiRef ? ` (UTR ${upiRef})` : ""}.`,
      href: "/me/activity",
    });
    return null;
  },
});
