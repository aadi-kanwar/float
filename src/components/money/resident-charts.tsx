"use client";

import { CalendarClock, CircleAlert } from "lucide-react";
import type { FunctionReturnType } from "convex/server";
import type { api } from "@convex/_generated/api";
import { Card, CardBody } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { SegmentMeter } from "@/components/viz/segment-meter";
import { formatDate, formatPaise } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { dueCountdown } from "./bits";

type Summary = FunctionReturnType<typeof api.money.mySummary>;

/** The credit limit split into overdue, owed, waiting to be sent and free. */
export function CreditMeter({ s }: { s: Summary }) {
  const owedNotOverdue = Math.max(0, s.outstandingPaise - s.overduePaise);
  return (
    <SegmentMeter
      label="Your credit"
      size="lg"
      totalPaise={Math.max(s.limitPaise, s.outstandingPaise + s.pendingDrawsPaise)}
      segments={[
        ...(s.overduePaise > 0 ? [{ key: "overdue", label: "Overdue", valuePaise: s.overduePaise, color: "bg-chart-overdue", icon: CircleAlert }] : []),
        { key: "owed", label: "You owe", valuePaise: owedNotOverdue, color: "bg-chart-owed" },
        ...(s.pendingDrawsPaise > 0 ? [{ key: "waiting", label: "Waiting to be sent", valuePaise: s.pendingDrawsPaise, color: "bg-chart-drawn", hatched: true, hint: "Fee included" }] : []),
        { key: "free", label: "Free to use", valuePaise: Math.max(0, s.limitPaise - s.outstandingPaise - s.pendingDrawsPaise), color: "bg-chart-available", hint: "Draws plus their fee" },
      ]}
    />
  );
}

/** Days until the next deadline, as a bar that fills up (red once overdue). */
export function DueProgress({ s }: { s: Summary }) {
  const now = useNow();
  if (!s.nextDue && !s.overdue) return null;
  if (s.overdue && !s.nextDue)
    return (
      <Card className="border-danger-border bg-danger-subtle">
        <CardBody className="flex items-center gap-3 text-danger-text">
          <Icon icon={CircleAlert} />
          <span className="font-medium">{formatPaise(s.overduePaise)} overdue · a late fee is added every day</span>
        </CardBody>
      </Card>
    );
  const due = s.nextDue!;
  const span = Math.max(1, due.dueAt - due.fromAt);
  const done = Math.min(1, Math.max(0, (now - due.fromAt) / span));
  const late = now > due.dueAt;
  return (
    <Card>
      <CardBody className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-sm font-medium">
            <Icon icon={CalendarClock} className="text-foreground-secondary" />
            {formatPaise(due.amountPaise)} due {formatDate(due.dueDate)}
          </span>
          <span className={cn("text-sm font-semibold", late ? "text-danger-text" : "text-foreground")}>{dueCountdown(due.dueAt, now)}</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-[4px] bg-chart-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(done * 100)} aria-label="Time until the deadline">
          <div className={cn("h-full rounded-[4px]", late ? "bg-chart-overdue" : "bg-chart-due")} style={{ width: `${done * 100}%` }} />
        </div>
      </CardBody>
    </Card>
  );
}

/** The security deposit: what's left and what has been used to settle dues. */
export function DepositMeter({ s }: { s: Summary }) {
  const used = Math.max(0, s.recordedDepositPaise - s.depositBalancePaise);
  return (
    <Card>
      <CardBody className="flex flex-col gap-3">
        <span className="text-sm font-medium">Security deposit {formatPaise(s.recordedDepositPaise)}</span>
        <SegmentMeter
          label="Security deposit"
          totalPaise={s.recordedDepositPaise}
          segments={[
            { key: "left", label: "Left", valuePaise: s.depositBalancePaise, color: "bg-primary" },
            ...(used > 0 ? [{ key: "used", label: "Used to settle dues", valuePaise: used, color: "bg-chart-repaid", hatched: true }] : []),
          ]}
        />
      </CardBody>
    </Card>
  );
}
