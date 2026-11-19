/// <reference types="vite/client" />
import { describe, expect, test } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { replay, type LedgerRow } from "../lib/ledger";
import { drawFeePaise } from "../lib/money";
import { createAdmin, createResident, errorCode, setIndiaTime, setupTest, type Admin, type Resident, type T } from "./harness.test-utils";

async function ready(t: T, admin: Admin, depositRupees = 10_000): Promise<Resident> {
  const r = await createResident(t, admin, { depositRupees });
  await r.as.mutation(api.terms.accept, { version: 0 });
  return r;
}

async function drawAndSend(r: Resident, admin: Admin, rupees: number) {
  const id = await r.as.mutation(api.draws.request, { amountRupees: rupees });
  await admin.as.mutation(api.draws.markDisbursed, { drawRequestId: id, upiRef: "UPI1" });
  return id;
}

const owed = async (r: Resident) => (await r.as.query(api.money.mySummary, {})).outstandingPaise;

const ledger = (t: T, residentId: Id<"residents">) =>
  t.run(async (ctx) =>
    ctx.db
      .query("ledgerEntries")
      .withIndex("by_resident_effectiveAt", (q) => q.eq("residentId", residentId))
      .collect(),
  );

const monthEnd = (t: T) => t.mutation(internal.statements.monthEndJob, {});
const daily = (t: T) => t.mutation(internal.statements.dailyJob, {});

describe("1. fees", () => {
  test("5% of the amount, rounded to the nearest rupee", () => {
    expect(drawFeePaise(100_000, 500)).toBe(5_000); // ₹1,000 -> ₹50
    expect(drawFeePaise(11_000, 500)).toBe(600); // ₹110 -> ₹5.50 -> ₹6
    expect(drawFeePaise(12_900, 500)).toBe(600); // ₹129 -> ₹6.45 -> ₹6
    expect(drawFeePaise(13_000, 500)).toBe(700); // ₹130 -> ₹6.50 -> ₹7
    expect(drawFeePaise(10_000, 500)).toBe(500);
    expect(drawFeePaise(10_000, 0)).toBe(0);
  });

  test("each draw is a principal row and a separate fee row; late fees never get a fee", async () => {
    const t = await setupTest();
    setIndiaTime("2027-04-10T12:00:00");
    const admin = await createAdmin(t);
    const r = await ready(t, admin);
    await drawAndSend(r, admin, 1000);
    setIndiaTime("2027-04-30T23:59:00");
    await monthEnd(t);
    setIndiaTime("2027-05-09T00:05:00");
    await daily(t);
    const rows = await ledger(t, r.residentId);
    expect(rows.filter((e) => e.type === "draw").map((e) => e.amountPaise)).toEqual([100_000]);
    expect(rows.filter((e) => e.type === "fee").map((e) => e.amountPaise)).toEqual([5_000]);
    expect(rows.filter((e) => e.type === "lateFee")).toHaveLength(4);
    expect(await owed(r)).toBe(100_000 + 5_000 + 4 * 10_000);
  });
});

