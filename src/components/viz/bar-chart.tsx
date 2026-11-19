"use client";

import { useState } from "react";
import { formatPaise } from "@/lib/format";
import { cn } from "@/lib/utils";

export type BarSeries = { key: string; label: string; color: string };
export type BarGroup = { key: string; label: string; values: Record<string, number> };

/** Rounds a top value up to a tidy axis maximum (1, 2, 5 × 10ⁿ rupees). */
function niceMax(paise: number): number {
  const rupees = Math.max(paise / 100, 1);
  const p = 10 ** Math.floor(Math.log10(rupees));
  const step = [1, 2, 5, 10].find((m) => m * p >= rupees)!;
  return step * p * 100;
}

const short = (paise: number) => {
  const r = paise / 100;
  if (r >= 100_000) return `₹${(r / 100_000).toFixed(r % 100_000 === 0 ? 0 : 1)}L`;
  if (r >= 1000) return `₹${(r / 1000).toFixed(r % 1000 === 0 ? 0 : 1)}k`;
  return `₹${r}`;
};

/**
 * Grouped bars over time (one shared rupee axis). Thin bars, 2px gaps,
 * recessive grid, a legend, and a tooltip with every value for the group
 * under the pointer or keyboard focus. A table view sits behind "Show table".
 */
export function BarChart({ label, series, groups, height = 160 }: { label: string; series: BarSeries[]; groups: BarGroup[]; height?: number }) {
  const [active, setActive] = useState<string | null>(null);
  const [table, setTable] = useState(false);
  const max = niceMax(Math.max(0, ...groups.flatMap((g) => series.map((s) => g.values[s.key] ?? 0))));
  const ticks = [max, max / 2, 0];
  return (
    <figure className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-label="Legend">
          {series.map((s) => (
            <li key={s.key} className="flex items-center gap-2">
              <span aria-hidden className={cn("size-3 rounded-[3px]", s.color)} />
              <span className="text-foreground-secondary">{s.label}</span>
            </li>
          ))}
        </ul>
        <button type="button" className="text-sm text-foreground-secondary underline hover:text-foreground" onClick={() => setTable(!table)}>
          {table ? "Show chart" : "Show table"}
        </button>
      </div>
      {table ? (
        <table className="w-full text-sm">
          <caption className="sr-only">{label}</caption>
          <thead>
            <tr className="text-left text-foreground-secondary">
              <th className="py-1 font-medium">Month</th>
              {series.map((s) => (
                <th key={s.key} className="py-1 text-right font-medium">
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.key} className="border-t border-border">
                <td className="py-1">{g.label}</td>
                {series.map((s) => (
                  <td key={s.key} className="tabular py-1 text-right">
                    {formatPaise(g.values[s.key] ?? 0)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="flex gap-2" role="img" aria-label={label}>
          <div className="flex flex-col justify-between text-right text-xs text-foreground-muted" style={{ height }}>
            {ticks.map((t) => (
              <span key={t} className="tabular -translate-y-1/2 first:translate-y-0 last:translate-y-0">
                {short(t)}
              </span>
            ))}
          </div>
          <div className="relative flex-1">
            <div className="absolute inset-x-0 top-0 flex flex-col justify-between" style={{ height }} aria-hidden>
              {ticks.map((t) => (
                <span key={t} className={cn("block border-t", t === 0 ? "border-border-strong" : "border-dashed border-border")} />
              ))}
            </div>
            <div className="relative flex items-end justify-around gap-2" style={{ height }}>
              {groups.map((g) => (
                <button
                  type="button"
                  key={g.key}
                  aria-label={`${g.label}: ${series.map((s) => `${s.label} ${formatPaise(g.values[s.key] ?? 0)}`).join(", ")}`}
                  onMouseEnter={() => setActive(g.key)}
                  onMouseLeave={() => setActive(null)}
                  onFocus={() => setActive(g.key)}
                  onBlur={() => setActive(null)}
                  className={cn("relative flex h-full flex-1 items-end justify-center gap-0.5 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring", active === g.key && "bg-subtle")}
                >
                  {series.map((s) => {
                    const v = g.values[s.key] ?? 0;
                    return (
                      <span
                        key={s.key}
                        className={cn("w-3 max-w-[40%] rounded-t-[4px] sm:w-4", s.color)}
                        style={{ height: v > 0 ? `max(${(v / max) * 100}%, 2px)` : 0 }}
                      />
                    );
                  })}
                  {active === g.key ? (
                    <span role="tooltip" className="pointer-events-none absolute -top-2 left-1/2 z-10 -translate-x-1/2 -translate-y-full rounded-sm border border-border bg-surface px-3 py-1.5 text-left text-sm whitespace-nowrap shadow-lg">
                      <span className="block font-medium">{g.label}</span>
                      {series.map((s) => (
                        <span key={s.key} className="flex items-center gap-2">
                          <span aria-hidden className={cn("size-2.5 rounded-[2px]", s.color)} />
                          <span className="text-foreground-secondary">{s.label}</span>
                          <span className="tabular ml-auto pl-3">{formatPaise(g.values[s.key] ?? 0)}</span>
                        </span>
                      ))}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
            <div className="mt-1 flex justify-around gap-2 text-xs text-foreground-secondary">
              {groups.map((g) => (
                <span key={g.key} className="flex-1 text-center">
                  {g.label}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </figure>
  );
}
