"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { HeadcountWorkspace } from "../../headcount-workspace";

interface PlanInfo {
  plan: { id: string; organizationId: string; fiscalYear: number; status: string; revenueSharesAsOf: string | null };
  canEdit: boolean;
}

/**
 * The shared payroll plan for a fiscal year: every person from both
 * Paylocity companies once, tagged and allocated to entities. Each
 * reporting group's budget prices its share of these rows.
 */
export default function PayrollPlanPage({ params }: { params: Promise<{ year: string }> }) {
  const { year } = use(params);
  const fiscalYear = Number(year);
  const [info, setInfo] = useState<PlanInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/budget/payroll-plan?fiscalYear=${fiscalYear}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load the payroll plan");
      setInfo({ plan: data.plan, canEdit: !!data.canEdit });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load the payroll plan");
      toast.error(err instanceof Error ? err.message : "Failed to load the payroll plan");
    }
  }, [fiscalYear]);

  useEffect(() => {
    if (Number.isFinite(fiscalYear) && fiscalYear > 2000) load();
  }, [load, fiscalYear]);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!info) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading the payroll plan
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs text-muted-foreground">
            <Link href="/budget" className="hover:underline">Budget</Link> / Payroll plan
          </div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            Payroll plan {fiscalYear}
            <Badge variant="outline">{info.plan.status}</Badge>
          </h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Every person from both Paylocity companies, once. Tag each one, set the pay change for the year, and allocate them to a company by hand or by revenue. Each reporting group&apos;s budget prices its share of this list.
          </p>
        </div>
      </div>
      <HeadcountWorkspace
        scope={{ kind: "plan", planId: info.plan.id, fiscalYear }}
        readOnly={!info.canEdit}
        ownerName="the organization"
        onChanged={load}
      />
    </div>
  );
}
