/// <reference types="vite/client" />
import { expect, test } from "vitest";
import { api, internal } from "../_generated/api";
import { guardedDb } from "../lib/functions";

import { createAdmin, createResident, errorCode, setupTest, signedInAs, PASSWORD } from "./harness.test-utils";
const PAGE = { numItems: 50, cursor: null };

test("an admin creates a resident who must change the temporary password", async () => {
  const t = await setupTest();
  const admin = await createAdmin(t);
  const { residentId } = await admin.as.action(api.residents.create, {
    name: "Asha Rao",
    phone: "98765 43210",
    roomNumber: "204",
    depositRupees: 8000,
    temporaryPassword: PASSWORD,
  });
  const r = await admin.as.query(api.residents.get, { residentId });
  expect(r).toMatchObject({ phone: "+919876543210", depositPaise: 800_000, limitPaise: 500_000, mustChangePassword: true });
  const userId = await t.run(async (ctx) => (await ctx.db.get(residentId))!.userId);
  const as = await signedInAs(t, userId);
  expect(await errorCode(as.query(api.settings.get, {}))).toBe("FORBIDDEN");
  // Same number twice is refused.
  expect(
    await errorCode(
      admin.as.action(api.residents.create, {
        name: "Someone Else",
        phone: "+919876543210",
        depositRupees: 0,
        temporaryPassword: PASSWORD,
      }),
    ),
  ).toBe("CONFLICT");
});

test("a resident can't use any admin function", async () => {
  const t = await setupTest();
  const admin = await createAdmin(t);
  const asha = await createResident(t, admin, { name: "Asha Rao" });
  const ravi = await createResident(t, admin, { name: "Ravi Kumar" });
  expect(await errorCode(asha.as.query(api.residents.list, {}))).toBe("FORBIDDEN");
  expect(await errorCode(asha.as.query(api.residents.get, { residentId: ravi.residentId }))).toBe("FORBIDDEN");
  expect(
    await errorCode(asha.as.mutation(api.residents.setLimit, { residentId: asha.residentId, limitRupees: 99_999, reason: "please" })),
  ).toBe("FORBIDDEN");
  expect(await errorCode(asha.as.mutation(api.residents.setPaused, { residentId: ravi.residentId, paused: true, reason: "nope" }))).toBe(
    "FORBIDDEN",
  );
  expect(await errorCode(asha.as.action(api.residents.resetPassword, { residentId: ravi.residentId }))).toBe("FORBIDDEN");
  expect(await errorCode(asha.as.query(api.audit.list, { paginationOpts: PAGE }))).toBe("FORBIDDEN");
  const s = await admin.as.query(api.settings.get, {});
  expect(
    await errorCode(asha.as.mutation(api.settings.save, { values: s.values, expectedVersion: s.version })),
  ).toBe("FORBIDDEN");
  expect(await errorCode(t.query(api.residents.list, {}))).toBe("NOT_SIGNED_IN");
});

test("overrides need a reason and are audit-logged with old and new values", async () => {
  const t = await setupTest();
  const admin = await createAdmin(t);
  const asha = await createResident(t, admin);
  expect(
    await errorCode(admin.as.mutation(api.residents.setLimit, { residentId: asha.residentId, limitRupees: 3000, reason: " " })),
  ).toBe("REASON_REQUIRED");
  await admin.as.mutation(api.residents.setLimit, { residentId: asha.residentId, limitRupees: 3000, reason: "New joiner" });
  await admin.as.mutation(api.residents.setPaused, { residentId: asha.residentId, paused: true, reason: "Left for a month" });
  const log = (await admin.as.query(api.audit.list, { residentId: asha.residentId, paginationOpts: PAGE })).page;
  expect(log.map((l) => l.action)).toEqual(["resident.paused", "resident.limit_changed", "resident.created"]);
  expect(log[1]).toMatchObject({ reason: "New joiner", metadata: { before: null, after: 300_000 } });
});

test("settings: versioned, audit-logged, validated, and stale saves are refused", async () => {
  const t = await setupTest();
  const admin = await createAdmin(t);
  const s = await admin.as.query(api.settings.get, {});
  expect(s.values.pointsName).toBe("Points");
  await admin.as.mutation(api.settings.save, {
    values: { ...s.values, pointsName: "Floats", lateFeeCapPaise: 50_000 },
    expectedVersion: s.version,
  });
  const after = await admin.as.query(api.settings.get, {});
  expect(after.version).toBe(1);
  expect(after.values.pointsName).toBe("Floats");
  expect(
    await errorCode(admin.as.mutation(api.settings.save, { values: s.values, expectedVersion: s.version })),
  ).toBe("CONFLICT");
  expect(
    await errorCode(admin.as.mutation(api.settings.save, { values: { ...after.values, feeBasisPoints: 9000 }, expectedVersion: 1 })),
  ).toBe("INVALID_INPUT");
  const [entry] = (await admin.as.query(api.audit.list, { action: "settings.changed", paginationOpts: PAGE })).page;
  expect(entry.metadata).toEqual({
    before: { pointsName: "Points", lateFeeCapPaise: null },
    after: { pointsName: "Floats", lateFeeCapPaise: 50_000 },
  });
  expect((await admin.as.query(api.settings.history, {})).length).toBe(1);
});

test("history tables are append-only", async () => {
  const t = await setupTest();
  const admin = await createAdmin(t);
  await createResident(t, admin);
  await t.run(async (ctx) => {
    const db = guardedDb(ctx);
    const row = (await ctx.db.query("auditLog").first())!;
    await expect(db.patch(row._id, { action: "changed" })).rejects.toThrow();
    await expect(db.delete(row._id)).rejects.toThrow();
  });
});

test("the first admin is made once, from the seed values", async () => {
  const t = await setupTest();
  process.env.SEED_ADMIN_PHONE = "+919000000001";
  process.env.SEED_ADMIN_PASSWORD = "first-admin-pass";
  process.env.SEED_ADMIN_NAME = "Owner";
  await t.action(internal.setup.createFirstAdmin, {});
  expect(await errorCode(t.action(internal.setup.createFirstAdmin, {}))).toBe("CONFLICT");
  const owner = await t.run(async (ctx) => ctx.db.query("users").withIndex("phone", (q) => q.eq("phone", "+919000000001")).unique());
  expect(owner).toMatchObject({ role: "admin", name: "Owner" });
  delete process.env.SEED_ADMIN_PASSWORD;
});
