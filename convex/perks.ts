/**
 * The Perk Store: perks (cards) and categories built by the admin; residents
 * browse active perks and redeem them with points (convex/redemptions.ts).
 */
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { writeAudit } from "./lib/audit";
import { appError } from "./lib/errors";
import { adminMutation, adminQuery, residentQuery } from "./lib/functions";
import { pointsBalance } from "./lib/points";
import { currentSettings } from "./lib/settings";
import { istDate } from "./lib/time";
import { vPerkField, vPerkLimit, vPerkVisibility, type PerkField, type PerkLimit } from "./lib/validators";
import { usedInPeriod } from "./lib/perks";

/** Icons a perk can show (the website has the same list). */
export const PERK_ICONS = [
  "gift",
  "coffee",
  "utensils",
  "pizza",
  "cake",
  "bed-double",
  "shirt",
  "washing-machine",
  "ticket",
  "popcorn",
  "book-open",
  "wifi",
  "bike",
  "sparkles",
] as const;

type Db = Pick<QueryCtx, "db" | "storage">;

const text = (value: string, label: string, min: number, max: number) => {
  const t = value.trim();
  if (t.length < min || t.length > max) throw appError("INVALID_INPUT", `${label}: use ${min} to ${max} characters.`);
  return t;
};

function checkLimit(limit: PerkLimit): PerkLimit {
  if (limit.kind !== "unlimited" && (!Number.isInteger(limit.count) || limit.count < 1 || limit.count > 100))
    throw appError("INVALID_INPUT", "The per-resident limit must be 1 to 100.");
  return limit;
}

function checkFields(fields: PerkField[]): PerkField[] {
  if (fields.length > 8) throw appError("INVALID_INPUT", "Use at most 8 questions.");
  return fields.map((f, i) => {
    const label = text(f.label, "Question", 1, 60);
    const options = f.type === "select" ? (f.options ?? []).map((o) => o.trim()).filter(Boolean).slice(0, 20) : undefined;
    if (f.type === "select" && (options ?? []).length < 2) throw appError("INVALID_INPUT", `"${label}": give at least 2 choices.`);
    return { key: `f${i + 1}`, label, type: f.type, options, required: f.required };
  });
}

const vPerkInput = {
  title: v.string(),
  summary: v.string(),
  details: v.string(),
  icon: v.string(),
  imageId: v.optional(v.id("_storage")),
  categoryId: v.optional(v.id("perkCategories")),
  costPoints: v.number(),
  stock: v.union(v.number(), v.null()),
  perResident: vPerkLimit,
  availableFrom: v.optional(v.string()),
  availableTo: v.optional(v.string()),
  visibility: vPerkVisibility,
  fields: v.array(vPerkField),
  fulfilmentNote: v.optional(v.string()),
};

type PerkInput = {
  title: string;
  summary: string;
  details: string;
  icon: string;
  imageId?: Id<"_storage">;
  categoryId?: Id<"perkCategories">;
  costPoints: number;
  stock: number | null;
  perResident: PerkLimit;
  availableFrom?: string;
  availableTo?: string;
  visibility: Doc<"perks">["visibility"];
  fields: PerkField[];
  fulfilmentNote?: string;
};

function cleanPerk(a: PerkInput) {
  const date = (d: string | undefined) => {
    if (!d) return undefined;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw appError("INVALID_DATE");
    return d;
  };
  if (!(PERK_ICONS as readonly string[]).includes(a.icon)) throw appError("INVALID_INPUT", "Choose an icon from the list.");
  if (!Number.isInteger(a.costPoints) || a.costPoints < 1 || a.costPoints > 1_000_000) throw appError("INVALID_INPUT", "The cost must be 1 or more points.");
  if (a.stock !== null && (!Number.isInteger(a.stock) || a.stock < 0 || a.stock > 100_000)) throw appError("INVALID_INPUT", "Stock must be 0 or more.");
  const from = date(a.availableFrom);
  const to = date(a.availableTo);
  if (from && to && from > to) throw appError("INVALID_INPUT", "The end date is before the start date.");
  return {
    title: text(a.title, "Title", 2, 60),
    summary: text(a.summary, "Short description", 2, 120),
    details: text(a.details, "Details", 0, 2000),
    icon: a.icon,
    imageId: a.imageId,
    categoryId: a.categoryId,
    costPoints: a.costPoints,
    stockLeft: a.stock,
    perResident: checkLimit(a.perResident),
    availableFrom: from,
    availableTo: to,
    visibility: a.visibility,
    fields: checkFields(a.fields),
    fulfilmentNote: a.fulfilmentNote?.trim() ? text(a.fulfilmentNote, "Fulfilment note", 1, 300) : undefined,
  };
}

