"use client";

import { useMutation } from "convex/react";
import { Copy } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useMe } from "@/components/app/session";
import { perkIcon } from "@/components/perks/perk-icon";
import { RedemptionBadge, RedemptionTimeline } from "@/components/perks/redemption-timeline";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { LoadingState } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/states";
import { toast } from "@/components/ui/toaster";
import { useQuery } from "@/lib/convex";
import { friendlyError } from "@/lib/errors";
import { formatWhen } from "@/lib/format";

/** The resident's redemptions with live status timelines. */
export default function MyRedemptionsPage() {
  const me = useMe();
  const list = useQuery(api.redemptions.mine, {});
  const cancel = useMutation(api.redemptions.cancel);
  const [busy, setBusy] = useState<Id<"redemptions"> | null>(null);
  return (
    <>
      <h1 className="font-serif text-3xl tracking-tight">My redemptions</h1>
      {list === undefined ? (
        <LoadingState rows={4} />
      ) : list.length === 0 ? (
        <EmptyState title="Nothing redeemed yet" action={<Button asChild variant="secondary"><Link href="/me/store">Go to the Perk Store</Link></Button>} />
      ) : (
        list.map((r) => (
          <Card key={r.redemptionId}>
            <CardBody className="flex flex-col gap-3">
              <div className="flex items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-chart-perk/15 text-chart-perk">
                  <Icon icon={perkIcon(r.icon)} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-medium">{r.perkTitle}</span>
                  <span className="text-sm text-foreground-secondary">
                    {r.costPoints} {me?.pointsName} · {formatWhen(r.createdAt)}
                    {r.refunded ? ` · ${me?.pointsName} given back` : ""}
                  </span>
                </span>
                <RedemptionBadge status={r.status} />
              </div>
              {r.answers.filter((a) => a.value).length > 0 ? (
                <p className="text-sm text-foreground-secondary">{r.answers.filter((a) => a.value).map((a) => `${a.label}: ${a.value}`).join(" · ")}</p>
              ) : null}
              <RedemptionTimeline status={r.status} history={r.history} />
              {r.redeemInfo ? <RedeemInfo info={r.redeemInfo} /> : null}
              {r.fulfilmentNote && r.status !== "rejected" && r.status !== "cancelled" ? (
                <p className="rounded-sm bg-primary-subtle px-3 py-2 text-sm text-primary-text">{r.fulfilmentNote}</p>
              ) : null}
              {r.status === "requested" ? (
                <Button
                  variant="ghost"
                  className="self-start"
                  loading={busy === r.redemptionId}
                  onClick={async () => {
                    setBusy(r.redemptionId);
                    try {
                      await cancel({ redemptionId: r.redemptionId });
                      toast.success(`Cancelled. Your ${me?.pointsName} are back.`);
                    } catch (error) {
                      toast.error(friendlyError(error));
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  Cancel
                </Button>
              ) : null}
            </CardBody>
          </Card>
        ))
      )}
    </>
  );
}

/** The code / link / details the office gave: big, with Copy, and links clickable. */
function RedeemInfo({ info }: { info: string }) {
  const parts = info.split(/(https?:\/\/[^\s]+)/g);
  return (
    <div className="flex flex-col gap-2 rounded-md border-2 border-primary-subtle-border bg-primary-subtle p-3">
      <span className="text-xs font-medium tracking-wide text-primary-text uppercase">Your code / details</span>
      <p className="font-mono text-lg break-all whitespace-pre-wrap text-foreground">
        {parts.map((part, i) =>
          /^https?:\/\//.test(part) ? (
            <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="text-primary-text underline">
              {part}
            </a>
          ) : (
            <span key={i}>{part}</span>
          ),
        )}
      </p>
      <Button
        variant="secondary"
        className="self-start"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(info);
            toast.success("Copied.");
          } catch {
            toast.error("Couldn't copy.");
          }
        }}
      >
        <Icon icon={Copy} />
        Copy
      </Button>
    </div>
  );
}
