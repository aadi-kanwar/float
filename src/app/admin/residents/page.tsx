"use client";

import { AddResidentDialog, ResidentsList } from "@/components/admin/residents";
import { PageHeader } from "@/components/ui/page-header";

export default function ResidentsPage() {
  return (
    <>
      <PageHeader title="Residents" description="Everyone who can draw pocket money. Open a resident to change their deposit, limit or access." actions={<AddResidentDialog />} />
      <ResidentsList />
    </>
  );
}
