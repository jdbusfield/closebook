"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Download, Printer, ChevronDown, Play } from "lucide-react";
import type { Granularity, StatementTab, VarianceDisplayMode } from "./types";

const TAB_LABELS: Record<StatementTab, string> = {
  "income-statement": "Income Statement",
  "balance-sheet": "Balance Sheet",
  "cash-flow": "Cash Flow",
  "pro-forma": "Pro Forma Adjustments",
  allocations: "Allocations",
  "fixed-asset-schedule": "Fixed-Asset Activity",
  "entity-breakdown": "Entity Breakdown",
  "re-breakdown": "RE Breakdown",
  bridge: "Bridge",
  all: "All Statements",
};

interface ConfigToolbarProps {
  startYear: number;
  startMonth: number;
  endYear: number;
  endMonth: number;
  granularity: Granularity;
  includeBudget: boolean;
  includeYoY: boolean;
  includeProForma?: boolean;
  showProFormaDetails?: boolean;
  attachProFormaToPrint?: boolean;
  includeAllocations?: boolean;
  includeFixedAssetSchedule?: boolean;
  ebitdaOnly?: boolean;
  includeTotal?: boolean;
  compareTotalOnly?: boolean;
  onStartYearChange: (year: number) => void;
  onStartMonthChange: (month: number) => void;
  onEndYearChange: (year: number) => void;
  onEndMonthChange: (month: number) => void;
  onGranularityChange: (granularity: Granularity) => void;
  onIncludeBudgetChange: (val: boolean) => void;
  onIncludeYoYChange: (val: boolean) => void;
  onIncludeProFormaChange?: (val: boolean) => void;
  onShowProFormaDetailsChange?: (val: boolean) => void;
  onAttachProFormaToPrintChange?: (val: boolean) => void;
  onIncludeAllocationsChange?: (val: boolean) => void;
  onIncludeFixedAssetScheduleChange?: (val: boolean) => void;
  onEbitdaOnlyChange?: (val: boolean) => void;
  onIncludeTotalChange?: (val: boolean) => void;
  onCompareTotalOnlyChange?: (val: boolean) => void;
  varianceDisplay?: VarianceDisplayMode;
  onVarianceDisplayChange?: (mode: VarianceDisplayMode) => void;
  onGenerate?: () => void;
  onExport: () => void;
  onExportAll?: () => void;
  onPrint: () => void;
  loading?: boolean;
  hasData?: boolean;
  activeTab?: StatementTab;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const YEARS = [
  2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026, 2027, 2028,
];

export function ConfigToolbar({
  startYear,
  startMonth,
  endYear,
  endMonth,
  granularity,
  includeBudget,
  includeYoY,
  includeProForma,
  showProFormaDetails,
  attachProFormaToPrint,
  includeAllocations,
  includeFixedAssetSchedule,
  ebitdaOnly,
  includeTotal,
  compareTotalOnly,
  onStartYearChange,
  onStartMonthChange,
  onEndYearChange,
  onEndMonthChange,
  onGranularityChange,
  onIncludeBudgetChange,
  onIncludeYoYChange,
  onIncludeProFormaChange,
  onShowProFormaDetailsChange,
  onAttachProFormaToPrintChange,
  onIncludeAllocationsChange,
  onIncludeFixedAssetScheduleChange,
  onEbitdaOnlyChange,
  onIncludeTotalChange,
  onCompareTotalOnlyChange,
  varianceDisplay = "dollars",
  onVarianceDisplayChange,
  onGenerate,
  onExport,
  onExportAll,
  onPrint,
  loading = false,
  hasData = false,
  activeTab,
}: ConfigToolbarProps) {
  const isIndividualTab = activeTab && activeTab !== "all";

  return (
    <div className="stmt-no-print flex flex-wrap items-end gap-3 pb-4 border-b">
      {/* Start Period */}
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">From</Label>
        <div className="flex gap-1">
          <Select
            value={String(startMonth)}
            onValueChange={(v) => onStartMonthChange(parseInt(v))}
          >
            <SelectTrigger className="w-[120px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MONTHS.map((m, i) => (
                <SelectItem key={i + 1} value={String(i + 1)}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={String(startYear)}
            onValueChange={(v) => onStartYearChange(parseInt(v))}
          >
            <SelectTrigger className="w-[80px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {YEARS.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* End Period */}
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">To</Label>
        <div className="flex gap-1">
          <Select
            value={String(endMonth)}
            onValueChange={(v) => onEndMonthChange(parseInt(v))}
          >
            <SelectTrigger className="w-[120px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MONTHS.map((m, i) => (
                <SelectItem key={i + 1} value={String(i + 1)}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={String(endYear)}
            onValueChange={(v) => onEndYearChange(parseInt(v))}
          >
            <SelectTrigger className="w-[80px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {YEARS.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Granularity */}
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">View</Label>
        <Select
          value={granularity}
          onValueChange={(v) => onGranularityChange(v as Granularity)}
        >
          <SelectTrigger className="w-[110px] h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="monthly">Monthly</SelectItem>
            <SelectItem value="quarterly">Quarterly</SelectItem>
            <SelectItem value="yearly">Yearly</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Separator */}
      <div className="h-8 w-px bg-border" />

      {/* Toggles */}
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-1.5 text-xs cursor-pointer">
          <Checkbox
            checked={includeYoY}
            onCheckedChange={(checked) => onIncludeYoYChange(checked === true)}
          />
          YoY Change
        </label>
        <label className="flex items-center gap-1.5 text-xs cursor-pointer">
          <Checkbox
            checked={includeBudget}
            onCheckedChange={(checked) =>
              onIncludeBudgetChange(checked === true)
            }
          />
          Budget
        </label>
        {onIncludeProFormaChange && (
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs cursor-pointer">
              <Checkbox
                checked={includeProForma ?? false}
                onCheckedChange={(checked) =>
                  onIncludeProFormaChange(checked === true)
                }
              />
              Pro Forma
            </label>
            {includeProForma && onShowProFormaDetailsChange && (
              <label className="flex items-center gap-1.5 text-xs cursor-pointer text-muted-foreground">
                <Checkbox
                  checked={showProFormaDetails ?? false}
                  onCheckedChange={(checked) =>
                    onShowProFormaDetailsChange(checked === true)
                  }
                />
                Show Details
              </label>
            )}
            {includeProForma && onAttachProFormaToPrintChange && (
              <label className="flex items-center gap-1.5 text-xs cursor-pointer text-muted-foreground">
                <Checkbox
                  checked={attachProFormaToPrint ?? false}
                  onCheckedChange={(checked) =>
                    onAttachProFormaToPrintChange(checked === true)
                  }
                />
                Attach to Print
              </label>
            )}
          </div>
        )}
        {onIncludeAllocationsChange && (
          <label className="flex items-center gap-1.5 text-xs cursor-pointer">
            <Checkbox
              checked={includeAllocations ?? false}
              onCheckedChange={(checked) =>
                onIncludeAllocationsChange(checked === true)
              }
            />
            Allocations
          </label>
        )}
        {onIncludeFixedAssetScheduleChange && (
          <label className="flex items-center gap-1.5 text-xs cursor-pointer">
            <Checkbox
              checked={includeFixedAssetSchedule ?? true}
              onCheckedChange={(checked) =>
                onIncludeFixedAssetScheduleChange(checked === true)
              }
            />
            Fixed-Asset Schedule
          </label>
        )}
        {onEbitdaOnlyChange && (
          <label className="flex items-center gap-1.5 text-xs cursor-pointer">
            <Checkbox
              checked={ebitdaOnly ?? false}
              onCheckedChange={(checked) =>
                onEbitdaOnlyChange(checked === true)
              }
            />
            EBITDA Only
          </label>
        )}
        {onIncludeTotalChange && (
          <label className="flex items-center gap-1.5 text-xs cursor-pointer">
            <Checkbox
              checked={includeTotal ?? false}
              onCheckedChange={(checked) =>
                onIncludeTotalChange(checked === true)
              }
            />
            Total
          </label>
        )}
        {onCompareTotalOnlyChange &&
          includeTotal &&
          (includeBudget || includeYoY) && (
            <label
              className="flex items-center gap-1.5 text-xs cursor-pointer text-muted-foreground"
              title="Show the Budget and Prior Year comparisons against the Total column only, instead of after every period"
            >
              <Checkbox
                checked={compareTotalOnly ?? false}
                onCheckedChange={(checked) =>
                  onCompareTotalOnlyChange(checked === true)
                }
              />
              Compare on Total only
            </label>
          )}
        {(includeBudget || includeYoY) && onVarianceDisplayChange && (
          <div className="flex items-center gap-1 ml-2">
            <Label className="text-xs text-muted-foreground mr-1">Variance:</Label>
            <div className="inline-flex rounded-md border border-input bg-muted p-0.5">
              <button
                type="button"
                className={`px-2 py-0.5 text-xs rounded-sm transition-colors ${
                  varianceDisplay === "dollars"
                    ? "bg-background shadow-sm font-medium"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => onVarianceDisplayChange("dollars")}
              >
                $
              </button>
              <button
                type="button"
                className={`px-2 py-0.5 text-xs rounded-sm transition-colors ${
                  varianceDisplay === "percentage"
                    ? "bg-background shadow-sm font-medium"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => onVarianceDisplayChange("percentage")}
              >
                %
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Separator */}
      <div className="h-8 w-px bg-border" />

      {/* Generate (manual mode only) */}
      {onGenerate && (
        <Button
          size="sm"
          onClick={onGenerate}
          disabled={loading}
          className="h-8 text-xs"
        >
          <Play className="h-3.5 w-3.5 mr-1" />
          {loading ? "Generating..." : "Generate"}
        </Button>
      )}

      {/* Separator */}
      {onGenerate && <div className="h-8 w-px bg-border" />}

      {/* Actions */}
      <div className="flex items-center gap-1">
        {isIndividualTab ? (
          /* Split button: main exports current tab, dropdown offers "Export All" */
          <div className="flex items-center">
            <Button
              variant="outline"
              size="sm"
              onClick={onExport}
              disabled={loading}
              className="h-8 text-xs rounded-r-none border-r-0"
            >
              <Download className="h-3.5 w-3.5 mr-1" />
              Export {TAB_LABELS[activeTab]}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={loading}
                  className="h-8 px-1.5 rounded-l-none"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={onExportAll}>
                  <Download className="h-3.5 w-3.5 mr-2" />
                  Export All Statements
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={onExport}
            disabled={loading}
            className="h-8 text-xs"
          >
            <Download className="h-3.5 w-3.5 mr-1" />
            Export
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={onPrint}
          disabled={loading}
          className="h-8 text-xs"
        >
          <Printer className="h-3.5 w-3.5 mr-1" />
          Print
        </Button>
      </div>
    </div>
  );
}
