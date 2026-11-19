"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { friendlyError } from "@/lib/errors";

/**
 * An admin override: optionally an amount in whole rupees, always a reason
 * (it goes in the audit log). `onSave` gets the amount (null when cleared or
 * not asked) and the reason.
 */
export function ReasonDialog({
  trigger,
  title,
  description,
  amount,
  confirmLabel = "Save",
  onSave,
}: {
  trigger: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  amount?: { label: string; initial: number | null; hint?: string; optional?: boolean };
  confirmLabel?: string;
  onSave: (amountRupees: number | null, reason: string) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setValue(amount?.initial == null ? "" : String(amount.initial));
          setReason("");
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title={title} description={description}>
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            let rupees: number | null = null;
            if (amount) {
              const text = value.trim().replace(/,/g, "");
              if (text === "" && amount.optional) rupees = null;
              else if (!/^\d+$/.test(text)) {
                toast.error("Enter whole rupees.");
                return;
              } else rupees = Number(text);
            }
            setBusy(true);
            try {
              await onSave(rupees, reason);
              toast.success("Saved.");
              setOpen(false);
            } catch (error) {
              toast.error(friendlyError(error));
            } finally {
              setBusy(false);
            }
          }}
        >
          {amount ? (
            <Field id="override-amount" label={amount.label} hint={amount.hint}>
              {(p) => (
                <Input
                  {...p}
                  inputMode="numeric"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  required={!amount.optional}
                />
              )}
            </Field>
          ) : null}
          <Field id="override-reason" label="Reason" hint="Saved in the audit log.">
            {(p) => <Input {...p} value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} maxLength={300} />}
          </Field>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" type="button">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" loading={busy}>
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
