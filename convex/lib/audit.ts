import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { appError } from "./errors";

/**
 * Appends one row to the audit log (append-only: see lib/functions.ts).
 * Never put passwords, tokens or other secrets in `metadata`.
 */
export async function writeAudit(
  ctx: Pick<MutationCtx, "db">,
  entry: {
    actorUserId: Id<"users"> | undefined;
    action: string;
    entityType: string;
    entityId: string;
    residentId?: Id<"residents">;
    reason?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await ctx.db.insert("auditLog", { ...entry, createdAt: Date.now() });
}

/** A reason is required for every admin override. */
export function requireReason(reason: string | undefined): string {
  const text = (reason ?? "").trim();
  if (text.length < 3 || text.length > 300) {
    throw appError("REASON_REQUIRED");
  }
  return text;
}
