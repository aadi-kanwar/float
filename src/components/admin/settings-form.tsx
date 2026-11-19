"use client";

import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { SettingsValues } from "@convex/lib/validators";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { LoadingState } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toaster";
import { useQuery } from "@/lib/convex";
import { friendlyError } from "@/lib/errors";

/** The form keeps text; it's turned into paise / basis points on save. */
type Form = {
  defaultLimit: string;
  limitCappedByDeposit: boolean;
  minDraw: string;
  feePercent: string;
  dueDayOfMonth: string;
  lateFeePerDay: string;
  lateFeeCap: string;
  requireDrawApproval: boolean;
  freezeWhenOverdue: boolean;
  dueSoonDays: string;
  pointsName: string;
  pointsExpiryMonths: string;
  limitGrowthEnabled: boolean;
};

const rupees = (paise: number) => String(paise / 100);

function toForm(s: SettingsValues): Form {
  return {
    defaultLimit: rupees(s.defaultLimitPaise),
    limitCappedByDeposit: s.limitCappedByDeposit,
    minDraw: rupees(s.minDrawPaise),
    feePercent: String(s.feeBasisPoints / 100),
    dueDayOfMonth: String(s.dueDayOfMonth),
    lateFeePerDay: rupees(s.lateFeePerDayPaise),
    lateFeeCap: s.lateFeeCapPaise === null ? "" : rupees(s.lateFeeCapPaise),
    requireDrawApproval: s.requireDrawApproval,
    freezeWhenOverdue: s.freezeWhenOverdue,
    dueSoonDays: String(s.dueSoonDays),
    pointsName: s.pointsName,
    pointsExpiryMonths: String(s.pointsExpiryMonths),
    limitGrowthEnabled: s.limitGrowthEnabled === true,
  };
}

function wholeNumber(label: string, text: string): number {
  const t = text.trim().replace(/,/g, "");
  if (!/^\d+$/.test(t)) throw new Error(`${label}: enter a whole number.`);
  return Number(t);
}

function fromForm(f: Form): SettingsValues {
  const fee = f.feePercent.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(fee)) throw new Error("Fee: enter a percentage like 5 or 2.5.");
  return {
    defaultLimitPaise: wholeNumber("Default limit", f.defaultLimit) * 100,
    limitCappedByDeposit: f.limitCappedByDeposit,
    minDrawPaise: wholeNumber("Minimum draw", f.minDraw) * 100,
    feeBasisPoints: Math.round(Number(fee) * 100),
    dueDayOfMonth: wholeNumber("Deadline day", f.dueDayOfMonth),
    lateFeePerDayPaise: wholeNumber("Late fee", f.lateFeePerDay) * 100,
    lateFeeCapPaise: f.lateFeeCap.trim() === "" ? null : wholeNumber("Late fee cap", f.lateFeeCap) * 100,
    requireDrawApproval: f.requireDrawApproval,
    freezeWhenOverdue: f.freezeWhenOverdue,
    dueSoonDays: wholeNumber("Reminder", f.dueSoonDays),
    pointsName: f.pointsName,
    pointsExpiryMonths: wholeNumber("Points expiry", f.pointsExpiryMonths),
    limitGrowthEnabled: f.limitGrowthEnabled,
  };
}

function Toggle({ id, label, hint, checked, onChange }: { id: string; label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label htmlFor={id} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md border border-border px-3 py-2 has-checked:border-primary has-checked:bg-primary-subtle">
      <input id={id} type="checkbox" className="mt-0.5 size-5 shrink-0 accent-primary" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="flex flex-col">
        <span className="font-medium">{label}</span>
        <span className="text-sm text-foreground-secondary">{hint}</span>
      </span>
    </label>
  );
}

