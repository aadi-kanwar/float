/// <reference types="vite/client" />
import { exportSPKI, generateKeyPair, SignJWT, type CryptoKey, type JWTPayload } from "jose";
import { beforeAll, describe, expect, test } from "vitest";
import { api } from "../_generated/api";
import { SSO_SESSION_MS } from "../lib/ssoTicket";
import { createAdmin, createResident, errorCode, setupTest, signedInAs, type T } from "./harness.test-utils";

const HUB = "https://admin.example.test";
const PHONE = "+919812345678";

let hubKey: CryptoKey;
let otherKey: CryptoKey;

beforeAll(async () => {
  const hub = await generateKeyPair("EdDSA", { extractable: true });
  hubKey = hub.privateKey;
  otherKey = (await generateKeyPair("EdDSA", { extractable: true })).privateKey;
  // Stored the way it is on the real deployment: one line, "\n" written out.
  process.env.HUB_SSO_PUBLIC_KEY = (await exportSPKI(hub.publicKey)).trim().replace(/\n/g, "\\n");
  process.env.HUB_ORIGIN = HUB;
});

let jtiCounter = 0;

/** A token as the hub signs it; `overrides` change claims (undefined removes one). */
async function sign(overrides: JWTPayload = {}, key: CryptoKey = hubKey) {
  const now = Math.floor(Date.now() / 1000);
  jtiCounter += 1;
  const claims: JWTPayload = {
    iss: HUB,
    aud: "float",
    sub: "hubAdmin1",
    phone: PHONE,
    name: "Meera Kapoor",
    profileType: "admin",
    role: "admin",
    properties: "*",
    jti: `nonce-${jtiCounter}`,
    iat: now,
    exp: now + 60,
    ...overrides,
  };
  for (const [k, value] of Object.entries(claims)) if (value === undefined) delete claims[k];
  return await new SignJWT(claims).setProtectedHeader({ alg: "EdDSA" }).sign(key);
}

const RESIDENT_CLAIMS = {
  sub: "hubRes1",
  phone: "+919811111111",
  name: "Kabir Singh",
  profileType: "resident",
  role: "resident",
  roomNumber: "305",
  properties: [{ id: "hubPg1", name: "Livoza Koramangala" }],
};

const ssoSignIn = (t: T, ticket: string) => t.action(api.auth.signIn, { provider: "hub-sso", params: { ticket } });
const userByPhone = (t: T, phone: string) => t.run((ctx) => ctx.db.query("users").withIndex("phone", (q) => q.eq("phone", phone)).first());
const sessionsOf = (t: T, userId: string) =>
  t.run((ctx) => ctx.db.query("authSessions").withIndex("userId", (q) => q.eq("userId", userId as never)).collect());

