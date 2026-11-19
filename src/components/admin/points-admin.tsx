"use client";

import { useMutation, usePaginatedQuery } from "convex/react";
import { ArrowDown, ArrowUp, Pencil, Plus, Sparkles } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import { usePropertyScope } from "@/components/app/property-scope";
import type { Id } from "@convex/_generated/dataModel";
import { describeRule, PointsHistory, POINTS_TYPE, StreakDots } from "@/components/points/points-bits";
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

const KIND_LABEL = { base: "Base", early: "Early bonus", streak: "Streak bonus" } as const;
type Kind = keyof typeof KIND_LABEL;

/** Earn rules: edit, switch off, reorder, add. */
export function RulesEditor() {
  const me = useMe();
  const rules = useQuery(api.points.rules, {});
  const setEnabled = useMutation(api.points.setRuleEnabled);
  const move = useMutation(api.points.moveRule);
  const name = me?.pointsName ?? "";
  if (rules === undefined) return <LoadingState rows={4} />;
  const run = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (error) {
      toast.error(friendlyError(error));
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-foreground-secondary">
        {name} are earned only on the amount drawn and repaid (never fees or late fees), for a statement paid in full by its deadline. Multipliers multiply together; the highest streak reached applies. Changes apply to statements paid from now on.
      </p>
      <Card>
        <ul className="divide-y divide-border">
          {rules.map((r, i) => (
            <li key={r.ruleId ?? i} className={cn("flex flex-wrap items-center gap-3 px-4 py-3", !r.enabled && "opacity-60")}>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-medium">{KIND_LABEL[r.type]}{r.enabled ? "" : " (off)"}</span>
                <span className="text-sm text-foreground-secondary">{describeRule(r, name)}</span>
              </span>
              <span className="flex items-center gap-1">
                <Button variant="ghost" size="icon" aria-label="Move up" disabled={i === 0} onClick={() => run(move({ index: i, by: -1 }))}>
                  <Icon icon={ArrowUp} />
                </Button>
                <Button variant="ghost" size="icon" aria-label="Move down" disabled={i === rules.length - 1} onClick={() => run(move({ index: i, by: 1 }))}>
                  <Icon icon={ArrowDown} />
                </Button>
                <RuleDialog rule={r} index={i} />
                <label className="flex min-h-11 cursor-pointer items-center gap-2 px-2 text-sm">
                  <input type="checkbox" className="size-5 accent-primary" checked={r.enabled} onChange={(e) => run(setEnabled({ index: i, enabled: e.target.checked }))} />
                  On
                </label>
              </span>
            </li>
          ))}
        </ul>
      </Card>
      <RuleDialog />
    </div>
  );
}

type RuleRow = NonNullable<ReturnType<typeof useQuery<typeof api.points.rules>>>[number];

function RuleDialog({ rule, index }: { rule?: RuleRow; index?: number }) {
  const save = useMutation(api.points.saveRule);
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<Kind>("streak");
  const [per100, setPer100] = useState("");
  const [pct, setPct] = useState("");
  const [streak, setStreak] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setType(rule?.type ?? "streak");
          setPer100(String(rule?.pointsPer100 ?? ""));
          setPct(rule?.multiplierPct ? String(rule.multiplierPct / 100) : "");
          setStreak(String(rule?.streakLength ?? ""));
        }
      }}
    >
      <DialogTrigger asChild>
        {rule ? (
          <Button variant="ghost" size="icon" aria-label="Edit rule">
            <Icon icon={Pencil} />
          </Button>
        ) : (
          <Button variant="secondary" className="self-start">
            <Icon icon={Plus} />
            Add a rule
          </Button>
        )}
      </DialogTrigger>
      <DialogContent title={rule ? `Edit ${KIND_LABEL[rule.type].toLowerCase()}` : "Add a rule"}>
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await save({
                index,
                type,
                pointsPer100: type === "base" ? Number(per100) : undefined,
                multiplierPct: type !== "base" ? Math.round(Number(pct) * 100) : undefined,
                streakLength: type === "streak" ? Number(streak) : undefined,
              });
              toast.success("Saved.");
              setOpen(false);
            } catch (error) {
              toast.error(friendlyError(error));
            } finally {
              setBusy(false);
            }
          }}
        >
          {rule ? null : (
            <Field id="rule-type" label="Kind">
              {(p) => (
                <NativeSelect {...p} value={type} onChange={(e) => setType(e.target.value as Kind)}>
                  <option value="base">Base: points per ₹100 repaid</option>
                  <option value="early">Early bonus: multiplier</option>
                  <option value="streak">Streak bonus: multiplier after N in a row</option>
                </NativeSelect>
              )}
            </Field>
          )}
          {type === "base" ? (
            <Field id="rule-per100" label="Points per ₹100">
              {(p) => <Input {...p} inputMode="numeric" value={per100} onChange={(e) => setPer100(e.target.value)} required />}
            </Field>
          ) : (
            <Field id="rule-pct" label="Multiplier (×)" hint="e.g. 2 or 1.25">
              {(p) => <Input {...p} inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} required />}
            </Field>
          )}
          {type === "streak" ? (
            <Field id="rule-streak" label="Statements in a row">
              {(p) => <Input {...p} inputMode="numeric" value={streak} onChange={(e) => setStreak(e.target.value)} required />}
            </Field>
          ) : null}
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
        <Stat label={`${p.pointsName} balance`} value={p.balance.toLocaleString("en-IN")} emphasis />
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
