"use client";

import { api } from "@convex/_generated/api";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingState } from "@/components/ui/skeleton";
import { Stat } from "@/components/ui/stat";
import { useQuery } from "@/lib/convex";

/** Admin home. Money, points and perk figures join as those parts are built. */
export default function Overview() {
  const residents = useQuery(api.residents.list, {});
  return (
    <>
      <PageHeader title="Overview" />
      {residents === undefined ? (
        <LoadingState rows={2} />
      ) : (
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Residents" value={residents.length} />
          <Stat label="Paused" value={residents.filter((r) => r.paused).length} warn={residents.some((r) => r.paused)} />
        </dl>
      )}
    </>
  );
}
