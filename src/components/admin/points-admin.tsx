"use client";

import { useMutation, usePaginatedQuery } from "convex/react";
import { Pencil, Plus, Sparkles } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import { usePropertyScope } from "@/components/app/property-scope";
import type { Id } from "@convex/_generated/dataModel";
import { PointsHistory, POINTS_TYPE, StreakDots } from "@/components/points/points-bits";
import { useMe } from "@/components/app/session";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { LoadingState } from "@/components/ui/skeleton";
import { Stat } from "@/components/ui/stat";
import { EmptyState } from "@/components/ui/states";
import { toast } from "@/components/ui/toaster";
import { useQuery } from "@/lib/convex";
import { friendlyError } from "@/lib/errors";
import { formatPaise, formatWhen } from "@/lib/format";
import { cn } from "@/lib/utils";

/** How points work now (the rules are fixed; their value is a setting). */
export function PointsRules() {
  const me = useMe();
  const settings = useQuery(api.settings.get, {});
  const name = me?.pointsName ?? "";
  if (settings === undefined) return <LoadingState rows={2} />;
  const pct = (settings.values.pointValueBasisPoints ?? 100) / 100;
  return (
    <Card>
      <CardBody className="flex flex-col gap-2 text-sm">
        <p>
          <strong>Residents get as many {name} as rupees of drawn money they repay</strong> (₹1,000 repaid = 1,000 {name}). Fees and late fees never earn {name}.
        </p>
        <p>They arrive as soon as you confirm the payment, any day of the month. If you reverse a payment, its {name} come off again.</p>
        <p>
          Their value: <strong>{pct.toLocaleString("en-IN")}%</strong>, so 1,000 {name} = ₹{(pct * 10).toLocaleString("en-IN", { maximumFractionDigits: 2 })}. Change this in{" "}
          <Link href="/admin/settings" className="underline">Settings → Rewards</Link>.
        </p>
      </CardBody>
    </Card>
  );
}

