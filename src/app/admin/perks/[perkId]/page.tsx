"use client";

import { useParams } from "next/navigation";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { PerkEditor } from "@/components/admin/perk-editor";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingState } from "@/components/ui/skeleton";
import { useQuery } from "@/lib/convex";

export default function EditPerkPage() {
  const { perkId } = useParams<{ perkId: Id<"perks"> }>();
  const p = useQuery(api.perks.adminGet, { perkId });
  return (
    <>
      <PageHeader title={p ? `Edit ${p.title}` : "Edit perk"} description="Changes apply from now on; past redemptions keep their title and cost." />
      {p === undefined ? <LoadingState rows={6} /> : <PerkEditor initial={p} />}
    </>
  );
}