describe("2. limit checks", () => {
  test("blocked above the limit (fee included), counting requests not yet sent", async () => {
    const t = await setupTest();
    const admin = await createAdmin(t);
    const r = await ready(t, admin);
    expect((await r.as.query(api.draws.preview, {})).availablePaise).toBe(476_200); // ₹4,762 + ₹238 fee = ₹5,000
    expect(await errorCode(r.as.mutation(api.draws.request, { amountRupees: 4800 }))).toBe("LIMIT_EXCEEDED");
    await r.as.mutation(api.draws.request, { amountRupees: 4000 }); // ₹4,200 with fee, waiting
    expect(await errorCode(r.as.mutation(api.draws.request, { amountRupees: 800 }))).toBe("LIMIT_EXCEEDED");
    await r.as.mutation(api.draws.request, { amountRupees: 700 }); // ₹735 -> ₹4,935
    expect(await errorCode(r.as.mutation(api.draws.request, { amountRupees: 100 }))).toBe("LIMIT_EXCEEDED");
    expect(await errorCode(r.as.mutation(api.draws.request, { amountRupees: 50 }))).toBe("INVALID_INPUT"); // below ₹100
  });

  test("blocked above the deposit when that setting is on", async () => {
    const t = await setupTest();
    const admin = await createAdmin(t);
    const r = await ready(t, admin, 2000);
    expect(await errorCode(r.as.mutation(api.draws.request, { amountRupees: 1950 }))).toBe("LIMIT_EXCEEDED");
    await r.as.mutation(api.draws.request, { amountRupees: 1900 }); // ₹1,995
    const s = await admin.as.query(api.settings.get, {});
    await admin.as.mutation(api.settings.save, { values: { ...s.values, limitCappedByDeposit: false }, expectedVersion: s.version });
    await r.as.mutation(api.draws.request, { amountRupees: 2000 }); // now up to ₹5,000
  });

  test("blocked while overdue (when frozen), while paused, and before accepting the terms", async () => {
    const t = await setupTest();
    setIndiaTime("2027-04-10T12:00:00");
    const admin = await createAdmin(t);
    const r = await ready(t, admin);
    await drawAndSend(r, admin, 500);
    setIndiaTime("2027-04-30T23:59:00");
    await monthEnd(t);
    setIndiaTime("2027-05-06T00:05:00");
    await daily(t);
    expect(await errorCode(r.as.mutation(api.draws.request, { amountRupees: 100 }))).toBe("OVERDUE_FROZEN");
    const s = await admin.as.query(api.settings.get, {});
    await admin.as.mutation(api.settings.save, { values: { ...s.values, freezeWhenOverdue: false }, expectedVersion: s.version });
    await r.as.mutation(api.draws.request, { amountRupees: 100 });

    await admin.as.mutation(api.residents.setPaused, { residentId: r.residentId, paused: true, reason: "Checking dues" });
    expect(await errorCode(r.as.mutation(api.draws.request, { amountRupees: 100 }))).toBe("PAUSED");

    const fresh = await createResident(t, admin);
    expect(await errorCode(fresh.as.mutation(api.draws.request, { amountRupees: 100 }))).toBe("TERMS_REQUIRED");
    await admin.as.mutation(api.terms.save, { text: "New terms for everyone, version one." });
    // Old acceptance no longer covers the new version.
    expect(await errorCode(r.as.mutation(api.residents.setPaused, { residentId: r.residentId, paused: false, reason: "x" }))).toBe("FORBIDDEN");
    await admin.as.mutation(api.residents.setPaused, { residentId: r.residentId, paused: false, reason: "All fine" });
    expect(await errorCode(r.as.mutation(api.draws.request, { amountRupees: 100 }))).toBe("TERMS_REQUIRED");
    await r.as.mutation(api.terms.accept, { version: 1 });
    await r.as.mutation(api.draws.request, { amountRupees: 100 });
  });
});

describe("3. statements", () => {
  test("made on the last day at 23:59; draws on the 1st and the 30th share the deadline", async () => {
    const t = await setupTest();
    setIndiaTime("2027-04-01T09:00:00");
    const admin = await createAdmin(t);
    const r = await ready(t, admin);
    const quiet = await ready(t, admin); // no activity: no statement
    await drawAndSend(r, admin, 1000);
    setIndiaTime("2027-04-30T21:00:00");
    await drawAndSend(r, admin, 2000);
    setIndiaTime("2027-04-29T23:59:00");
    expect(await monthEnd(t)).toEqual({ statements: 0 }); // not the last day
    setIndiaTime("2027-04-30T23:59:00");
    expect(await monthEnd(t)).toEqual({ statements: 1 });
    expect(await monthEnd(t)).toEqual({ statements: 0 }); // twice: nothing new
    const { statements } = await r.as.query(api.statements.mine, {});
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatchObject({ month: "2027-04", dueDate: "2027-05-05", totalDuePaise: 300_000 + 15_000, status: "open" });
    const detail = await r.as.query(api.statements.myDetail, { month: "2027-04" });
    expect(detail.lines.map((l) => [l.type, l.amountPaise])).toEqual([
      ["draw", 100_000],
      ["fee", 5_000],
      ["draw", 200_000],
      ["fee", 10_000],
    ]);
    expect((await quiet.as.query(api.statements.mine, {})).statements).toHaveLength(0);
  });

  test("money sent after the statement is made goes on next month's statement", async () => {
    const t = await setupTest();
    setIndiaTime("2027-04-30T12:00:00");
    const admin = await createAdmin(t);
    const r = await ready(t, admin);
    await drawAndSend(r, admin, 200);
    const late = await r.as.mutation(api.draws.request, { amountRupees: 300 });
    setIndiaTime("2027-04-30T23:59:00");
    await monthEnd(t);
    setIndiaTime("2027-04-30T23:59:40");
    await admin.as.mutation(api.draws.markDisbursed, { drawRequestId: late });
    const rows = await ledger(t, r.residentId);
    expect(rows.filter((e) => e.type === "draw").map((e) => e.cycleMonth)).toEqual(["2027-04", "2027-05"]);
  });

  test("a missed month-end run is caught up the next day", async () => {
    const t = await setupTest();
    setIndiaTime("2027-04-10T12:00:00");
    const admin = await createAdmin(t);
    const r = await ready(t, admin);
    await drawAndSend(r, admin, 1000);
    setIndiaTime("2027-05-01T00:05:00");
    await daily(t);
    expect((await r.as.query(api.statements.mine, {})).statements.map((s) => s.month)).toEqual(["2027-04"]);
  });
});