/** Give (+) or take (−) points from one resident, with a reason. */
export function AdjustDialog({ residentId, residentName }: { residentId?: Id<"residents">; residentName?: string }) {
  const me = useMe();
  const { arg } = usePropertyScope();
  const residents = useQuery(api.residents.list, residentId ? "skip" : arg);
  const adjust = useMutation(api.points.adjust);
  const [open, setOpen] = useState(false);
  const [who, setWho] = useState("");
  const [mode, setMode] = useState<"give" | "take">("give");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const name = me?.pointsName ?? "";
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) { setWho(""); setAmount(""); setReason(""); setMode("give"); } }}>
      <DialogTrigger asChild>
        <Button variant="secondary">
          <Icon icon={Sparkles} />
          Give or take {name}
        </Button>
      </DialogTrigger>
      <DialogContent title={`Give or take ${name}${residentName ? ` · ${residentName}` : ""}`} description="Saved in the points ledger and the audit log; the resident is told.">
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const target = residentId ?? (who as Id<"residents">);
            if (!target) {
              toast.error("Choose a resident.");
              return;
            }
            if (!/^\d+$/.test(amount)) {
              toast.error("Enter a whole number.");
              return;
            }
            setBusy(true);
            try {
              await adjust({ residentId: target, points: (mode === "give" ? 1 : -1) * Number(amount), reason });
              toast.success("Saved.");
              setOpen(false);
            } catch (error) {
              toast.error(friendlyError(error));
            } finally {
              setBusy(false);
            }
          }}
        >
          {residentId ? null : (
            <Field id="adj-who" label="Resident">
              {(p) => (
                <NativeSelect {...p} value={who} onChange={(e) => setWho(e.target.value)} required>
                  <option value="">Choose…</option>
                  {(residents ?? []).map((r) => (
                    <option key={r.residentId} value={r.residentId}>
                      {r.name}{r.roomNumber ? ` · ${r.roomNumber}` : ""}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field id="adj-mode" label="Give or take">
              {(p) => (
                <NativeSelect {...p} value={mode} onChange={(e) => setMode(e.target.value as "give" | "take")}>
                  <option value="give">Give</option>
                  <option value="take">Take</option>
                </NativeSelect>
              )}
            </Field>
            <Field id="adj-amount" label={name}>
              {(p) => <Input {...p} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))} required />}
            </Field>
          </div>
          <Field id="adj-reason" label="Reason" hint="The resident sees this.">
            {(p) => <Input {...p} value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} maxLength={300} />}
          </Field>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" type="button">Cancel</Button>
            </DialogClose>
            <Button type="submit" loading={busy}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Every points change for everyone, newest first. */
export function PointsLedger() {
  const me = useMe();
  const { arg } = usePropertyScope();
  const { results, status, loadMore } = usePaginatedQuery(api.points.ledger, arg, { initialNumItems: 50 });
  if (status === "LoadingFirstPage") return <LoadingState rows={5} />;
  if (results.length === 0) return <EmptyState title="Nothing yet" />;
  return (
    <div className="flex flex-col gap-3">
      <Card>
        <ul className="divide-y divide-border">
          {results.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
              <span className="flex min-w-0 flex-col">
                <span className="font-medium">
                  <Link href={`/admin/residents/${r.residentId}`} className="hover:underline">{r.residentName}</Link>
                  <span className="font-normal text-foreground-secondary"> · {POINTS_TYPE[r.type]}</span>
                </span>
                <span className="truncate text-foreground-secondary">{formatWhen(r.createdAt)}{r.reason ? ` · ${r.reason}` : ""}</span>
              </span>
              <span className={cn("tabular font-semibold", r.points > 0 ? "text-success" : "text-foreground-secondary")}>
                {r.points > 0 ? "+" : "−"}{Math.abs(r.points)} {me?.pointsName}
              </span>
            </li>
          ))}
        </ul>
      </Card>
      {status === "CanLoadMore" ? (
        <Button variant="secondary" className="self-center" onClick={() => loadMore(50)}>Show older</Button>
      ) : null}
    </div>
  );
}

/** Limit growth rules (used only when Settings → limit growth is on). */
export function LimitRules() {
  const data = useQuery(api.points.limitRules, {});
  const save = useMutation(api.points.saveLimitRule);
  if (data === undefined) return <LoadingState rows={2} />;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-foreground-secondary">
        Limit growth is <strong>{data.enabled ? "on" : "off"}</strong> (Settings → Rewards). Each time a resident&apos;s on-time streak reaches a multiple of a rule&apos;s number, their limit goes up by its amount, never past its maximum. You can always set a limit by hand on the resident&apos;s page.
      </p>
      {data.rules.length > 0 ? (
        <Card>
          <ul className="divide-y divide-border">
            {data.rules.map((r) => (
              <li key={r.ruleId} className={cn("flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm", !r.enabled && "opacity-60")}>
                <span>
                  After <strong>{r.streakLength}</strong> on time in a row: +{formatPaise(r.raisePaise)}, up to {formatPaise(r.maxPaise)}
                  {r.enabled ? "" : " (off)"}
                </span>
                <span className="flex items-center gap-1">
                  <LimitRuleDialog rule={r} />
                  <label className="flex min-h-11 cursor-pointer items-center gap-2 px-2">
                    <input
                      type="checkbox"
                      className="size-5 accent-primary"
                      checked={r.enabled}
                      onChange={(e) =>
                        save({ ruleId: r.ruleId, streakLength: r.streakLength, raiseRupees: r.raisePaise / 100, maxRupees: r.maxPaise / 100, enabled: e.target.checked }).catch((error) => toast.error(friendlyError(error)))
                      }
                    />
                    On
                  </label>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <LimitRuleDialog />
    </div>
  );
}

function LimitRuleDialog({ rule }: { rule?: { ruleId: Id<"limitRules">; streakLength: number; raisePaise: number; maxPaise: number; enabled: boolean } }) {
  const save = useMutation(api.points.saveLimitRule);
  const [open, setOpen] = useState(false);
  const [n, setN] = useState("");
  const [raise, setRaise] = useState("");
  const [max, setMax] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) { setN(String(rule?.streakLength ?? 3)); setRaise(String((rule?.raisePaise ?? 50_000) / 100)); setMax(String((rule?.maxPaise ?? 1_000_000) / 100)); } }}>
      <DialogTrigger asChild>
        {rule ? (
          <Button variant="ghost" size="icon" aria-label="Edit rule"><Icon icon={Pencil} /></Button>
        ) : (
          <Button variant="secondary" className="self-start"><Icon icon={Plus} />Add a limit rule</Button>
        )}
      </DialogTrigger>
      <DialogContent title={rule ? "Edit limit rule" : "Add a limit rule"}>
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await save({ ruleId: rule?.ruleId, streakLength: Number(n), raiseRupees: Number(raise), maxRupees: Number(max), enabled: rule?.enabled ?? true });
              toast.success("Saved.");
              setOpen(false);
            } catch (error) {
              toast.error(friendlyError(error));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field id="lr-n" label="On time in a row">
            {(p) => <Input {...p} inputMode="numeric" value={n} onChange={(e) => setN(e.target.value)} required />}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field id="lr-raise" label="Raise by (₹)">
              {(p) => <Input {...p} inputMode="numeric" value={raise} onChange={(e) => setRaise(e.target.value)} required />}
            </Field>
            <Field id="lr-max" label="Up to (₹)">
              {(p) => <Input {...p} inputMode="numeric" value={max} onChange={(e) => setMax(e.target.value)} required />}
            </Field>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="ghost" type="button">Cancel</Button></DialogClose>
            <Button type="submit" loading={busy}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** On a resident's admin page: their points, streak and history. */
export function ResidentPoints({ residentId, residentName }: { residentId: Id<"residents">; residentName: string }) {
  const p = useQuery(api.points.residentPoints, { residentId });
  if (p === undefined) return <LoadingState rows={3} />;
  return (
    <div className="flex flex-col gap-3">
      <dl className="grid grid-cols-2 gap-3">
        <Stat label={`${p.pointsName} balance`} value={p.balance.toLocaleString("en-IN")} hint={`Worth ${formatPaise(p.balanceValuePaise)}`} emphasis />
        <Stat label="On time in a row" value={p.streak} />
      </dl>
      <Card>
        <CardBody className="flex flex-col gap-3">
          <StreakDots recent={p.recent} name={p.pointsName} />
          <AdjustDialog residentId={residentId} residentName={residentName} />
        </CardBody>
      </Card>
      {p.history.length > 0 ? (
        <Card>
          <PointsHistory rows={p.history.slice(0, 20)} name={p.pointsName} />
        </Card>
      ) : null}
    </div>
  );
}
