"use client";

import { useMutation } from "convex/react";
import { Check, Send, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import { usePropertyScope } from "@/components/app/property-scope";
import type { Id } from "@convex/_generated/dataModel";
import { DrawBadge } from "@/components/money/bits";
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

type Tab = "waiting" | "disbursed" | "rejected" | "cancelled";

export default function DrawsPage() {
  const [tab, setTab] = useState<Tab>("waiting");
  const { arg } = usePropertyScope();
  const rows = useQuery(api.draws.queue, { status: tab, ...arg });
  const approve = useMutation(api.draws.approve);
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <>
      <PageHeader title="Draw requests" description="Approve, then send the money by UPI outside the app and mark it sent. It goes on the resident's statement when sent." />
      <SegmentedTabs
        label="Show"
        idPrefix="draws"
        items={[
          { value: "waiting", label: "Waiting", count: tab === "waiting" ? rows?.length : undefined },
          { value: "disbursed", label: "Sent" },
          { value: "rejected", label: "Rejected" },
          { value: "cancelled", label: "Cancelled" },
        ]}
        value={tab}
        onChange={setTab}
      />
      <div id="draws-panel" role="tabpanel">
        {rows === undefined ? (
          <LoadingState rows={4} />
        ) : rows.length === 0 ? (
          <EmptyState title={tab === "waiting" ? "Nothing waiting" : "None"} />
        ) : (
          <Card>
            <ul className="divide-y divide-border">
              {rows.map((d) => (
                <li key={d.drawRequestId} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="font-medium">
                      <Link href={`/admin/residents/${d.residentId}`} className="hover:underline">
                        {d.residentName}
                      </Link>
                      {d.roomNumber ? <span className="font-normal text-foreground-secondary"> · Room {d.roomNumber}</span> : null}
                    </span>
                    <span className="text-sm text-foreground-secondary">
                      <span className="tabular font-semibold text-foreground">{formatPaise(d.amountPaise)}</span> + fee {formatPaise(d.feePaise)} · {formatWhen(d.requestedAt)}
                      {d.upiRef ? ` · UPI ref ${d.upiRef}` : ""}
                    </span>
                    <span>
                      <DrawBadge status={d.status} />
                    </span>
                    {d.note ? <span className="text-sm">Note: {d.note}</span> : null}
                  </div>
                  {d.status === "requested" || d.status === "approved" ? (
                    <div className="flex flex-wrap gap-2">
                      {d.status === "requested" ? (
                        <Button
                          variant="secondary"
                          loading={busy === d.drawRequestId}
                          onClick={async () => {
                            setBusy(d.drawRequestId);
                            try {
                              await approve({ drawRequestId: d.drawRequestId });
                              toast.success("Approved.");
                            } catch (error) {
                              toast.error(friendlyError(error));
                            } finally {
                              setBusy(null);
                            }
                          }}
                        >
                          <Icon icon={Check} />
                          Approve
                        </Button>
                      ) : null}
                      <SendDialog id={d.drawRequestId} name={d.residentName} amountPaise={d.amountPaise} />
                      <RejectDialog id={d.drawRequestId} name={d.residentName} />
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

function SendDialog({ id, name, amountPaise }: { id: Id<"drawRequests">; name: string; amountPaise: number }) {
  const mark = useMutation(api.draws.markDisbursed);
  const [open, setOpen] = useState(false);
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setRef(""); }}>
      <DialogTrigger asChild>
        <Button>
          <Icon icon={Send} />
          Mark sent
        </Button>
      </DialogTrigger>
      <DialogContent title={`Sent ${formatPaise(amountPaise)} to ${name}?`} description="Send it by UPI first. Marking it sent puts it (and its fee) on their statement.">
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await mark({ drawRequestId: id, upiRef: ref || undefined });
              toast.success("Marked as sent.");
              setOpen(false);
            } catch (error) {
              toast.error(friendlyError(error));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field id="send-ref" label="UPI reference (optional)">
            {(p) => <Input {...p} value={ref} onChange={(e) => setRef(e.target.value)} maxLength={60} />}
          </Field>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" type="button">Cancel</Button>
            </DialogClose>
            <Button type="submit" loading={busy}>Mark sent</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RejectDialog({ id, name }: { id: Id<"drawRequests">; name: string }) {
  const reject = useMutation(api.draws.reject);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setNote(""); }}>
      <DialogTrigger asChild>
        <Button variant="ghost">
          <Icon icon={X} />
          Reject
        </Button>
      </DialogTrigger>
      <DialogContent title={`Reject ${name}'s draw?`} description="They'll see your note.">
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await reject({ drawRequestId: id, note: note || undefined });
              toast.success("Rejected.");
              setOpen(false);
            } catch (error) {
              toast.error(friendlyError(error));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field id="reject-note" label="Note (optional)">
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
