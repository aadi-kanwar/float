/// <reference types="vite/client" />
import { describe, expect, test } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { createAdmin, createResident, errorCode, setIndiaTime, setupTest, type Admin, type Resident, type T } from "./harness.test-utils";

const PERK = {
  title: "Guest night",
  summary: "A friend stays one night",
  details: "One extra bed in your room for one night.",
  icon: "bed-double",
  costPoints: 100,
  stock: 2 as number | null,
  perResident: { kind: "per_month" as const, count: 1 },
  visibility: "active" as const,
  fields: [
    { key: "", label: "Guest name", type: "text" as const, required: true },
    { key: "", label: "Date of stay", type: "date" as const, required: true },
  ],
  fulfilmentNote: "Collect the bedding from the front desk.",
};

async function setup() {
  const t = await setupTest("2027-03-10");
  const admin = await createAdmin(t);
  const asha = await createResident(t, admin, { name: "Asha Rao" });
  const ravi = await createResident(t, admin, { name: "Ravi Kumar" });
  for (const r of [asha, ravi]) await admin.as.mutation(api.points.adjust, { residentId: r.residentId, points: 250, reason: "Starting points" });
  const perkId = await admin.as.mutation(api.perks.create, PERK);
  return { t, admin, asha, ravi, perkId };
}

const answers = [
  { key: "f1", value: "Meera" },
  { key: "f2", value: "2027-03-20" },
];
const balance = async (r: Resident) => (await r.as.query(api.points.mine, {})).balance;
const stock = async (admin: Admin, perkId: Id<"perks">) => (await admin.as.query(api.perks.adminGet, { perkId })).stockLeft;

