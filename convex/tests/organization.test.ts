/// <reference types="vite/client" />
import { expect, test } from "vitest";
import { api } from "../_generated/api";
import { createAdmin, createResident, errorCode, setupTest } from "./harness.test-utils";

test("the organisation is set up once, with its first property; more are added and renamed in Settings", async () => {
  const t = await setupTest();
  const admin = await createAdmin(t);
  expect((await admin.as.query(api.users.me, {}))?.organization).toBeNull();
  await admin.as.mutation(api.organization.create, { name: "Livoza Stays", propertyName: "Livoza Koramangala" });
  expect(await errorCode(admin.as.mutation(api.organization.create, { name: "Again", propertyName: "X PG" }))).toBe("CONFLICT");
  const b = await admin.as.mutation(api.organization.addProperty, { name: "Livoza Indiranagar" });
  expect(await errorCode(admin.as.mutation(api.organization.addProperty, { name: "livoza indiranagar" }))).toBe("CONFLICT");
  await admin.as.mutation(api.organization.renameProperty, { targetPropertyId: b, name: "Livoza HSR" });
  await admin.as.mutation(api.organization.rename, { name: "Livoza" });
  const me = await admin.as.query(api.users.me, {});
  expect(me?.organization).toMatchObject({ name: "Livoza", properties: [{ name: "Livoza HSR" }, { name: "Livoza Koramangala" }] });
  const log = await t.run((ctx) => ctx.db.query("auditLog").collect());
  expect(log.map((l) => l.action)).toEqual(expect.arrayContaining(["organization.created", "property.added", "property.renamed", "organization.renamed"]));
});

test("admin screens show one property or all", async () => {
  const t = await setupTest();
  const admin = await createAdmin(t);
  const { propertyId: a } = await admin.as.mutation(api.organization.create, { name: "Livoza", propertyName: "PG A" });
  const b = await admin.as.mutation(api.organization.addProperty, { name: "PG B" });
  const asha = await createResident(t, admin, { name: "Asha" });
  const ravi = await createResident(t, admin, { name: "Ravi" });
  await admin.as.mutation(api.residents.update, { residentId: asha.residentId, name: "Asha", propertyId: a });
  await admin.as.mutation(api.residents.update, { residentId: ravi.residentId, name: "Ravi", propertyId: b });
  for (const r of [asha, ravi]) {
    await r.as.mutation(api.terms.accept, { version: 0 });
    await r.as.mutation(api.draws.request, { amountRupees: 500 });
  }
  expect((await admin.as.query(api.draws.queue, {})).map((d) => d.residentName).sort()).toEqual(["Asha", "Ravi"]);
  expect((await admin.as.query(api.draws.queue, { propertyId: a })).map((d) => d.residentName)).toEqual(["Asha"]);
  expect((await admin.as.query(api.residents.list, { propertyId: b })).map((r) => r.name)).toEqual(["Ravi"]);
  expect((await admin.as.query(api.money.overview, { propertyId: b })).drawsPending).toBe(1);
  expect((await admin.as.query(api.money.overview, {})).drawsPending).toBe(2);
  const cal = await admin.as.query(api.money.calendar, { month: "2027-04", propertyId: a });
  expect(cal.events.filter((e) => e.kind === "draw_asked").map((e) => e.residentName)).toEqual(["Asha"]);
  // The resident sees only their own property.
  expect((await asha.as.query(api.users.me, {}))).toMatchObject({ organization: null, propertyName: "PG A" });
});
