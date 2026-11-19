"use client";

import {
  ArrowDownToLine,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  FileText,
  Gift,
  HandCoins,
  Landmark,
  Send,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { CalendarKind } from "@convex/money";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { LoadingState } from "@/components/ui/skeleton";
import { useQuery } from "@/lib/convex";
import { addMonths, formatDay, formatMonth, formatPaise, todayIn } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Each kind of event: an icon and a label always go with the colour. Fixed order. */
export const KINDS: { kind: CalendarKind; label: string; icon: LucideIcon; color: string; hatched?: boolean; ink?: string }[] = [
  { kind: "late_fee", label: "Late fees", icon: CircleAlert, color: "bg-chart-overdue" },
  { kind: "due", label: "Deadline", icon: CalendarClock, color: "bg-chart-due", ink: "text-foreground" },
  { kind: "draw_asked", label: "Draw asked", icon: HandCoins, color: "bg-chart-drawn", hatched: true },
  { kind: "draw_sent", label: "Money sent", icon: Send, color: "bg-chart-drawn" },
  { kind: "payment", label: "Payment", icon: ArrowDownToLine, color: "bg-chart-repaid" },
  { kind: "deposit_settled", label: "Settled from deposit", icon: Landmark, color: "bg-chart-repaid", hatched: true },
  { kind: "statement", label: "Statements made", icon: FileText, color: "bg-chart-statement" },
  { kind: "perk", label: "Perk redeemed", icon: Gift, color: "bg-chart-perk" },
  { kind: "joined", label: "Resident added", icon: UserPlus, color: "bg-foreground-muted" },
];
const KIND = new Map(KINDS.map((k) => [k.kind, k]));
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function daysOf(month: string): (string | null)[] {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(); // 0 = Sunday
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (first + 6) % 7;
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= count; d += 1) cells.push(`${month}-${String(d).padStart(2, "0")}`);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/** Admin: a month of money events, India time. Tap a day for the details. Updates live. */
export function MoneyCalendar() {
  const today = todayIn();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [day, setDay] = useState<string | null>(today);
  const data = useQuery(api.money.calendar, { month });
  const byDay = new Map<string, NonNullable<typeof data>["events"]>();
  for (const e of data?.events ?? []) byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]);
  const selected = day && day.startsWith(month) ? (byDay.get(day) ?? []) : [];
  const present = new Set((data?.events ?? []).map((e) => e.kind));
  return (
    <Card>
      <CardBody className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-serif text-2xl tracking-tight">{formatMonth(month)}</h2>
          <div className="flex gap-1">
            <Button variant="ghost" size="icon" aria-label="Previous month" onClick={() => setMonth(addMonths(month, -1))}>
              <Icon icon={ChevronLeft} />
            </Button>
            <Button variant="ghost" onClick={() => { setMonth(today.slice(0, 7)); setDay(today); }}>
              Today
            </Button>
            <Button variant="ghost" size="icon" aria-label="Next month" onClick={() => setMonth(addMonths(month, 1))}>
              <Icon icon={ChevronRight} />
            </Button>
          </div>
        </div>
        {data === undefined ? (
          <LoadingState rows={5} />
        ) : (
          <div className="grid grid-cols-7 gap-1 text-center" role="grid" aria-label={`Events in ${formatMonth(month)}`}>
            {WEEKDAYS.map((w) => (
              <span key={w} role="columnheader" className="pb-1 text-xs font-medium text-foreground-secondary">
                {w}
              </span>
            ))}
            {daysOf(month).map((date, i) => {
              if (date === null) return <span key={`e${i}`} aria-hidden />;
              const events = byDay.get(date) ?? [];
              const kinds = KINDS.filter((k) => events.some((e) => e.kind === k.kind));
              const isToday = date === today;
              const isSelected = date === day;
              return (
                <button
                  key={date}
                  type="button"
                  role="gridcell"
                  aria-selected={isSelected}
                  aria-label={`${formatDay(date, "d MMMM")}: ${events.length === 0 ? "nothing" : kinds.map((k) => `${k.label} ${events.filter((e) => e.kind === k.kind).length}`).join(", ")}`}
                  onClick={() => setDay(date)}
                  className={cn(
                    "flex min-h-14 flex-col items-center gap-1 rounded-sm border px-0.5 pt-1 pb-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    isSelected ? "border-primary bg-primary-subtle" : "border-transparent hover:bg-subtle",
                  )}
                >
                  <span className={cn("tabular flex size-6 items-center justify-center rounded-full text-sm", isToday ? "bg-primary font-semibold text-primary-foreground" : "text-foreground")}>
                    {Number(date.slice(8))}
                  </span>
                  <span className="flex flex-wrap justify-center gap-0.5" aria-hidden>
                    {kinds.slice(0, 4).map((k) => (
                      <span key={k.kind} className={cn("size-2 rounded-full ring-1 ring-surface", k.color, k.hatched && "hatched")} />
                    ))}
                    {kinds.length > 4 ? <span className="text-[10px] leading-2 text-foreground-secondary">+</span> : null}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-foreground-secondary" aria-label="Legend">
          {KINDS.filter((k) => present.has(k.kind)).map((k) => (
            <li key={k.kind} className="flex items-center gap-1.5">
              <span aria-hidden className={cn("size-2.5 rounded-full", k.color, k.hatched && "hatched")} />
              <Icon icon={k.icon} className="size-3.5" />
              {k.label}
            </li>
          ))}
        </ul>
        {day && day.startsWith(month) ? (
          <section aria-label={`Events on ${formatDay(day, "d MMMM")}`} className="flex flex-col gap-2 border-t border-border pt-3">
            <h3 className="font-medium">{formatDay(day, "EEEE d MMMM")}</h3>
            {selected.length === 0 ? (
              <p className="text-sm text-foreground-secondary">Nothing on this day.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {selected.map((e, i) => {
                  const k = KIND.get(e.kind)!;
                  return (
                    <li key={i} className="flex items-center gap-3 py-2 text-sm">
                      <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full", k.ink ?? "text-white", k.color)}>
                        <Icon icon={k.icon} className="size-4" />
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="font-medium">{e.label}</span>
                        {e.residentId ? (
                          <Link href={`/admin/residents/${e.residentId}`} className="truncate text-foreground-secondary hover:underline">
                            {e.residentName}
                          </Link>
                        ) : null}
                      </span>
                      {e.amountPaise !== null ? <span className="tabular font-medium">{formatPaise(e.amountPaise)}</span> : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ) : null}
      </CardBody>
    </Card>
  );
}