describe("7. redemptions", () => {
  test("points come off at once; stock goes down; the resident sees it as Requested", async () => {
    const { admin, asha, perkId } = await setup();
    const id = await asha.as.mutation(api.redemptions.redeem, { perkId, answers });
    expect(await balance(asha)).toBe(150);
    expect(await stock(admin, perkId)).toBe(1);
    const [mine] = await asha.as.query(api.redemptions.mine, {});
    expect(mine).toMatchObject({ redemptionId: id, status: "requested", answers: [{ label: "Guest name", value: "Meera" }, { label: "Date of stay", value: "2027-03-20" }] });
    expect(await admin.as.query(api.redemptions.newCount, {})).toBe(1);
  });

  test("rejecting or cancelling gives the points back and restores stock, exactly once", async () => {
    const { admin, asha, ravi, perkId } = await setup();
    const a = await asha.as.mutation(api.redemptions.redeem, { perkId, answers });
    const b = await ravi.as.mutation(api.redemptions.redeem, { perkId, answers });
    expect(await stock(admin, perkId)).toBe(0);
    await admin.as.mutation(api.redemptions.setStatus, { redemptionId: a, status: "approved", note: "See you then" });
    await admin.as.mutation(api.redemptions.setStatus, { redemptionId: a, status: "rejected", note: "Fully booked that night" });
    expect(await errorCode(admin.as.mutation(api.redemptions.setStatus, { redemptionId: a, status: "cancelled" }))).toBe("CONFLICT");
    await ravi.as.mutation(api.redemptions.cancel, { redemptionId: b });
    expect(await balance(asha)).toBe(250);
    expect(await balance(ravi)).toBe(250);
    expect(await stock(admin, perkId)).toBe(2);
    const [mine] = await asha.as.query(api.redemptions.mine, {});
    expect(mine.history.map((h) => [h.status, h.note])).toEqual([
      ["requested", null],
      ["approved", "See you then"],
      ["rejected", "Fully booked that night"],
    ]);
    const notes = await asha.as.query(api.money.myNotifications, {});
    expect(notes.map((n) => n.title)).toEqual(expect.arrayContaining(["Guest night: Approved", "Guest night: Rejected"]));
  });

  test("the resident can't cancel once it's past Requested", async () => {
    const { admin, asha, perkId } = await setup();
    const id = await asha.as.mutation(api.redemptions.redeem, { perkId, answers });
    await admin.as.mutation(api.redemptions.setStatus, { redemptionId: id, status: "in_progress" });
    expect(await errorCode(asha.as.mutation(api.redemptions.cancel, { redemptionId: id }))).toBe("CONFLICT");
    await admin.as.mutation(api.redemptions.setStatus, { redemptionId: id, status: "fulfilled", note: "Enjoy" });
    expect(await balance(asha)).toBe(150);
  });

  test("stock and the per-resident limit are enforced; a new month resets a monthly limit", async () => {
    const { t, admin, asha, ravi, perkId } = await setup();
    await asha.as.mutation(api.redemptions.redeem, { perkId, answers });
    expect(await errorCode(asha.as.mutation(api.redemptions.redeem, { perkId, answers }))).toBe("PERK_LIMIT_REACHED");
    await ravi.as.mutation(api.redemptions.redeem, { perkId, answers });
    const third = await createResident(t, admin);
    await admin.as.mutation(api.points.adjust, { residentId: third.residentId, points: 500, reason: "x" + "yz" });
    expect(await errorCode(third.as.mutation(api.redemptions.redeem, { perkId, answers }))).toBe("OUT_OF_STOCK");
    const unlimited = await admin.as.mutation(api.perks.create, { ...PERK, title: "Chai", costPoints: 10, stock: null, perResident: { kind: "total", count: 1 }, fields: [] });
    await asha.as.mutation(api.redemptions.redeem, { perkId: unlimited, answers: [] });
    expect(await errorCode(asha.as.mutation(api.redemptions.redeem, { perkId: unlimited, answers: [] }))).toBe("PERK_LIMIT_REACHED");
    setIndiaTime("2027-04-02T10:00:00");
    await admin.as.mutation(api.perks.update, { perkId, ...PERK, stock: 5 });
    await asha.as.mutation(api.redemptions.redeem, { perkId, answers }); // new month
  });

  test("not enough points, missing answers, hidden, out-of-date and paused are refused", async () => {
    const { admin, asha, perkId } = await setup();
    const pricey = await admin.as.mutation(api.perks.create, { ...PERK, title: "Weekend trip", costPoints: 1000, fields: [] });
    expect(await errorCode(asha.as.mutation(api.redemptions.redeem, { perkId: pricey, answers: [] }))).toBe("NOT_ENOUGH_POINTS");
    expect(await errorCode(asha.as.mutation(api.redemptions.redeem, { perkId, answers: [{ key: "f1", value: "Meera" }] }))).toBe("INVALID_INPUT");
    const hidden = await admin.as.mutation(api.perks.create, { ...PERK, title: "Secret", visibility: "hidden", fields: [] });
    expect(await errorCode(asha.as.mutation(api.redemptions.redeem, { perkId: hidden, answers: [] }))).toBe("NOT_FOUND");
    const later = await admin.as.mutation(api.perks.create, { ...PERK, title: "Holi party", availableFrom: "2027-03-20", fields: [] });
    expect(await errorCode(asha.as.mutation(api.redemptions.redeem, { perkId: later, answers: [] }))).toBe("NOT_FOUND");
    expect((await asha.as.query(api.perks.store, {})).perks.map((p) => [p.title, p.affordable])).toEqual([["Guest night", true], ["Weekend trip", false]]);
    await admin.as.mutation(api.residents.setPaused, { residentId: asha.residentId, paused: true, reason: "Checking" });
    expect(await errorCode(asha.as.mutation(api.redemptions.redeem, { perkId, answers }))).toBe("PAUSED");
  });

  test("residents can't use the admin's perk functions or touch others' redemptions", async () => {
    const { admin, asha, ravi, perkId } = await setup();
    const id = await ravi.as.mutation(api.redemptions.redeem, { perkId, answers });
    expect(await errorCode(asha.as.mutation(api.redemptions.cancel, { redemptionId: id }))).toBe("NOT_FOUND");
    expect(await errorCode(asha.as.mutation(api.redemptions.setStatus, { redemptionId: id, status: "fulfilled" }))).toBe("FORBIDDEN");
    expect(await errorCode(asha.as.mutation(api.perks.create, PERK))).toBe("FORBIDDEN");
    expect(await errorCode(asha.as.query(api.redemptions.queue, { paginationOpts: { numItems: 10, cursor: null } }))).toBe("FORBIDDEN");
    expect(await errorCode(asha.as.mutation(api.exports.download, { kind: "ledger", from: "2027-01-01", to: "2027-12-31" }))).toBe("FORBIDDEN");
    expect(await asha.as.query(api.redemptions.mine, {})).toEqual([]);
    expect((await admin.as.query(api.redemptions.queue, { paginationOpts: { numItems: 10, cursor: null }, status: "requested" })).page).toHaveLength(1);
  });
});

test("CSV export: a date range, safe cells, audit-logged", async () => {
  const { admin, asha, perkId } = await setup();
  await asha.as.mutation(api.redemptions.redeem, { perkId, answers: [{ key: "f1", value: "=HYPERLINK()" }, { key: "f2", value: "2027-03-20" }] });
  const { csv, filename } = await admin.as.mutation(api.exports.download, { kind: "redemptions", from: "2027-03-01", to: "2027-03-31" });
  expect(filename).toBe("float-redemptions-2027-03-01-to-2027-03-31.csv");
  expect(csv.split("\r\n")[1]).toContain("Guest night");
  expect(csv).toContain("Guest name: =HYPERLINK()"); // inside a cell, not at its start
  const points = await admin.as.mutation(api.exports.download, { kind: "points", from: "2027-03-01", to: "2027-03-31" });
  expect(points.csv.split("\r\n").filter(Boolean)).toHaveLength(1 + 2 + 1); // header, two grants, one redemption
  expect(await errorCode(admin.as.mutation(api.exports.download, { kind: "ledger", from: "2027-04-01", to: "2027-03-01" }))).toBe("INVALID_DATE");
});

export type { T };
