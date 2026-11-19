import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Download,
  Gift,
  Inbox,
  Store,
  Sparkles,
  FileText,
  House,
  LayoutDashboard,
  ListOrdered,
  ScrollText,
  Settings,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** In the phone's bottom bar (default true), or under its "More" tab (false). The sidebar shows everything. */
  mobile?: boolean;
  /** A count shown next to it (e.g. new redemptions). */
  badge?: number;
};

export const ADMIN_NAV: NavItem[] = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/residents", label: "Residents", icon: Users },
  { href: "/admin/draws", label: "Draws", icon: ArrowUpFromLine },
  { href: "/admin/repayments", label: "Repayments", icon: ArrowDownToLine },
  { href: "/admin/statements", label: "Statements", icon: FileText, mobile: false },
  { href: "/admin/points", label: "Points", icon: Sparkles, mobile: false },
  { href: "/admin/perks", label: "Perk Store", icon: Store, mobile: false },
  { href: "/admin/redemptions", label: "Redemptions", icon: Inbox, mobile: false },
  { href: "/admin/export", label: "CSV export", icon: Download, mobile: false },
  { href: "/admin/audit", label: "Audit log", icon: ScrollText, mobile: false },
  { href: "/admin/settings", label: "Settings", icon: Settings, mobile: false },
];

/** Resident screens (bottom bar on every screen size; phone-first). */
export const RESIDENT_NAV: NavItem[] = [
  { href: "/me", label: "Home", icon: House },
  { href: "/me/store", label: "Store", icon: Store },
  { href: "/me/points", label: "Points", icon: Sparkles },
  { href: "/me/statements", label: "Statements", icon: FileText },
];

/** Under the resident's "More" tab. */
export const RESIDENT_MORE: NavItem[] = [
  { href: "/me/redemptions", label: "My redemptions", icon: Gift },
  { href: "/me/activity", label: "Activity", icon: ListOrdered },
  { href: "/me/account", label: "Account", icon: UserRound },
];

/** The points tab wears the admin's name for the points (never a hard-coded "Points"). */
export function namedNav(items: NavItem[], pointsName: string | undefined, badges: Record<string, number> = {}): NavItem[] {
  return items.map((item) => ({
    ...item,
    label: item.href.endsWith("/points") && pointsName ? pointsName : item.label,
    badge: badges[item.href] ?? item.badge,
  }));
}
