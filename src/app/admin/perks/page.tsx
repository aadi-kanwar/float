"use client";

import { useMutation } from "convex/react";
import { ArrowDown, ArrowUp, Pencil, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import { useMe } from "@/components/app/session";
import { PerkArt } from "@/components/perks/perk-card";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingState } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import { toast } from "@/components/ui/toaster";
import { useQuery } from "@/lib/convex";
import { friendlyError } from "@/lib/errors";
import { CircleCheck, EyeOff, Archive } from "lucide-react";

const VIS = {
  active: { label: "Active", tone: "success" as const, icon: CircleCheck },
  hidden: { label: "Hidden", tone: "neutral" as const, icon: EyeOff },
  archived: { label: "Archived", tone: "neutral" as const, icon: Archive },
};

export default function PerksAdminPage() {
  const me = useMe();
  const perks = useQuery(api.perks.adminList, {});
  const move = useMutation(api.perks.move);
  return (
    <>
      <PageHeader
        title="Perk Store"
        description={`Build the perks residents redeem with ${me?.pointsName ?? ""}. Order here is the order in the store.`}
        actions={
          <Button asChild>
            <Link href="/admin/perks/new">
              <Icon icon={Plus} />
              New perk
            </Link>
          </Button>
        }
      />
      {perks === undefined ? (
        <LoadingState rows={4} />
      ) : perks.length === 0 ? (
        <EmptyState title="No perks yet" description="Add your first perk, e.g. a guest night or a free laundry wash." />
      ) : (
        <Card>
          <ul className="divide-y divide-border">
            {perks.map((p, i) => (
              <li key={p.perkId} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <PerkArt perk={p} className="size-12 shrink-0 overflow-hidden rounded-sm [&_svg]:size-6" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex flex-wrap items-center gap-2 font-medium">
                    {p.title}
                    <StatusBadge tone={VIS[p.visibility].tone} icon={VIS[p.visibility].icon}>{VIS[p.visibility].label}</StatusBadge>
                  </span>
                  <span className="text-sm text-foreground-secondary">
                    {p.costPoints} {me?.pointsName} · {p.stockLeft === null ? "unlimited" : `${p.stockLeft} left`} · redeemed {p.redeemed}×
                  </span>
                </span>
                <span className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" aria-label="Move up" disabled={i === 0} onClick={() => move({ perkId: p.perkId, by: -1 }).catch((e) => toast.error(friendlyError(e)))}>
                    <Icon icon={ArrowUp} />
                  </Button>
                  <Button variant="ghost" size="icon" aria-label="Move down" disabled={i === perks.length - 1} onClick={() => move({ perkId: p.perkId, by: 1 }).catch((e) => toast.error(friendlyError(e)))}>
                    <Icon icon={ArrowDown} />
                  </Button>
                  <Button asChild variant="secondary">
                    <Link href={`/admin/perks/${p.perkId}`}>
                      <Icon icon={Pencil} />
                      Edit
                    </Link>
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Categories />
    </>
  );
}

function Categories() {
  const cats = useQuery(api.perks.categories, {});
  const save = useMutation(api.perks.saveCategory);
  const [name, setName] = useState("");
  return (
    <section aria-labelledby="cats" className="flex flex-col gap-2">
      <h2 id="cats" className="font-serif text-2xl tracking-tight">Categories</h2>
      <Card>
        <CardBody className="flex flex-col gap-3">
          {(cats ?? []).length > 0 ? (
            <ul className="flex flex-wrap gap-2">
              {(cats ?? []).map((c) => (
                <li key={c.categoryId}>
                  <button
                    type="button"
                    title={c.archived ? "Archived: tap to bring back" : "Tap to archive"}
                    onClick={() => save({ categoryId: c.categoryId, name: c.name, archived: !c.archived }).catch((e) => toast.error(friendlyError(e)))}
                    className={c.archived ? "rounded-full border border-dashed border-border-strong px-3 py-1 text-sm text-foreground-muted line-through" : "rounded-full border border-border bg-subtle px-3 py-1 text-sm"}
                  >
                    {c.name}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-foreground-secondary">No categories yet. Residents can filter the store by them.</p>
          )}
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await save({ name });
                setName("");
              } catch (error) {
                toast.error(friendlyError(error));
              }
            }}
          >
            <Input aria-label="New category" placeholder="e.g. Food, Stay, Laundry" value={name} onChange={(e) => setName(e.target.value)} required />
            <Button type="submit" variant="secondary">
              <Icon icon={Plus} />
              Add
            </Button>
          </form>
        </CardBody>
      </Card>
    </section>
  );
}
