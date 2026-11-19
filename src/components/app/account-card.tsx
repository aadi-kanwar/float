"use client";

import { KeyRound } from "lucide-react";
import Link from "next/link";
import { formatPhoneForDisplay } from "@convex/lib/inputRules";
import { useMe } from "@/components/app/session";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { LoadingState } from "@/components/ui/skeleton";
import { DetailList } from "@/components/ui/stat";
import { ROLE_LABEL } from "@/lib/labels";

/** Your own account: name, login, role, and Change my password (not for Livoza Hub logins). */
export function AccountCard() {
  const me = useMe();
  return (
    <Card>
      <CardBody className="flex flex-col gap-4">
        {me ? (
          <DetailList
            rows={[
              { label: "Name", value: me.name ?? "—" },
              {
                label: "Mobile (login)",
                value: me.phone ? formatPhoneForDisplay(me.phone) : "—",
              },
              { label: "Role", value: me.role ? ROLE_LABEL[me.role] : "—" },
            ]}
          />
        ) : (
          <LoadingState rows={1} />
        )}
        {me?.hubLink ? (
          <p className="text-sm text-foreground-secondary">You signed in through the Livoza Hub. Change your password there.</p>
        ) : (
        <Button asChild variant="secondary" className="self-start">
          <Link href="/change-password">
            <Icon icon={KeyRound} />
            Change my password
          </Link>
        </Button>
        )}
      </CardBody>
    </Card>
  );
}
