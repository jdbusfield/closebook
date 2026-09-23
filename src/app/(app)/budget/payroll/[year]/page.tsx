"use client";

import { use, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { HeadcountWorkspace, type PlanInfo } from "../../headcount-workspace";

/**
 * The shared payroll plan for a fiscal year: every person from both
 * Paylocity companies once, tagged and allocated to entities. Each
 * reporting group's budget prices its share of these rows.
 *
 * The workspace loads the plan by year in one request; the plan itself
 * (status, who may edit) comes back with the rows, so nothing waits on a
 * separate lookup first.
 */
export default function PayrollPlanPage({ params }: { params: Promise<{ year: string }> }) {
  const { year } = use(params);
  const fiscalYear = Number(year);
  const [info, setInfo] = useState<{ plan: PlanInfo; canEdit: boolean } | null>(null);

  if (!Number.isFinite(fiscalYear) || fiscalYear <= 2000) return <p className="text-sm text-destructive">Not a valid year.</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs text-muted-foreground">
            <Link href="/budget" className="hover:underline">Budget</Link> / Payroll plan
          </div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            Payroll plan {fiscalYear}
            {info && <Badge variant="outline">{info.plan.status}</Badge>}
          </h1>
        </div>
      </div>
      <HeadcountWorkspace
        scope={{ kind: "plan", fiscalYear }}
        readOnly={!info?.canEdit}
        ownerName="the organization"
        onPlanLoaded={setInfo}
      />
    </div>
  );
}
