"use client";

import { Check, CircleAlert, Clock, Minus, Zap } from "lucide-react";
import type { StatementStatus } from "@convex/lib/account";
import { Icon } from "@/components/ui/icon";
import { formatDay, formatPaise, formatWhen } from "@/lib/format";
import { cn } from "@/lib/utils";

const DOT: Record<StatementStatus, { cls: string; icon: typeof Check; label: string }> = {
  paid_early: { cls: "bg-success text-white", icon: Zap, label: "Paid early" },
  paid_on_time: { cls: "bg-chart-available text-white", icon: Check, label: "Paid on time" },
  paid_late: { cls: "bg-warning text-white", icon: Clock, label: "Paid late" },
  overdue: { cls: "bg-chart-overdue text-white", icon: CircleAlert, label: "Overdue" },
  open: { cls: "border-2 border-dashed border-border-strong text-foreground-muted", icon: Minus, label: "To pay" },
};

/** The last statements as a row of round badges: the streak at a glance. */
export function StreakDots({ recent, name }: { recent: { month: string; status: StatementStatus; points: number }[]; name: string }) {
  if (recent.length === 0) return <p className="text-sm text-foreground-secondary">Your statements will show here once you have some.</p>;
  return (
    <ol className="flex flex-wrap gap-3" aria-label="Recent statements">
      {recent.map((r) => {
        const d = DOT[r.status];
        return (
          <li key={r.month} className="flex w-12 flex-col items-center gap-1 text-center" title={`${d.label}${r.points ? ` · +${r.points} ${name}` : ""}`}>
            <span className={cn("flex size-10 items-center justify-center rounded-full", d.cls)}>
              <Icon icon={d.icon} className="size-5" />
            </span>
            <span className="text-xs text-foreground-secondary">{formatDay(`${r.month}-01`, "MMM")}</span>
            <span className="sr-only">{d.label}</span>
            {r.points > 0 ? <span className="tabular text-xs font-medium text-primary-text">+{r.points}</span> : null}
          </li>
        );
      })}
    </ol>
  );
}

export const POINTS_TYPE: Record<string, string> = {
  earned: "Earned",
  redeemed: "Spent",
  refunded: "Given back",
  expired: "Expired",
  manual: "From the office",
};

export function PointsHistory({ rows, name }: { rows: { id: string; type: string; points: number; reason: string | null; createdAt: number; statementMonth: string | null }[]; name: string }) {
  return (
    <ul className="divide-y divide-border">
      {rows.map((h) => (
        <li key={h.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
          <span className="flex min-w-0 flex-col">
            <span className="font-medium">
              {POINTS_TYPE[h.type] ?? h.type}
              {h.statementMonth ? <span className="font-normal text-foreground-secondary"> · {formatDay(`${h.statementMonth}-01`, "MMMM yyyy")} statement</span> : null}
            </span>
            <span className="truncate text-foreground-secondary">
              {formatWhen(h.createdAt)}
              {h.reason ? ` · ${h.reason}` : ""}
            </span>
          </span>
          <span className={cn("tabular shrink-0 font-semibold", h.points > 0 ? "text-success" : "text-foreground-secondary")}>
            {h.points > 0 ? "+" : "−"}
            {Math.abs(h.points)} <span className="font-normal">{name}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export { formatPaise };
