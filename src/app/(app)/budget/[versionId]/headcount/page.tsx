"use client";

import { use } from "react";
import { Loader2 } from "lucide-react";
import { useBudgetVersion } from "../version-shell";
import { HeadcountWorkspace } from "../../headcount-workspace";

/** A version's read-only view of its share of the organization's shared payroll plan. */
export default function BudgetHeadcountPage({ params }: { params: Promise<{ versionId: string }> }) {
  const { versionId } = use(params);
  const { info, reload } = useBudgetVersion();
  if (!info) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading
      </div>
    );
  }
  return (
    <HeadcountWorkspace
      scope={{ kind: "version", versionId, fiscalYear: info.owner.fiscalYear }}
      readOnly
      ownerName={info.owner.ownerName}
      onChanged={() => reload()}
    />
  );
}
