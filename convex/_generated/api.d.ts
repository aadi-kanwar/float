/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as access from "../access.js";
import type * as audit from "../audit.js";
import type * as auth from "../auth.js";
import type * as authLimits from "../authLimits.js";
import type * as crons from "../crons.js";
import type * as draws from "../draws.js";
import type * as http from "../http.js";
import type * as lib_account from "../lib/account.js";
import type * as lib_accounts from "../lib/accounts.js";
import type * as lib_audit from "../lib/audit.js";
import type * as lib_csv from "../lib/csv.js";
import type * as lib_errors from "../lib/errors.js";
import type * as lib_functions from "../lib/functions.js";
import type * as lib_inputRules from "../lib/inputRules.js";
import type * as lib_ledger from "../lib/ledger.js";
import type * as lib_money from "../lib/money.js";
import type * as lib_rewards from "../lib/rewards.js";
import type * as lib_settings from "../lib/settings.js";
import type * as lib_terms from "../lib/terms.js";
import type * as lib_time from "../lib/time.js";
import type * as lib_validators from "../lib/validators.js";
import type * as money from "../money.js";
import type * as properties from "../properties.js";
import type * as repayments from "../repayments.js";
import type * as residents from "../residents.js";
import type * as settings from "../settings.js";
import type * as setup from "../setup.js";
import type * as sso from "../sso.js";
import type * as statements from "../statements.js";
import type * as terms from "../terms.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  access: typeof access;
  audit: typeof audit;
  auth: typeof auth;
  authLimits: typeof authLimits;
  crons: typeof crons;
  draws: typeof draws;
  http: typeof http;
  "lib/account": typeof lib_account;
  "lib/accounts": typeof lib_accounts;
  "lib/audit": typeof lib_audit;
  "lib/csv": typeof lib_csv;
  "lib/errors": typeof lib_errors;
  "lib/functions": typeof lib_functions;
  "lib/inputRules": typeof lib_inputRules;
  "lib/ledger": typeof lib_ledger;
  "lib/money": typeof lib_money;
  "lib/rewards": typeof lib_rewards;
  "lib/settings": typeof lib_settings;
  "lib/terms": typeof lib_terms;
  "lib/time": typeof lib_time;
  "lib/validators": typeof lib_validators;
  money: typeof money;
  properties: typeof properties;
  repayments: typeof repayments;
  residents: typeof residents;
  settings: typeof settings;
  setup: typeof setup;
  sso: typeof sso;
  statements: typeof statements;
  terms: typeof terms;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