describe("10. Livoza Hub sign-in", () => {
  test("a valid admin ticket gives Float's Admin role and a 12-hour login", async () => {
    const t = await setupTest();
    const result = await ssoSignIn(t, await sign());
    expect(result.tokens?.token).toBeTruthy();
    const user = (await userByPhone(t, PHONE))!;
    expect(user).toMatchObject({ role: "admin", name: "Meera Kapoor", ssoManaged: true, hubUserId: "hubAdmin1" });
    const [session] = await sessionsOf(t, user._id);
    expect(session.expirationTime - Date.now()).toBeGreaterThan(SSO_SESSION_MS - 60_000);
    expect(session.expirationTime - Date.now()).toBeLessThanOrEqual(SSO_SESSION_MS);
    const as = await signedInAs(t, user._id);
    expect((await as.query(api.users.me, {}))?.hubLink).toBe(HUB);
    await as.query(api.residents.list, {}); // admin functions work
  });

  test("a valid resident ticket makes (or updates) the resident; deposit and limit stay Float's", async () => {
    const t = await setupTest();
    const admin = await createAdmin(t);
    await ssoSignIn(t, await sign(RESIDENT_CLAIMS));
    const list = await admin.as.query(api.residents.list, {});
    expect(list).toMatchObject([{ name: "Kabir Singh", roomNumber: "305", propertyName: "Livoza Koramangala", depositPaise: 0, fromHub: true }]);
    await admin.as.mutation(api.residents.setDeposit, { residentId: list[0].residentId, depositRupees: 6000, reason: "Paid at check-in" });
    await ssoSignIn(t, await sign({ ...RESIDENT_CLAIMS, roomNumber: "306" }));
    expect((await admin.as.query(api.residents.list, {}))[0]).toMatchObject({ roomNumber: "306", depositPaise: 600_000 });
  });

  test("expired, wrong audience, wrong issuer, tampered, wrong role and reused tickets are refused the same way", async () => {
    const t = await setupTest();
    const now = Math.floor(Date.now() / 1000);
    const refused = [
      await sign({ iat: now - 600, exp: now - 540 }), // expired
      await sign({ aud: "crate" }), // another app's ticket
      await sign({ iss: "https://evil.example" }),
      await sign({}, otherKey), // not signed by the hub
      (await sign()).replace(/\.([^.]+)\./, (_m, body: string) => `.${body.slice(0, -2)}AA.`), // tampered
      await sign({ role: "warden", profileType: "warden" }), // no Float role
      await sign({ role: "manager" }),
      await sign({ role: "admin", profileType: "resident" }), // a resident can't be made admin
      await sign({ role: "master_admin" }), // the old kind
      await sign({ phone: undefined }),
      "not-a-ticket",
    ];
    for (const ticket of refused) expect(await errorCode(ssoSignIn(t, ticket))).toBe("SSO_LINK_EXPIRED");
    const once = await sign();
    await ssoSignIn(t, once);
    expect(await errorCode(ssoSignIn(t, once))).toBe("SSO_LINK_EXPIRED"); // reused
    expect(await t.run((ctx) => ctx.db.query("users").collect())).toHaveLength(1);
  });

  test("an admin ticket never changes a resident account (same number)", async () => {
    const t = await setupTest();
    const admin = await createAdmin(t);
    const asha = await createResident(t, admin, { phone: PHONE });
    const before = await t.run(async (ctx) => [await ctx.db.get(asha.userId), await ctx.db.get(asha.residentId)]);
    expect(await errorCode(ssoSignIn(t, await sign()))).toBe("SSO_LINK_EXPIRED");
    const after = await t.run(async (ctx) => [await ctx.db.get(asha.userId), await ctx.db.get(asha.residentId)]);
    expect(after).toEqual(before);
    expect((await sessionsOf(t, asha.userId)).length).toBe(1); // only the test's own session
    const log = await t.run((ctx) => ctx.db.query("auditLog").collect());
    expect(log.map((l) => l.action)).toContain("hub.role_conflict");
  });

  test("an admin signing in through the hub never touches any resident", async () => {
    const t = await setupTest();
    const admin = await createAdmin(t);
    await createResident(t, admin);
    await createResident(t, admin);
    const before = await t.run((ctx) => ctx.db.query("residents").collect());
    await ssoSignIn(t, await sign());
    expect(await t.run((ctx) => ctx.db.query("residents").collect())).toEqual(before);
  });
});

describe("hub sync and export", () => {
  const post = (t: T, path: string, token?: string) =>
    t.fetch(path, { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {} });

  test("sync: switching someone off ends their logins; revoke signs them out; replays and unsigned requests get 401", async () => {
    const t = await setupTest();
    await ssoSignIn(t, await sign(RESIDENT_CLAIMS));
    const user = (await userByPhone(t, RESIDENT_CLAIMS.phone))!;
    expect((await sessionsOf(t, user._id)).length).toBe(1);

    const revoke = await sign({ ...RESIDENT_CLAIMS, aud: "float-sync", kind: "person", active: true, revoke: true });
    expect((await post(t, "/sso/sync", revoke)).status).toBe(200);
    expect((await sessionsOf(t, user._id)).length).toBe(0);
    expect((await post(t, "/sso/sync", revoke)).status).toBe(401); // used once
    expect((await post(t, "/sso/sync")).status).toBe(401);
    expect((await post(t, "/sso/sync", await sign({ ...RESIDENT_CLAIMS, kind: "person", active: true }))).status).toBe(401); // a sign-in ticket isn't a sync

    await post(t, "/sso/sync", await sign({ ...RESIDENT_CLAIMS, aud: "float-sync", kind: "person", active: false, revoke: true }));
    expect((await userByPhone(t, RESIDENT_CLAIMS.phone))?.disabled).toBe(true);
  });

  test("sync of a PG links it by name; export lists people and PGs", async () => {
    const t = await setupTest();
    const admin = await createAdmin(t);
    await admin.as.mutation(api.properties.add, { name: "Livoza Indiranagar" });
    const res = await post(t, "/sso/sync", await sign({ aud: "float-sync", sub: "hubPg9", kind: "property", property: { id: "hubPg9", name: "Livoza Indiranagar", organizationName: "Livoza" } }));
    expect(res.status).toBe(200);
    const pgs = await admin.as.query(api.properties.list, {});
    expect(pgs).toMatchObject([{ name: "Livoza Indiranagar", fromHub: true }]);
    await createResident(t, admin, { name: "Asha Rao" });
    const out = await post(t, "/sso/export", await sign({ aud: "float-export", sub: "import" }));
    const body = (await out.json()) as { ok: boolean; people: { name: string; hubType: string; passwordHash: string | null }[] };
    expect(body.ok).toBe(true);
    expect(body.people.map((p) => [p.name, p.hubType])).toEqual(expect.arrayContaining([["Asha Rao", "resident"]]));
    expect(body.people.find((p) => p.name === "Asha Rao")?.passwordHash).toBeTruthy();
  });
});
