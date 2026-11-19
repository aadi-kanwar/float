"use client";

import { Flame, Hourglass } from "lucide-react";
import { api } from "@convex/_generated/api";
import { describeRule, PointsHistory, StreakDots } from "@/components/points/points-bits";
import { Card, CardBody } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { LoadingState } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/states";
import { useQuery } from "@/lib/convex";
import { formatShortDate } from "@/lib/format";

export default function PointsPage() {
  const p = useQuery(api.points.mine, {});
  if (p === undefined) return <LoadingState rows={6} />;
  const name = p.pointsName;
  return (
    <>
      <h1 className="font-serif text-3xl tracking-tight">{name}</h1>
      <Card className="border-primary-subtle-border bg-primary-subtle">
        <CardBody className="flex items-end justify-between gap-4">
          <span className="flex flex-col">
            <span className="text-sm font-medium text-primary-text">Your balance</span>
            <span className="tabular font-serif text-3xl text-primary-text">
              {p.balance.toLocaleString("en-IN")} <span className="text-xl">{name}</span>
            </span>
          </span>
          <span className="flex items-center gap-1.5 rounded-full bg-surface px-3 py-1 text-sm font-medium">
            <Icon icon={Flame} className="size-4 text-chart-owed" />
            {p.streak} on time in a row
          </span>
        </CardBody>
      </Card>

      <section aria-labelledby="streak" className="flex flex-col gap-2">
        <h2 id="streak" className="font-serif text-2xl tracking-tight">
          Recent statements
        </h2>
        <Card>
          <CardBody>
            <StreakDots recent={p.recent} name={name} />
          </CardBody>
        </Card>
      </section>

      {p.expiring.length > 0 ? (
        <section aria-labelledby="expiring" className="flex flex-col gap-2">
          <h2 id="expiring" className="font-serif text-2xl tracking-tight">
            Expiring soon
          </h2>
          <Card>
            <ul className="divide-y divide-border">
              {p.expiring.map((e, i) => (
                <li key={i} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                  <span className="flex items-center gap-2">
                    <Icon icon={Hourglass} className="size-4 text-foreground-secondary" />
                    {formatShortDate(e.expiresAt)}
                  </span>
                  <span className="tabular font-medium">
                    {e.points} {name}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      ) : null}

      <section aria-labelledby="earn" className="flex flex-col gap-2">
        <h2 id="earn" className="font-serif text-2xl tracking-tight">
          How to earn {name}
        </h2>
        <Card>
          <CardBody>
            <ul className="flex list-disc flex-col gap-2 pl-5 text-sm">
              {p.rules.map((r, i) => (
                <li key={i}>{describeRule(r, name, p.dueDay)}</li>
              ))}
              <li>Paid after the deadline: no {name} for that statement, and your streak starts again.</li>
              {p.expiryMonths > 0 ? <li>{name} expire {p.expiryMonths} months after you earn them.</li> : null}
            </ul>
          </CardBody>
        </Card>
      </section>

      <section aria-labelledby="hist" className="flex flex-col gap-2">
        <h2 id="hist" className="font-serif text-2xl tracking-tight">
          History
        </h2>
        {p.history.length === 0 ? (
          <EmptyState title={`No ${name} yet`} description="Repay a statement on time to earn your first." />
        ) : (
          <Card>
            <PointsHistory rows={p.history} name={name} />
          </Card>
        )}
      </section>
    </>
  );
}
