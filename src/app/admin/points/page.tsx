"use client";

import { useState } from "react";
import { AdjustDialog, LimitRules, PointsLedger, RulesEditor } from "@/components/admin/points-admin";
import { useMe } from "@/components/app/session";
import { PageHeader } from "@/components/ui/page-header";
import { SegmentedTabs } from "@/components/ui/tabs";

type Tab = "rules" | "ledger" | "limits";

export default function PointsAdminPage() {
  const me = useMe();
  const [tab, setTab] = useState<Tab>("rules");
  const name = me?.pointsName ?? "";
  return (
    <>
      <PageHeader title={name} description={`How residents earn ${name}, every change to them, and limit growth.`} actions={<AdjustDialog />} />
      <SegmentedTabs
        label="Show"
        idPrefix="points"
        items={[
          { value: "rules", label: "Earn rules" },
          { value: "ledger", label: "Ledger" },
          { value: "limits", label: "Limit growth" },
        ]}
        value={tab}
        onChange={setTab}
      />
      <div id="points-panel" role="tabpanel">
        {tab === "rules" ? <RulesEditor /> : tab === "ledger" ? <PointsLedger /> : <LimitRules />}
      </div>
    </>
  );
}