async function view(ctx: Db, p: Doc<"perks">) {
  return {
    perkId: p._id,
    title: p.title,
    summary: p.summary,
    details: p.details,
    icon: p.icon,
    imageUrl: p.imageId ? await ctx.storage.getUrl(p.imageId) : null,
    imageId: p.imageId ?? null,
    categoryId: p.categoryId ?? null,
    costPoints: p.costPoints,
    stockLeft: p.stockLeft,
    perResident: p.perResident,
    availableFrom: p.availableFrom ?? null,
    availableTo: p.availableTo ?? null,
    visibility: p.visibility,
    fields: p.fields,
    fulfilmentNote: p.fulfilmentNote ?? null,
    sortOrder: p.sortOrder,
  };
}

// ---- Admin -----------------------------------------------------------------

export const adminList = adminQuery({
  args: {},
  handler: async (ctx) => {
    const perks = await ctx.db.query("perks").withIndex("by_sortOrder").collect();
    const out = [];
    for (const p of perks) {
      const redemptions = await ctx.db.query("redemptions").withIndex("by_perk_createdAt", (q) => q.eq("perkId", p._id)).collect();
      out.push({ ...(await view(ctx, p)), redeemed: redemptions.filter((r) => r.status !== "rejected" && r.status !== "cancelled").length });
    }
    return out;
  },
});

export const adminGet = adminQuery({
  args: { perkId: v.id("perks") },
  handler: async (ctx, { perkId }) => {
    const p = await ctx.db.get(perkId);
    if (p === null) throw appError("NOT_FOUND");
    return await view(ctx, p);
  },
});

export const create = adminMutation({
  args: vPerkInput,
  handler: async (ctx, args) => {
    const values = cleanPerk(args);
    const last = await ctx.db.query("perks").withIndex("by_sortOrder").order("desc").first();
    const now = Date.now();
    const id = await ctx.db.insert("perks", { ...values, sortOrder: (last?.sortOrder ?? 0) + 1, createdAt: now, updatedAt: now });
    await writeAudit(ctx, { actorUserId: ctx.admin.userId, action: "perk.created", entityType: "perks", entityId: id, metadata: { after: { ...values, imageId: values.imageId ? "image" : null } } });
    return id;
  },
});

export const update = adminMutation({
  args: { perkId: v.id("perks"), ...vPerkInput },
  handler: async (ctx, { perkId, ...args }) => {
    const p = await ctx.db.get(perkId);
    if (p === null) throw appError("NOT_FOUND");
    const values = cleanPerk(args);
    const keys = Object.keys(values) as (keyof typeof values)[];
    const changed = keys.filter((k) => JSON.stringify(p[k] ?? null) !== JSON.stringify(values[k] ?? null));
    if (changed.length === 0) return null;
    if (p.imageId && p.imageId !== values.imageId) await ctx.storage.delete(p.imageId);
    await ctx.db.patch(p._id, { ...values, updatedAt: Date.now() });
    await writeAudit(ctx, {
      actorUserId: ctx.admin.userId,
      action: "perk.updated",
      entityType: "perks",
      entityId: p._id,
      metadata: {
        title: values.title,
        before: Object.fromEntries(changed.map((k) => [k, k === "imageId" ? (p.imageId ? "image" : null) : (p[k] ?? null)])),
        after: Object.fromEntries(changed.map((k) => [k, k === "imageId" ? (values.imageId ? "image" : null) : (values[k] ?? null)])),
      },
    });
    return null;
  },
});

