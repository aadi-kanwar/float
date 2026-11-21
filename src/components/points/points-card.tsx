"use client";

import { ChevronRight, Sparkles } from "lucide-react";
import Link from "next/link";
import { api } from "@convex/_generated/api";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { useQuery } from "@/lib/convex";
import { formatPaise } from "@/lib/format";

/** Home: the points balance and streak, linking to the points page. */
export function PointsCard() {
  const p = useQuery(api.points.mine, {});
  if (p === undefined) return null;
  return (
    <Card>
      <Link href="/me/points" className="flex items-center gap-3 px-4 py-3 hover:bg-subtle">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-chart-perk text-white">
          <Icon icon={Sparkles} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="tabular text-lg font-semibold">
            {p.balance.toLocaleString("en-IN")} {p.pointsName}
          </span>
          <span className="text-sm text-foreground-secondary">Worth {formatPaise(p.balanceValuePaise)}</span>
        </span>
        <ChevronRight className="size-4 text-foreground-muted" aria-hidden />
      </Link>
    </Card>
  );
}
