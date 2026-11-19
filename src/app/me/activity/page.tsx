"use client";

import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { ClaimBadge, DrawBadge, LedgerAmount } from "@/components/money/bits";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { LoadingState } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/states";
import { SegmentedTabs } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toaster";
import { useQuery } from "@/lib/convex";
import { friendlyError } from "@/lib/errors";
import { formatDate, formatPaise, formatWhen } from "@/lib/format";
import { LEDGER_LABEL } from "@/lib/money-labels";

type Tab = "requests" | "ledger";

export default function ActivityPage() {
  const [tab, setTab] = useState<Tab>("requests");
  return (
    <>
      <h1 className="font-serif text-3xl tracking-tight">Activity</h1>
      <SegmentedTabs
        label="Show"
        idPrefix="activity"
        items={[
          { value: "requests", label: "Draws & payments" },
          { value: "ledger", label: "Account" },
        ]}
        value={tab}
        onChange={setTab}
      />
      <div id="activity-panel" role="tabpanel">
        {tab === "requests" ? <Requests /> : <Ledger />}
      </div>
    </>
  );
}

function Requests() {
  const draws = useQuery(api.draws.mine, {});
  const claims = useQuery(api.repayments.mine, {});
  const cancel = useMutation(api.draws.cancel);
  const [busy, setBusy] = useState<Id<"drawRequests"> | null>(null);
  if (draws === undefined || claims === undefined) return <LoadingState rows={4} />;
  const items = [
    ...draws.map((d) => ({ kind: "draw" as const, at: d.requestedAt, d })),
    ...claims.map((c) => ({ kind: "claim" as const, at: c.submittedAt, c })),
  ].sort((a, b) => b.at - a.at);
  if (items.length === 0) return <EmptyState title="Nothing yet" description="Your draws and payments will show here." />;
  return (
    <Card>
      <ul className="divide-y divide-border">
        {items.map((item) =>
          item.kind === "draw" ? (
            <li key={item.d.drawRequestId} className="flex flex-col gap-2 px-4 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-medium">Draw {formatPaise(item.d.amountPaise)}</span>
                <span className="text-xs text-foreground-secondary">{formatWhen(item.d.requestedAt)}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm text-foreground-secondary">
                <DrawBadge status={item.d.status} />
                <span>Fee {formatPaise(item.d.feePaise)}</span>
                {item.d.upiRef ? <span>· UPI ref {item.d.upiRef}</span> : null}
              </div>
              {item.d.note ? <p className="text-sm">Note: {item.d.note}</p> : null}
              {item.d.status === "requested" ? (
                <Button
                 
                  variant="ghost"
                  className="self-start"
                  loading={busy === item.d.drawRequestId}
                  onClick={async () => {
                    setBusy(item.d.drawRequestId);
                    try {
                      await cancel({ drawRequestId: item.d.drawRequestId });
                      toast.success("Cancelled.");
                    } catch (error) {
                      toast.error(friendlyError(error));
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  Cancel request
                </Button>
              ) : null}
            </li>
          ) : (
            <li key={item.c.claimId} className="flex flex-col gap-2 px-4 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-medium">Payment {formatPaise(item.c.amountPaise)}</span>
                <span className="text-xs text-foreground-secondary">{formatWhen(item.c.submittedAt)}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm text-foreground-secondary">
                <ClaimBadge status={item.c.status} />
                {item.c.upiRef ? <span>UPI ref {item.c.upiRef}</span> : null}
              </div>
              {item.c.note ? <p className="text-sm">Note: {item.c.note}</p> : null}
            </li>
          ),
        )}
      </ul>
    </Card>
  );
}

function Ledger() {
  const rows = useQuery(api.money.myActivity, {});
  if (rows === undefined) return <LoadingState rows={4} />;
  if (rows.length === 0) return <EmptyState title="Nothing yet" />;
  return (
    <Card>
      <ul className="divide-y divide-border">
        {rows.map((r) => (
          <li key={r.entryId} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
            <span className="flex min-w-0 flex-col">
              <span className="font-medium">
                {LEDGER_LABEL[r.type]}
                {r.reversed ? <span className="font-normal text-foreground-secondary"> · cancelled</span> : null}
              </span>
              <span className="text-foreground-secondary">{r.forDate ? formatDate(r.forDate) : formatWhen(r.effectiveAt)}</span>
            </span>
            <LedgerAmount type={r.type} amountPaise={r.amountPaise} reversed={r.reversed} />
          </li>
        ))}
      </ul>
    </Card>
  );
}
