"use client";

import { StatusBadge } from "@/components/ui/status-badge";
import { formatPaise } from "@/lib/format";
import { CLAIM_STATUS, DRAW_STATUS, STATEMENT_STATUS, isCredit } from "@/lib/money-labels";
import type { StatementStatus } from "@convex/lib/account";
import type { DrawStatus } from "@convex/lib/validators";
import { cn } from "@/lib/utils";

export function StatementBadge({ status }: { status: StatementStatus }) {
  const s = STATEMENT_STATUS[status];
  return (
    <StatusBadge tone={s.tone} icon={s.icon}>
      {s.label}
    </StatusBadge>
  );
}

export function DrawBadge({ status }: { status: DrawStatus }) {
  const s = DRAW_STATUS[status];
  return (
    <StatusBadge tone={s.tone} icon={s.icon}>
      {s.label}
    </StatusBadge>
  );
}

export function ClaimBadge({ status }: { status: "pending" | "confirmed" | "rejected" }) {
  const s = CLAIM_STATUS[status];
  return (
    <StatusBadge tone={s.tone} icon={s.icon}>
      {s.label}
    </StatusBadge>
  );
}

/** "₹1,050" for charges, "−₹1,050" for payments; struck through when reversed. */
export function LedgerAmount({ type, amountPaise, reversed = false }: { type: string; amountPaise: number; reversed?: boolean }) {
  return (
    <span className={cn("tabular font-medium", isCredit(type) && "text-success", reversed && "text-foreground-muted line-through")}>
      {isCredit(type) ? "−" : ""}
      {formatPaise(amountPaise)}
    </span>
  );
}

/** "Due today", "Due in 3 days", "2 days overdue". */
export function dueCountdown(dueAt: number, now = Date.now()): string {
  const days = Math.ceil((dueAt - now) / 86_400_000);
  if (now > dueAt) {
    const late = Math.max(1, Math.floor((now - dueAt) / 86_400_000) + 1);
    return late === 1 ? "1 day overdue" : `${late} days overdue`;
  }
  if (days <= 1) return "Due today";
  return `Due in ${days} days`;
}
