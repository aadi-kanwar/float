"use client";

import { usePaginatedQuery } from "convex/react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FilterBar } from "@/components/ui/filter-bar";
import { NativeSelect } from "@/components/ui/native-select";
import { LoadingState } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/states";
import { formatDateTime, formatPaise } from "@/lib/format";

export const ACTION_LABEL: Record<string, string> = {
  "setup.first_admin_created": "First admin created",
  "user.password_changed": "Changed own password",
  "property.added": "PG added",
  "property.renamed": "PG renamed",
  "resident.created": "Resident added",
  "resident.updated": "Resident details changed",
  "resident.deposit_changed": "Deposit changed",
  "resident.limit_changed": "Limit changed",
  "resident.paused": "Resident paused",
  "resident.resumed": "Resident resumed",
  "resident.password_reset": "Password reset",
  "settings.changed": "Settings changed",
  "terms.changed": "Terms changed",
  "terms.accepted": "Terms accepted",
  "draw.requested": "Draw asked",
  "draw.auto_approved": "Draw asked (approved at once)",
  "draw.approved": "Draw approved",
  "draw.rejected": "Draw rejected",
  "draw.cancelled": "Draw cancelled",
  "draw.disbursed": "Draw sent",
  "repayment.claimed": "Payment reported",
  "repayment.confirmed": "Payment confirmed",
  "repayment.rejected": "Payment rejected",
  "repayment.recorded": "Payment recorded",
  "ledger.waived": "Fee waived",
  "ledger.reversed": "Ledger row reversed",
  "deposit.settled": "Settled from deposit",
  "sso.signed_in": "Signed in from the Livoza Hub",
  "hub.person_synced": "Updated from the Livoza Hub",
  "hub.property_linked": "PG linked to the Livoza Hub",
};

const FILTERS = [
  { value: "", label: "Everything" },
  ...Object.entries(ACTION_LABEL).map(([value, label]) => ({ value, label })),
];

const MONEY_KEYS = /paise$/i;

function show(key: string, value: unknown): string {
  if (value === undefined || value === null || value === "") return "—";
  if (typeof value === "number" && MONEY_KEYS.test(key)) return formatPaise(value);
  if (typeof value === "boolean") return value ? "on" : "off";
  if (Array.isArray(value)) return value.length === 0 ? "none" : value.map((v) => String(v)).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** A one-line "what changed": key: old → new. */
export function auditSummary(action: string, meta: Record<string, unknown> | null): string {
  if (!meta) return "";
  const before = meta.before;
  const after = meta.after;
  // Single values (deposit, limit, paused): the key is in the action.
  if ((typeof before !== "object" || before === null) && (typeof after !== "object" || after === null) && ("before" in meta || "after" in meta)) {
    const key = action.includes("deposit") || action.includes("limit") ? "paise" : "";
    return `${show(key, before)} → ${show(key, after)}`;
  }
  const b = (before ?? {}) as Record<string, unknown>;
  const a = (after ?? {}) as Record<string, unknown>;
  if (before && after) {
    const keys = Object.keys(a).filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k]));
    return keys.map((k) => `${k}: ${show(k, b[k])} → ${show(k, a[k])}`).join(" · ");
  }
  if (after) return Object.entries(a).filter(([k]) => k !== "propertyId").map(([k, v]) => `${k}: ${show(k, v)}`).join(" · ");
  return "";
}

/** Every change, newest first; optionally for one resident. Can't be edited or deleted. */
export function AuditLog({ residentId }: { residentId?: Id<"residents"> }) {
  const [action, setAction] = useState("");
  const { results, status, loadMore } = usePaginatedQuery(
    api.audit.list,
    { residentId, action: residentId ? undefined : action || undefined },
    { initialNumItems: 50 },
  );
  return (
    <div className="flex flex-col gap-4">
      {residentId ? null : (
        <FilterBar>
          <NativeSelect aria-label="Show" value={action} onChange={(e) => setAction(e.target.value)} className="sm:w-64">
            {FILTERS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </NativeSelect>
        </FilterBar>
      )}
      {status === "LoadingFirstPage" ? (
        <LoadingState rows={6} />
      ) : results.length === 0 ? (
        <EmptyState title="Nothing here yet" />
      ) : (
        <Card>
          <ul className="divide-y divide-border" aria-label="Audit log">
            {results.map((row) => {
              const what = auditSummary(row.action, row.metadata);
              return (
                <li key={row.auditId} className="flex flex-col gap-1 px-4 py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="font-medium">
                      {ACTION_LABEL[row.action] ?? row.action}
                      {row.residentName && !residentId ? <span className="font-normal text-foreground-secondary"> · {row.residentName}</span> : null}
                    </span>
                    <span className="tabular text-xs text-foreground-secondary">{formatDateTime(row.createdAt)}</span>
                  </div>
                  <span className="text-sm break-words text-foreground-secondary">
                    {row.actorName ?? "System"}
                    {what ? ` · ${what}` : ""}
                  </span>
                  {row.reason ? <span className="text-sm">Reason: {row.reason}</span> : null}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
      {status === "CanLoadMore" ? (
        <Button variant="secondary" className="self-center" onClick={() => loadMore(50)}>
          Show older
        </Button>
      ) : status === "LoadingMore" ? (
        <LoadingState rows={1} />
      ) : null}
    </div>
  );
}
