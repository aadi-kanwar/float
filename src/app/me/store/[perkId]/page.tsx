"use client";

import { useMutation } from "convex/react";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import { PerkArt } from "@/components/perks/perk-card";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { LoadingState } from "@/components/ui/skeleton";
import { DetailList } from "@/components/ui/stat";
import { EmptyState } from "@/components/ui/states";
import { toast } from "@/components/ui/toaster";
import { useQuery } from "@/lib/convex";
import { friendlyError } from "@/lib/errors";
import { formatDate } from "@/lib/format";

const LIMIT_TEXT = { per_month: "a month", per_semester: "a semester", total: "in total" } as const;

export default function PerkPage() {
  const { perkId } = useParams<{ perkId: string }>();
  const router = useRouter();
  const s = useQuery(api.perks.store, {});
  const redeem = useMutation(api.redemptions.redeem);
  const [step, setStep] = useState<"closed" | "confirm">("closed");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  if (s === undefined) return <LoadingState rows={6} />;
  const p = s.perks.find((x) => x.perkId === perkId);
  if (!p) return <EmptyState title="This perk isn't available" action={<Button asChild variant="secondary"><Link href="/me/store">Back to the store</Link></Button>} />;
  const out = p.stockLeft === 0;
  const blocked = s.paused || out || p.limitReached || !p.affordable;
  const after = s.balance - p.costPoints;
  return (
    <>
      <Link href="/me/store" className="inline-flex items-center gap-1 self-start text-sm text-foreground-secondary hover:text-foreground">
        <Icon icon={ArrowLeft} className="size-4" />
        Perk Store
      </Link>
      <Card className="overflow-hidden">
        <PerkArt perk={p} className="aspect-[16/9]" />
        <CardBody className="flex flex-col gap-3">
          <h1 className="font-serif text-3xl tracking-tight">{p.title}</h1>
          <p className="text-foreground-secondary">{p.summary}</p>
          {p.details ? <p className="text-sm whitespace-pre-wrap">{p.details}</p> : null}
          <DetailList
            rows={[
              { label: "Cost", value: `${p.costPoints.toLocaleString("en-IN")} ${s.pointsName}`, strong: true },
              ...(p.stockLeft !== null ? [{ label: "Left", value: String(p.stockLeft) }] : []),
              ...(p.perResident.kind !== "unlimited" ? [{ label: "You can redeem", value: `${p.perResident.count}× ${LIMIT_TEXT[p.perResident.kind]} (used ${p.usedInPeriod})` }] : []),
              ...(p.availableTo ? [{ label: "Available until", value: formatDate(p.availableTo) }] : []),
            ]}
          />
        </CardBody>
      </Card>
      {out ? <Banner tone="warning" title="Out of stock" /> : p.limitReached ? <Banner tone="info" title="You've used this perk as often as allowed for now" /> : !p.affordable ? <Banner tone="info" title={`You need ${p.costPoints - s.balance} more ${s.pointsName}`}>Repay on time to earn more.</Banner> : null}
      <Button className="min-h-14" disabled={blocked} onClick={() => { setAnswers({}); setStep("confirm"); }}>
        Redeem for {p.costPoints.toLocaleString("en-IN")} {s.pointsName}
      </Button>
      <Dialog open={step === "confirm"} onOpenChange={(o) => setStep(o ? "confirm" : "closed")}>
        <DialogContent title={`Redeem ${p.title}?`} description={`${p.costPoints} ${s.pointsName} come off now (you'll have ${after}). If the office can't do it, you get them back.`}>
          <form
            className="flex flex-col gap-4"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await redeem({ perkId: p.perkId, answers: p.fields.map((f) => ({ key: f.key, value: answers[f.key] ?? "" })) });
                toast.success(p.fulfilmentNote ?? "Redeemed! The office will take it from here.");
                router.replace("/me/redemptions");
              } catch (error) {
                toast.error(friendlyError(error));
              } finally {
                setBusy(false);
              }
            }}
          >
            {p.fields.map((f) => (
              <Field key={f.key} id={`ans-${f.key}`} label={`${f.label}${f.required ? "" : " (optional)"}`}>
                {(props) =>
                  f.type === "select" ? (
                    <NativeSelect {...props} value={answers[f.key] ?? ""} required={f.required} onChange={(e) => setAnswers({ ...answers, [f.key]: e.target.value })}>
                      <option value="">Choose…</option>
                      {(f.options ?? []).map((o) => (
                        <option key={o} value={o}>{o}</option>
                      ))}
                    </NativeSelect>
                  ) : (
                    <Input
                      {...props}
                      type={f.type === "date" ? "date" : "text"}
                      inputMode={f.type === "number" ? "decimal" : undefined}
                      value={answers[f.key] ?? ""}
                      required={f.required}
                      maxLength={200}
                      onChange={(e) => setAnswers({ ...answers, [f.key]: e.target.value })}
                    />
                  )
                }
              </Field>
            ))}
            {p.fulfilmentNote ? <p className="rounded-sm bg-subtle px-3 py-2 text-sm">After redeeming: {p.fulfilmentNote}</p> : null}
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="ghost" type="button">Cancel</Button>
              </DialogClose>
              <Button type="submit" loading={busy}>Confirm</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
