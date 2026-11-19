"use client";

import { ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import Link from "next/link";
import { api } from "@convex/_generated/api";
import { Eyebrow } from "@/components/app/brand";
import { useMe } from "@/components/app/session";
import { PointsCard } from "@/components/points/points-card";
import {
  CreditMeter,
  DepositMeter,
  DueProgress,
} from "@/components/money/resident-charts";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { LoadingState } from "@/components/ui/skeleton";
import { useQuery } from "@/lib/convex";
import { formatDay, formatPaise, todayIn } from "@/lib/format";

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
          {s.paused ? (
            <Banner tone="warning" title="Your account is paused">
              You can&apos;t draw money right now. You can still pay. Please
              talk to the office.
            </Banner>
          ) : null}
          {s.overdue ? (
            <Banner
              tone="danger"
              title={`${formatPaise(s.overduePaise)} is overdue`}
            >
              A late fee is added every day until it&apos;s paid.
              {s.frozen ? " You can draw again once it's paid." : ""}
            </Banner>
          ) : null}
          <Card>
            <CardBody className="flex flex-col gap-1">
              <span className="text-sm font-medium text-primary-text">
                You can draw
              </span>
              <span className="tabular font-serif text-3xl tracking-tight text-primary-text">
                {formatPaise(s.availablePaise)}
              </span>
              <span className="text-sm text-foreground-secondary">
                Limit {formatPaise(s.limitPaise)} · the fee is included
              </span>
              <CreditMeter s={s} />
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
          <DueProgress s={s} />
          {s.pendingClaimsPaise > 0 ? (
            <p className="text-sm text-foreground-secondary">
              {formatPaise(s.pendingClaimsPaise)} paid, waiting for the office
              to confirm.
            </p>
          ) : null}
          {!s.nextDue && s.unbilledPaise > 0 ? (
            <p className="text-sm text-foreground-secondary">
              {formatPaise(s.unbilledPaise)} drawn this month goes on your
              statement on the last day; it&apos;s due the {s.dueDay}th of next
              month.
            </p>
          ) : null}
          <PointsCard />
          <DepositMeter s={s} />
        </>
      )}
    </>
  );
}
