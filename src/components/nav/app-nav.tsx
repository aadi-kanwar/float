"use client";

import { Menu } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Dialog as RadixDialog } from "radix-ui";
import { useState } from "react";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import type { NavItem } from "./nav-items";

/** The home tabs are active only on the home page itself. */
function isActive(pathname: string, href: string) {
  if (href === "/admin" || href === "/me") return pathname === href;
  return pathname.startsWith(href);
}

/** Desktop: a sidebar. Hidden below the `md` breakpoint. */
export function AppSidebar({
  items,
  footer,
  preview = false,
}: {
  items: NavItem[];
  footer?: React.ReactNode;
  /** Always visible, for the /design page. */
  preview?: boolean;
}) {
  const pathname = usePathname();
  return (
    <nav
      aria-label={preview ? "Admin (preview)" : "Admin"}
      className={cn(
        "w-60 shrink-0 flex-col justify-between border-r border-border bg-surface p-3 print:hidden",
        preview ? "flex" : "hidden overflow-y-auto md:flex",
      )}
    >
      <ul className="flex flex-col gap-1">
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                prefetch
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors",
                  active
                    ? "bg-primary-subtle text-primary-text"
                    : "text-foreground-secondary hover:bg-subtle hover:text-foreground",
                )}
              >
                <Icon icon={item.icon} />
                {item.label}
                <Badge count={item.badge} />
              </Link>
            </li>
          );
        })}
      </ul>
      {footer}
    </nav>
  );
}

/** A small count next to a menu item (e.g. new redemptions). */
function Badge({ count }: { count?: number }) {
  if (!count) return null;
  return (
    <span className="tabular ml-auto flex min-w-5 items-center justify-center rounded-full bg-chart-perk px-1.5 text-xs font-semibold text-white" aria-label={`${count} new`}>
      {count > 99 ? "99+" : count}
    </span>
  );
}

/** A bottom-bar tab: icon in a pill that fills in when active, label below. */
function TabFace({ icon, label, active }: { icon: NavItem["icon"]; label: string; active: boolean }) {
  return (
    <>
      <span
        className={cn(
          "flex h-8 w-14 items-center justify-center rounded-full transition-colors",
          active ? "bg-primary text-primary-foreground" : "text-foreground-secondary",
        )}
      >
        <Icon icon={icon} />
      </span>
      <span className={cn("truncate", active ? "font-semibold text-primary-text" : "text-foreground-secondary")}>{label}</span>
    </>
  );
}

const tabClass = "flex min-h-16 w-full flex-col items-center justify-center gap-1 px-1 text-xs font-medium";

/**
 * Mobile: the bottom bar (AppFrame keeps it at the bottom of the screen).
 * Hidden from `md` up unless `everywhere` (resident screens have no sidebar). `more` holds the
 * extra screens and Log out, behind a "More" tab.
 */
export function BottomNav({
  items,
  more,
  preview = false,
  everywhere = false,
}: {
  items: NavItem[];
  more?: { items: NavItem[]; footer: React.ReactNode };
  preview?: boolean;
  everywhere?: boolean;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const moreActive = more?.items.some((item) => isActive(pathname, item.href)) ?? false;
  return (
    <nav
      aria-label={preview ? "Main (preview)" : "Main"}
      className={cn(
        "border-t border-border bg-surface print:hidden",
        !preview && "pb-[env(safe-area-inset-bottom)]",
        !preview && !everywhere && "md:hidden",
      )}
    >
      <ul className="mx-auto flex max-w-lg">
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href} className="min-w-0 flex-1">
              <Link href={item.href} prefetch aria-current={active ? "page" : undefined} className={cn(tabClass, "relative")}>
                <TabFace icon={item.icon} label={item.label} active={active} />
                {item.badge ? (
                  <span className="absolute top-1 left-1/2 ml-3">
                    <Badge count={item.badge} />
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
        {more ? (
          <li className="min-w-0 flex-1">
            <RadixDialog.Root open={open} onOpenChange={setOpen}>
              <RadixDialog.Trigger className={cn(tabClass, "relative")} aria-current={moreActive ? "page" : undefined}>
                <TabFace icon={Menu} label="More" active={moreActive || open} />
                {more.items.some((i) => i.badge) ? <span className="absolute top-2 left-1/2 ml-4 size-2.5 rounded-full bg-chart-perk" aria-label="Something new" /> : null}
              </RadixDialog.Trigger>
              <RadixDialog.Portal>
                <RadixDialog.Overlay className="fixed inset-0 z-40 bg-inverse/40" />
                <RadixDialog.Content className="fixed inset-x-0 bottom-0 z-50 flex flex-col gap-1 rounded-t-xl border-t border-border bg-surface p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-lg">
                  <RadixDialog.Title className="px-3 py-2 text-sm font-medium text-foreground-secondary">More</RadixDialog.Title>
                  <RadixDialog.Description className="sr-only">Other screens, and log out</RadixDialog.Description>
                  <ul className="flex flex-col gap-1">
                    {more.items.map((item) => {
                      const active = isActive(pathname, item.href);
                      return (
                        <li key={item.href}>
                          <Link
                            href={item.href}
                            prefetch
                            onClick={() => setOpen(false)}
                            aria-current={active ? "page" : undefined}
                            className={cn(
                              "flex min-h-12 items-center gap-3 rounded-md px-3 text-base font-medium",
                              active ? "bg-primary-subtle text-primary-text" : "text-foreground hover:bg-subtle",
                            )}
                          >
                            <Icon icon={item.icon} />
                            {item.label}
                            <Badge count={item.badge} />
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                  <div className="mt-1 border-t border-border pt-2">{more.footer}</div>
                </RadixDialog.Content>
              </RadixDialog.Portal>
            </RadixDialog.Root>
          </li>
        ) : null}
      </ul>
    </nav>
  );
}
