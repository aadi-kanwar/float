"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { api } from "@convex/_generated/api";
import { StatementBadge } from "@/components/money/bits";
import { Card } from "@/components/ui/card";
import { LoadingState } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/states";
import { useQuery } from "@/lib/convex";
import { formatDate, formatMonth, formatPaise } from "@/lib/format";

export default function StatementsPage() {
  const data = useQuery(api.statements.mine, {});
  return (
    <>
      <h1 className="font-serif text-3xl tracking-tight">Statements</h1>
      {data === undefined ? (
        <LoadingState rows={4} />
      ) : (
        <>
          {data.unbilledPaise > 0 ? (
            <p className="text-sm text-foreground-secondary">This month so far: {formatPaise(data.unbilledPaise)}. It goes on the statement made on the last day of the month.</p>
          ) : null}
          {data.statements.length === 0 ? (
            <EmptyState title="No statements yet" description="A statement is made on the last day of any month you draw money." />
          ) : (
            <Card>
              <ul className="divide-y divide-border">
                {data.statements.map((s) => (
                  <li key={s.month}>
                    <Link href={`/me/statements/${s.month}`} className="flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-subtle">
                      <span className="flex min-w-0 flex-1 flex-col gap-1">
                        <span className="font-medium">{formatMonth(s.month)}</span>
                        <span className="text-sm text-foreground-secondary">
                          {formatPaise(s.totalDuePaise)} · due {formatDate(s.dueDate)}
                          {s.status === "overdue" && s.lateFeesSoFarPaise > 0 ? ` · late fees so far ${formatPaise(s.lateFeesSoFarPaise)}` : ""}
                        </span>
                      </span>
                      <StatementBadge status={s.status} />
                      <ChevronRight className="size-4 shrink-0 text-foreground-muted" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </>
  );
}
