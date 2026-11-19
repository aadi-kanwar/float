"use client";

import { OrganizationSettings } from "@/components/admin/organization-settings";
import { SettingsForm } from "@/components/admin/settings-form";
import { TermsEditor } from "@/components/admin/terms-editor";
import { AccountCard } from "@/components/app/account-card";
import { PageHeader } from "@/components/ui/page-header";

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" description="Every change applies from now on and is kept in the audit log. Past statements and records never change." />
      <OrganizationSettings />
      <SettingsForm />
      <section aria-labelledby="terms" className="flex flex-col gap-2">
        <h2 id="terms" className="font-serif text-2xl tracking-tight">
          Terms for residents
        </h2>
        <TermsEditor />
      </section>
      <section aria-labelledby="account" className="flex flex-col gap-2">
        <h2 id="account" className="font-serif text-2xl tracking-tight">
          Your account
        </h2>
        <AccountCard />
      </section>
    </>
  );
}
