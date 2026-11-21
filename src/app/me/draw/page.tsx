"use client";

import { useMutation } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { LoadingState } from "@/components/ui/skeleton";
import { DetailList } from "@/components/ui/stat";
import { toast } from "@/components/ui/toaster";
import { useQuery } from "@/lib/convex";
import { friendlyError } from "@/lib/errors";
import { formatPaise } from "@/lib/format";
import { drawFeePaise } from "@convex/lib/money";

export default function DrawPage() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const rupees = /^\d+$/.test(text.trim()) ? Number(text.trim()) : undefined;
  // Asked once (no amount): typing doesn't go to the server, so nothing flickers.
  // The fee is worked out here with the same rule the server uses.
  const base = useQuery(api.draws.preview, {});
  const request = useMutation(api.draws.request);
  if (base === undefined) return <LoadingState rows={4} />;
  const amountPaise = rupees !== undefined && rupees > 0 ? rupees * 100 : 0;
  const feePaise = drawFeePaise(amountPaise, base.feeBasisPoints);
  const p = { ...base, amountPaise, feePaise, totalPaise: amountPaise + feePaise };
  const tooMuch = p.totalPaise > 0 && p.amountPaise > p.availablePaise;
  const tooLittle = p.amountPaise > 0 && p.amountPaise < p.minDrawPaise;
  const blocked = p.paused || p.frozen || !p.termsAccepted;
  return (
    <>
      <h1 className="font-serif text-3xl tracking-tight">Draw money</h1>
      {p.paused ? <Banner tone="warning" title="Your account is paused">Please talk to the office.</Banner> : null}
      {p.frozen ? <Banner tone="danger" title="Something is overdue">Please pay what&apos;s overdue first.</Banner> : null}
      {!p.termsAccepted ? (
        <Banner tone="info" title="Please accept the terms first" action={<Button asChild><Link href="/me/terms">Read terms</Link></Button>}>
          You only need to do this once (and again if they change).
        </Banner>
      ) : null}
      {!p.payoutSet ? (
        <Banner tone="info" title="Where should we send it?" action={<Button asChild><Link href="/me/account">Add UPI</Link></Button>}>
          Add your UPI ID or QR in Account so the office can pay you.
        </Banner>
      ) : null}
      <p className="text-sm text-foreground-secondary">You can draw up to {formatPaise(p.availablePaise)} now.</p>
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (rupees === undefined) return;
          setBusy(true);
          try {
            await request({ amountRupees: rupees });
            toast.success(p.needsApproval ? "Asked. The office will approve it and send the money." : "Approved. The office will send the money.");
            router.replace("/me/activity");
          } catch (error) {
            toast.error(friendlyError(error));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field id="amount" label="Amount (₹)" error={tooMuch ? "That's more than you can draw." : tooLittle ? `The smallest draw is ${formatPaise(p.minDrawPaise)}.` : undefined}>
          {(f) => <Input {...f} inputMode="numeric" autoFocus placeholder="1000" value={text} onChange={(e) => setText(e.target.value.replace(/[^\d]/g, ""))} className="text-2xl" />}
        </Field>
        <Card>
          <CardBody>
            <DetailList
              rows={[
                { label: "You get", value: formatPaise(p.amountPaise) },
                { label: `Fee (${p.feeBasisPoints / 100}%, rounded to the rupee)`, value: formatPaise(p.feePaise) },
                { label: `To pay by the ${p.dueDay}th of next month`, value: formatPaise(p.totalPaise), strong: true },
              ]}
            />
          </CardBody>
        </Card>
        <Button type="submit" className="min-h-14" loading={busy} disabled={blocked || rupees === undefined || tooMuch || tooLittle}>
          {p.needsApproval ? "Ask for this draw" : "Draw now"}
        </Button>
        <p className="text-xs text-foreground-secondary">The office sends the money by UPI. Everything drawn this month is on one statement, due the {p.dueDay}th of next month.</p>
      </form>
    </>
  );
}
