"use client";

import { CircleAlert, CircleCheck, CircleDot, Clock } from "lucide-react";
import Link from "next/link";
import { api } from "@convex/_generated/api";
import { MoneyCalendar } from "@/components/admin/money-calendar";
import { Card, CardBody } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingState } from "@/components/ui/skeleton";
import { Stat } from "@/components/ui/stat";
import { BarChart } from "@/components/viz/bar-chart";
import { SegmentMeter } from "@/components/viz/segment-meter";
import { useQuery } from "@/lib/convex";
import { formatDay, formatMonth, formatPaise } from "@/lib/format";

const count = (n: number) => String(n);

/** Admin home: the money at a glance, what's waiting, and the month's calendar. Updates live. */
export default function Overview() {
  const o = useQuery(api.money.overview, {});
  return (
    <>
      <PageHeader title="Overview" />
      {o === undefined ? (
        <LoadingState rows={4} />
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat
              label="Total owed"
              value={formatPaise(o.outstandingPaise)}
              emphasis
            />
            <Stat
              label="Overdue"
              value={formatPaise(o.overduePaise)}
              hint={`${o.overdueCount} ${o.overdueCount === 1 ? "resident" : "residents"}`}
              warn={o.overdueCount > 0}
            />
            <Stat
              label="Fees this month"
              value={formatPaise(o.feesThisMonthPaise)}
            />
            <Stat label="Residents" value={o.residents} />
          </dl>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardBody className="flex flex-col gap-3">
                <h2 className="font-medium">Credit across all residents</h2>
                <SegmentMeter
                  label="Credit across all residents"
                  size="lg"
                  segments={[
                    {
                      key: "overdue",
                      label: "Overdue",
                      valuePaise: o.overduePaise,
                      color: "bg-chart-overdue",
                      icon: CircleAlert,
                    },
                    {
                      key: "owed",
                      label: "Owed, not yet due",
                      valuePaise: Math.max(
                        0,
                        o.outstandingPaise - o.overduePaise,
                      ),
                      color: "bg-chart-owed",
                    },
                    {
                      key: "waiting",
                      label: "Draws waiting",
                      valuePaise: o.pendingDrawsPaise,
                      color: "bg-chart-drawn",
                      hatched: true,
                      hint: "Asked or approved, not sent yet",
                    },
                    {
                      key: "free",
                      label: "Unused credit",
                      valuePaise: o.availablePaise,
                      color: "bg-chart-available",
                      hint: "Active, unpaused residents",
                    },
                  ]}
                />
              </CardBody>
            </Card>
            <Card>
              <CardBody className="flex flex-col gap-3">
                <h2 className="font-medium">
                  {formatMonth(o.lastMonth)} statements
                </h2>
                {Object.values(o.lastMonthStatuses).every((n) => n === 0) ? (
                  <p className="text-sm text-foreground-secondary">
                    No statements were made for {formatMonth(o.lastMonth)}.
                  </p>
                ) : (
                  <SegmentMeter
                    label={`${formatMonth(o.lastMonth)} statements by status`}
                    size="lg"
                    format={count}
                    segments={[
                      {
                        key: "early",
                        label: "Paid early",
                        valuePaise: o.lastMonthStatuses.paid_early,
                        color: "bg-success",
                        icon: CircleCheck,
                      },
                      {
                        key: "ontime",
                        label: "Paid on time",
                        valuePaise: o.lastMonthStatuses.paid_on_time,
                        color: "bg-chart-available",
                        icon: CircleCheck,
                      },
                      {
                        key: "open",
                        label: "To pay",
                        valuePaise: o.lastMonthStatuses.open,
                        color: "bg-info",
                        icon: CircleDot,
                      },
                      {
                        key: "late",
                        label: "Paid late",
                        valuePaise: o.lastMonthStatuses.paid_late,
                        color: "bg-warning",
                        icon: Clock,
                      },
                      {
                        key: "overdue",
                        label: "Overdue",
                        valuePaise: o.lastMonthStatuses.overdue,
                        color: "bg-chart-overdue",
                        icon: CircleAlert,
                      },
                    ]}
                  />
                )}
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardBody className="flex flex-col gap-3">
              <h2 className="font-medium">Money out and in, last 6 months</h2>
              <BarChart
                label="Money drawn and repaid per month"
                series={[
                  { key: "drawn", label: "Drawn", color: "bg-chart-drawn" },
                  { key: "repaid", label: "Repaid", color: "bg-chart-repaid" },
                ]}
                groups={o.monthly.map((m) => ({
                  key: m.month,
                  label: formatDay(`${m.month}-01`, "MMM"),
                  values: { drawn: m.drawnPaise, repaid: m.repaidPaise },
                }))}
              />
            </CardBody>
          </Card>

          <h2 className="font-serif text-2xl tracking-tight">
            Waiting for you
          </h2>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Link href="/admin/draws" className="rounded-md hover:opacity-90">
              <Stat
                label="Draws to approve"
                value={o.drawsPending}
                warn={o.drawsPending > 0}
                hint={
                  o.drawsToSend > 0
                    ? `${o.drawsToSend} approved, to send`
                    : undefined
                }
              />
            </Link>
            <Link
              href="/admin/repayments"
              className="rounded-md hover:opacity-90"
            >
              <Stat
                label="Payments to confirm"
                value={o.repaymentsPending}
                warn={o.repaymentsPending > 0}
              />
            </Link>
          </dl>

          <h2 className="font-serif text-2xl tracking-tight">Calendar</h2>
          <MoneyCalendar />
        </>
      )}
    </>
  );
}
