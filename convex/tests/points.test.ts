/// <reference types="vite/client" />
import { describe, expect, test } from "vitest";
import { api, internal } from "../_generated/api";
import { lots, pointsFor, DEFAULT_RULES } from "../lib/points";
import { shiftMonth } from "../lib/time";
import { createAdmin, createResident, errorCode, setIndiaTime, setupTest, type Admin, type Resident, type T } from "./harness.test-utils";

async function ready(t: T, admin: Admin): Promise<Resident> {
  const r = await createResident(t, admin, { depositRupees: 10_000 });
  await r.as.mutation(api.terms.accept, { version: 0 });
  return r;
}

/**
 * One month: draw on the 10th, then pay in full either early (the 20th of
 * the same month), on time (the 3rd of next month) or late (the 9th).
 */
async function cycle(t: T, admin: Admin, r: Resident, month: string, rupees: number, when: "early" | "onTime" | "late") {
  setIndiaTime(`${month}-10T12:00:00`);
  const id = await r.as.mutation(api.draws.request, { amountRupees: rupees });
  await admin.as.mutation(api.draws.markDisbursed, { drawRequestId: id });
  const next = shiftMonth(month, 1);
  const pay = async () => {
    const owed = (await r.as.query(api.money.mySummary, {})).outstandingPaise;
    const claimId = await r.as.mutation(api.repayments.claim, { amountRupees: owed / 100 });
    await admin.as.mutation(api.repayments.confirm, { claimId });
  };
  if (when === "early") {
    setIndiaTime(`${month}-20T12:00:00`);
    await pay();
  }
  const lastDay = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  setIndiaTime(`${month}-${lastDay}T23:59:00`);
  await t.mutation(internal.statements.monthEndJob, {});
  if (when === "onTime") {
    setIndiaTime(`${next}-03T12:00:00`);
    await pay();
  }
  if (when === "late") {
    for (const d of ["06", "07", "08", "09"]) {
      setIndiaTime(`${next}-${d}T00:05:00`);
      await t.mutation(internal.statements.dailyJob, {});
    }
    setIndiaTime(`${next}-09T12:00:00`);
    await pay();
  }
}

const balance = async (r: Resident) => (await r.as.query(api.points.mine, {})).balance;
const earned = async (r: Resident) =>
  (await r.as.query(api.points.mine, {})).history.filter((h) => h.type === "earned").map((h) => [h.statementMonth, h.points]);

