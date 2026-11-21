import { CircleAlert, CircleCheck, CircleDot, Clock, type LucideIcon } from "lucide-react";
import type { StatementStatus } from "@convex/lib/account";
import type { DrawStatus } from "@convex/lib/validators";

type Tone = "neutral" | "primary" | "success" | "warning" | "danger" | "info";

export const STATEMENT_STATUS: Record<StatementStatus, { label: string; tone: Tone; icon: LucideIcon }> = {
  open: { label: "To pay", tone: "info", icon: CircleDot },
  paid_early: { label: "Paid early", tone: "success", icon: CircleCheck },
  paid_on_time: { label: "Paid on time", tone: "success", icon: CircleCheck },
  paid_late: { label: "Paid late", tone: "warning", icon: Clock },
  overdue: { label: "Overdue", tone: "danger", icon: CircleAlert },
};

export const DRAW_STATUS: Record<DrawStatus, { label: string; tone: Tone; icon: LucideIcon }> = {
  requested: { label: "Waiting for approval", tone: "info", icon: Clock },
  approved: { label: "Approved, to be sent", tone: "primary", icon: CircleDot },
  disbursed: { label: "Sent", tone: "success", icon: CircleCheck },
  rejected: { label: "Not approved", tone: "danger", icon: CircleAlert },
  cancelled: { label: "Cancelled", tone: "neutral", icon: CircleAlert },
};

export const CLAIM_STATUS: Record<"pending" | "confirmed" | "rejected", { label: string; tone: Tone; icon: LucideIcon }> = {
  pending: { label: "Waiting for confirmation", tone: "info", icon: Clock },
  confirmed: { label: "Confirmed", tone: "success", icon: CircleCheck },
  rejected: { label: "Not confirmed", tone: "danger", icon: CircleAlert },
};

export const LEDGER_LABEL: Record<string, string> = {
  draw: "Money drawn",
  fee: "Fee",
  lateFee: "Late fee",
  repayment: "Payment",
  waiver: "Waived",
  reversal: "Correction (reversal)",
};

/** Rows that lower what's owed show with a minus. */
export const isCredit = (type: string) => type === "repayment" || type === "waiver";
