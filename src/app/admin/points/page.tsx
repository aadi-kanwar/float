"use client";

import { useState } from "react";
import { AdjustDialog, LimitRules, PointsLedger, PointsRules } from "@/components/admin/points-admin";
import { useMe } from "@/components/app/session";
import { PageHeader } from "@/components/ui/page-header";
import { SegmentedTabs } from "@/components/ui/tabs";

type Tab = "ledger" | "limits";

export default function PointsAdminPage() {
  const me = useMe();
  const [tab, setTab] = useState<Tab>("ledger");
  const name = me?.pointsName ?? "";
  return (
    <>
      <PageHeader title={name} description={`How residents earn ${name}, every change to them, and limit growth.`} actions={<AdjustDialog />} />
      <PointsRules />
      <SegmentedTabs
        label="Show"
        idPrefix="points"
        items={[
          { value: "ledger", label: "Ledger" },
          { value: "limits", label: "Limit growth" },
        ]}
        value={tab}
        onChange={setTab}
      />
      <div id="points-panel" role="tabpanel">
        {tab === "ledger" ? <PointsLedger /> : <LimitRules />}
      </div>
    </>
  );
}
