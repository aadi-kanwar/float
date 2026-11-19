/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import type * as access from "../access.js";
import type * as audit from "../audit.js";
import type * as auth from "../auth.js";
import type * as authLimits from "../authLimits.js";
import type * as crons from "../crons.js";
import type * as http from "../http.js";
import type * as lib_accounts from "../lib/accounts.js";
import type * as lib_audit from "../lib/audit.js";
import type * as lib_csv from "../lib/csv.js";
import type * as lib_errors from "../lib/errors.js";
import type * as lib_functions from "../lib/functions.js";
import type * as lib_inputRules from "../lib/inputRules.js";
import type * as lib_money from "../lib/money.js";
import type * as lib_settings from "../lib/settings.js";
import type * as lib_time from "../lib/time.js";
import type * as lib_validators from "../lib/validators.js";
import type * as properties from "../properties.js";
import type * as residents from "../residents.js";
import type * as settings from "../settings.js";
import type * as setup from "../setup.js";
import type * as sso from "../sso.js";
import type * as users from "../users.js";

/**
 * A utility for referencing Convex functions in your app's API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
declare const fullApi: ApiFromModules<{
  access: typeof access;
  audit: typeof audit;
  auth: typeof auth;
  authLimits: typeof authLimits;
  crons: typeof crons;
  http: typeof http;
  "lib/accounts": typeof lib_accounts;
  "lib/audit": typeof lib_audit;
  "lib/csv": typeof lib_csv;
  "lib/errors": typeof lib_errors;
  "lib/functions": typeof lib_functions;
  "lib/inputRules": typeof lib_inputRules;
  "lib/money": typeof lib_money;
  "lib/settings": typeof lib_settings;
  "lib/time": typeof lib_time;
  "lib/validators": typeof lib_validators;
  properties: typeof properties;
  residents: typeof residents;
  settings: typeof settings;
  setup: typeof setup;
  sso: typeof sso;
  users: typeof users;
}>;
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;
