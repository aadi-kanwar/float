"use client";

import { useMutation } from "convex/react";
import { Copy, ImagePlus, QrCode, Send, Smartphone } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { PaymentMode } from "@convex/lib/validators";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { toast } from "@/components/ui/toaster";
import { friendlyError } from "@/lib/errors";
import { formatPaise } from "@/lib/format";
import { cn } from "@/lib/utils";

export const PAYMENT_MODE_LABEL: Record<PaymentMode, string> = {
  upi: "UPI",
  cash: "Cash",
  bank_transfer: "Bank transfer",
  other: "Other",
};

/** A UPI payment link: opens any UPI app on a phone, with the amount filled in. */
export function upiLink(upiId: string, name: string, amountPaise?: number): string {
  const params = new URLSearchParams({ pa: upiId, pn: name, cu: "INR" });
  if (amountPaise) params.set("am", (amountPaise / 100).toFixed(2));
  params.set("tn", "Float");
  return `upi://pay?${params.toString()}`;
}

/** A QR code for the UPI link, drawn on this device (nothing is sent anywhere). */
function UpiQr({ value, className }: { value: string; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    QRCode.toDataURL(value, { margin: 1, width: 360, errorCorrectionLevel: "M" })
      .then((url) => live && setSrc(url))
      .catch(() => live && setSrc(null));
    return () => {
      live = false;
    };
  }, [value]);
  if (!src) return <div className={cn("aspect-square animate-pulse rounded-md bg-subtle", className)} />;
  // eslint-disable-next-line @next/next/no-img-element -- generated on this device
  return <img src={src} alt="UPI QR code" className={cn("aspect-square rounded-md bg-white p-2", className)} />;
}

/** Where to send the money: UPI ID (copy + open UPI app), a QR made from it, and/or the resident's own QR photo. */
export function PayeeDetails({ name, upiId, upiQrUrl, amountPaise }: { name: string; upiId: string | null; upiQrUrl: string | null; amountPaise?: number }) {
  if (!upiId && !upiQrUrl)
    return (
      <Banner tone="warning" title="No UPI details yet">
        Ask {name} to add their UPI ID or QR under Account, or add it on their page.
      </Banner>
    );
  return (
    <div className="flex flex-col gap-3">
      {upiId ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-subtle px-3 py-2">
          <span className="min-w-0 flex-1 truncate font-mono text-base">{upiId}</span>
          <Button
            variant="ghost"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(upiId);
                toast.success("UPI ID copied.");
              } catch {
                toast.error("Couldn't copy.");
              }
            }}
          >
            <Icon icon={Copy} />
            Copy
          </Button>
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {upiId ? (
          <figure className="flex flex-col items-center gap-1">
            <UpiQr value={upiLink(upiId, name, amountPaise)} className="w-48" />
            <figcaption className="text-xs text-foreground-secondary">Scan with any UPI app{amountPaise ? ` · ${formatPaise(amountPaise)} filled in` : ""}</figcaption>
          </figure>
        ) : null}
        {upiQrUrl ? (
          <figure className="flex flex-col items-center gap-1">
            {/* eslint-disable-next-line @next/next/no-img-element -- from Convex storage */}
            <img src={upiQrUrl} alt={`${name}'s UPI QR code`} className="w-48 rounded-md border border-border object-contain" />
            <figcaption className="text-xs text-foreground-secondary">{name}&apos;s own QR</figcaption>
          </figure>
        ) : null}
      </div>
      {upiId ? (
        <Button asChild variant="secondary" className="self-start md:hidden">
          <a href={upiLink(upiId, name, amountPaise)}>
            <Icon icon={Smartphone} />
            Open UPI app
          </a>
        </Button>
      ) : null}
    </div>
  );
}

/** Admin, on a resident's page: "Send money" shows their UPI ID / QR. */
export function SendMoneyDialog({ name, upiId, upiQrUrl }: { name: string; upiId: string | null; upiQrUrl: string | null }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>
          <Icon icon={Send} />
          Send money
        </Button>
      </DialogTrigger>
      <DialogContent title={`Send money to ${name}`} description="Pay by UPI from your phone, then mark their draw as sent under Draws.">
        <PayeeDetails name={name} upiId={upiId} upiQrUrl={upiQrUrl} />
      </DialogContent>
    </Dialog>
  );
}

