/**
 * Redeeming perks.
 *
 *   resident redeems -> Requested (points taken at once, stock goes down)
 *   admin moves it between Requested -> Approved -> In progress -> Fulfilled
 *   Rejected (admin) or Cancelled (admin, or the resident while Requested):
 *     the points come back and the stock goes back up, exactly once.
 *
 * Every change is kept in the redemption's history with its time and note,
 * audit-logged, and sent to the resident as an in-app notification. The
 * resident's screens update by themselves (Convex is live).
 */
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { notify } from "./lib/account";
import { writeAudit } from "./lib/audit";
import { appError } from "./lib/errors";
import { adminMutation, adminQuery, residentMutation, residentQuery } from "./lib/functions";
import { inScope, residentsInScope } from "./lib/org";
import { usedInPeriod } from "./lib/perks";
import { pointsBalance } from "./lib/points";
import { currentSettings } from "./lib/settings";
import { istDate } from "./lib/time";
import { vRedemptionStatus, type RedemptionStatus } from "./lib/validators";
import { perkOpen } from "./perks";

export const STATUS_LABEL: Record<RedemptionStatus, string> = {
  requested: "Requested",
  approved: "Approved",
  in_progress: "In progress",
  fulfilled: "Fulfilled",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

const ENDED: RedemptionStatus[] = ["rejected", "cancelled"];

function cleanAnswers(fields: Doc<"perks">["fields"], answers: { key: string; value: string }[]) {
  return fields.map((f) => {
    const value = (answers.find((a) => a.key === f.key)?.value ?? "").trim();
    if (f.required && value === "") throw appError("INVALID_INPUT", `Please fill in "${f.label}".`);
    if (value !== "") {
      if (value.length > 200) throw appError("INVALID_INPUT", `"${f.label}" is too long.`);
      if (f.type === "number" && !/^-?\d+(\.\d+)?$/.test(value)) throw appError("INVALID_INPUT", `"${f.label}" must be a number.`);
      if (f.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw appError("INVALID_INPUT", `"${f.label}" must be a date.`);
      if (f.type === "select" && !(f.options ?? []).includes(value)) throw appError("INVALID_INPUT", `Choose one of the options for "${f.label}".`);
    }
    return { label: f.label, value };
  });
}

export const redeem = residentMutation({
  args: { perkId: v.id("perks"), answers: v.array(v.object({ key: v.string(), value: v.string() })) },
  handler: async (ctx, args) => {
    const { resident, userId } = ctx.resident;
    if (resident.paused) throw appError("PAUSED");
    const perk = await ctx.db.get(args.perkId);
    if (perk === null || !perkOpen(perk, istDate(Date.now()))) throw appError("NOT_FOUND", "This perk isn't available right now.");
    if (perk.stockLeft !== null && perk.stockLeft <= 0) throw appError("OUT_OF_STOCK");
    if (perk.perResident.kind !== "unlimited" && (await usedInPeriod(ctx, resident._id, perk)) >= perk.perResident.count)
      throw appError("PERK_LIMIT_REACHED");
    const balance = await pointsBalance(ctx, resident._id);
    const settings = await currentSettings(ctx);
    if (balance < perk.costPoints) throw appError("NOT_ENOUGH_POINTS", `You need ${perk.costPoints - balance} more ${settings.pointsName}.`);
    const answers = cleanAnswers(perk.fields, args.answers);
    const now = Date.now();
    const pointsEntryId = await ctx.db.insert("pointsLedger", {
      residentId: resident._id,
      type: "redeemed",
      points: -perk.costPoints,
      reason: perk.title,
      createdAt: now,
      createdBy: userId,
    });
    const id = await ctx.db.insert("redemptions", {
      residentId: resident._id,
      perkId: perk._id,
      perkTitle: perk.title,
      costPoints: perk.costPoints,
      answers,
      status: "requested",
      history: [{ status: "requested", at: now, by: "resident", byUserId: userId }],
      pointsEntryId,
      createdAt: now,
      updatedAt: now,
    });
    if (perk.stockLeft !== null) await ctx.db.patch(perk._id, { stockLeft: perk.stockLeft - 1 });
    await writeAudit(ctx, {
      actorUserId: userId,
      action: "redemption.requested",
      entityType: "redemptions",
      entityId: id,
      residentId: resident._id,
      metadata: { perk: perk.title, costPoints: perk.costPoints, stockBefore: perk.stockLeft, stockAfter: perk.stockLeft === null ? null : perk.stockLeft - 1 },
    });
    return id;
  },
});

/** Points back and stock back, once. */
async function undo(ctx: Pick<MutationCtx, "db">, r: Doc<"redemptions">, actor: Id<"users">) {
  if (r.refundEntryId) return undefined;
  const refundEntryId = await ctx.db.insert("pointsLedger", {
    residentId: r.residentId,
    type: "refunded",
    points: r.costPoints,
    refundOf: r.pointsEntryId,
    reason: r.perkTitle,
    createdAt: Date.now(),
    createdBy: actor,
  });
  const perk = await ctx.db.get(r.perkId);
  if (perk !== null && perk.stockLeft !== null) await ctx.db.patch(perk._id, { stockLeft: perk.stockLeft + 1 });
  return refundEntryId;
}

async function changeStatus(
  ctx: Pick<MutationCtx, "db">,
  r: Doc<"redemptions">,
  to: RedemptionStatus,
  who: { by: "resident" | "admin"; userId: Id<"users"> },
  note: string | undefined,
) {
  const now = Date.now();
  const refundEntryId = ENDED.includes(to) ? await undo(ctx, r, who.userId) : undefined;
  await ctx.db.patch(r._id, {
    status: to,
    history: [...r.history, { status: to, at: now, by: who.by, byUserId: who.userId, note }],
    updatedAt: now,
    ...(refundEntryId ? { refundEntryId } : {}),
  });
  await writeAudit(ctx, {
    actorUserId: who.userId,
    action: "redemption.status_changed",
    entityType: "redemptions",
    entityId: r._id,
    residentId: r.residentId,
    reason: note,
    metadata: { perk: r.perkTitle, before: r.status, after: to, pointsRefunded: refundEntryId ? r.costPoints : 0 },
  });
  const settings = await currentSettings(ctx);
  await notify(ctx, r.residentId, {
    kind: "redemption_status",
    title: `${r.perkTitle}: ${STATUS_LABEL[to]}`,
    body: `${note ? `${note} ` : ""}${refundEntryId ? `Your ${r.costPoints} ${settings.pointsName} are back.` : ""}`.trim() || `Your redemption is now ${STATUS_LABEL[to].toLowerCase()}.`,
    href: "/me/redemptions",
  });
}

/** The resident cancels, only while it is still Requested. */
export const cancel = residentMutation({
  args: { redemptionId: v.id("redemptions") },
  handler: async (ctx, { redemptionId }) => {
    const r = await ctx.db.get(redemptionId);
    if (r === null || r.residentId !== ctx.resident.resident._id) throw appError("NOT_FOUND");
    if (r.status !== "requested") throw appError("CONFLICT", "It can only be cancelled before the office approves it.");
    await changeStatus(ctx, r, "cancelled", { by: "resident", userId: ctx.resident.userId }, undefined);
    return null;
  },
});

/** The admin moves a redemption to any status (with a note). Rejected and Cancelled are final. */
export const setStatus = adminMutation({
  args: { redemptionId: v.id("redemptions"), status: vRedemptionStatus, note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const r = await ctx.db.get(args.redemptionId);
    if (r === null) throw appError("NOT_FOUND");
    if (ENDED.includes(r.status)) throw appError("CONFLICT", `It's already ${STATUS_LABEL[r.status].toLowerCase()}.`);
    if (r.status === args.status) throw appError("CONFLICT", "It's already at that step.");
    const note = args.note?.trim() || undefined;
    if (note && note.length > 300) throw appError("INVALID_INPUT", "Use at most 300 characters.");
    await changeStatus(ctx, r, args.status, { by: "admin", userId: ctx.admin.userId }, note);
    return null;
  },
});

function publicRedemption(r: Doc<"redemptions">) {
  return {
    redemptionId: r._id,
    perkId: r.perkId,
    perkTitle: r.perkTitle,
    costPoints: r.costPoints,
    answers: r.answers,
    status: r.status,
    history: r.history.map((h) => ({ status: h.status, at: h.at, by: h.by, note: h.note ?? null })),
    createdAt: r.createdAt,
    refunded: r.refundEntryId !== undefined,
  };
}

export const mine = residentQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("redemptions")
      .withIndex("by_resident_createdAt", (q) => q.eq("residentId", ctx.resident.resident._id))
      .order("desc")
      .take(100);
    const out = [];
    for (const r of rows) {
      const perk = await ctx.db.get(r.perkId);
      out.push({ ...publicRedemption(r), fulfilmentNote: perk?.fulfilmentNote ?? null, icon: perk?.icon ?? "gift" });
    }
    return out;
  },
});

