"use client";

import { AccountCard } from "@/components/app/account-card";
import { SignOutButton } from "@/components/app/session";
import { ThemeToggle } from "@/components/app/theme-toggle";

export default function AccountPage() {
  return (
    <>
      <h1 className="font-serif text-3xl tracking-tight">Account</h1>
      <AccountCard />
      <ThemeToggle full />
      <SignOutButton variant="secondary" />
    </>
  );
}
