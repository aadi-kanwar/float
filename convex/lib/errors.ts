import { ConvexError } from "convex/values";

/**
 * Error codes the browser can recognise. Messages are written for admins
 * and residents, never for programmers, and never reveal private details.
 */
export type AppErrorCode =
  | "NOT_SIGNED_IN"
  | "PASSWORD_CHANGE_REQUIRED"
  | "ACCOUNT_DISABLED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INVALID_INPUT"
  | "CONFLICT"
  | "SIGN_IN_FAILED"
  | "TOO_MANY_ATTEMPTS"
  | "INVALID_PHONE"
  | "WEAK_PASSWORD"
  | "INVALID_DATE"
  | "SSO_LINK_EXPIRED"
  | "USE_HUB"
  | "REASON_REQUIRED"
  | "PAUSED"
  | "LIMIT_EXCEEDED"
  | "OVERDUE_FROZEN"
  | "TERMS_REQUIRED"
  | "NOT_ENOUGH_POINTS"
  | "OUT_OF_STOCK"
  | "PERK_LIMIT_REACHED";

export type AppErrorData = { code: AppErrorCode; message: string };

export const DEFAULT_MESSAGES: Record<AppErrorCode, string> = {
  NOT_SIGNED_IN: "Please sign in to continue.",
  PASSWORD_CHANGE_REQUIRED: "Please choose a new password first.",
  ACCOUNT_DISABLED:
    "This account has been switched off. Please contact the office.",
  FORBIDDEN: "You don't have permission to do that.",
  NOT_FOUND: "We couldn't find that. It may have been removed.",
  INVALID_INPUT: "Some details aren't valid. Please check and try again.",
  CONFLICT: "That has already been done.",
  SIGN_IN_FAILED:
    "That mobile number and password didn't work. Please check and try again.",
  TOO_MANY_ATTEMPTS: "Too many attempts. Please wait 15 minutes and try again.",
  INVALID_PHONE: "Enter a valid mobile number.",
  WEAK_PASSWORD: "Please choose a stronger password.",
  INVALID_DATE: "That date can't be used here.",
  // Deliberately the same for every Admin Hub sign-in failure: never say why.
  SSO_LINK_EXPIRED: "This link has expired. Open it again from the Livoza Hub.",
  USE_HUB: "Float now uses the Livoza Hub to sign in. Sign in there, then open Float.",
  REASON_REQUIRED: "Please give a reason (at least 3 characters).",
  PAUSED: "Your account is paused. Please contact the office.",
  LIMIT_EXCEEDED: "That's more than you can draw right now.",
  OVERDUE_FROZEN: "Please clear your overdue amount before drawing again.",
  TERMS_REQUIRED: "Please read and accept the terms first.",
  NOT_ENOUGH_POINTS: "You don't have enough points for this.",
  OUT_OF_STOCK: "Sorry, this perk is out of stock.",
  PERK_LIMIT_REACHED: "You've already redeemed this perk as many times as allowed.",
};

export function appError(
  code: AppErrorCode,
  message?: string,
): ConvexError<AppErrorData> {
  return new ConvexError({ code, message: message ?? DEFAULT_MESSAGES[code] });
}