export function SettingsForm() {
  const data = useQuery(api.settings.get, {});
  const save = useMutation(api.settings.save);
  const [form, setForm] = useState<Form | null>(null);
  const [version, setVersion] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  // Load once, and again after someone else saves (a newer version).
  if (data && data.version !== version) {
    setForm(toForm(data.values));
    setVersion(data.version);
  }
  if (!form || version === null) return <LoadingState rows={6} />;
  const set = <K extends keyof Form>(key: K) => (value: Form[K]) => setForm({ ...form, [key]: value });
  const text = (key: keyof Form, label: string, hint?: string, inputMode: "numeric" | "decimal" | "text" = "numeric") => (
    <Field id={`s-${key}`} label={label} hint={hint}>
      {(p) => <Input {...p} inputMode={inputMode} value={form[key] as string} onChange={(e) => set(key)(e.target.value as never)} />}
    </Field>
  );
  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={async (e) => {
        e.preventDefault();
        let values: SettingsValues;
        try {
          values = fromForm(form);
        } catch (error) {
          toast.error((error as Error).message);
          return;
        }
        setBusy(true);
        try {
          const result = await save({ values, expectedVersion: version, reason: reason || undefined });
          setVersion(result.version);
          setReason("");
          toast.success("Settings saved. They apply from now on; past records don't change.");
        } catch (error) {
          toast.error(friendlyError(error));
        } finally {
          setBusy(false);
        }
      }}
    >
      <section aria-labelledby="s-money" className="flex flex-col gap-2">
        <h2 id="s-money" className="font-serif text-2xl tracking-tight">
          Money
        </h2>
        <Card>
          <CardBody className="grid gap-4 sm:grid-cols-2">
            {text("defaultLimit", "Default credit limit (₹)", "For residents without their own limit.")}
            {text("minDraw", "Minimum draw (₹)")}
            {text("feePercent", "Fee on each draw (%)", "Rounded to the nearest rupee. Never charged on late fees.", "decimal")}
            {text("dueDayOfMonth", "Repay by day of next month", "Statements are made on the last day of each month, 23:59.")}
            {text("lateFeePerDay", "Late fee per day (₹)")}
            {text("lateFeeCap", "Late fee cap per statement (₹)", "Leave empty for no cap.")}
            {text("dueSoonDays", "\"Due soon\" reminder (days before)")}
            <div className="flex flex-col gap-2 sm:col-span-2">
              <Toggle id="s-cap" label="Limit can't be more than the deposit" hint="Money drawn can never be more than the deposit left (fees don't count)." checked={form.limitCappedByDeposit} onChange={set("limitCappedByDeposit")} />
              <Toggle id="s-approve" label="Draws need my approval" hint="Off: draws are approved at once (you still send the money and mark it sent)." checked={form.requireDrawApproval} onChange={set("requireDrawApproval")} />
              <Toggle id="s-freeze" label="No new draws while anything is overdue" hint="" checked={form.freezeWhenOverdue} onChange={set("freezeWhenOverdue")} />
            </div>
          </CardBody>
        </Card>
      </section>
      <section aria-labelledby="s-points" className="flex flex-col gap-2">
        <h2 id="s-points" className="font-serif text-2xl tracking-tight">
          Rewards
        </h2>
        <Card>
          <CardBody className="grid gap-4 sm:grid-cols-2">
            {text("pointsName", "Name of the points", "Shown to residents everywhere, e.g. \"Points\" or \"Coins\".", "text")}
            {text("pointsExpiryMonths", `${form.pointsName || "Points"} expire after (months)`, "0 = never.")}
            <div className="sm:col-span-2">
              <Toggle id="s-growth" label="Raise limits automatically" hint="Uses the limit growth rules on the rewards page." checked={form.limitGrowthEnabled} onChange={set("limitGrowthEnabled")} />
            </div>
          </CardBody>
        </Card>
      </section>
      <Card>
        <CardBody className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <Field id="s-reason" label="Note for the audit log (optional)" className="flex-1">
            {(p) => <Input {...p} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />}
          </Field>
          <Button type="submit" loading={busy}>
            Save settings
          </Button>
        </CardBody>
      </Card>
    </form>
  );
}
