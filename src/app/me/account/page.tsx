"use client";

import { AccountCard } from "@/components/app/account-card";
import { SignOutButton } from "@/components/app/session";

export default function AccountPage() {
  return (
    <>
      <h1 className="font-serif text-3xl tracking-tight">Account</h1>
      <AccountCard />
      <SignOutButton variant="secondary" />
    </>
  );
}