/** Moves a perk up or down in the store. */
export const move = adminMutation({
  args: { perkId: v.id("perks"), by: v.union(v.literal(-1), v.literal(1)) },
  handler: async (ctx, { perkId, by }) => {
    const list = await ctx.db.query("perks").withIndex("by_sortOrder").collect();
    const i = list.findIndex((p) => p._id === perkId);
    if (i < 0 || !list[i + by]) return null;
    [list[i], list[i + by]] = [list[i + by], list[i]];
    for (const [n, p] of list.entries()) if (p.sortOrder !== n) await ctx.db.patch(p._id, { sortOrder: n });
    await writeAudit(ctx, { actorUserId: ctx.admin.userId, action: "perk.reordered", entityType: "perks", entityId: perkId, metadata: { before: i, after: i + by } });
    return null;
  },
});

/** For uploading a perk image (the browser sends the file straight to storage). */
export const imageUploadUrl = adminMutation({
  args: {},
  handler: async (ctx) => await ctx.storage.generateUploadUrl(),
});

export const categories = adminQuery({
  args: {},
  handler: async (ctx) =>
    (await ctx.db.query("perkCategories").withIndex("by_sortOrder").collect()).map((c) => ({ categoryId: c._id, name: c.name, archived: c.archived })),
});

export const saveCategory = adminMutation({
  args: { categoryId: v.optional(v.id("perkCategories")), name: v.string(), archived: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const name = text(args.name, "Category", 2, 40);
    const all = await ctx.db.query("perkCategories").collect();
    if (all.some((c) => c._id !== args.categoryId && c.name.toLowerCase() === name.toLowerCase()))
      throw appError("CONFLICT", "That category already exists.");
    if (args.categoryId) {
      const c = await ctx.db.get(args.categoryId);
      if (c === null) throw appError("NOT_FOUND");
      const archived = args.archived ?? c.archived;
      await ctx.db.patch(c._id, { name, archived });
      await writeAudit(ctx, { actorUserId: ctx.admin.userId, action: "perk_category.updated", entityType: "perkCategories", entityId: c._id, metadata: { before: { name: c.name, archived: c.archived }, after: { name, archived } } });
      return c._id;
    }
    const id = await ctx.db.insert("perkCategories", { name, sortOrder: all.length, archived: false, createdAt: Date.now() });
    await writeAudit(ctx, { actorUserId: ctx.admin.userId, action: "perk_category.created", entityType: "perkCategories", entityId: id, metadata: { after: { name } } });
    return id;
  },
});

// ---- Residents ---------------------------------------------------------------

/** Whether a perk can be redeemed today (active and inside its dates). */
export function perkOpen(p: Doc<"perks">, today: string): boolean {
  if (p.visibility !== "active") return false;
  if (p.availableFrom && today < p.availableFrom) return false;
  if (p.availableTo && today > p.availableTo) return false;
  return true;
}

/** The store: active perks in their dates, with what this resident can do. */
export const store = residentQuery({
  args: {},
  handler: async (ctx) => {
    const { resident } = ctx.resident;
    const today = istDate(Date.now());
    const balance = await pointsBalance(ctx, resident._id);
    const settings = await currentSettings(ctx);
    const cats = (await ctx.db.query("perkCategories").withIndex("by_sortOrder").collect()).filter((c) => !c.archived);
    const perks = (await ctx.db.query("perks").withIndex("by_visibility_sortOrder", (q) => q.eq("visibility", "active")).collect()).filter((p) => perkOpen(p, today));
    const out = [];
    for (const p of perks) {
      const used = await usedInPeriod(ctx, resident._id, p);
      out.push({
        ...(await view(ctx, p)),
        affordable: balance >= p.costPoints,
        limitReached: p.perResident.kind !== "unlimited" && used >= p.perResident.count,
        usedInPeriod: used,
      });
    }
    return { balance, pointsName: settings.pointsName, paused: resident.paused, categories: cats.map((c) => ({ categoryId: c._id, name: c.name })), perks: out };
  },
});
