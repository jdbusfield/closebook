"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Loader2, Lock, Star } from "lucide-react";
import { cn } from "@/lib/utils";

export interface VersionInfo {
  version: {
    id: string;
    name: string;
    fiscal_year: number;
    kind: string;
    status: string;
    is_active: boolean;
    locked_at: string | null;
    approved_at: string | null;
    notes: string | null;
    forecast_through_month: number | null;
  };
  owner: {
    id: string;
    organizationId: string | null;
    entityId: string | null;
    reportingEntityId: string | null;
    fiscalYear: number;
    kind: string;
    lockedAt: string | null;
    chartId: string | null;
    ownerName: string;
    ownerCode: string;
  };
  memberEntities: Array<{ id: string; name: string; code: string }>;
  counts: { headcount: number; builds: number; lines: number; assumptions: number };
  canEdit: boolean;
}

interface Ctx {
  info: VersionInfo | null;
  reload: () => Promise<void>;
  readOnly: boolean;
}

const VersionContext = createContext<Ctx>({ info: null, reload: async () => {}, readOnly: true });

export function useBudgetVersion(): Ctx {
  return useContext(VersionContext);
}

const TABS = [
  { key: "", label: "Overview" },
  { key: "assumptions", label: "Assumptions" },
  { key: "headcount", label: "Headcount" },
  { key: "drivers", label: "Drivers" },
  { key: "lines", label: "Model" },
  { key: "review", label: "Review" },
];

export function VersionShell({ versionId, children }: { versionId: string; children: ReactNode }) {
  const pathname = usePathname();
  const [info, setInfo] = useState<VersionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const res = await fetch(`/api/budget/versions/${versionId}`);
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Could not load version");
      return;
    }
    setInfo(data);
    setError(null);
  }, [versionId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- state is set after the fetch resolves
    reload();
  }, [reload]);

  const base = `/budget/${versionId}`;
  const current = pathname.replace(base, "").replace(/^\//, "").split("/")[0] ?? "";
  const readOnly = !info?.canEdit || !!info?.version.locked_at;

  return (
    <VersionContext.Provider value={{ info, reload, readOnly }}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs text-muted-foreground">
              <Link href="/budget" className="hover:underline">
                Budget
              </Link>{" "}
              / {info?.owner.ownerName ?? "..."}
            </div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
              {info ? info.version.name : <Loader2 className="h-5 w-5 animate-spin" />}
              {info?.version.is_active && <Star className="h-4 w-4 fill-amber-400 text-amber-500" aria-label="Active" />}
              {info?.version.locked_at && <Lock className="h-4 w-4 text-muted-foreground" aria-label="Locked" />}
            </h1>
            {info && (
              <p className="text-sm text-muted-foreground">
                {info.owner.ownerName} ({info.memberEntities.map((e) => e.code).join(", ")}) · Fiscal year {info.version.fiscal_year} ·{" "}
                <span className="capitalize">{info.version.kind}</span>
                {info.version.locked_at && " · approved and locked"}
              </p>
            )}
          </div>
          {info && (
            <div className="flex items-center gap-2">
              <Badge variant={info.version.status === "approved" ? "default" : "secondary"}>{info.version.status}</Badge>
              {readOnly && !info.version.locked_at && <Badge variant="outline">Read only</Badge>}
            </div>
          )}
        </div>

        <nav className="flex gap-1 overflow-x-auto border-b">
          {TABS.map((t) => {
            const active = current === t.key;
            return (
              <Link
                key={t.key || "overview"}
                href={t.key ? `${base}/${t.key}` : base}
                className={cn(
                  "whitespace-nowrap border-b-2 px-3 py-2 text-sm",
                  active ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
              </Link>
            );
          })}
        </nav>

        {error && <p className="text-sm text-destructive">{error}</p>}
        {children}
      </div>
    </VersionContext.Provider>
  );
}
