import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/**
 * Runs after every confirmed payment or deposit settlement. Points for
 * on-time statements are added here in the points phase.
 */
export async function afterCredit(
  _ctx: Pick<MutationCtx, "db">,
  _residentId: Id<"residents">,
  _actorUserId: Id<"users"> | undefined,
): Promise<void> {
  void _ctx;
  void _residentId;
  void _actorUserId;
}
