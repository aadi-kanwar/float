"use client";

import { Bell } from "lucide-react";
import Link from "next/link";
import { api } from "@convex/_generated/api";
import { Icon } from "@/components/ui/icon";
import { useQuery } from "@/lib/convex";

/** The resident's notifications, with the number not yet seen. Updates live. */
export function NotificationBell() {
  const count = useQuery(api.money.unreadCount, {});
  return (
    <Link
      href="/me/notifications"
      aria-label={count ? `Notifications, ${count} new` : "Notifications"}
      className="relative flex size-11 items-center justify-center rounded-md text-foreground-secondary hover:bg-subtle hover:text-foreground"
    >
      <Icon icon={Bell} />
      {count ? (
        <span className="tabular absolute top-1.5 right-1.5 flex min-w-5 items-center justify-center rounded-full bg-primary px-1 text-xs font-semibold text-primary-foreground">
          {count > 9 ? "9+" : count}
        </span>
      ) : null}
    </Link>
  );
}
