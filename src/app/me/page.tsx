"use client";

import { ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import Link from "next/link";
import { api } from "@convex/_generated/api";
import { Eyebrow } from "@/components/app/brand";
import { useMe } from "@/components/app/session";
import { dueCountdown } from "@/components/money/bits";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { LoadingState } from "@/components/ui/skeleton";
import { Stat } from "@/components/ui/stat";
import { useQuery } from "@/lib/convex";
import { formatDate, formatDay, formatPaise, todayIn } from "@/lib/format";

export default function ResidentHome() {
  const me = useMe();
  const s = useQuery(api.money.mySummary, {});
  const firstName = (me?.name ?? "").split(" ")[0];
  return (
    <>
      <div className="flex flex-col gap-1">
        <Eyebrow>{formatDay(todayIn(), "EEEE d MMMM")}</Eyebrow>
        <h1 className="font-serif text-3xl tracking-tight">
          Hello, <em className="text-primary-soft">{firstName}.</em>
        </h1>
      </div>
      {s === undefined ? (
        <LoadingState rows={4} />
      ) : (
        <>
          {s.paused ? <Banner tone="warning" title="Your account is paused">You can&apos;t draw money right now. You can still pay. Please talk to the office.</Banner> : null}
          {s.overdue ? (
            <Banner tone="danger" title={`${formatPaise(s.overduePaise)} is overdue`}>
              A late fee is added every day until it&apos;s paid.{s.frozen ? " You can draw again once it's paid." : ""}
            </Banner>
          ) : null}
          <Card className="border-primary-subtle-border bg-primary-subtle">
            <CardBody className="flex flex-col gap-1">
              <span className="text-sm font-medium text-primary-text">Available to draw</span>
              <span className="tabular font-serif text-3xl tracking-tight text-primary-text">{formatPaise(s.availablePaise)}</span>
              <span className="text-sm text-foreground-secondary">Limit {formatPaise(s.limitPaise)} · the fee is included</span>
            </CardBody>
          </Card>
          <div className="grid grid-cols-2 gap-3">
            {s.paused || s.frozen ? (
              <Button className="min-h-14" disabled>
                <Icon icon={ArrowUpFromLine} />
                Draw money
              </Button>
            ) : (
              <Button asChild className="min-h-14">
                <Link href="/me/draw">
                  <Icon icon={ArrowUpFromLine} />
                  Draw money
                </Link>
              </Button>
            )}
            <Button asChild variant="secondary" className="min-h-14">
              <Link href="/me/pay">
                <Icon icon={ArrowDownToLine} />
                I&apos;ve paid
              </Link>
            </Button>
          </div>
          <dl className="grid grid-cols-2 gap-3">
            <Stat label="You owe" value={formatPaise(s.outstandingPaise)} warn={s.overdue} hint={s.pendingClaimsPaise > 0 ? `${formatPaise(s.pendingClaimsPaise)} paid, waiting to be confirmed` : undefined} />
            <Stat
              label="Next due"
              value={s.nextDue ? formatPaise(s.nextDue.amountPaise) : "—"}
              hint={s.nextDue ? `${formatDate(s.nextDue.dueDate)} · ${dueCountdown(s.nextDue.dueAt)}` : s.unbilledPaise > 0 ? `This month so far; due the ${s.dueDay}th of next month` : "Nothing due"}
            />
          </dl>
          {s.pendingDrawsPaise > 0 ? (
            <p className="text-sm text-foreground-secondary">
              {formatPaise(s.pendingDrawsPaise)} in draws is waiting to be sent (fee included). <Link className="underline" href="/me/activity">See activity</Link>
            </p>
          ) : null}
        </>
      )}
    </>
  );
}
