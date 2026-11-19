"use client";

import type { LucideIcon } from "lucide-react";
import { useState } from "react";
import { Icon } from "@/components/ui/icon";
import { formatPaise } from "@/lib/format";
import { cn } from "@/lib/utils";

export type Segment = {
  key: string;
  label: string;
  valuePaise: number;
  /** A bg-chart-* class. */
  color: string;
  hatched?: boolean;
  icon?: LucideIcon;
  hint?: string;
};

/**
 * Parts of a whole as one thin bar (e.g. a credit limit: overdue, owed,
 * waiting, available). 2px gaps between parts, rounded ends, a hover/focus
 * tooltip on each part, and a legend with every value, so nothing depends
 * on colour alone.
 */
export function SegmentMeter({
  label,
  segments,
  totalPaise,
  className,
  size = "md",
  format = formatPaise,
}: {
  label: string;
  segments: Segment[];
  /** The whole; anything not covered by the parts shows as empty track. */
  totalPaise?: number;
  className?: string;
  size?: "md" | "lg";
  /** How values are written (default: rupees). */
  format?: (value: number) => string;
}) {
  const [active, setActive] = useState<string | null>(null);
  const shown = segments.filter((s) => s.valuePaise > 0);
  const sum = shown.reduce((a, s) => a + s.valuePaise, 0);
  const total = Math.max(totalPaise ?? sum, sum, 1);
  const hovered = shown.find((s) => s.key === active);
  return (
    <figure className={cn("flex flex-col gap-3", className)}>
      <div className="relative">
        <div
          role="img"
          aria-label={`${label}: ${segments.map((s) => `${s.label} ${format(s.valuePaise)}`).join(", ")}`}
          className={cn("flex w-full gap-0.5 overflow-hidden rounded-[4px] bg-chart-track", size === "lg" ? "h-5" : "h-3")}
        >
          {shown.map((s) => (
            <span
              key={s.key}
              tabIndex={0}
              aria-label={`${s.label}: ${format(s.valuePaise)}`}
              onMouseEnter={() => setActive(s.key)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(s.key)}
              onBlur={() => setActive(null)}
              className={cn("h-full min-w-1 rounded-[4px] outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-ring", s.color, s.hatched && "hatched", active && active !== s.key && "opacity-60")}
              style={{ width: `${(s.valuePaise / total) * 100}%` }}
            />
          ))}
        </div>
        {hovered ? (
          <div role="tooltip" className="pointer-events-none absolute -top-2 left-1/2 z-10 -translate-x-1/2 -translate-y-full rounded-sm border border-border bg-surface px-3 py-1.5 text-sm whitespace-nowrap shadow-lg">
            <span className="font-medium">{hovered.label}</span> <span className="tabular">{format(hovered.valuePaise)}</span>
            {hovered.hint ? <span className="block text-xs text-foreground-secondary">{hovered.hint}</span> : null}
          </div>
        ) : null}
      </div>
      <figcaption>
        <ul className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm min-[420px]:grid-cols-2">
          {segments.map((s) => (
            <li key={s.key} className="flex min-w-0 items-center gap-2">
              <span aria-hidden className={cn("size-3 shrink-0 rounded-[3px]", s.color, s.hatched && "hatched")} />
              {s.icon ? <Icon icon={s.icon} className="size-3.5 shrink-0 text-foreground-secondary" /> : null}
              <span className="truncate text-foreground-secondary">{s.label}</span>
              <span className="tabular ml-auto font-medium text-foreground">{format(s.valuePaise)}</span>
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}
