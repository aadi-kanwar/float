"use client";

import { useMutation } from "convex/react";
import { Download } from "lucide-react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import { usePropertyScope } from "@/components/app/property-scope";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { toast } from "@/components/ui/toaster";
import { friendlyError } from "@/lib/errors";
import { addMonths, todayIn } from "@/lib/format";

const KINDS = [
  { kind: "ledger" as const, label: "Money ledger", hint: "Every draw, fee, late fee, payment, waiver and correction." },
  { kind: "statements" as const, label: "Statements", hint: "Each statement's figures as they were when it was made." },
  { kind: "points" as const, label: "Points ledger", hint: "Every points change: earned, spent, given back, expired, by the office." },
  { kind: "redemptions" as const, label: "Redemptions", hint: "Every perk redeemed, its status and the answers given." },
];

export default function ExportPage() {
  const download = useMutation(api.exports.download);
  const { arg, current } = usePropertyScope();
  const today = todayIn();
  const [from, setFrom] = useState(`${addMonths(today.slice(0, 7), -1)}-01`);
  const [to, setTo] = useState(today);
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <>
      <PageHeader
        title="CSV export"
        description={`${current ? `Only ${current.name}. ` : "All properties. "}Files open in Excel or Google Sheets. Dates are India time; both ends of the range are included. Every download is in the audit log.`}
      />
      <Card>
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field id="ex-from" label="From">{(p) => <Input {...p} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />}</Field>
          <Field id="ex-to" label="To">{(p) => <Input {...p} type="date" value={to} onChange={(e) => setTo(e.target.value)} />}</Field>
        </CardBody>
      </Card>
      <div className="grid gap-3 sm:grid-cols-2">
        {KINDS.map((k) => (
          <Card key={k.kind}>
            <CardBody className="flex h-full flex-col gap-2">
              <span className="font-medium">{k.label}</span>
              <span className="flex-1 text-sm text-foreground-secondary">{k.hint}</span>
              <Button
                variant="secondary"
                className="self-start"
                loading={busy === k.kind}
                onClick={async () => {
                  setBusy(k.kind);
                  try {
                    const { filename, csv } = await download({ kind: k.kind, from, to, ...arg });
                    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = filename;
                    a.click();
                    URL.revokeObjectURL(url);
                  } catch (error) {
                    toast.error(friendlyError(error));
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                <Icon icon={Download} />
                Download CSV
              </Button>
            </CardBody>
          </Card>
        ))}
      </div>
    </>
  );
}
