import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { auth } from "./auth";
import { hubSignedHttpAction } from "./lib/functions";
import { bearerToken } from "./lib/ssoTicket";

const http = httpRouter();

// Login endpoints used by Convex Auth.
auth.addHttpRoutes(http);

/**
 * Livoza Hub sync: one person or PG, in a token the hub signed for audience
 * "float-sync". Float is made to match it; a sync with `revoke` ends that
 * person's Float logins (the hub's "revoke in all apps"). 401 for anything else.
 */
http.route({
  path: "/sso/sync",
  method: "POST",
  handler: hubSignedHttpAction(async (ctx, request) => {
    const token = bearerToken(request);
    const sync = token ? await ctx.runAction(internal.ssoNode.verifySync, { token }) : null;
    if (sync === null) return Response.json({ ok: false }, { status: 401 });
    const applied =
      sync.kind === "person"
        ? await ctx.runMutation(internal.sso.applySync, {
            jti: sync.jti,
            person: {
              hubUserId: sync.hubUserId,
              phone: sync.phone,
              name: sync.name,
              profileType: sync.profileType,
              role: sync.role,
              properties: sync.properties,
              roomNumber: sync.roomNumber,
              active: sync.active,
              revoke: sync.revoke,
            },
          })
        : await ctx.runMutation(internal.sso.applySync, { jti: sync.jti, property: { id: sync.property.id, name: sync.property.name, organizationName: sync.property.organizationName } });
    if (!applied) return Response.json({ ok: false }, { status: 401 });
    return Response.json({ ok: true });
  }),
});

/** Livoza Hub import: everyone and every PG, for a token signed for audience "float-export". */
http.route({
  path: "/sso/export",
  method: "POST",
  handler: hubSignedHttpAction(async (ctx, request) => {
    const token = bearerToken(request);
    const checked = token ? await ctx.runAction(internal.ssoNode.verifyExport, { token }) : null;
    const data = checked ? await ctx.runMutation(internal.sso.exportForImport, checked) : null;
    if (data === null) return Response.json({ ok: false }, { status: 401 });
    return Response.json({ ok: true, ...data });
  }),
});

export default http;
