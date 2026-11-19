"use client";

import { EMPTY_PERK, PerkEditor } from "@/components/admin/perk-editor";
import { PageHeader } from "@/components/ui/page-header";

export default function NewPerkPage() {
  return (
    <>
      <PageHeader title="New perk" description="It starts hidden; set it to Active when it's ready for the store." />
      <PerkEditor initial={EMPTY_PERK} />
    </>
  );
}