describe("6. points", () => {
  test("the formula: per ₹100 of principal, early and streak multipliers multiply", () => {
    expect(pointsFor(100_000, false, 1, DEFAULT_RULES).points).toBe(50);
    expect(pointsFor(100_000, true, 1, DEFAULT_RULES).points).toBe(100);
    expect(pointsFor(100_000, false, 3, DEFAULT_RULES).points).toBe(62); // 62.5
    expect(pointsFor(100_000, false, 6, DEFAULT_RULES).points).toBe(75);
    expect(pointsFor(100_000, true, 6, DEFAULT_RULES).points).toBe(150);
    expect(pointsFor(15_000, false, 1, DEFAULT_RULES).points).toBe(7); // ₹150 -> 7.5
  });

  test("earned on repaid principal only (not the fee), when the admin confirms an on-time payment", async () => {
    const t = await setupTest("2026-12-01");
    const admin = await createAdmin(t);
    const r = await ready(t, admin);
    await cycle(t, admin, r, "2027-01", 1000, "onTime");
    expect(await earned(r)).toEqual([["2027-01", 50]]); // ₹1,050 paid, points on ₹1,000
    // Confirming again can't happen, and re-running the jobs gives nothing more.
    await t.mutation(internal.statements.dailyJob, {});
    expect(await balance(r)).toBe(50);
  });

  test("paid before the statement is made: early bonus", async () => {
    const t = await setupTest("2026-12-01");
    const admin = await createAdmin(t);
    const r = await ready(t, admin);
    await cycle(t, admin, r, "2027-01", 1000, "early");
    expect(await earned(r)).toEqual([["2027-01", 100]]);
  });

  test("streaks of 3 and 6; paid late gives 0 and resets the streak", async () => {
    const t = await setupTest("2026-12-01");
    const admin = await createAdmin(t);
    const r = await ready(t, admin);
    const months = ["2027-01", "2027-02", "2027-03", "2027-04", "2027-05", "2027-06"];
    for (const m of months) await cycle(t, admin, r, m, 1000, "onTime");
    expect(await earned(r)).toEqual(
      [["2027-06", 75], ["2027-05", 62], ["2027-04", 62], ["2027-03", 62], ["2027-02", 50], ["2027-01", 50]],
    );
    expect((await r.as.query(api.points.mine, {})).streak).toBe(6);
    await cycle(t, admin, r, "2027-07", 1000, "late");
    expect((await r.as.query(api.points.mine, {})).streak).toBe(0);
    await cycle(t, admin, r, "2027-08", 1000, "onTime");
    const all = await earned(r);
    expect(all.find(([m]) => m === "2027-07")).toBeUndefined();
    expect(all[0]).toEqual(["2027-08", 50]); // streak back to 1: no multiplier
  });

  test("a reversed payment takes the points back", async () => {
    const t = await setupTest("2026-12-01");
    const admin = await createAdmin(t);
    const r = await ready(t, admin);
    await cycle(t, admin, r, "2027-01", 1000, "onTime");
    expect(await balance(r)).toBe(50);
    const account = await admin.as.query(api.money.residentAccount, { residentId: r.residentId });
    const payment = account.ledger.find((e) => e.type === "repayment")!;
    setIndiaTime("2027-02-10T12:00:00");
    await admin.as.mutation(api.money.reverse, { entryId: payment.entryId, reason: "Bounced" });
    expect(await balance(r)).toBe(0);
  });

  test("points expire after 12 months; only unused points expire; the job is safe to run twice", async () => {
    const t = await setupTest("2026-12-01");
    const admin = await createAdmin(t);
    const r = await ready(t, admin);
    await cycle(t, admin, r, "2027-01", 1000, "onTime"); // 50 points earned on 3 Feb 2027
    await admin.as.mutation(api.points.adjust, { residentId: r.residentId, points: -20, reason: "Spent at the desk" });
    const mine = await r.as.query(api.points.mine, {});
    expect(mine.expiring).toEqual([{ points: 30, expiresAt: new Date("2028-02-03T12:00:00+05:30").getTime() }]);
    setIndiaTime("2028-02-03T00:05:00");
    await t.mutation(internal.statements.dailyJob, {});
    expect(await balance(r)).toBe(30);
    setIndiaTime("2028-02-04T00:05:00");
    await t.mutation(internal.statements.dailyJob, {});
    await t.mutation(internal.statements.dailyJob, {});
    expect(await balance(r)).toBe(0);
    const types = (await r.as.query(api.points.mine, {})).history.map((h) => h.type);
    expect(types.filter((x) => x === "expired")).toHaveLength(1);
  });

  test("a refunded redemption gives back points that keep their original expiry", () => {
    const rows = [
      { _id: "e1", type: "earned", points: 50, expiresAt: 1000, createdAt: 1 },
      { _id: "x1", type: "redeemed", points: -40, createdAt: 2 },
      { _id: "f1", type: "refunded", points: 40, refundOf: "x1", createdAt: 3 },
    ] as never;
    expect(lots(rows)).toMatchObject({ balance: 50, lots: [{ left: 50, expiresAt: 1000 }] });
  });

  test("manual grants and deductions: need a reason, never below 0, admin only, audit-logged", async () => {
    const t = await setupTest("2026-12-01");
    const admin = await createAdmin(t);
    const r = await ready(t, admin);
    expect(await errorCode(admin.as.mutation(api.points.adjust, { residentId: r.residentId, points: 10, reason: "" }))).toBe("REASON_REQUIRED");
    await admin.as.mutation(api.points.adjust, { residentId: r.residentId, points: 30, reason: "Helped at Diwali" });
    expect(await errorCode(admin.as.mutation(api.points.adjust, { residentId: r.residentId, points: -31, reason: "Too much" }))).toBe("INVALID_INPUT");
    expect(await errorCode(r.as.mutation(api.points.adjust, { residentId: r.residentId, points: 100, reason: "Me" }))).toBe("FORBIDDEN");
    expect(await errorCode(r.as.mutation(api.points.saveRule, { type: "base", pointsPer100: 100 }))).toBe("FORBIDDEN");
    expect(await errorCode(r.as.query(api.points.residentPoints, { residentId: r.residentId }))).toBe("FORBIDDEN");
    expect(await balance(r)).toBe(30);
    const audit = await t.run((ctx) => ctx.db.query("auditLog").collect());
    expect(audit.find((a) => a.action === "points.granted")?.metadata).toMatchObject({ before: 0, after: 30 });
  });

  test("admin edits, disables and reorders earn rules; new rules apply from then on", async () => {
    const t = await setupTest("2026-12-01");
    const admin = await createAdmin(t);
    const r = await ready(t, admin);
    await cycle(t, admin, r, "2027-01", 1000, "onTime");
    const rules = await admin.as.query(api.points.rules, {});
    expect(rules.map((x) => x.type)).toEqual(["base", "early", "streak", "streak"]);
    await admin.as.mutation(api.points.setRuleEnabled, { index: 1, enabled: false }); // no early bonus
    await admin.as.mutation(api.points.moveRule, { index: 3, by: -1 });
    await admin.as.mutation(api.points.saveRule, { index: 0, type: "base", pointsPer100: 10 });
    expect((await admin.as.query(api.points.rules, {})).map((x) => x.streakLength)).toEqual([null, null, 6, 3]);
    await cycle(t, admin, r, "2027-02", 1000, "early");
    expect(await earned(r)).toEqual([["2027-02", 100], ["2027-01", 50]]); // 10 per ₹100, no early 2×
  });
});

describe("limit growth", () => {
  test("off by default; when on, raises the limit after N on-time statements, up to the maximum", async () => {
    const t = await setupTest("2026-12-01");
    const admin = await createAdmin(t);
    const r = await ready(t, admin);
    await admin.as.mutation(api.points.saveLimitRule, { streakLength: 2, raiseRupees: 600, maxRupees: 6000, enabled: true });
    await cycle(t, admin, r, "2027-01", 500, "onTime");
    await cycle(t, admin, r, "2027-02", 500, "onTime");
    expect((await r.as.query(api.money.mySummary, {})).limitPaise).toBe(500_000); // setting is off
    const s = await admin.as.query(api.settings.get, {});
    await admin.as.mutation(api.settings.save, { values: { ...s.values, limitGrowthEnabled: true }, expectedVersion: s.version });
    await cycle(t, admin, r, "2027-03", 500, "onTime");
    await cycle(t, admin, r, "2027-04", 500, "onTime"); // streak 4: raise
    expect((await r.as.query(api.money.mySummary, {})).limitPaise).toBe(560_000);
    await cycle(t, admin, r, "2027-05", 500, "onTime");
    await cycle(t, admin, r, "2027-06", 500, "onTime"); // streak 6: raise, capped at ₹6,000
    expect((await r.as.query(api.money.mySummary, {})).limitPaise).toBe(600_000);
  });
});
