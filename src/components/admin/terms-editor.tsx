"use client";

import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { LoadingState } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toaster";
import { useQuery } from "@/lib/convex";
import { friendlyError } from "@/lib/errors";
import { inputClasses } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** The terms residents accept. Saving makes a new version they must accept before their next draw. */
export function TermsEditor() {
  const terms = useQuery(api.terms.current, {});
  const save = useMutation(api.terms.save);
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (terms === undefined) return <LoadingState rows={3} />;
  const value = text ?? terms.text;
  return (
    <Card>
      <CardBody className="flex flex-col gap-3">
        <p className="text-sm text-foreground-secondary">
          Version {terms.version}
          {terms.version === 0 ? " (Float's starting text)" : ""}. Saving a change makes a new version; residents accept it before their next draw.
        </p>
        <textarea aria-label="Terms" className={cn(inputClasses, "min-h-64 py-2 leading-relaxed")} value={value} onChange={(e) => setText(e.target.value)} />
        <Button
          className="self-start"
          loading={busy}
          disabled={value.trim() === terms.text}
          onClick={async () => {
            setBusy(true);
            try {
              const { version } = await save({ text: value });
              setText(null);
              toast.success(`Saved as version ${version}.`);
            } catch (error) {
              toast.error(friendlyError(error));
            } finally {
              setBusy(false);
            }
          }}
        >
          Save new version
        </Button>
      </CardBody>
    </Card>
  );
}
