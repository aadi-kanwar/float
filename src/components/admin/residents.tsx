"use client";

import { useAction } from "convex/react";
import { ChevronRight, CirclePause, Link2, UserPlus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { formatPhoneForDisplay, temporaryPassword as suggestPassword } from "@convex/lib/inputRules";
import { usePropertyScope, useShowProperty } from "@/components/app/property-scope";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { FilterBar, SearchInput } from "@/components/ui/filter-bar";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { LoadingState } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import { toast } from "@/components/ui/toaster";
import { useQuery } from "@/lib/convex";
import { friendlyError } from "@/lib/errors";
import { formatPaise } from "@/lib/format";
import { OneTimePassword } from "./one-time-password";

type Pg = { propertyId: Id<"properties">; name: string };

export function ResidentsList() {
  const [search, setSearch] = useState("");
  const [show, setShow] = useState<"all" | "paused" | "left">("all");
  const { arg } = usePropertyScope();
  const showProperty = useShowProperty();
  const residents = useQuery(api.residents.list, {
    search: search || undefined,
    ...arg,
    status: show === "left" ? "left" : "active",
    paused: show === "paused" ? true : undefined,
  });
  return (
    <div className="flex flex-col gap-4">
      <FilterBar>
        <SearchInput label="Search residents" placeholder="Name, room or number" value={search} onChange={(e) => setSearch(e.target.value)} />
        <NativeSelect aria-label="Show" value={show} onChange={(e) => setShow(e.target.value as typeof show)} className="sm:w-44">
          <option value="all">Current residents</option>
          <option value="paused">Paused only</option>
          <option value="left">Left</option>
        </NativeSelect>
      </FilterBar>
      {residents === undefined ? (
        <LoadingState rows={5} />
      ) : residents.length === 0 ? (
        <EmptyState
          title={search ? "No one matches" : "No residents yet"}
          description={search ? "Try another name, room or number." : "Residents arrive from the Livoza Hub, or add one here."}
        />
      ) : (
        <Card>
          <ul className="divide-y divide-border" aria-label="Residents">
            {residents.map((r) => (
              <li key={r.residentId}>
                <Link
                  href={`/admin/residents/${r.residentId}`}
                  className="flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-subtle focus-visible:bg-subtle"
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-medium">{r.name}</span>
                      {r.paused ? (
                        <StatusBadge tone="warning" icon={CirclePause}>
                          Paused
                        </StatusBadge>
                      ) : null}
                      {r.fromHub ? (
                        <StatusBadge tone="info" icon={Link2}>
                          Livoza Hub
                        </StatusBadge>
                      ) : null}
                    </span>
                    <span className="truncate text-sm text-foreground-secondary">
                      {[r.roomNumber ? `Room ${r.roomNumber}` : null, showProperty ? (r.propertyName ?? "No property") : null, formatPhoneForDisplay(r.phone)]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  <span className="hidden flex-col items-end text-sm sm:flex">
                    <span className="tabular">Limit {formatPaise(r.limitPaise)}</span>
                    <span className="tabular text-foreground-secondary">Deposit {formatPaise(r.depositPaise)}</span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-foreground-muted" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

/** Add a resident with a temporary password (Float's own login). */
export function AddResidentDialog() {
  const create = useAction(api.residents.create);
  const pgs = useQuery(api.properties.list, {});
  const { current } = usePropertyScope();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [room, setRoom] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [deposit, setDeposit] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setName("");
          setPhone("");
          setRoom("");
          setPropertyId(current?.propertyId ?? (pgs?.length === 1 ? pgs[0].propertyId : ""));
          setDeposit("");
          setPassword(suggestPassword());
          setCreated(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Icon icon={UserPlus} />
          Add resident
        </Button>
      </DialogTrigger>
      <DialogContent
        title={created ? `${name.trim()} can now sign in` : "Add a resident"}
        description={
          created
            ? "Give them this temporary password in person. They sign in with their mobile number and this password, then choose their own."
            : "Residents who use the Livoza Hub are added automatically. Use this only for someone who isn't on the hub."
        }
      >
        {created ? (
          <OneTimePassword password={created} />
        ) : (
          <form
            className="flex flex-col gap-4"
            onSubmit={async (e) => {
              e.preventDefault();
              const rupees = deposit.trim().replace(/,/g, "");
              if (!/^\d+$/.test(rupees)) {
                toast.error("Enter the deposit in whole rupees.");
                return;
              }
              setBusy(true);
              try {
                await create({
                  name,
                  phone,
                  roomNumber: room || undefined,
                  propertyId: (propertyId || undefined) as Id<"properties"> | undefined,
                  depositRupees: Number(rupees),
                  temporaryPassword: password,
                });
                setCreated(password);
              } catch (error) {
                toast.error(friendlyError(error));
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field id="r-name" label="Full name">
              {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" required />}
            </Field>
            <Field id="r-phone" label="Mobile number" hint="Their login. India (+91) unless you type another code.">
              {(p) => (
                <Input {...p} type="tel" inputMode="tel" placeholder="98765 43210" value={phone} onChange={(e) => setPhone(e.target.value)} required />
              )}
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field id="r-room" label="Room / bed">
                {(p) => <Input {...p} value={room} onChange={(e) => setRoom(e.target.value)} maxLength={20} />}
              </Field>
              <Field id="r-deposit" label="Deposit (₹)">
                {(p) => <Input {...p} inputMode="numeric" value={deposit} onChange={(e) => setDeposit(e.target.value)} required />}
              </Field>
            </div>
            {pgs && pgs.length > 0 ? <PgSelect pgs={pgs} value={propertyId} onChange={setPropertyId} /> : null}
            <Field id="r-password" label="Temporary password" hint="At least 8 characters. They must change it when they first sign in.">
              {(p) => <Input {...p} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" required />}
            </Field>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="ghost" type="button">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" loading={busy}>
                Add resident
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function PgSelect({ pgs, value, onChange }: { pgs: Pg[]; value: string; onChange: (v: string) => void }) {
  return (
    <Field id="r-pg" label="Property">
      {(p) => (
        <NativeSelect {...p} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Choose…</option>
          {pgs.map((pg) => (
            <option key={pg.propertyId} value={pg.propertyId}>
              {pg.name}
            </option>
          ))}
        </NativeSelect>
      )}
    </Field>
  );
}
