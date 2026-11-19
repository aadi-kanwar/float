"use client";

import Link from "next/link";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import { StatementBadge } from "@/components/money/bits";
import { Card } from "@/components/ui/card";
import { FilterBar } from "@/components/ui/filter-bar";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingState } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/states";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useQuery } from "@/lib/convex";
import { addMonths, formatDate, formatMonth, formatPaise, todayIn } from "@/lib/format";

export default function StatementsAdminPage() {
  const [month, setMonth] = useState(addMonths(todayIn().slice(0, 7), -1));
  const rows = useQuery(api.statements.byMonth, { month });
  return (
    <>
      <PageHeader title="Statements" description="Made on the last day of each month at 23:59. Status updates live as payments are confirmed." />
      <FilterBar>
        <Input type="month" aria-label="Month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className="sm:w-48" />
      </FilterBar>
      {rows === undefined ? (
        <LoadingState rows={4} />
      ) : rows.length === 0 ? (
        <EmptyState title={`No statements for ${formatMonth(month)}`} />
      ) : (
        <Card className="overflow-x-auto">
          <Table>
            <THead>
              <TR>
                <TH>Resident</TH>
                <TH className="text-right">Total due</TH>
                <TH className="text-right">Still owed</TH>
                <TH>Due</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.residentId}>
                  <TD>
                    <Link href={`/admin/residents/${r.residentId}`} className="font-medium hover:underline">
                      {r.residentName}
                    </Link>
                    {r.roomNumber ? <span className="text-foreground-secondary"> · {r.roomNumber}</span> : null}
                  </TD>
                  <TD className="tabular text-right">{formatPaise(r.totalDuePaise)}</TD>
                  <TD className="tabular text-right">
                    {formatPaise(r.outstandingPaise)}
                    {r.lateFeesSoFarPaise > 0 ? <span className="block text-xs text-foreground-secondary">late fees {formatPaise(r.lateFeesSoFarPaise)}</span> : null}
                  </TD>
                  <TD>{formatDate(r.dueDate)}</TD>
                  <TD>
                    <StatementBadge status={r.status} />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
    </>
  );
}
