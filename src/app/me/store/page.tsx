"use client";

import { Sparkles } from "lucide-react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import { PerkCard } from "@/components/perks/perk-card";
import { Banner } from "@/components/ui/banner";
import { Icon } from "@/components/ui/icon";
import { LoadingState } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/states";
import { useQuery } from "@/lib/convex";
import { cn } from "@/lib/utils";

export default function StorePage() {
  const s = useQuery(api.perks.store, {});
  const [category, setCategory] = useState<string>("");
  if (s === undefined) return <LoadingState rows={6} />;
  const perks = category ? s.perks.filter((p) => p.categoryId === category) : s.perks;
  return (
    <>
      <div className="flex items-end justify-between gap-3">
        <h1 className="font-serif text-3xl tracking-tight">Perk Store</h1>
        <span className="flex items-center gap-1.5 rounded-full bg-primary-subtle px-3 py-1 text-sm font-semibold text-primary-text">
          <Icon icon={Sparkles} className="size-4" />
          {s.balance.toLocaleString("en-IN")} {s.pointsName}
        </span>
      </div>
      {s.paused ? <Banner tone="warning" title="Your account is paused">You can look, but can&apos;t redeem right now.</Banner> : null}
      {s.categories.length > 0 ? (
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="group" aria-label="Category">
          {[{ categoryId: "", name: "All" }, ...s.categories].map((c) => (
            <button
              key={c.categoryId}
              type="button"
              aria-pressed={category === c.categoryId}
              onClick={() => setCategory(c.categoryId)}
              className={cn(
                "min-h-10 shrink-0 rounded-full border px-4 text-sm font-medium",
                category === c.categoryId ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface text-foreground hover:bg-subtle",
              )}
            >
              {c.name}
            </button>
          ))}
        </div>
      ) : null}
      {perks.length === 0 ? (
        <EmptyState title="No perks here yet" description="Check back soon." />
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {perks.map((p) => (
            <PerkCard key={p.perkId} perk={p} pointsName={s.pointsName} balance={s.balance} href={`/me/store/${p.perkId}`} />
          ))}
        </div>
      )}
    </>
  );
}
