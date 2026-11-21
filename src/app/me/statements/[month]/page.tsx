"use client";

import { useParams } from "next/navigation";
import { api } from "@convex/_generated/api";
import { StatementDetail } from "@/components/money/statement-detail";
import { LoadingState } from "@/components/ui/skeleton";
import { useQuery } from "@/lib/convex";
import { formatMonth } from "@/lib/format";

export default function StatementPage() {
  const { month } = useParams<{ month: string }>();
  const d = useQuery(api.statements.myDetail, { month });
  return (
    <>
      <h1 className="font-serif text-3xl tracking-tight">{formatMonth(month)}</h1>
      {d === undefined ? <LoadingState rows={4} /> : <StatementDetail d={d} />}
    </>
  );
}
