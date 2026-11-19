"use client";

import { Eyebrow } from "@/components/app/brand";
import { useMe } from "@/components/app/session";
import { EmptyState } from "@/components/ui/states";
import { formatDay, todayIn } from "@/lib/format";

/** Resident home. Balances, draws and points are added with the money engine. */
export default function ResidentHome() {
  const me = useMe();
  const firstName = (me?.name ?? "").split(" ")[0];
  return (
    <>
      <div className="flex flex-col gap-1">
        <Eyebrow>{formatDay(todayIn(), "EEEE d MMMM")}</Eyebrow>
        <h1 className="font-serif text-3xl tracking-tight">
          Hello, <em className="text-primary-soft">{firstName}.</em>
        </h1>
      </div>
      <EmptyState title="Pocket money is coming soon" description="You'll be able to draw money against your deposit here." />
    </>
  );
}
