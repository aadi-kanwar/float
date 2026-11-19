"use client";

import Link from "next/link";
import { api } from "@convex/_generated/api";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingState } from "@/components/ui/skeleton";
import { Stat } from "@/components/ui/stat";
import { useQuery } from "@/lib/convex";
import { formatPaise } from "@/lib/format";

/** Admin home: the money at a glance and what's waiting. Updates live. */
export default function Overview() {
  const o = useQuery(api.money.overview, {});
  return (
    <>
      <PageHeader title="Overview" />
      {o === undefined ? (
        <LoadingState rows={3} />
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat label="Total owed" value={formatPaise(o.outstandingPaise)} emphasis />
            <Stat label="Overdue" value={formatPaise(o.overduePaise)} hint={`${o.overdueCount} ${o.overdueCount === 1 ? "resident" : "residents"}`} warn={o.overdueCount > 0} />
            <Stat label="Fees this month" value={formatPaise(o.feesThisMonthPaise)} />
          </dl>
          <h2 className="font-serif text-2xl tracking-tight">Waiting for you</h2>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Link href="/admin/draws" className="rounded-md hover:opacity-90">
              <Stat label="Draws to approve" value={o.drawsPending} warn={o.drawsPending > 0} hint={o.drawsToSend > 0 ? `${o.drawsToSend} approved, to send` : undefined} />
            </Link>
            <Link href="/admin/repayments" className="rounded-md hover:opacity-90">
              <Stat label="Payments to confirm" value={o.repaymentsPending} warn={o.repaymentsPending > 0} />
            </Link>
            <Link href="/admin/residents" className="rounded-md hover:opacity-90">
              <Stat label="Residents" value={o.residents} />
            </Link>
          </dl>
        </>
      )}
    </>
  );
}