describe("4. late fees", () => {
  async function overdueSetup() {
    const t = await setupTest();
    setIndiaTime("2027-04-10T12:00:00");
    const admin = await createAdmin(t);
    const r = await ready(t, admin);
    await drawAndSend(r, admin, 1000);
    setIndiaTime("2027-04-30T23:59:00");
    await monthEnd(t);
    return { t, admin, r };
  }
  const lateFees = async (t: T, r: Resident) => (await ledger(t, r.residentId)).filter((e) => e.type === "lateFee");

  test("nothing on the deadline day; once per day after; running twice changes nothing", async () => {
    const { t, r } = await overdueSetup();
    setIndiaTime("2027-05-05T23:00:00");
    await daily(t);
    expect(await lateFees(t, r)).toHaveLength(0);
    setIndiaTime("2027-05-06T00:05:00");
    await daily(t);
    await daily(t);
    expect((await lateFees(t, r)).map((e) => e.forDate)).toEqual(["2027-05-06"]);
    setIndiaTime("2027-05-09T00:05:00");
    await daily(t);
    await daily(t);
    expect((await lateFees(t, r)).map((e) => e.forDate)).toEqual(["2027-05-06", "2027-05-07", "2027-05-08", "2027-05-09"]);
    const { statements } = await r.as.query(api.statements.mine, {});
    expect(statements[0]).toMatchObject({ status: "overdue", lateFeesSoFarPaise: 40_000 });
  });

  test("respects the cap per statement", async () => {
    const { t, admin, r } = await overdueSetup();
    const s = await admin.as.query(api.settings.get, {});
    await admin.as.mutation(api.settings.save, { values: { ...s.values, lateFeeCapPaise: 25_000 }, expectedVersion: s.version });
    setIndiaTime("2027-05-12T00:05:00");
    await daily(t);
    expect((await lateFees(t, r)).map((e) => e.amountPaise)).toEqual([10_000, 10_000, 5_000]);
  });

  test("stops once paid; a payment counts from when the resident said they paid", async () => {
    const { t, admin, r } = await overdueSetup();
    setIndiaTime("2027-05-05T20:00:00");
    const claimId = await r.as.mutation(api.repayments.claim, { amountRupees: 1050, upiRef: "abc" });
    setIndiaTime("2027-05-07T00:05:00");
    await daily(t); // waiting for the admin: no late fee yet
    expect(await lateFees(t, r)).toHaveLength(0);
    setIndiaTime("2027-05-08T10:00:00");
    await admin.as.mutation(api.repayments.confirm, { claimId });
    setIndiaTime("2027-05-09T00:05:00");
    await daily(t);
    expect(await lateFees(t, r)).toHaveLength(0);
    expect((await r.as.query(api.statements.mine, {})).statements[0].status).toBe("paid_on_time");
  });

  test("a rejected payment: the missed days are charged afterwards", async () => {
    const { t, admin, r } = await overdueSetup();
    setIndiaTime("2027-05-05T20:00:00");
    const claimId = await r.as.mutation(api.repayments.claim, { amountRupees: 1050 });
    setIndiaTime("2027-05-07T00:05:00");
    await daily(t);
    expect(await lateFees(t, r)).toHaveLength(0);
    await admin.as.mutation(api.repayments.reject, { claimId, note: "Not received" });
    setIndiaTime("2027-05-08T00:05:00");
    await daily(t);
    expect((await lateFees(t, r)).map((e) => e.forDate)).toEqual(["2027-05-06", "2027-05-07", "2027-05-08"]);
  });

  test("a late fee the admin reversed is never charged again", async () => {
    const { t, admin, r } = await overdueSetup();
    setIndiaTime("2027-05-06T00:05:00");
    await daily(t);
    const [fee] = await lateFees(t, r);
    await admin.as.mutation(api.money.reverse, { entryId: fee._id, reason: "Bank holiday" });
    expect(await errorCode(admin.as.mutation(api.money.reverse, { entryId: fee._id, reason: "Again" }))).toBe("CONFLICT");
    await daily(t);
    expect(await lateFees(t, r)).toHaveLength(1);
    expect(await owed(r)).toBe(105_000);
  });
});

