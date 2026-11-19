"use client";

import { useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { LoadingState } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toaster";
import { useQuery } from "@/lib/convex";
import { friendlyError } from "@/lib/errors";
import { formatWhen } from "@/lib/format";

export default function TermsPage() {
  const router = useRouter();
  const terms = useQuery(api.terms.mine, {});
  const accept = useMutation(api.terms.accept);
  const [ticked, setTicked] = useState(false);
  const [busy, setBusy] = useState(false);
  if (terms === undefined) return <LoadingState rows={6} />;
  return (
    <>
      <h1 className="font-serif text-3xl tracking-tight">Terms</h1>
      <Card>
        <CardBody>
          <div className="text-sm leading-relaxed whitespace-pre-wrap">{terms.text}</div>
        </CardBody>
      </Card>
      {terms.acceptedAt ? (
        <Banner tone="success" title="You accepted these terms">
          {formatWhen(terms.acceptedAt)}
        </Banner>
      ) : (
        <>
          <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md border border-border px-3 py-2 has-checked:border-primary has-checked:bg-primary-subtle">
            <input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-primary" checked={ticked} onChange={(e) => setTicked(e.target.checked)} />
            <span>I have read and accept these terms.</span>
          </label>
          <Button
            className="min-h-14"
            disabled={!ticked}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await accept({ version: terms.version });
                toast.success("Thanks. You can draw money now.");
                router.replace("/me/draw");
              } catch (error) {
                toast.error(friendlyError(error));
              } finally {
                setBusy(false);
              }
            }}
          >
            Accept
          </Button>
        </>
      )}
    </>
  );
}
