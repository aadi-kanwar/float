"use client";

import { useAction, useMutation } from "convex/react";
import { ArrowLeft, CirclePause, CirclePlay, KeyRound, Link2, Pencil } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { formatPhoneForDisplay } from "@convex/lib/inputRules";
import { AuditLog } from "@/components/admin/audit-log";
import { OneTimePassword } from "@/components/admin/one-time-password";
import { ReasonDialog } from "@/components/admin/reason-dialog";
import { PgSelect } from "@/components/admin/residents";
import { useMe } from "@/components/app/session";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingState } from "@/components/ui/skeleton";
import { DetailList, Stat } from "@/components/ui/stat";
import { StatusBadge } from "@/components/ui/status-badge";
import { toast } from "@/components/ui/toaster";
import { useQuery } from "@/lib/convex";
import { friendlyError } from "@/lib/errors";
import { formatDateTime, formatPaise } from "@/lib/format";

export default function ResidentPage() {
  const { residentId } = useParams<{ residentId: Id<"residents"> }>();
  const r = useQuery(api.residents.get, { residentId });
  const setDeposit = useMutation(api.residents.setDeposit);
  const setLimit = useMutation(api.residents.setLimit);
  const setPaused = useMutation(api.residents.setPaused);
  if (r === undefined) return <LoadingState rows={6} />;
  return (
    <>
      <Link href="/admin/residents" className="inline-flex items-center gap-1 self-start text-sm text-foreground-secondary hover:text-foreground">
        <Icon icon={ArrowLeft} className="size-4" />
        Residents
      </Link>
      <PageHeader
        title={r.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {[r.roomNumber ? `Room ${r.roomNumber}` : null, r.propertyName, formatPhoneForDisplay(r.phone)].filter(Boolean).join(" · ")}
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
        }
        actions={<EditDialog resident={r} />}
      />
      {r.disabled ? <Banner tone="warning" title="Switched off in the Livoza Hub">They can&apos;t sign in. Their history and anything they owe stay here.</Banner> : null}
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Credit limit" value={formatPaise(r.limitPaise)} hint={r.ownLimit ? "Set for them" : "Default from Settings"} />
        <Stat label="Recorded deposit" value={formatPaise(r.depositPaise)} />
      </dl>
      <Card>
        <CardBody className="flex flex-wrap gap-2">
          <ReasonDialog
            trigger={<Button variant="secondary">Change limit</Button>}
            title="Change credit limit"
            description="Leave the amount empty to go back to the default limit from Settings."
            amount={{ label: "Limit (₹)", initial: r.ownLimit ? r.limitPaise / 100 : null, optional: true }}
            onSave={(rupees, reason) => setLimit({ residentId, limitRupees: rupees, reason })}
          />
          <ReasonDialog
            trigger={<Button variant="secondary">Change deposit</Button>}
            title="Change recorded deposit"
            description="The security deposit they paid. Settling dues from it is done separately and keeps its own record."
            amount={{ label: "Deposit (₹)", initial: r.depositPaise / 100 }}
            onSave={(rupees, reason) => setDeposit({ residentId, depositRupees: rupees ?? 0, reason })}
          />
          <ReasonDialog
            trigger={
              <Button variant="secondary">
                <Icon icon={r.paused ? CirclePlay : CirclePause} />
                {r.paused ? "Resume" : "Pause"}
              </Button>
            }
            title={r.paused ? `Resume ${r.name}?` : `Pause ${r.name}?`}
            description={
              r.paused
                ? "They can draw money and redeem perks again."
                : "They can't draw money or redeem perks. They can still sign in, see everything and repay."
            }
            confirmLabel={r.paused ? "Resume" : "Pause"}
            onSave={(_, reason) => setPaused({ residentId, paused: !r.paused, reason })}
          />
          {r.hasPassword ? <ResetPasswordDialog residentId={residentId} name={r.name} /> : null}
        </CardBody>
      </Card>
      <Card>
        <CardBody>
          <DetailList
            rows={[
              { label: "Signs in", value: r.fromHub ? "Through the Livoza Hub" : "With a Float password" },
              { label: "Added", value: formatDateTime(r.createdAt) },
            ]}
          />
        </CardBody>
      </Card>
      <section aria-labelledby="history" className="flex flex-col gap-2">
        <h2 id="history" className="font-serif text-2xl tracking-tight">
          Changes
        </h2>
        <AuditLog residentId={residentId} />
      </section>
    </>
  );
}

type Resident = NonNullable<ReturnType<typeof useQuery<typeof api.residents.get>>>;

function EditDialog({ resident }: { resident: Resident }) {
  const update = useMutation(api.residents.update);
  const pgs = useQuery(api.properties.list, {});
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [room, setRoom] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setName(resident.name);
          setRoom(resident.roomNumber ?? "");
          setPropertyId(resident.propertyId ?? "");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary">
          <Icon icon={Pencil} />
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent
        title={`Edit ${resident.name}`}
        description={resident.fromHub ? "Name and room come from the Livoza Hub; its next update replaces them." : undefined}
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await update({
                residentId: resident.residentId,
                name,
                roomNumber: room || undefined,
                propertyId: (propertyId || undefined) as Id<"properties"> | undefined,
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
          <Field id="e-name" label="Full name">
            {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} required />}
          </Field>
          <Field id="e-room" label="Room / bed">
            {(p) => <Input {...p} value={room} onChange={(e) => setRoom(e.target.value)} maxLength={20} />}
          </Field>
          {pgs && pgs.length > 0 ? <PgSelect pgs={pgs} value={propertyId} onChange={setPropertyId} /> : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" type="button">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" loading={busy}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({ residentId, name }: { residentId: Id<"residents">; name: string }) {
  const reset = useAction(api.residents.resetPassword);
  const me = useMe();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState<string | null>(null);
  if (me?.role !== "admin") return null;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setPassword(null);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary">
          <Icon icon={KeyRound} />
          Reset password
        </Button>
      </DialogTrigger>
      <DialogContent
        title={password ? `New password for ${name}` : `Reset ${name}'s password?`}
        description={
          password
            ? "Give them this temporary password in person. It's shown only once."
            : "They're signed out everywhere and get a temporary password, which they must change when they sign in."
        }
      >
        {password ? (
          <OneTimePassword password={password} />
        ) : (
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  setPassword((await reset({ residentId })).temporaryPassword);
                } catch (error) {
                  toast.error(friendlyError(error));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Reset password
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
