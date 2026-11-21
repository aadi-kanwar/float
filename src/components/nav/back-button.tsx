"use client";

import { ArrowLeft } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { Icon } from "@/components/ui/icon";
import type { NavItem } from "./nav-items";

/**
 * "← Back" on every screen that isn't one of the tabs (e.g. a statement, a
 * perk, Draw money, a resident's page). Goes to the previous screen, or to
 * `home` when there's none (opened from a link).
 */
export function BackButton({ tabs, home }: { tabs: NavItem[]; home: string }) {
  const pathname = usePathname();
  const router = useRouter();
  if (tabs.some((t) => t.href === pathname)) return null;
  return (
    <button
      type="button"
      onClick={() => {
        if (window.history.length > 1) router.back();
        else router.push(home);
      }}
      className="-ml-2 inline-flex min-h-11 items-center gap-1.5 self-start rounded-md px-2 text-sm font-medium text-foreground-secondary hover:bg-subtle hover:text-foreground"
    >
      <Icon icon={ArrowLeft} className="size-4" />
      Back
    </button>
  );
}
