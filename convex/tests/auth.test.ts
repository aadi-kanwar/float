/// <reference types="vite/client" />
import { expect, test } from "vitest";
import { api, internal } from "../_generated/api";
import { FAILED_ATTEMPTS_LIMIT } from "../authLimits";
import { PASSWORD, advance, createAdmin, createResident, errorCode, nextPhone, setupTest, signedInAs, type T } from "./harness.test-utils";

const signIn = (t: T, phone: string, password: string, extra: Record<string, string> = {}) =>
  t.action(api.auth.signIn, { provider: "phone-password", params: { phone, password, ...extra } });

test("wrong password and unknown number give the same error", async () => {
  const t = await setupTest();
  await t.action(internal.setup.createFirstAdmin, { phone: "9876543210", password: PASSWORD, name: "Owner" });
  expect((await signIn(t, "98765 43210", PASSWORD)).tokens?.token).toBeTruthy();
  expect(await errorCode(signIn(t, "9876543210", "wrong-password"))).toBe("SIGN_IN_FAILED");
  expect(await errorCode(signIn(t, "9123456780", PASSWORD))).toBe("SIGN_IN_FAILED");
});

test("5 failed attempts lock the number for 15 minutes", async () => {
  const t = await setupTest();
  await t.action(internal.setup.createFirstAdmin, { phone: "9876543210", password: PASSWORD, name: "Owner" });
  expect(FAILED_ATTEMPTS_LIMIT).toBe(5);
  for (let i = 0; i < 5; i += 1) expect(await errorCode(signIn(t, "9876543210", "nope-nope-1"))).toBe("SIGN_IN_FAILED");
  // Even the right password is refused while locked.
  expect(await errorCode(signIn(t, "9876543210", PASSWORD))).toBe("TOO_MANY_ATTEMPTS");
  advance(14 * 60 * 1000);
  expect(await errorCode(signIn(t, "9876543210", PASSWORD))).toBe("TOO_MANY_ATTEMPTS");
  advance(2 * 60 * 1000);
  expect((await signIn(t, "9876543210", PASSWORD)).tokens?.token).toBeTruthy();
});

test("there is no self sign-up", async () => {
  const t = await setupTest();
  expect(await errorCode(signIn(t, nextPhone(), PASSWORD, { flow: "signUp" }))).toBe("FORBIDDEN");
});

test("a new resident must change the temporary password before anything else", async () => {
  const t = await setupTest();
  const admin = await createAdmin(t);
  const phone = nextPhone();
  const { residentId } = await admin.as.action(api.residents.create, {
    name: "Ravi Kumar",
    phone,
    depositRupees: 5000,
    temporaryPassword: PASSWORD,
  });
  expect((await signIn(t, phone, PASSWORD)).tokens?.token).toBeTruthy();
  const userId = await t.run(async (ctx) => (await ctx.db.get(residentId))!.userId);
  const as = await signedInAs(t, userId);
  expect((await as.query(api.users.me, {}))?.mustChangePassword).toBe(true);
  await as.action(api.users.changePassword, { newPassword: "my-own-secret-9" });
  const me = await as.query(api.users.me, {});
  expect(me).toMatchObject({ mustChangePassword: false, role: "resident", residentActive: true, pointsName: "Points" });
  expect((await signIn(t, phone, "my-own-secret-9")).tokens?.token).toBeTruthy();
});

test("only the admin resets a password; the temporary one is never logged", async () => {
  const t = await setupTest();
  const admin = await createAdmin(t);
  const ravi = await createResident(t, admin);
  const { temporaryPassword } = await admin.as.action(api.residents.resetPassword, { residentId: ravi.residentId });
  expect(temporaryPassword).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}$/);
  expect((await signIn(t, ravi.phone, temporaryPassword)).tokens?.token).toBeTruthy();
  expect(await errorCode(signIn(t, ravi.phone, PASSWORD))).toBe("SIGN_IN_FAILED");
  const audit = await t.run((ctx) => ctx.db.query("auditLog").collect());
  expect(audit.map((a) => a.action)).toContain("resident.password_reset");
  expect(JSON.stringify(audit)).not.toContain(temporaryPassword);
  expect(JSON.stringify(audit)).not.toContain(PASSWORD);
});
