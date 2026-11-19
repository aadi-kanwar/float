/// <reference types="vite/client" />
// Shared helpers for backend tests. The double extension keeps Convex from
// deploying this file as a backend module.
import { convexTest } from "convex-test";
import { exportJWK, exportPKCS8, generateKeyPair } from "jose";
import { vi } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";

export const modules = import.meta.glob("../**/*.ts");

/** Keys Convex Auth needs to issue login tokens inside tests. */
async function configureAuthEnv() {
  if (process.env.JWT_PRIVATE_KEY) return;
  const { privateKey, publicKey } = await generateKeyPair("RS256", {
    extractable: true,
  });
  process.env.JWT_PRIVATE_KEY = (await exportPKCS8(privateKey))
    .trimEnd()
    .replace(/\n/g, " ");
  process.env.JWKS = JSON.stringify({
    keys: [{ use: "sig", ...(await exportJWK(publicKey)) }],
  });
  process.env.CONVEX_SITE_URL = "https://test.convex.site";
  process.env.SITE_URL = "http://localhost:3000";
}

/** Fixes "now" (only Date; timers keep working). Noon IST on `date`. */
export function setToday(date: string) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${date}T06:30:00Z`));
}

export async function setupTest(today = "2027-04-20") {
  await configureAuthEnv();
  setToday(today);
  return convexTest(schema, modules);
}

export type T = Awaited<ReturnType<typeof setupTest>>;

let phoneCounter = 0;
export function nextPhone() {
  phoneCounter += 1;
  return `+9198${String(phoneCounter).padStart(8, "0")}`;
}

/** A client signed in as `userId` (a fresh session). */
export async function signedInAs(t: T, userId: Id<"users">) {
  const sessionId = await t.run(async (ctx) =>
    ctx.db.insert("authSessions", {
      userId,
      expirationTime: Date.now() + 3_600_000,
    }),
  );
  return t.withIdentity({ subject: `${userId}|${sessionId}` });
}

/** An admin account (as the seed or the hub would make it). */
export async function createAdmin(t: T, name = "Test Admin") {
  const phone = nextPhone();
  const userId = await t.run(async (ctx) => ctx.db.insert("users", { phone, role: "admin", name }));
  return { userId, phone, as: await signedInAs(t, userId) };
}

export type Admin = Awaited<ReturnType<typeof createAdmin>>;

export const PASSWORD = "plain-tea-42";

/**
 * A resident created through the real admin action, already past the
 * first-login password change.
 */
export async function createResident(
  t: T,
  admin: Admin,
  details: Partial<{ name: string; depositRupees: number; roomNumber: string; phone: string }> = {},
) {
  const phone = details.phone ?? nextPhone();
  const { residentId } = await admin.as.action(api.residents.create, {
    name: details.name ?? "Test Resident",
    phone,
    roomNumber: details.roomNumber ?? "101",
    depositRupees: details.depositRupees ?? 10_000,
    temporaryPassword: PASSWORD,
  });
  const userId = await t.run(async (ctx) => {
    const r = (await ctx.db.get(residentId))!;
    await ctx.db.patch(r.userId, { mustChangePassword: false });
    return r.userId;
  });
  return { residentId, userId, phone, as: await signedInAs(t, userId) };
}

export type Resident = Awaited<ReturnType<typeof createResident>>;

/** The ConvexError code thrown by `promise`, or "NO_ERROR". */
export async function errorCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "NO_ERROR";
  } catch (error) {
    const data = (error as { data?: unknown }).data;
    if (data && typeof data === "object" && "code" in data)
      return String(data.code);
    return `UNEXPECTED: ${(error as Error).message}`;
  }
}

/** Sets "now" to an India time, e.g. "2027-04-30T23:59:00". */
export function setIndiaTime(local: string) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${local}+05:30`));
}

/** Moves "now" forward by `ms` (fake timers). */
export function advance(ms: number) {
  vi.setSystemTime(new Date(Date.now() + ms));
}

export const HOUR = 60 * 60 * 1000;