describe("5. repayment order", () => {
  test("late fees -> fees -> principal, oldest statement first", () => {
    const rows: LedgerRow[] = [
      { id: "a1", type: "draw", amountPaise: 100_000, cycleMonth: "2027-03", effectiveAt: 1, createdAt: 1 },
      { id: "a2", type: "fee", amountPaise: 5_000, cycleMonth: "2027-03", effectiveAt: 1, createdAt: 1 },
      { id: "a3", type: "lateFee", amountPaise: 20_000, cycleMonth: "2027-03", effectiveAt: 2, createdAt: 2 },
      { id: "b1", type: "draw", amountPaise: 50_000, cycleMonth: "2027-04", effectiveAt: 3, createdAt: 3 },
      { id: "b2", type: "fee", amountPaise: 2_500, cycleMonth: "2027-04", effectiveAt: 3, createdAt: 3 },
      { id: "p1", type: "repayment", amountPaise: 30_000, effectiveAt: 4, createdAt: 4 },
      { id: "p2", type: "repayment", amountPaise: 100_000, effectiveAt: 5, createdAt: 5 },
    ];
    const { allocations, outstandingPaise } = replay(rows);
    expect(allocations.map((a) => [a.creditId, a.month, a.bucket, a.amountPaise])).toEqual([
      ["p1", "2027-03", "lateFee", 20_000],
      ["p1", "2027-03", "fee", 5_000],
      ["p1", "2027-03", "principal", 5_000],
      ["p2", "2027-03", "principal", 95_000],
      ["p2", "2027-04", "fee", 2_500],
      ["p2", "2027-04", "principal", 2_500],
    ]);
    expect(outstandingPaise).toBe(47_500);
  });

  test("a reversed repayment is left out; the money is owed again", () => {
    const rows: LedgerRow[] = [
      { id: "a1", type: "draw", amountPaise: 100_000, cycleMonth: "2027-03", effectiveAt: 1, createdAt: 1 },
      { id: "p1", type: "repayment", amountPaise: 100_000, effectiveAt: 2, createdAt: 2 },
      { id: "r1", type: "reversal", amountPaise: 100_000, reversesEntryId: "p1", effectiveAt: 3, createdAt: 3 },
    ];
    expect(replay(rows).outstandingPaise).toBe(100_000);
  });
});

