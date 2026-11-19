"use node";

import { v } from "convex/values";
import { internalAction } from "./lib/functions";
import {
  hubTicketSettingsFromEnv,
  verifyHubExport,
  verifyHubPersonTicket,
  verifyHubSync,
  type HubPersonTicket,
  type HubSync,
} from "./lib/ssoTicket";

/**
 * Checks what the Livoza Hub signed (Node.js, for its built-in Ed25519
 * support). Internal: only the `hub-sso` login provider and the hub's web
 * endpoints call these. Each returns null for any problem.
 */
export const verifyPersonTicket = internalAction({
  args: { ticket: v.string() },
  handler: async (_ctx, { ticket }): Promise<HubPersonTicket | null> => await verifyHubPersonTicket(ticket, hubTicketSettingsFromEnv()),
});

export const verifySync = internalAction({
  args: { token: v.string() },
  handler: async (_ctx, { token }): Promise<HubSync | null> => await verifyHubSync(token, hubTicketSettingsFromEnv()),
});

export const verifyExport = internalAction({
  args: { token: v.string() },
  returns: v.union(v.null(), v.object({ jti: v.string() })),
  handler: async (_ctx, { token }) => await verifyHubExport(token, hubTicketSettingsFromEnv()),
});
