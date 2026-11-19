"use client";

import type { FunctionReturnType } from "convex/server";
import type { api } from "@convex/_generated/api";
import { Banner } from "@/components/ui/banner";
import { Card, CardBody } from "@/components/ui/card";
import { DetailList } from "@/components/ui/stat";
import { formatDate, formatPaise, formatShortDate } from "@/lib/format";
import { LEDGER_LABEL } from "@/lib/money-labels";
import { LedgerAmount, StatementBadge } from "./bits";

type Detail = FunctionReturnType<typeof api.statements.myDetail>;

const BUCKET: Record<string, string> = { lateFee: "late fees", fee: "fees", principal: "amount drawn" };

/** One statement: its saved figures, line items and the payments applied to it. */
export function StatementDetail({ d }: { d: Detail }) {
  const s = d.statement;
  return (
    <div className="flex flex-col gap-4">
      {s ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <StatementBadge status={s.status} />
            <span className="text-sm text-foreground-secondary">Due {formatDate(s.dueDate)}</span>
          </div>
          {s.status === "overdue" ? (
            <Banner tone="danger" title={`${formatPaise(d.outstandingPaise)} overdue`}>
              Late fees so far: {formatPaise(d.lateFeesSoFarPaise)}. One is added every day until it&apos;s paid.
            </Banner>
          ) : null}
          <Card>
            <CardBody>
              <DetailList
                rows={[
                  { label: "Drawn this month", value: formatPaise(s.drawnPaise) },
                  { label: "Fees", value: formatPaise(s.feesPaise) },
                  ...(s.paidThisMonthPaise > 0 ? [{ label: "Already paid", value: `−${formatPaise(s.paidThisMonthPaise)}` }] : []),
                  ...(s.carriedOverPaise > 0 ? [{ label: "Carried over from earlier", value: formatPaise(s.carriedOverPaise) }] : []),
                  ...(s.lateFeesPaise > 0 ? [{ label: "Late fees from earlier", value: formatPaise(s.lateFeesPaise) }] : []),
                  { label: "Total due when made", value: formatPaise(s.totalDuePaise), strong: true },
                  { label: "Still to pay on this month", value: formatPaise(d.outstandingPaise), strong: true },
                ]}
              />
            </CardBody>
          </Card>
        </>
      ) : (
        <p className="text-sm text-foreground-secondary">This month&apos;s statement isn&apos;t made yet.</p>
      )}
      <section aria-labelledby="lines" className="flex flex-col gap-2">
        <h2 id="lines" className="font-serif text-xl tracking-tight">
          Line items
        </h2>
        <Card>
          <ul className="divide-y divide-border">
            {d.lines.map((l, i) => (
              <li key={i} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                <span>
                  {LEDGER_LABEL[l.type]}
                  {l.type === "waiver" && l.bucket ? ` (${l.bucket === "fee" ? "fee" : "late fee"})` : ""}
                  <span className="text-foreground-secondary"> · {l.forDate ? formatDate(l.forDate) : formatShortDate(l.at)}</span>
                  {l.reversed ? <span className="text-foreground-secondary"> · cancelled</span> : null}
                </span>
                <LedgerAmount type={l.type} amountPaise={l.amountPaise} reversed={l.reversed} />
              </li>
            ))}
            {d.payments.map((p, i) => (
              <li key={`p${i}`} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                <span>
                  Paid towards {BUCKET[p.bucket]}
                  <span className="text-foreground-secondary"> · {formatShortDate(p.at)}</span>
                </span>
                <LedgerAmount type="repayment" amountPaise={p.amountPaise} />
              </li>
            ))}
          </ul>
        </Card>
      </section>
    </div>
  );
}