describe("8. settings changes only affect the future", () => {
  test("past statements and ledger rows keep their amounts", async () => {
    const t = await setupTest();
    setIndiaTime("2027-04-10T12:00:00");
    const admin = await createAdmin(t);
    const r = await ready(t, admin);
    await drawAndSend(r, admin, 1000);
    setIndiaTime("2027-04-30T23:59:00");
    await monthEnd(t);
    const before = await t.run((ctx) => ctx.db.query("statements").collect());
    const rowsBefore = await ledger(t, r.residentId);
    setIndiaTime("2027-05-01T10:00:00");
    const s = await admin.as.query(api.settings.get, {});
    await admin.as.mutation(api.settings.save, {
      values: { ...s.values, feeBasisPoints: 1000, dueDayOfMonth: 10, lateFeePerDayPaise: 5_000 },
      expectedVersion: s.version,
    });
    expect(await t.run((ctx) => ctx.db.query("statements").collect())).toEqual(before);
    expect((await ledger(t, r.residentId)).slice(0, rowsBefore.length)).toEqual(rowsBefore);
    await drawAndSend(r, admin, 1000); // new fee: 10%
    const fees = (await ledger(t, r.residentId)).filter((e) => e.type === "fee").map((e) => e.amountPaise);
    expect(fees).toEqual([5_000, 10_000]);
    // April's deadline stays the 5th; late fees from then on use the new amount.
    setIndiaTime("2027-05-06T00:05:00");
    await daily(t);
    expect((await ledger(t, r.residentId)).filter((e) => e.type === "lateFee").map((e) => e.amountPaise)).toEqual([5_000]);
  });
});

describe("overrides and access", () => {
  test("waive, settle from deposit (deposit and limit go down), all audit-logged", async () => {
    const t = await setupTest();
    setIndiaTime("2027-04-10T12:00:00");
    const admin = await createAdmin(t);
    const r = await ready(t, admin, 5000);
    await drawAndSend(r, admin, 1000);
    await admin.as.mutation(api.money.waive, { residentId: r.residentId, month: "2027-04", bucket: "fee", amountRupees: 20, reason: "Goodwill" });
    expect(await owed(r)).toBe(103_000);
    expect(
      await errorCode(admin.as.mutation(api.money.waive, { residentId: r.residentId, month: "2027-04", bucket: "fee", amountRupees: 31, reason: "Too much" })),
    ).toBe("INVALID_INPUT");
    await admin.as.mutation(api.money.settleFromDeposit, { residentId: r.residentId, amountRupees: 1030, reason: "Moving out" });
    const s = await r.as.query(api.money.mySummary, {});
    expect(s).toMatchObject({ outstandingPaise: 0, depositBalancePaise: 397_000, limitPaise: 397_000 });
    const audit = await t.run((ctx) => ctx.db.query("auditLog").collect());
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["ledger.waived", "deposit.settled", "draw.disbursed"]));
  });

  test("residents can't reach the admin's money functions or anyone else's draws", async () => {
    const t = await setupTest();
    const admin = await createAdmin(t);
    const asha = await ready(t, admin);
    const ravi = await ready(t, admin);
    const draw = await ravi.as.mutation(api.draws.request, { amountRupees: 500 });
    expect(await errorCode(asha.as.mutation(api.draws.cancel, { drawRequestId: draw }))).toBe("NOT_FOUND");
    expect(await errorCode(asha.as.mutation(api.draws.approve, { drawRequestId: draw }))).toBe("FORBIDDEN");
    expect(await errorCode(asha.as.mutation(api.draws.markDisbursed, { drawRequestId: draw }))).toBe("FORBIDDEN");
    expect(await errorCode(asha.as.query(api.draws.queue, {}))).toBe("FORBIDDEN");
    expect(await errorCode(asha.as.query(api.money.residentAccount, { residentId: ravi.residentId }))).toBe("FORBIDDEN");
    expect(await errorCode(asha.as.query(api.statements.residentDetail, { residentId: ravi.residentId, month: "2027-04" }))).toBe("FORBIDDEN");
    expect(await errorCode(asha.as.mutation(api.money.settleFromDeposit, { residentId: asha.residentId, amountRupees: 1, reason: "self" }))).toBe(
      "FORBIDDEN",
    );
    expect(await errorCode(asha.as.mutation(api.repayments.record, { residentId: asha.residentId, amountRupees: 1 }))).toBe("FORBIDDEN");
    expect((await asha.as.query(api.draws.mine, {})).length).toBe(0);
    // A resident can cancel only while it's still requested.
    await admin.as.mutation(api.draws.approve, { drawRequestId: draw });
    expect(await errorCode(ravi.as.mutation(api.draws.cancel, { drawRequestId: draw }))).toBe("CONFLICT");
  });
});
