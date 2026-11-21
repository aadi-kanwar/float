"use client";

import { useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { LoadingState } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toaster";
import { useQuery } from "@/lib/convex";
import { friendlyError } from "@/lib/errors";
import { formatPaise } from "@/lib/format";

export default function PayPage() {
  const router = useRouter();
  const s = useQuery(api.money.mySummary, {});
  const claim = useMutation(api.repayments.claim);
  const [amount, setAmount] = useState<string | null>(null);
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  if (s === undefined) return <LoadingState rows={3} />;
  const left = Math.max(0, s.outstandingPaise - s.pendingClaimsPaise);
  const value = amount ?? (left > 0 ? String(Math.ceil(left / 100)) : "");
  return (
    <>
      <h1 className="font-serif text-3xl tracking-tight">I&apos;ve paid</h1>
      <p className="text-sm text-foreground-secondary">
        Pay the office by UPI first, then tell us here. It counts from now once the office confirms it. You owe {formatPaise(left)}
        {s.pendingClaimsPaise > 0 ? ` (plus ${formatPaise(s.pendingClaimsPaise)} waiting to be confirmed)` : ""}.
      </p>
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!/^\d+$/.test(value)) {
            toast.error("Enter whole rupees.");
            return;
          }
          setBusy(true);
          try {
            await claim({ amountRupees: Number(value), upiRef: ref || undefined });
            toast.success("Thanks! The office will confirm it.");
            router.replace("/me/activity");
          } catch (error) {
            toast.error(friendlyError(error));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field id="pay-amount" label="Amount paid (₹)">
          {(f) => <Input {...f} inputMode="numeric" value={value} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))} className="text-2xl" />}
        </Field>
        <Field id="pay-ref" label="UTR / reference (optional)" hint="The 12-digit UTR in your UPI app helps the office find it.">
          {(f) => <Input {...f} value={ref} onChange={(e) => setRef(e.target.value)} maxLength={60} />}
        </Field>
        <Button type="submit" className="min-h-14" loading={busy} disabled={left === 0}>
          Tell the office
        </Button>
      </form>
    </>
  );
}
