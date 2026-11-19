"use client";

import { useMutation } from "convex/react";
import Link from "next/link";
import { useEffect } from "react";
import { api } from "@convex/_generated/api";
import { Card } from "@/components/ui/card";
import { LoadingState } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/states";
import { useQuery } from "@/lib/convex";
import { formatWhen } from "@/lib/format";
import { cn } from "@/lib/utils";

export default function NotificationsPage() {
  const list = useQuery(api.money.myNotifications, {});
  const markAllRead = useMutation(api.money.markAllRead);
  const unread = list?.some((n) => !n.read) ?? false;
  useEffect(() => {
    if (unread) void markAllRead({});
  }, [unread, markAllRead]);
  return (
    <>
      <h1 className="font-serif text-3xl tracking-tight">Notifications</h1>
      {list === undefined ? (
        <LoadingState rows={4} />
      ) : list.length === 0 ? (
        <EmptyState title="No notifications yet" />
      ) : (
        <Card>
          <ul className="divide-y divide-border">
            {list.map((n) => {
              const body = (
                <>
                  <span className="flex items-baseline justify-between gap-3">
                    <span className={cn("font-medium", !n.read && "text-primary-text")}>{n.title}</span>
                    <span className="shrink-0 text-xs text-foreground-secondary">{formatWhen(n.createdAt)}</span>
                  </span>
                  <span className="text-sm text-foreground-secondary">{n.body}</span>
                </>
              );
              return (
                <li key={n.id}>
                  {n.href ? (
                    <Link href={n.href} className="flex flex-col gap-1 px-4 py-3 hover:bg-subtle">
                      {body}
                    </Link>
                  ) : (
                    <div className="flex flex-col gap-1 px-4 py-3">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </>
  );
}
