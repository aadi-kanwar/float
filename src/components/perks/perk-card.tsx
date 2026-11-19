"use client";

import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { perkIcon } from "./perk-icon";

type Perk = {
  perkId: string;
  title: string;
  summary: string;
  icon: string;
  imageUrl: string | null;
  costPoints: number;
  stockLeft: number | null;
  affordable?: boolean;
  limitReached?: boolean;
};

/** The picture at the top of a perk: its image, or its icon on a coloured tile. */
export function PerkArt({ perk, className }: { perk: Pick<Perk, "icon" | "imageUrl" | "title">; className?: string }) {
  if (perk.imageUrl)
    // eslint-disable-next-line @next/next/no-img-element -- images come from Convex storage
    return <img src={perk.imageUrl} alt="" className={cn("w-full object-cover", className)} />;
  return (
    <div className={cn("flex w-full items-center justify-center bg-chart-perk/15 text-chart-perk", className)}>
      <Icon icon={perkIcon(perk.icon)} className="size-10" />
    </div>
  );
}

/** A perk in the store grid: picture, title, short text, cost and what's left. */
export function PerkCard({ perk, pointsName, href, balance }: { perk: Perk; pointsName: string; href: string; balance?: number }) {
  const short = balance !== undefined && !perk.affordable ? perk.costPoints - balance : 0;
  const out = perk.stockLeft === 0;
  return (
    <Link href={href} className="group flex flex-col overflow-hidden rounded-md border border-border bg-surface hover:border-border-strong focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
      <PerkArt perk={perk} className="aspect-[16/9]" />
      <div className="flex flex-1 flex-col gap-1 p-3">
        <span className="font-medium group-hover:underline">{perk.title}</span>
        <span className="line-clamp-2 text-sm text-foreground-secondary">{perk.summary}</span>
        <span className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-2">
          <span className="tabular rounded-full bg-primary-subtle px-2.5 py-0.5 text-sm font-semibold text-primary-text">
            {perk.costPoints.toLocaleString("en-IN")} {pointsName}
          </span>
          <span className="text-xs text-foreground-secondary">
            {out ? "Out of stock" : perk.limitReached ? "Limit reached" : short > 0 ? `${short} more needed` : perk.stockLeft !== null ? `${perk.stockLeft} left` : ""}
          </span>
        </span>
      </div>
    </Link>
  );
}
