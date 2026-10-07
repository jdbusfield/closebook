"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MONTH_ABBRS } from "@/lib/budget/format";
import { cn } from "@/lib/utils";

/**
 * "Export master list": the whole organization's budget for a year on one tab
 * (every reporting group's lines and items, plus Consolidated). The picker sets
 * how many of last year's months are closed (JD: Jan-Aug 2026).
 */
export function MasterExportButton({ fiscalYear, kind = "budget", size = "default", className }: { fiscalYear: number; kind?: string; size?: "default" | "sm"; className?: string }) {
  const [through, setThrough] = useState(8);
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Button variant="outline" size={size} asChild>
        <a href={`/api/budget/export/master?fiscalYear=${fiscalYear}&kind=${kind === "forecast" ? "forecast" : "budget"}&through=${through}`}>
          <Download className="mr-2 h-4 w-4" />
          Export master list
        </a>
      </Button>
      <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
        {fiscalYear - 1} closed through
        <select className={cn("rounded-md border bg-background px-2 text-sm text-foreground", size === "sm" ? "h-8" : "h-9")} value={through} onChange={(e) => setThrough(Number(e.target.value))}>
          {MONTH_ABBRS.map((m, i) => (
            <option key={m} value={i + 1}>{m}</option>
          ))}
        </select>
      </label>
    </div>
  );
}
