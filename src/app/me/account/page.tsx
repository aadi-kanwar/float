"use client";

import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { PayoutEditor } from "@/components/admin/send-money";
import { AccountCard } from "@/components/app/account-card";
import { SignOutButton } from "@/components/app/session";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { Card, CardBody } from "@/components/ui/card";
import { LoadingState } from "@/components/ui/skeleton";
import { useQuery } from "@/lib/convex";

export default function AccountPage() {
  const payout = useQuery(api.residents.myPayout, {});
  const save = useMutation(api.residents.setMyPayout);
  const uploadUrl = useMutation(api.residents.myQrUploadUrl);
  return (
    <>
      <h1 className="font-serif text-3xl tracking-tight">Account</h1>
      <AccountCard />
      <section aria-labelledby="getpaid" className="flex flex-col gap-2">
        <h2 id="getpaid" className="font-serif text-2xl tracking-tight">
          Where to send your money
        </h2>
        <p className="text-sm text-foreground-secondary">The office pays your draws here. Add your UPI ID, a photo of your UPI QR code, or both.</p>
        <Card>
          <CardBody>
            {payout === undefined ? (
              <LoadingState rows={2} />
            ) : (
              <PayoutEditor
                initialUpiId={payout.upiId}
                initialQrId={payout.upiQrId}
                initialQrUrl={payout.upiQrUrl}
                uploadUrl={() => uploadUrl({})}
                save={(upiId, upiQrId) => save({ upiId, upiQrId })}
              />
            )}
          </CardBody>
        </Card>
      </section>
      <ThemeToggle full />
      <SignOutButton variant="secondary" />
    </>
  );
}
