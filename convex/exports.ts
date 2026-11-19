/**
 * Admin: CSV downloads for a date range (India dates, both ends included):
 * the money ledger, statements, the points ledger and redemptions. Each
 * download is audit-logged. Amounts are in rupees with paise.
 */
import { v } from "convex/values";
import { writeAudit } from "./lib/audit";
import { toCsv } from "./lib/csv";
import { appError } from "./lib/errors";
import { adminMutation } from "./lib/functions";
import { voidIds } from "./lib/ledger";
import { inScope, residentsInScope } from "./lib/org";
import { toRows } from "./lib/account";
import { istDate, istStartOfDay, DAY_MS } from "./lib/time";

const rupees = (paise: number) => (paise / 100).toFixed(2);
const when = (ms: number) => new Date(ms + 5.5 * 3_600_000).toISOString().replace("T", " ").slice(0, 16);

export const download = adminMutation({
  args: {
    kind: v.union(v.literal("ledger"), v.literal("statements"), v.literal("points"), v.literal("redemptions")),
    from: v.string(),
    to: v.string(),
    propertyId: v.optional(v.id("properties")),
  },
  handler: async (ctx, { kind, from, to, propertyId }) => {
    const scope = await residentsInScope(ctx, propertyId);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) throw appError("INVALID_DATE");
    const start = istStartOfDay(from);
    const end = istStartOfDay(to) + DAY_MS;
    const names = new Map<string, { name: string; room: string }>();
    const who = async (id: string) => {
      if (!names.has(id)) {
        const r = await ctx.db.get(id as never);
        const doc = r as { name?: string; roomNumber?: string } | null;
        names.set(id, { name: doc?.name ?? "Unknown", room: doc?.roomNumber ?? "" });
      }
      return names.get(id)!;
    };
    const rows: (string | number)[][] = [];
    if (kind === "ledger") {
      rows.push(["Date (IST)", "Resident", "Room", "Type", "Amount (₹)", "Statement month", "Late fee day", "Reversed", "Note"]);
      const all = await ctx.db.query("ledgerEntries").collect();
      const cancelled = voidIds(toRows(all));
      for (const e of all.filter((e) => e.effectiveAt >= start && e.effectiveAt < end && inScope(scope, e.residentId)).sort((a, b) => a.effectiveAt - b.effectiveAt)) {
        const r = await who(e.residentId);
        rows.push([when(e.effectiveAt), r.name, r.room, e.type, rupees(e.amountPaise), e.cycleMonth ?? "", e.forDate ?? "", cancelled.has(e._id) && e.type !== "reversal" ? "yes" : "", e.note ?? ""]);
      }
    } else if (kind === "statements") {
      rows.push(["Month", "Resident", "Room", "Made (IST)", "Due date", "Drawn (₹)", "Fees (₹)", "Paid in month (₹)", "Carried over (₹)", "Late fees (₹)", "Total due (₹)"]);
      for (const s of (await ctx.db.query("statements").collect()).filter((s) => s.generatedAt >= start && s.generatedAt < end && inScope(scope, s.residentId)).sort((a, b) => (a.month < b.month ? -1 : 1))) {
        const r = await who(s.residentId);
        rows.push([s.month, r.name, r.room, when(s.generatedAt), s.dueDate, rupees(s.drawnPaise), rupees(s.feesPaise), rupees(s.paidThisMonthPaise), rupees(s.carriedOverPaise), rupees(s.lateFeesPaise), rupees(s.totalDuePaise)]);
      }
    } else if (kind === "points") {
      rows.push(["Date (IST)", "Resident", "Room", "Type", "Points", "Statement month", "Expires (IST date)", "Reason"]);
      for (const p of (await ctx.db.query("pointsLedger").withIndex("by_createdAt", (q) => q.gte("createdAt", start).lt("createdAt", end)).collect()).filter((x) => inScope(scope, x.residentId))) {
        const r = await who(p.residentId);
        rows.push([when(p.createdAt), r.name, r.room, p.type, p.points, p.statementMonth ?? "", p.expiresAt ? istDate(p.expiresAt) : "", p.reason ?? ""]);
      }
    } else {
      rows.push(["Date (IST)", "Resident", "Room", "Perk", "Points", "Status", "Answers", "Last note"]);
      for (const x of (await ctx.db.query("redemptions").withIndex("by_createdAt", (q) => q.gte("createdAt", start).lt("createdAt", end)).collect()).filter((y) => inScope(scope, y.residentId))) {
        const r = await who(x.residentId);
        const last = [...x.history].reverse().find((h) => h.note);
        rows.push([when(x.createdAt), r.name, r.room, x.perkTitle, x.costPoints, x.status, x.answers.map((a) => `${a.label}: ${a.value}`).join("; "), last?.note ?? ""]);
      }
    }
    await writeAudit(ctx, { actorUserId: ctx.admin.userId, action: "report.exported", entityType: "exports", entityId: kind, metadata: { kind, from, to, propertyId: propertyId ?? null, rows: rows.length - 1 } });
    return { filename: `float-${kind}-${from}-to-${to}.csv`, csv: toCsv(rows) };
  },
});
