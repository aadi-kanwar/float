import {
  BedDouble,
  Bike,
  BookOpen,
  Cake,
  Coffee,
  Gift,
  Pizza,
  Popcorn,
  Shirt,
  Sparkles,
  Ticket,
  Utensils,
  WashingMachine,
  Wifi,
  type LucideIcon,
} from "lucide-react";

/** The icons a perk can use (the backend has the same list in convex/perks.ts). */
export const PERK_ICON: Record<string, { icon: LucideIcon; label: string }> = {
  gift: { icon: Gift, label: "Gift" },
  coffee: { icon: Coffee, label: "Coffee" },
  utensils: { icon: Utensils, label: "Meal" },
  pizza: { icon: Pizza, label: "Pizza" },
  cake: { icon: Cake, label: "Cake" },
  "bed-double": { icon: BedDouble, label: "Bed" },
  shirt: { icon: Shirt, label: "Laundry" },
  "washing-machine": { icon: WashingMachine, label: "Washing machine" },
  ticket: { icon: Ticket, label: "Ticket" },
  popcorn: { icon: Popcorn, label: "Movie" },
  "book-open": { icon: BookOpen, label: "Book" },
  wifi: { icon: Wifi, label: "Wi-Fi" },
  bike: { icon: Bike, label: "Bike" },
  sparkles: { icon: Sparkles, label: "Sparkles" },
};

export const perkIcon = (name: string) => PERK_ICON[name]?.icon ?? Gift;
