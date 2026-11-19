"use client";

import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogClose, DialogFooter } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { toast } from "@/components/ui/toaster";

/** Shows a temporary password once, with Copy. */
export function OneTimePassword({ password }: { password: string }) {
  return (
    <>
      <p className="rounded-md border border-border bg-subtle px-4 py-3 text-center font-mono text-2xl tracking-widest">
        {password}
      </p>
      <DialogFooter>
        <Button
          variant="secondary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(password);
              toast.success("Copied.");
            } catch {
              toast.error("Couldn't copy. Please write it down.");
            }
          }}
        >
          <Icon icon={Copy} />
          Copy
        </Button>
        <DialogClose asChild>
          <Button>Done</Button>
        </DialogClose>
      </DialogFooter>
    </>
  );
}
