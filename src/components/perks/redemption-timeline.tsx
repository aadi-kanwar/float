"use client";

import { Check, CircleX, Clock, Hammer, PackageCheck, ThumbsUp, type LucideIcon } from "lucide-react";
import type { RedemptionStatus } from "@convex/lib/validators";
import { Icon } from "@/components/ui/icon";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatWhen } from "@/lib/format";
import { cn } from "@/lib/utils";

export const REDEMPTION_STATUS: Record<RedemptionStatus, { label: string; icon: LucideIcon; tone: "info" | "primary" | "warning" | "success" | "danger" | "neutral" }> = {
  requested: { label: "Requested", icon: Clock, tone: "info" },
  approved: { label: "Approved", icon: ThumbsUp, tone: "primary" },
  in_progress: { label: "In progress", icon: Hammer, tone: "warning" },
  fulfilled: { label: "Fulfilled", icon: PackageCheck, tone: "success" },
  rejected: { label: "Rejected", icon: CircleX, tone: "danger" },
  cancelled: { label: "Cancelled", icon: CircleX, tone: "neutral" },
};

export function RedemptionBadge({ status }: { status: RedemptionStatus }) {
  const s = REDEMPTION_STATUS[status];
  return (
    <StatusBadge tone={s.tone} icon={s.icon}>
      {s.label}
    </StatusBadge>
  );
}

const STEPS: RedemptionStatus[] = ["requested", "approved", "in_progress", "fulfilled"];

/**
 * The four steps as a vertical timeline: done steps filled, the current one
 * marked, with the time and the office's note at each change. A rejected or
 * cancelled redemption ends with that step.
 */
export function RedemptionTimeline({ status, history }: { status: RedemptionStatus; history: { status: RedemptionStatus; at: number; by: string; note: string | null }[] }) {
  const ended = status === "rejected" || status === "cancelled";
  const reachedIndex = Math.max(...history.filter((h) => STEPS.includes(h.status)).map((h) => STEPS.indexOf(h.status)), 0);
  const steps: RedemptionStatus[] = ended ? [...STEPS.slice(0, reachedIndex + 1), status] : STEPS;
  return (
    <ol className="flex flex-col">
      {steps.map((step, i) => {
        const event = [...history].reverse().find((h) => h.status === step);
        const done = event !== undefined && (ended || STEPS.indexOf(step) <= STEPS.indexOf(status));
        const current = step === status;
        const s = REDEMPTION_STATUS[step];
        const last = i === steps.length - 1;
        return (
          <li key={step} className="flex gap-3">
            <span className="flex flex-col items-center">
              <span
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-full border-2",
                  done
                    ? step === "rejected"
                      ? "border-danger bg-danger text-white"
                      : step === "cancelled"
                        ? "border-foreground-muted bg-foreground-muted text-white"
                        : "border-primary bg-primary text-primary-foreground"
                    : "border-border-strong bg-surface text-foreground-muted",
                  current && !ended && "ring-4 ring-primary-subtle",
                )}
              >
                <Icon icon={done && !current ? Check : s.icon} className="size-4" />
              </span>
              {last ? null : <span className={cn("w-0.5 flex-1", done ? "bg-primary" : "bg-border")} aria-hidden />}
            </span>
            <span className={cn("flex min-w-0 flex-col pb-4", !done && "text-foreground-muted")}>
              <span className="font-medium">{s.label}</span>
              {event ? <span className="text-xs text-foreground-secondary">{formatWhen(event.at)}{event.by === "resident" && step === "cancelled" ? " · by you" : ""}</span> : null}
              {event?.note ? <span className="mt-1 rounded-sm bg-subtle px-2 py-1 text-sm text-foreground">“{event.note}”</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
