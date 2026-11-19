import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { awardPoints } from "./points";

/**
 * Runs after every confirmed payment, waiver, reversal or deposit
 * settlement: gives points for statements now paid on time (or takes them
 * back if a reversal undid that).
 */
export async function afterCredit(
  ctx: Pick<MutationCtx, "db">,
  residentId: Id<"residents">,
  actorUserId: Id<"users"> | undefined,
): Promise<void> {
  await awardPoints(ctx, residentId, actorUserId);
}
