/** Admin: the active properties (for pickers). Adding and renaming is in convex/organization.ts. */
import { adminQuery } from "./lib/functions";
import { activeProperties } from "./lib/org";

export const list = adminQuery({
  args: {},
  handler: async (ctx) => (await activeProperties(ctx)).map((p) => ({ propertyId: p._id, name: p.name, fromHub: p.hubPropertyId !== undefined })),
});
