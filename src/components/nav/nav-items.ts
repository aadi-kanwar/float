import {
  Building2,
  House,
  LayoutDashboard,
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
};

export const ADMIN_NAV: NavItem[] = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/residents", label: "Residents", icon: Users },
  { href: "/admin/pgs", label: "PGs", icon: Building2, mobile: false },
  { href: "/admin/audit", label: "Audit log", icon: ScrollText, mobile: false },
  { href: "/admin/settings", label: "Settings", icon: Settings, mobile: false },
];

/** Resident screens (bottom bar on every screen size; phone-first). */
export const RESIDENT_NAV: NavItem[] = [
  { href: "/me", label: "Home", icon: House },
  { href: "/me/account", label: "Account", icon: UserRound },
];
