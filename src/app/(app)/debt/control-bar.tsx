"use client";

/**
 * Compact header bar for the debt dashboard.
 *
 *   Scope pill · Period pill · Export button
 *
 * Heavy controls (date pickers, scope choices) live in popovers so the
 * page header stays slim. Quick preset buttons (MTD / QTD / YTD / T12)
 * are inline in the period popover — they're the most common cadence
 * for investor/bank reporting.
 */

import {
  Building2,
  Calendar,
  ChevronDown,
  Download,
  Layers,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { EntityRef } from "@/lib/utils/debt-rollforward";
import type { ReportingEntity, Scope } from "./use-debt-dashboard-data";

export type PeriodPreset = "MTD" | "QTD" | "YTD" | "T12" | "CUSTOM";

interface Props {
  scope: Scope;
  onScopeChange: (s: Scope) => void;
  entityId: string | null;
  onEntityIdChange: (id: string | null) => void;
  reportingEntityId: string | null;
  onReportingEntityIdChange: (id: string | null) => void;
  entities: EntityRef[];
  reportingEntities: ReportingEntity[];
  asOfIso: string;
  onAsOfIsoChange: (d: string) => void;
  startIso: string;
  endIso: string;
  onStartIsoChange: (d: string) => void;
  onEndIsoChange: (d: string) => void;
  preset: PeriodPreset;
  onPresetChange: (p: PeriodPreset) => void;
  onExportClick: () => void;
  disableExport?: boolean;
}

export function ControlBar(props: Props) {
  const {
    scope,
    onScopeChange,
    entityId,
    onEntityIdChange,
    reportingEntityId,
    onReportingEntityIdChange,
    entities,
    reportingEntities,
    asOfIso,
    onAsOfIsoChange,
    startIso,
    endIso,
    onStartIsoChange,
    onEndIsoChange,
    preset,
    onPresetChange,
    onExportClick,
    disableExport,
  } = props;

  function applyPreset(p: PeriodPreset) {
    onPresetChange(p);
    if (p === "CUSTOM") return;
    const [y, m, d] = asOfIso.split("-").map(Number);
    const asOfDate = new Date(y, m - 1, d);
    let start: Date;
    const end = asOfDate;
    switch (p) {
      case "MTD":
        start = new Date(y, m - 1, 1);
        break;
      case "QTD": {
        const qStart = Math.floor((m - 1) / 3) * 3;
        start = new Date(y, qStart, 1);
        break;
      }
      case "YTD":
        start = new Date(y, 0, 1);
        break;
      case "T12":
        start = new Date(y - 1, m - 1, 1);
        break;
    }
    onStartIsoChange(formatIso(start));
    onEndIsoChange(formatIso(end));
  }

  const scopeLabel =
    scope === "organization"
      ? "All Entities"
      : scope === "reporting_entity"
        ? reportingEntities.find((r) => r.id === reportingEntityId)?.name ??
          "Pick Reporting Entity"
        : entities.find((e) => e.id === entityId)?.name ?? "Pick Entity";

  const ScopeIcon =
    scope === "organization"
      ? Building2
      : scope === "reporting_entity"
        ? Layers
        : Users;

  const periodLabel =
    preset !== "CUSTOM"
      ? `${preset} · ${shortDate(startIso)} – ${shortDate(endIso)}`
      : `${shortDate(startIso)} – ${shortDate(endIso)}`;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Scope pill */}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-9 gap-2">
            <ScopeIcon className="size-4" />
            <span className="font-medium">{scopeLabel}</span>
            <ChevronDown className="size-3.5 opacity-60" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[320px] space-y-3 p-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Scope
            </Label>
            <Select value={scope} onValueChange={(v) => onScopeChange(v as Scope)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="organization">
                  <span className="flex items-center gap-2">
                    <Building2 className="size-4" />
                    All Entities (Organization)
                  </span>
                </SelectItem>
                <SelectItem value="reporting_entity">
                  <span className="flex items-center gap-2">
                    <Layers className="size-4" />
                    Reporting Entity (group)
                  </span>
                </SelectItem>
                <SelectItem value="entity">
                  <span className="flex items-center gap-2">
                    <Users className="size-4" />
                    Single Entity
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          {scope === "reporting_entity" && (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Reporting Entity
              </Label>
              <Select
                value={reportingEntityId ?? ""}
                onValueChange={(v) => onReportingEntityIdChange(v || null)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select…" />
                </SelectTrigger>
                <SelectContent>
                  {reportingEntities.map((re) => (
                    <SelectItem key={re.id} value={re.id}>
                      {re.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {scope === "entity" && (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Entity
              </Label>
              <Select
                value={entityId ?? ""}
                onValueChange={(v) => onEntityIdChange(v || null)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select…" />
                </SelectTrigger>
                <SelectContent>
                  {entities.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </PopoverContent>
      </Popover>

      {/* Period pill */}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-9 gap-2">
            <Calendar className="size-4" />
            <span className="font-medium">{periodLabel}</span>
            <ChevronDown className="size-3.5 opacity-60" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[380px] space-y-3 p-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Presets
            </Label>
            <div className="grid grid-cols-4 gap-1.5">
              {(["MTD", "QTD", "YTD", "T12"] as const).map((p) => (
                <Button
                  key={p}
                  size="sm"
                  variant={preset === p ? "default" : "outline"}
                  onClick={() => applyPreset(p)}
                  className="h-8 text-xs"
                >
                  {p}
                </Button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                From
              </Label>
              <Input
                type="date"
                value={startIso}
                onChange={(e) => {
                  onStartIsoChange(e.target.value);
                  onPresetChange("CUSTOM");
                }}
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                To
              </Label>
              <Input
                type="date"
                value={endIso}
                onChange={(e) => {
                  onEndIsoChange(e.target.value);
                  onPresetChange("CUSTOM");
                }}
                className="h-9"
              />
            </div>
          </div>
          <div className="space-y-1.5 border-t pt-3">
            <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Snapshot date (As of)
            </Label>
            <Input
              type="date"
              value={asOfIso}
              onChange={(e) => onAsOfIsoChange(e.target.value)}
              className="h-9"
            />
            <p className="text-[11px] text-muted-foreground">
              Drives the Outstanding metric and trend sparkline.
            </p>
          </div>
        </PopoverContent>
      </Popover>

      <div className="ml-auto">
        <Button
          size="sm"
          onClick={onExportClick}
          disabled={disableExport}
          className={cn("h-9")}
        >
          <Download className="mr-2 size-4" />
          Export
        </Button>
      </div>
    </div>
  );
}

function formatIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
function shortDate(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${MONTHS_SHORT[m - 1]} ${d}`;
}
