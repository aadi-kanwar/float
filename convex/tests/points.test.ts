/// <reference types="vite/client" />
import { describe, expect, test } from "vitest";
import { api, internal } from "../_generated/api";
import { lots, pointsForPrincipal, pointsValuePaise } from "../lib/points";
import { shiftMonth } from "../lib/time";
import { createAdmin, createResident, errorCode, setIndiaTime, setupTest, type Admin, type Resident, type T } from "./harness.test-utils";

async function ready(t: T, admin: Admin): Promise<Resident> {
  const r = await createResident(t, admin);
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
  (await r.as.query(api.points.mine, {})).history.filter((h) => h.type === "earned").map((h) => h.points);

describe("6. points: 1 per ₹1 of drawn money repaid, live", () => {
  test("the formula", () => {
    expect(pointsForPrincipal(100_000)).toBe(1000); // ₹1,000 -> 1,000 points
    expect(pointsForPrincipal(15_050)).toBe(150); // whole rupees only
    expect(pointsValuePaise(1000, 100)).toBe(1000); // 1,000 points at 1% of ₹1 = ₹10
    expect(pointsValuePaise(1000, 250)).toBe(2500);
  });

  test("given as soon as a payment is confirmed, any day; fees never earn", async () => {
    const t = await setupTest("2026-12-01");
    const admin = await createAdmin(t);
    const r = await ready(t, admin);
    setIndiaTime("2027-01-10T12:00:00");
    const id = await r.as.mutation(api.draws.request, { amountRupees: 1000 });
    await admin.as.mutation(api.draws.markDisbursed, { drawRequestId: id });
    setIndiaTime("2027-01-12T12:00:00");
    let claimId = await r.as.mutation(api.repayments.claim, { amountRupees: 500 });
    await admin.as.mutation(api.repayments.confirm, { claimId });
    expect(await balance(r)).toBe(450); // ₹50 fee paid first, then ₹450 of the draw
    setIndiaTime("2027-01-20T12:00:00");
    claimId = await r.as.mutation(api.repayments.claim, { amountRupees: 550 });
    await admin.as.mutation(api.repayments.confirm, { claimId });
    expect(await earned(r)).toEqual([550, 450]);
    // Jobs and statements give nothing more.
    setIndiaTime("2027-01-31T23:59:00");
    await t.mutation(internal.statements.monthEndJob, {});
    expect(await balance(r)).toBe(1000);
    const notes = await r.as.query(api.money.myNotifications, {});
    expect(notes.map((n) => n.title)).toContain("You earned 450 Points");
  });

  test("on time, early and late payments all earn the drawn amount (late fees don't)", async () => {
    const t = await setupTest("2026-12-01");
    const admin = await createAdmin(t);
    const r = await ready(t, admin);
    await cycle(t, admin, r, "2027-01", 1000, "early");
    await cycle(t, admin, r, "2027-02", 1000, "onTime");
    await cycle(t, admin, r, "2027-03", 1000, "late");
    expect(await earned(r)).toEqual([1000, 1000, 1000]);
  });

  test("what the points are worth follows the setting", async () => {
    const t = await setupTest("2026-12-01");
    const admin = await createAdmin(t);
    const r = await ready(t, admin);
    await admin.as.mutation(api.points.adjust, { residentId: r.residentId, points: 1000, reason: "Test" });
    expect((await r.as.query(api.points.mine, {})).balanceValuePaise).toBe(1000);
    const s = await admin.as.query(api.settings.get, {});
    await admin.as.mutation(api.settings.save, { values: { ...s.values, pointValueBasisPoints: 250 }, expectedVersion: s.version });
    expect((await r.as.query(api.points.mine, {})).balanceValuePaise).toBe(2500);
    expect(await errorCode(admin.as.mutation(api.settings.save, { values: { ...s.values, pointValueBasisPoints: 20_000 }, expectedVersion: 1 }))).toBe("INVALID_INPUT");
  });

  test("a reversed payment takes the points back", async () => {
    const t = await setupTest("2026-12-01");
    const admin = await createAdmin(t);
    const r = await ready(t, admin);
    await cycle(t, admin, r, "2027-01", 1000, "onTime");
    expect(await balance(r)).toBe(1000);
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
    await cycle(t, admin, r, "2027-01", 1000, "onTime"); // 1,000 points earned on 3 Feb 2027
    await admin.as.mutation(api.points.adjust, { residentId: r.residentId, points: -200, reason: "Spent at the desk" });
    const mine = await r.as.query(api.points.mine, {});
    expect(mine.expiring).toEqual([{ points: 800, expiresAt: new Date("2028-02-03T12:00:00+05:30").getTime() }]);
    setIndiaTime("2028-02-03T00:05:00");
    await t.mutation(internal.statements.dailyJob, {});
    expect(await balance(r)).toBe(800);
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
    expect(await errorCode(r.as.query(api.points.residentPoints, { residentId: r.residentId }))).toBe("FORBIDDEN");
    expect(await balance(r)).toBe(30);
    const audit = await t.run((ctx) => ctx.db.query("auditLog").collect());
    expect(audit.find((a) => a.action === "points.granted")?.metadata).toMatchObject({ before: 0, after: 30 });
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
