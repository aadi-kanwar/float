"use client";

import { useMutation } from "convex/react";
import { Check, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { ClaimBadge } from "@/components/money/bits";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingState } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/states";
import { SegmentedTabs } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toaster";
import { useQuery } from "@/lib/convex";
import { friendlyError } from "@/lib/errors";
import { formatPaise, formatWhen } from "@/lib/format";

type Tab = "pending" | "confirmed" | "rejected";

export default function RepaymentsPage() {
  const [tab, setTab] = useState<Tab>("pending");
  const rows = useQuery(api.repayments.queue, { status: tab });
  const confirm = useMutation(api.repayments.confirm);
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <>
      <PageHeader
        title="Repayment confirmations"
        description="Check the money arrived in your UPI app, then confirm. A confirmed payment counts from when the resident said they paid."
      />
      <SegmentedTabs
        label="Show"
        idPrefix="claims"
        items={[
          { value: "pending", label: "To confirm", count: tab === "pending" ? rows?.length : undefined },
          { value: "confirmed", label: "Confirmed" },
          { value: "rejected", label: "Rejected" },
        ]}
        value={tab}
        onChange={setTab}
      />
      <div id="claims-panel" role="tabpanel">
        {rows === undefined ? (
          <LoadingState rows={4} />
        ) : rows.length === 0 ? (
          <EmptyState title={tab === "pending" ? "Nothing to confirm" : "None"} />
        ) : (
          <Card>
            <ul className="divide-y divide-border">
              {rows.map((c) => (
                <li key={c.claimId} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="font-medium">
                      <Link href={`/admin/residents/${c.residentId}`} className="hover:underline">
                        {c.residentName}
                      </Link>
                      {c.roomNumber ? <span className="font-normal text-foreground-secondary"> · Room {c.roomNumber}</span> : null}
                    </span>
                    <span className="text-sm text-foreground-secondary">
                      <span className="tabular font-semibold text-foreground">{formatPaise(c.amountPaise)}</span> · paid {formatWhen(c.submittedAt)}
                      {c.upiRef ? ` · UPI ref ${c.upiRef}` : ""}
                    </span>
                    <span>
                      <ClaimBadge status={c.status} />
                    </span>
                    {c.note ? <span className="text-sm">Note: {c.note}</span> : null}
                  </div>
                  {c.status === "pending" ? (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        loading={busy === c.claimId}
                        onClick={async () => {
                          setBusy(c.claimId);
                          try {
                            await confirm({ claimId: c.claimId });
                            toast.success("Confirmed.");
                          } catch (error) {
                            toast.error(friendlyError(error));
                          } finally {
                            setBusy(null);
                          }
                        }}
                      >
                        <Icon icon={Check} />
                        Confirm
                      </Button>
                      <RejectClaim id={c.claimId} name={c.residentName} />
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}

function RejectClaim({ id, name }: { id: Id<"repaymentClaims">; name: string }) {
  const reject = useMutation(api.repayments.reject);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setNote(""); }}>
      <DialogTrigger asChild>
        <Button variant="ghost">
          <Icon icon={X} />
          Not received
        </Button>
      </DialogTrigger>
      <DialogContent title={`Reject ${name}'s payment?`} description="They'll see your note. Late fees for the days it waited are added if still owed.">
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await reject({ claimId: id, note: note || undefined });
              toast.success("Rejected.");
              setOpen(false);
            } catch (error) {
              toast.error(friendlyError(error));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field id="claim-note" label="Note (optional)">
            {(p) => <Input {...p} value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />}
          </Field>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" type="button">Cancel</Button>
            </DialogClose>
            <Button type="submit" variant="destructive" loading={busy}>Reject</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
