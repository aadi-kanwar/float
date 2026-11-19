"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { ResidentShell } from "@/components/app/resident-shell";
import { destinationFor, SignOutButton, useMe } from "@/components/app/session";
import { LoadingState } from "@/components/ui/skeleton";
import { NotAuthorizedState } from "@/components/ui/states";

/** Resident screens (phone-first). Admins have their own (/admin). */
export default function ResidentLayout({ children }: { children: React.ReactNode }) {
  const me = useMe();
  const router = useRouter();
  useEffect(() => {
    if (me === null) router.replace("/signin");
    else if (me && (me.mustChangePassword || me.role === "admin")) router.replace(destinationFor(me));
  }, [me, router]);
  if (me === undefined || me === null || me.mustChangePassword || me.role === "admin") {
    return (
      <ResidentShell>
        <LoadingState rows={3} />
      </ResidentShell>
    );
  }
  if (me.role !== "resident" || !me.residentActive) {
    return (
      <ResidentShell>
        <NotAuthorizedState description="Your account isn't set up for Float. Please ask the office." />
        <div className="flex justify-center">
          <SignOutButton variant="secondary" />
        </div>
      </ResidentShell>
    );
  }
  return <ResidentShell nav>{children}</ResidentShell>;
}
