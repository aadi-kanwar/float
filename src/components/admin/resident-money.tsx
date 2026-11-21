"use client";

import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { LedgerAmount, StatementBadge } from "@/components/money/bits";
import { StatementDetail } from "@/components/money/statement-detail";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { LoadingState } from "@/components/ui/skeleton";
import { Stat } from "@/components/ui/stat";
import { EmptyState } from "@/components/ui/states";
import { toast } from "@/components/ui/toaster";
import { useQuery } from "@/lib/convex";
import { friendlyError } from "@/lib/errors";
import { formatDate, formatMonth, formatPaise, formatWhen } from "@/lib/format";
import { LEDGER_LABEL } from "@/lib/money-labels";
import { ReasonDialog } from "./reason-dialog";

/** A resident's money on their admin page: figures, overrides, statements and the ledger. */
export function ResidentMoney({
  residentId,
  ownLimit,
  actions,
}: {
  residentId: Id<"residents">;
  ownLimit: boolean;
  actions?: React.ReactNode;
}) {
  const a = useQuery(api.money.residentAccount, { residentId });
  const reverse = useMutation(api.money.reverse);
  if (a === undefined) return <LoadingState rows={4} />;
  return (
    <>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Owes" value={formatPaise(a.outstandingPaise)} emphasis />
        <Stat label="Overdue" value={formatPaise(a.overduePaise)} warn={a.overdue} />
        <Stat label="Can draw now" value={formatPaise(a.availablePaise)} hint={`Limit ${formatPaise(a.limitPaise)}${ownLimit ? " (set for them)" : ""}`} />
      </dl>
      <Card>
        <CardBody className="flex flex-wrap gap-2">
          <RecordPayment residentId={residentId} />
          {a.waivable.length > 0 ? <WaiveDialog residentId={residentId} waivable={a.waivable} /> : null}
          {actions}
        </CardBody>
      </Card>

      <section aria-labelledby="r-statements" className="flex flex-col gap-2">
        <h2 id="r-statements" className="font-serif text-2xl tracking-tight">
          Statements
        </h2>
        {a.statements.length === 0 ? (
          <EmptyState title="No statements yet" />
        ) : (
          <Card>
            <ul className="divide-y divide-border">
              {a.statements.map((s) => (
                <li key={s.month} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                  <span className="flex flex-col">
                    <span className="font-medium">{formatMonth(s.month)}</span>
                    <span className="text-sm text-foreground-secondary">
                      {formatPaise(s.totalDuePaise)} · due {formatDate(s.dueDate)} · owed {formatPaise(s.outstandingPaise)}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <StatementBadge status={s.status} />
                    <StatementDialog residentId={residentId} month={s.month} />
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>

      <section aria-labelledby="r-ledger" className="flex flex-col gap-2">
        <h2 id="r-ledger" className="font-serif text-2xl tracking-tight">
          Ledger
        </h2>
        <p className="text-sm text-foreground-secondary">Nothing here is ever edited or deleted. To correct a row, reverse it (and add the right one).</p>
        {a.ledger.length === 0 ? (
          <EmptyState title="Nothing yet" />
        ) : (
          <Card>
            <ul className="divide-y divide-border">
              {a.ledger.map((e) => (
                <li key={e.entryId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
                  <span className="flex min-w-0 flex-col">
                    <span className="font-medium">
                      {LEDGER_LABEL[e.type]}
                      {e.cycleMonth ? <span className="font-normal text-foreground-secondary"> · {formatMonth(e.cycleMonth)}</span> : null}
                      {e.reversed ? <span className="font-normal text-foreground-secondary"> · reversed</span> : null}
                    </span>
                    <span className="text-foreground-secondary">
                      {e.forDate ? formatDate(e.forDate) : formatWhen(e.effectiveAt)}
                      {e.note ? ` · ${e.note}` : ""}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <LedgerAmount type={e.type} amountPaise={e.amountPaise} reversed={e.reversed} />
                    {e.canReverse ? (
                      <ReasonDialog
                        trigger={<Button variant="ghost">Reverse</Button>}
                        title={`Reverse this ${LEDGER_LABEL[e.type].toLowerCase()}?`}
                        description={`${formatPaise(e.amountPaise)}. A reversing row is added; the original stays in the history.`}
                        confirmLabel="Reverse"
                        onSave={(_, reason) => reverse({ entryId: e.entryId, reason })}
                      />
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>
    </>
  );
}

function RecordPayment({ residentId }: { residentId: Id<"residents"> }) {
  const record = useMutation(api.repayments.record);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) { setAmount(""); setRef(""); } }}>
      <DialogTrigger asChild>
        <Button>Record a payment</Button>
      </DialogTrigger>
      <DialogContent title="Record a payment you received" description="It counts from now.">
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!/^\d+$/.test(amount)) {
              toast.error("Enter whole rupees.");
              return;
            }
            setBusy(true);
            try {
              await record({ residentId, amountRupees: Number(amount), upiRef: ref || undefined });
              toast.success("Payment recorded.");
              setOpen(false);
            } catch (error) {
              toast.error(friendlyError(error));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field id="rec-amount" label="Amount (₹)">
            {(p) => <Input {...p} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))} required />}
          </Field>
          <Field id="rec-ref" label="UTR / reference (optional)">
            {(p) => <Input {...p} value={ref} onChange={(e) => setRef(e.target.value)} maxLength={60} />}
          </Field>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" type="button">Cancel</Button>
            </DialogClose>
            <Button type="submit" loading={busy}>Record</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function WaiveDialog({ residentId, waivable }: { residentId: Id<"residents">; waivable: { month: string; feePaise: number; lateFeePaise: number }[] }) {
  const waive = useMutation(api.money.waive);
  const options = waivable.flatMap((w) => [
    ...(w.lateFeePaise > 0 ? [{ key: `${w.month}|lateFee`, label: `${formatMonth(w.month)}: late fees (${formatPaise(w.lateFeePaise)})` }] : []),
    ...(w.feePaise > 0 ? [{ key: `${w.month}|fee`, label: `${formatMonth(w.month)}: fees (${formatPaise(w.feePaise)})` }] : []),
  ]);
  const [choice, setChoice] = useState(options[0]?.key ?? "");
  return (
    <ReasonDialog
      trigger={<Button variant="secondary">Waive a fee</Button>}
      title="Waive a fee or late fee"
      description={
        <NativeSelect aria-label="What to waive" value={choice} onChange={(e) => setChoice(e.target.value)}>
          {options.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </NativeSelect>
      }
      amount={{ label: "Amount (₹)", initial: null, optional: true, hint: "Leave empty to waive all of it." }}
      confirmLabel="Waive"
      onSave={(rupees, reason) => {
        const [month, bucket] = (choice || options[0].key).split("|") as [string, "fee" | "lateFee"];
        return waive({ residentId, month, bucket, amountRupees: rupees, reason });
      }}
    />
  );
}

function StatementDialog({ residentId, month }: { residentId: Id<"residents">; month: string }) {
  const [open, setOpen] = useState(false);
  const d = useQuery(api.statements.residentDetail, open ? { residentId, month } : "skip");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost">View</Button>
      </DialogTrigger>
      <DialogContent title={formatMonth(month)} className="max-w-lg">
        {d === undefined ? <LoadingState rows={4} /> : <StatementDetail d={d} />}
      </DialogContent>
    </Dialog>
  );
}
