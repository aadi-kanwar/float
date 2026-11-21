"use client";

import { useMutation, usePaginatedQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import { usePropertyScope } from "@/components/app/property-scope";
import type { Id } from "@convex/_generated/dataModel";
import type { RedemptionStatus } from "@convex/lib/validators";
import { useMe } from "@/components/app/session";
import { REDEMPTION_STATUS, RedemptionBadge, RedemptionTimeline } from "@/components/perks/redemption-timeline";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { FilterBar } from "@/components/ui/filter-bar";
import { Input, inputClasses } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { NativeSelect } from "@/components/ui/native-select";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingState } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/states";
import { toast } from "@/components/ui/toaster";
import { useQuery } from "@/lib/convex";
import { friendlyError } from "@/lib/errors";
import { formatWhen } from "@/lib/format";

const ORDER: RedemptionStatus[] = ["requested", "approved", "in_progress", "fulfilled", "rejected", "cancelled"];

export default function RedemptionsAdminPage() {
  const me = useMe();
  const [status, setStatus] = useState<RedemptionStatus | "">("requested");
  const [perkId, setPerkId] = useState("");
  const [residentId, setResidentId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const { arg } = usePropertyScope();
  const perks = useQuery(api.perks.adminList, {});
  const residents = useQuery(api.residents.list, arg);
  const newCount = useQuery(api.redemptions.newCount, arg);
  const { results, status: loading, loadMore } = usePaginatedQuery(
    api.redemptions.queue,
    {
      status: status || undefined,
      perkId: (perkId || undefined) as Id<"perks"> | undefined,
      residentId: (residentId || undefined) as Id<"residents"> | undefined,
      from: from || undefined,
      to: to || undefined,
      ...arg,
    },
    { initialNumItems: 30 },
  );
  return (
    <>
      <PageHeader
        title="Redemptions"
        description={`${newCount ?? 0} new. Move each one along and add a note; the resident sees every change straight away. Rejecting or cancelling gives the ${me?.pointsName ?? ""} back.`}
      />
      <FilterBar>
        <NativeSelect aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as RedemptionStatus | "")} className="sm:w-44">
          <option value="">All statuses</option>
          {ORDER.map((s) => (
            <option key={s} value={s}>{REDEMPTION_STATUS[s].label}</option>
          ))}
        </NativeSelect>
        <NativeSelect aria-label="Perk" value={perkId} onChange={(e) => setPerkId(e.target.value)} className="sm:w-48">
          <option value="">All perks</option>
          {(perks ?? []).map((p) => (
            <option key={p.perkId} value={p.perkId}>{p.title}</option>
          ))}
        </NativeSelect>
        <NativeSelect aria-label="Resident" value={residentId} onChange={(e) => setResidentId(e.target.value)} className="sm:w-48">
          <option value="">All residents</option>
          {(residents ?? []).map((r) => (
            <option key={r.residentId} value={r.residentId}>{r.name}</option>
          ))}
        </NativeSelect>
        <Input type="date" aria-label="From" value={from} onChange={(e) => setFrom(e.target.value)} className="sm:w-40" />
        <Input type="date" aria-label="To" value={to} onChange={(e) => setTo(e.target.value)} className="sm:w-40" />
      </FilterBar>
      {loading === "LoadingFirstPage" ? (
        <LoadingState rows={4} />
      ) : results.length === 0 ? (
        <EmptyState title="Nothing here" />
      ) : (
        <div className="flex flex-col gap-3">
          {results.map((r) => (
            <Card key={r.redemptionId}>
              <CardBody className="grid gap-4 md:grid-cols-[1fr_16rem]">
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{r.perkTitle}</span>
                    <RedemptionBadge status={r.status} />
                  </div>
                  <span className="text-sm text-foreground-secondary">
                    <Link href={`/admin/residents/${r.residentId}`} className="font-medium text-foreground hover:underline">{r.residentName}</Link>
                    {r.roomNumber ? ` · Room ${r.roomNumber}` : ""} · {r.costPoints} {me?.pointsName} · {formatWhen(r.createdAt)}
                  </span>
                  {r.answers.filter((a) => a.value).map((a) => (
                    <span key={a.label} className="text-sm"><span className="text-foreground-secondary">{a.label}:</span> {a.value}</span>
                  ))}
                  {r.redeemInfo ? <span className="rounded-sm bg-subtle px-2 py-1 font-mono text-sm break-all">{r.redeemInfo}</span> : null}
                  {r.status !== "rejected" && r.status !== "cancelled" ? <MoveDialog redemptionId={r.redemptionId} current={r.status} title={r.perkTitle} /> : null}
                </div>
                <RedemptionTimeline status={r.status} history={r.history} />
              </CardBody>
            </Card>
          ))}
          {loading === "CanLoadMore" ? <Button variant="secondary" className="self-center" onClick={() => loadMore(30)}>Show more</Button> : null}
        </div>
      )}
    </>
  );
}

function MoveDialog({ redemptionId, current, title }: { redemptionId: Id<"redemptions">; current: RedemptionStatus; title: string }) {
  const setStatus = useMutation(api.redemptions.setStatus);
  const next = ORDER[Math.min(ORDER.indexOf(current) + 1, 3)];
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState<RedemptionStatus>(next);
  const [note, setNote] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) { setTo(next); setNote(""); setInfo(""); } }}>
      <DialogTrigger asChild>
        <Button className="self-start">Update status</Button>
      </DialogTrigger>
      <DialogContent title={`Update ${title}`} description="The resident sees the new status and your note at once.">
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await setStatus({ redemptionId, status: to, note: note || undefined, info: info || undefined });
              toast.success("Updated.");
              setOpen(false);
            } catch (error) {
              toast.error(friendlyError(error));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field id="mv-to" label="Move to">
            {(p) => (
              <NativeSelect {...p} value={to} onChange={(e) => setTo(e.target.value as RedemptionStatus)}>
                {ORDER.filter((s) => s !== current).map((s) => (
                  <option key={s} value={s}>
                    {REDEMPTION_STATUS[s].label}
                    {s === "rejected" || s === "cancelled" ? " (gives the points back)" : ""}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          {to !== "rejected" && to !== "cancelled" ? (
            <Field id="mv-info" label="Code, link or details for the resident (optional)" hint="e.g. a voucher code, a booking link, or where to collect it. Shown big on their screen with a Copy button.">
              {(p) => <textarea {...p} className={cn(inputClasses, "min-h-20 py-2")} value={info} onChange={(e) => setInfo(e.target.value)} maxLength={1000} />}
            </Field>
          ) : null}
          <Field id="mv-note" label="Note (optional)">
            {(p) => <Input {...p} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />}
          </Field>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" type="button">Cancel</Button>
            </DialogClose>
            <Button type="submit" loading={busy} variant={to === "rejected" || to === "cancelled" ? "destructive" : "primary"}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