/** Admin queue with filters; newest first (oldest first for Requested). */
export const queue = adminQuery({
  args: {
    paginationOpts: paginationOptsValidator,
    status: v.optional(vRedemptionStatus),
    perkId: v.optional(v.id("perks")),
    residentId: v.optional(v.id("residents")),
    from: v.optional(v.string()),
    to: v.optional(v.string()),
    propertyId: v.optional(v.id("properties")),
  },
  handler: async (ctx, args) => {
    const scope = await residentsInScope(ctx, args.propertyId);
    if (scope !== null && scope.size === 0) return { page: [], isDone: true, continueCursor: "" };
    const base = args.status
      ? ctx.db.query("redemptions").withIndex("by_status_createdAt", (q) => q.eq("status", args.status!))
      : args.perkId
        ? ctx.db.query("redemptions").withIndex("by_perk_createdAt", (q) => q.eq("perkId", args.perkId!))
        : args.residentId
          ? ctx.db.query("redemptions").withIndex("by_resident_createdAt", (q) => q.eq("residentId", args.residentId!))
          : ctx.db.query("redemptions").withIndex("by_createdAt");
    const filtered = base.filter((q) =>
      q.and(
        args.perkId ? q.eq(q.field("perkId"), args.perkId) : true,
        args.residentId ? q.eq(q.field("residentId"), args.residentId) : true,
        args.from ? q.gte(q.field("createdAt"), Date.parse(`${args.from}T00:00:00+05:30`)) : true,
        args.to ? q.lt(q.field("createdAt"), Date.parse(`${args.to}T00:00:00+05:30`) + 86_400_000) : true,
        scope === null ? true : q.or(...[...scope].map((id) => q.eq(q.field("residentId"), id as Id<"residents">))),
      ),
    );
    const page = await filtered.order(args.status === "requested" ? "asc" : "desc").paginate(args.paginationOpts);
    const out = [];
    for (const r of page.page) {
      const resident = await ctx.db.get(r.residentId);
      out.push({ ...publicRedemption(r), residentId: r.residentId, residentName: resident?.name ?? "Unknown", roomNumber: resident?.roomNumber ?? null });
    }
    return { ...page, page: out };
  },
});

/** The badge: how many are waiting at Requested. */
export const newCount = adminQuery({
  args: { propertyId: v.optional(v.id("properties")) },
  handler: async (ctx, { propertyId }) => {
    const scope = await residentsInScope(ctx, propertyId);
    return (await ctx.db.query("redemptions").withIndex("by_status_createdAt", (q) => q.eq("status", "requested")).collect()).filter((r) => inScope(scope, r.residentId)).length;
  },
});
