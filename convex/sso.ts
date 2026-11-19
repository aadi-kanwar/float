/**
 * Livoza Hub: what the website needs to know about the hub. Not secret.
 * (Ticket sign-in and sync are added in the single sign-on phase.)
 */
import { v } from "convex/values";
import { viewerQuery } from "./lib/functions";

/** The hub's address, for the "open it again from the Livoza Hub" button. */
export const hubOrigin = viewerQuery({
  args: {},
  returns: v.union(v.string(), v.null()),
  handler: async () => process.env.HUB_ORIGIN ?? null,
});

/**
 * Whether Float's own sign-in is switched off (HUB_ONLY=true, once everyone
 * uses the Livoza Hub), and where to send people instead.
 */
export const hubSettings = viewerQuery({
  args: {},
  returns: v.object({ hubOnly: v.boolean(), openUrl: v.union(v.string(), v.null()) }),
  handler: async () => {
    const origin = process.env.HUB_ORIGIN ?? null;
    return { hubOnly: process.env.HUB_ONLY === "true" && origin !== null, openUrl: origin ? `${origin}/open/float` : null };
  },
});
