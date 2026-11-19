"use client";

import { RESIDENT_MORE, RESIDENT_NAV } from "@/components/nav/nav-items";
import { BottomNav } from "@/components/nav/app-nav";
import { AppFrame } from "./app-frame";
import { Brand } from "./brand";
import { AdminHubLink, SignOutButton, useMe } from "./session";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { namedNav } from "@/components/nav/nav-items";
import { NotificationBell } from "./notification-bell";

/**
 * Frame for resident screens (phone-first): app name on top, the bottom
 * navigation on every screen size.
 * Without `nav` (e.g. while loading), a logout button sits in the header.
 */
export function ResidentShell({
  nav = false,
  children,
}: {
  nav?: boolean;
  children: React.ReactNode;
}) {
  const me = useMe();
  return (
    <AppFrame
      header={
        <header className="border-b border-border bg-surface">
          <div className="mx-auto flex h-14 max-w-lg items-center justify-between gap-3 px-4">
            <Brand />
            {nav ? (
              <span className="flex items-center gap-2">
                <AdminHubLink />
                <NotificationBell />
              </span>
            ) : (
              <span className="flex items-center gap-1">
                <ThemeToggle />
                <SignOutButton />
              </span>
            )}
          </div>
        </header>
      }
      nav={
        nav ? (
          <BottomNav
            items={namedNav(RESIDENT_NAV, me?.pointsName)}
            more={{
              items: RESIDENT_MORE,
              footer: (
                <>
                  <ThemeToggle full />
                  <SignOutButton variant="ghost" full />
                </>
              ),
            }}
            everywhere
          />
        ) : null
      }
    >
      <main className="mx-auto flex min-h-full w-full max-w-lg flex-col gap-6 px-4 py-6">
        {children}
      </main>
    </AppFrame>
  );
}
