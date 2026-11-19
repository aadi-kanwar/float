"use client";

import { useMutation } from "convex/react";
import { ImagePlus, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { PerkField, PerkLimit } from "@convex/lib/validators";
import { useMe } from "@/components/app/session";
import { PerkCard } from "@/components/perks/perk-card";
import { PERK_ICON } from "@/components/perks/perk-icon";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { Input, inputClasses } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { toast } from "@/components/ui/toaster";
import { useQuery } from "@/lib/convex";
import { friendlyError } from "@/lib/errors";
import { cn } from "@/lib/utils";

type Initial = {
  perkId?: Id<"perks">;
  title: string;
  summary: string;
  details: string;
  icon: string;
  imageId: Id<"_storage"> | null;
  imageUrl: string | null;
  categoryId: Id<"perkCategories"> | null;
  costPoints: number;
  stockLeft: number | null;
  perResident: PerkLimit;
  availableFrom: string | null;
  availableTo: string | null;
  visibility: "active" | "hidden" | "archived";
  fields: PerkField[];
  fulfilmentNote: string | null;
};

export const EMPTY_PERK: Initial = {
  title: "",
  summary: "",
  details: "",
  icon: "gift",
  imageId: null,
  imageUrl: null,
  categoryId: null,
  costPoints: 100,
  stockLeft: null,
  perResident: { kind: "unlimited" },
  availableFrom: null,
  availableTo: null,
  visibility: "hidden",
  fields: [],
  fulfilmentNote: null,
};

/** Every perk setting on one page, with a live preview of the card. */
export function PerkEditor({ initial }: { initial: Initial }) {
  const me = useMe();
  const router = useRouter();
  const categories = useQuery(api.perks.categories, {});
  const create = useMutation(api.perks.create);
  const update = useMutation(api.perks.update);
  const uploadUrl = useMutation(api.perks.imageUploadUrl);
  const [f, setF] = useState(initial);
  const [cost, setCost] = useState(String(initial.costPoints));
  const [stock, setStock] = useState(initial.stockLeft === null ? "" : String(initial.stockLeft));
  const [limitCount, setLimitCount] = useState(initial.perResident.kind === "unlimited" ? "1" : String(initial.perResident.count));
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const set = <K extends keyof Initial>(k: K, v: Initial[K]) => setF((x) => ({ ...x, [k]: v }));
  const name = me?.pointsName ?? "";

  const save = async () => {
    const costPoints = Number(cost);
    const stockValue = stock.trim() === "" ? null : Number(stock);
    const perResident: PerkLimit = f.perResident.kind === "unlimited" ? { kind: "unlimited" } : { kind: f.perResident.kind, count: Number(limitCount) };
    const args = {
      title: f.title,
      summary: f.summary,
      details: f.details,
      icon: f.icon,
      imageId: f.imageId ?? undefined,
      categoryId: f.categoryId ?? undefined,
      costPoints,
      stock: stockValue,
      perResident,
      availableFrom: f.availableFrom || undefined,
      availableTo: f.availableTo || undefined,
      visibility: f.visibility,
      fields: f.fields,
      fulfilmentNote: f.fulfilmentNote || undefined,
    };
    setBusy(true);
    try {
      if (f.perkId) await update({ perkId: f.perkId, ...args });
      else await create(args);
      toast.success("Perk saved.");
      router.push("/admin/perks");
    } catch (error) {
      toast.error(friendlyError(error));
    } finally {
      setBusy(false);
    }
  };

  const upload = async (file: File) => {
    if (!file.type.startsWith("image/") || file.size > 3_000_000) {
      toast.error("Use an image file under 3 MB.");
      return;
    }
    setUploading(true);
    try {
      const url = await uploadUrl({});
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": file.type }, body: file });
      const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
      setF((x) => ({ ...x, imageId: storageId, imageUrl: URL.createObjectURL(file) }));
    } catch {
      toast.error("The image couldn't be uploaded. Please try again.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <Card>
          <CardBody className="flex flex-col gap-4">
            <Field id="p-title" label="Title">
              {(p) => <Input {...p} value={f.title} onChange={(e) => set("title", e.target.value)} maxLength={60} required />}
            </Field>
            <Field id="p-summary" label="Short description" hint="On the card in the store.">
              {(p) => <Input {...p} value={f.summary} onChange={(e) => set("summary", e.target.value)} maxLength={120} required />}
            </Field>
            <Field id="p-details" label="Details" hint="On the perk's own page.">
              {(p) => <textarea {...p} className={cn(inputClasses, "min-h-28 py-2")} value={f.details} onChange={(e) => set("details", e.target.value)} maxLength={2000} />}
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="p-cat" label="Category">
                {(p) => (
                  <NativeSelect {...p} value={f.categoryId ?? ""} onChange={(e) => set("categoryId", (e.target.value || null) as Id<"perkCategories"> | null)}>
                    <option value="">None</option>
                    {(categories ?? []).filter((c) => !c.archived || c.categoryId === f.categoryId).map((c) => (
                      <option key={c.categoryId} value={c.categoryId}>{c.name}</option>
                    ))}
                  </NativeSelect>
                )}
              </Field>
              <Field id="p-vis" label="Visibility">
                {(p) => (
                  <NativeSelect {...p} value={f.visibility} onChange={(e) => set("visibility", e.target.value as Initial["visibility"])}>
                    <option value="active">Active (in the store)</option>
                    <option value="hidden">Hidden</option>
                    <option value="archived">Archived (history kept)</option>
                  </NativeSelect>
                )}
              </Field>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="flex flex-col gap-3">
            <span className="text-sm font-medium">Picture</span>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Icon">
              {Object.entries(PERK_ICON).map(([key, v]) => (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={f.icon === key}
                  aria-label={v.label}
                  onClick={() => set("icon", key)}
                  className={cn("flex size-11 items-center justify-center rounded-md border", f.icon === key ? "border-primary bg-primary-subtle text-primary-text" : "border-border text-foreground-secondary hover:bg-subtle")}
                >
                  <Icon icon={v.icon} />
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className={cn("inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-border-strong px-4 text-sm font-medium hover:bg-subtle", uploading && "opacity-60")}>
                <Icon icon={ImagePlus} />
                {uploading ? "Uploading…" : f.imageId ? "Change image" : "Upload an image (optional)"}
                <input type="file" accept="image/*" className="sr-only" disabled={uploading} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
              </label>
              {f.imageId ? (
                <Button type="button" variant="ghost" onClick={() => setF((x) => ({ ...x, imageId: null, imageUrl: null }))}>
                  Use the icon instead
                </Button>
              ) : null}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <Field id="p-cost" label={`Cost (${name})`}>
              {(p) => <Input {...p} inputMode="numeric" value={cost} onChange={(e) => setCost(e.target.value.replace(/[^\d]/g, ""))} required />}
            </Field>
            <Field id="p-stock" label={f.perkId ? "Stock left" : "Stock"} hint="Leave empty for unlimited.">
              {(p) => <Input {...p} inputMode="numeric" value={stock} onChange={(e) => setStock(e.target.value.replace(/[^\d]/g, ""))} />}
            </Field>
            <Field id="p-limit" label="Each resident can redeem">
              {(p) => (
                <NativeSelect {...p} value={f.perResident.kind} onChange={(e) => set("perResident", e.target.value === "unlimited" ? { kind: "unlimited" } : { kind: e.target.value as "per_month", count: Number(limitCount) || 1 })}>
                  <option value="unlimited">Any number of times</option>
                  <option value="per_month">N times a month</option>
                  <option value="per_semester">N times a semester (Jan–Jun, Jul–Dec)</option>
                  <option value="total">N times in total</option>
                </NativeSelect>
              )}
            </Field>
            {f.perResident.kind !== "unlimited" ? (
              <Field id="p-limit-n" label="N">
                {(p) => <Input {...p} inputMode="numeric" value={limitCount} onChange={(e) => setLimitCount(e.target.value.replace(/[^\d]/g, ""))} required />}
              </Field>
            ) : <span />}
            <Field id="p-from" label="Available from (optional)">
              {(p) => <Input {...p} type="date" value={f.availableFrom ?? ""} onChange={(e) => set("availableFrom", e.target.value || null)} />}
            </Field>
            <Field id="p-to" label="Available until (optional)">
              {(p) => <Input {...p} type="date" value={f.availableTo ?? ""} onChange={(e) => set("availableTo", e.target.value || null)} />}
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="flex flex-col gap-3">
            <span className="text-sm font-medium">Questions the resident answers when redeeming</span>
            {f.fields.map((q, i) => (
              <div key={i} className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-[1fr_9rem_auto]">
                <Input aria-label="Question" placeholder="e.g. Guest name" value={q.label} onChange={(e) => set("fields", f.fields.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                <NativeSelect aria-label="Answer type" value={q.type} onChange={(e) => set("fields", f.fields.map((x, j) => (j === i ? { ...x, type: e.target.value as PerkField["type"] } : x)))}>
                  <option value="text">Text</option>
                  <option value="date">Date</option>
                  <option value="number">Number</option>
                  <option value="select">Choose one</option>
                </NativeSelect>
                <Button type="button" variant="ghost" size="icon" aria-label="Remove question" onClick={() => set("fields", f.fields.filter((_, j) => j !== i))}>
                  <Icon icon={Trash2} />
                </Button>
                {q.type === "select" ? (
                  <Input className="sm:col-span-3" aria-label="Choices" placeholder="Choices, separated by commas" value={(q.options ?? []).join(", ")} onChange={(e) => set("fields", f.fields.map((x, j) => (j === i ? { ...x, options: e.target.value.split(",").map((o) => o.trimStart()) } : x)))} />
                ) : null}
                <label className="flex items-center gap-2 text-sm sm:col-span-3">
                  <input type="checkbox" className="size-5 accent-primary" checked={q.required} onChange={(e) => set("fields", f.fields.map((x, j) => (j === i ? { ...x, required: e.target.checked } : x)))} />
                  Required
                </label>
              </div>
            ))}
            <Button type="button" variant="secondary" className="self-start" disabled={f.fields.length >= 8} onClick={() => set("fields", [...f.fields, { key: "", label: "", type: "text", required: true }])}>
              <Icon icon={Plus} />
              Add a question
            </Button>
            <Field id="p-note" label="Shown after redeeming (optional)" hint='e.g. "Collect from the front desk"'>
              {(p) => <Input {...p} value={f.fulfilmentNote ?? ""} onChange={(e) => set("fulfilmentNote", e.target.value)} maxLength={300} />}
            </Field>
          </CardBody>
        </Card>
        <div className="flex gap-2">
          <Button type="submit" loading={busy}>Save perk</Button>
          <Button type="button" variant="ghost" onClick={() => router.push("/admin/perks")}>Cancel</Button>
        </div>
      </form>
      <aside className="flex flex-col gap-2 lg:sticky lg:top-4 lg:self-start">
        <span className="text-sm font-medium text-foreground-secondary">Preview</span>
        <PerkCard
          perk={{ perkId: "preview", title: f.title || "Title", summary: f.summary || "Short description", icon: f.icon, imageUrl: f.imageUrl, costPoints: Number(cost) || 0, stockLeft: stock === "" ? null : Number(stock) }}
          pointsName={name}
          href="#"
        />
      </aside>
    </div>
  );
}
