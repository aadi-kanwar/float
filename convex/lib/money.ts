import { ConvexError } from "convex/values";

/**
 * Indian rupee formatting (en-IN grouping, ₹). Money is stored as integer
 * paise; `formatPaise` shows paise only when there are any.
 */
const whole = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});
const exact = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** An amount in rupees: whole rupees, or with paise when `exact` and not whole. */
export function formatINR(
  amount: number,
  options: { exact?: boolean } = {},
): string {
  const value = options.exact
    ? Math.round(amount * 100) / 100
    : Math.round(amount);
  const text = (
    options.exact && !Number.isInteger(value) ? exact : whole
  ).format(Math.abs(value));
  return value < 0 ? `−${text}` : text;
}

/** Integer paise as "₹1,250" or "₹42.50". */
export function formatPaise(paise: number): string {
  return formatINR(paise / 100, { exact: true });
}

/** Whole rupees typed in a form -> integer paise. Refuses fractions and non-numbers. */
export function rupeesToPaise(rupees: number): number {
  if (!Number.isFinite(rupees) || !Number.isInteger(rupees)) {
    throw new ConvexError({ code: "INVALID_INPUT", message: "Use whole rupees." });
  }
  return rupees * 100;
}

/**
 * The fee on a draw: `basisPoints` (500 = 5%) of the amount, rounded to the
 * nearest whole rupee (halves round up). Integer maths only.
 */
export function drawFeePaise(amountPaise: number, basisPoints: number): number {
  // rupees = amountPaise * bp / 1_000_000, rounded half up.
  const numerator = amountPaise * basisPoints;
  const denominator = 1_000_000;
  const rupees = Math.floor((2 * numerator + denominator) / (2 * denominator));
  return rupees * 100;
}
