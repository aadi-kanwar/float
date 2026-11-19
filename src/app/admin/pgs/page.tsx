"use client";

import { useMutation } from "convex/react";
import { Link2, Plus } from "lucide-react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingState } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import { toast } from "@/components/ui/toaster";
import { useQuery } from "@/lib/convex";
import { friendlyError } from "@/lib/errors";

export default function PgsPage() {
  const pgs = useQuery(api.properties.list, {});
  const add = useMutation(api.properties.add);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <>
      <PageHeader title="PGs" description="Your PGs normally arrive from the Livoza Hub. Add one here only if it isn't on the hub; the hub links it by name later." />
      {pgs === undefined ? (
        <LoadingState rows={2} />
      ) : pgs.length === 0 ? (
        <EmptyState title="No PGs yet" />
      ) : (
        <Card>
          <ul className="divide-y divide-border">
            {pgs.map((p) => (
              <li key={p.propertyId} className="flex min-h-12 items-center justify-between gap-3 px-4 py-2">
                <span className="font-medium">{p.name}</span>
                {p.fromHub ? (
                  <StatusBadge tone="info" icon={Link2}>
                    Livoza Hub
                  </StatusBadge>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card>
        <CardBody>
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await add({ name });
                setName("");
                toast.success("PG added.");
              } catch (error) {
                toast.error(friendlyError(error));
              } finally {
                setBusy(false);
              }
            }}
          >
            <Input aria-label="New PG name" placeholder="PG name" value={name} onChange={(e) => setName(e.target.value)} required />
            <Button type="submit" variant="secondary" loading={busy}>
              <Icon icon={Plus} />
              Add PG
            </Button>
          </form>
        </CardBody>
      </Card>
    </>
  );
}