/** Admin, in the Draws queue: pay, then record how (mode) and the UTR (optional). */
export function MarkSentDialog({
  drawRequestId,
  name,
  amountPaise,
  upiId,
  upiQrUrl,
}: {
  drawRequestId: Id<"drawRequests">;
  name: string;
  amountPaise: number;
  upiId: string | null;
  upiQrUrl: string | null;
}) {
  const mark = useMutation(api.draws.markDisbursed);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<PaymentMode>("upi");
  const [utr, setUtr] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setMode("upi");
          setUtr("");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Icon icon={Send} />
          Pay &amp; mark sent
        </Button>
      </DialogTrigger>
      <DialogContent title={`Send ${formatPaise(amountPaise)} to ${name}`} description="Pay first, then record how you paid. It then goes on their statement with its fee.">
        <PayeeDetails name={name} upiId={upiId} upiQrUrl={upiQrUrl} amountPaise={amountPaise} />
        <form
          className="flex flex-col gap-4 border-t border-border pt-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await mark({ drawRequestId, paymentMode: mode, upiRef: utr || undefined });
              toast.success("Marked as sent.");
              setOpen(false);
            } catch (error) {
              toast.error(friendlyError(error));
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field id="send-mode" label="Mode of payment">
              {(p) => (
                <NativeSelect {...p} value={mode} onChange={(e) => setMode(e.target.value as PaymentMode)}>
                  {(Object.keys(PAYMENT_MODE_LABEL) as PaymentMode[]).map((m) => (
                    <option key={m} value={m}>
                      {PAYMENT_MODE_LABEL[m]}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
            <Field id="send-utr" label="UTR / reference (optional)">
              {(p) => <Input {...p} value={utr} onChange={(e) => setUtr(e.target.value)} maxLength={60} inputMode="text" />}
            </Field>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" type="button">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" loading={busy}>
              Mark sent
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Edit a UPI ID and/or upload a QR photo. Used by the resident (Account) and
 * the admin (resident's page).
 */
export function PayoutEditor({
  initialUpiId,
  initialQrId,
  initialQrUrl,
  uploadUrl,
  save,
  compact = false,
}: {
  initialUpiId: string | null;
  initialQrId: Id<"_storage"> | null;
  initialQrUrl: string | null;
  uploadUrl: () => Promise<string>;
  save: (upiId: string | null, upiQrId: Id<"_storage"> | null) => Promise<unknown>;
  compact?: boolean;
}) {
  const [upiId, setUpiId] = useState(initialUpiId ?? "");
  const [qrId, setQrId] = useState<Id<"_storage"> | null>(initialQrId);
  const [qrUrl, setQrUrl] = useState<string | null>(initialQrUrl);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await save(upiId.trim() || null, qrId);
          toast.success("Saved.");
        } catch (error) {
          toast.error(friendlyError(error));
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field id="payout-upi" label="UPI ID" hint="For example name@okhdfcbank">
        {(p) => <Input {...p} value={upiId} onChange={(e) => setUpiId(e.target.value)} autoCapitalize="none" autoCorrect="off" maxLength={300} />}
      </Field>
      <div className={cn("flex flex-wrap items-center gap-3", compact && "text-sm")}>
        {qrUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- from Convex storage or this device
          <img src={qrUrl} alt="UPI QR code" className="size-20 rounded-sm border border-border object-contain" />
        ) : (
          <span className="flex size-20 items-center justify-center rounded-sm border border-dashed border-border-strong text-foreground-muted">
            <Icon icon={QrCode} />
          </span>
        )}
        <label className={cn("inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-border-strong px-4 text-sm font-medium hover:bg-subtle", uploading && "opacity-60")}>
          <Icon icon={ImagePlus} />
          {uploading ? "Uploading…" : qrId ? "Change QR photo" : "Add a QR photo (optional)"}
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            disabled={uploading}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              if (!file.type.startsWith("image/") || file.size > 3_000_000) {
                toast.error("Use an image file under 3 MB.");
                return;
              }
              setUploading(true);
              try {
                const res = await fetch(await uploadUrl(), { method: "POST", headers: { "Content-Type": file.type }, body: file });
                const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
                setQrId(storageId);
                setQrUrl(URL.createObjectURL(file));
              } catch {
                toast.error("The photo couldn't be uploaded. Please try again.");
              } finally {
                setUploading(false);
              }
            }}
          />
        </label>
        {qrId ? (
          <Button type="button" variant="ghost" onClick={() => { setQrId(null); setQrUrl(null); }}>
            Remove photo
          </Button>
        ) : null}
      </div>
      <Button type="submit" variant="secondary" className="self-start" loading={busy}>
        Save payment details
      </Button>
    </form>
  );
}
