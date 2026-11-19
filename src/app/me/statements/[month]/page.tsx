"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api } from "@convex/_generated/api";
import { StatementDetail } from "@/components/money/statement-detail";
import { Icon } from "@/components/ui/icon";
import { LoadingState } from "@/components/ui/skeleton";
import { useQuery } from "@/lib/convex";
import { formatMonth } from "@/lib/format";

export default function StatementPage() {
  const { month } = useParams<{ month: string }>();
  const d = useQuery(api.statements.myDetail, { month });
  return (
    <>
      <Link href="/me/statements" className="inline-flex items-center gap-1 self-start text-sm text-foreground-secondary hover:text-foreground">
        <Icon icon={ArrowLeft} className="size-4" />
        Statements
      </Link>
      <h1 className="font-serif text-3xl tracking-tight">{formatMonth(month)}</h1>
      {d === undefined ? <LoadingState rows={4} /> : <StatementDetail d={d} />}
    </>
  );
}
