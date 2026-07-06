"use client";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, Trash2 } from "lucide-react";

// --- Types & helpers ---

/** Editable class split row (pct kept as string while typing). */
export interface ClassSplitDraft {
  className: string;
  pct: string;
}

export interface ClassAllocationEntry {
  class: string;
  pct: number;
}

/** Build editor drafts from a stored allocation row (splits or legacy single class). */
export function draftsFromAllocation(
  classAllocations?: ClassAllocationEntry[] | null,
  legacyClass?: string | null
): ClassSplitDraft[] {
  if (Array.isArray(classAllocations) && classAllocations.length > 0) {
    return classAllocations.map((s) => ({
      className: s.class ?? "",
      pct: String(s.pct ?? ""),
    }));
  }
  if (legacyClass && legacyClass.trim() !== "") {
    return [{ className: legacyClass.trim(), pct: "100" }];
  }
  return [];
}

/** Convert drafts to the API payload. Returns null when no valid splits. */
export function draftsToPayload(drafts: ClassSplitDraft[]): ClassAllocationEntry[] | null {
  const valid = drafts
    .map((d) => ({ class: d.className.trim(), pct: Number(d.pct) }))
    .filter((d) => d.class !== "" && Number.isFinite(d.pct) && d.pct > 0);
  return valid.length > 0 ? valid : null;
}

export function draftsSum(drafts: ClassSplitDraft[]): number {
  return drafts.reduce((s, d) => {
    const n = Number(d.pct);
    return s + (Number.isFinite(n) ? n : 0);
  }, 0);
}

/** Drafts are saveable when empty (clears the class) or when pcts sum to 100. */
export function draftsValid(drafts: ClassSplitDraft[]): boolean {
  const payload = draftsToPayload(drafts);
  if (!payload) return drafts.every((d) => d.className.trim() === "");
  return Math.abs(draftsSum(drafts) - 100) <= 0.1;
}

/** Compact display, e.g. "Admin 60% / Ops 40%" or "Admin". */
export function formatClassSplits(
  classAllocations?: ClassAllocationEntry[] | null,
  legacyClass?: string | null
): string {
  if (Array.isArray(classAllocations) && classAllocations.length > 0) {
    if (classAllocations.length === 1) return classAllocations[0].class;
    return classAllocations
      .map((s) => `${s.class} ${Math.round(s.pct * 10) / 10}%`)
      .join(" / ");
  }
  return legacyClass?.trim() || "";
}

// --- Editor ---

export function ClassSplitsEditor({
  drafts,
  onChange,
  disabled,
  compact,
}: {
  drafts: ClassSplitDraft[];
  onChange: (next: ClassSplitDraft[]) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const sum = draftsSum(drafts);
  const hasRows = drafts.length > 0;
  const sumOk = !hasRows || Math.abs(sum - 100) <= 0.1;

  const update = (idx: number, field: keyof ClassSplitDraft, value: string) => {
    const next = [...drafts];
    next[idx] = { ...next[idx], [field]: value };
    onChange(next);
  };

  return (
    <div className={compact ? "space-y-1" : "space-y-2"}>
      {drafts.map((d, idx) => (
        <div key={idx} className="flex items-center gap-1.5">
          <Input
            value={d.className}
            onChange={(e) => update(idx, "className", e.target.value)}
            placeholder="Class"
            className={compact ? "h-7 text-xs flex-1 min-w-[90px]" : "h-8 text-sm flex-1"}
            disabled={disabled}
          />
          <Input
            value={d.pct}
            onChange={(e) => update(idx, "pct", e.target.value)}
            placeholder="%"
            inputMode="decimal"
            className={`text-right ${compact ? "h-7 text-xs w-[52px]" : "h-8 text-sm w-[64px]"}`}
            disabled={disabled}
          />
          <span className="text-xs text-muted-foreground">%</span>
          <Button
            variant="ghost"
            size="icon"
            className={compact ? "h-6 w-6" : "h-7 w-7"}
            onClick={() => onChange(drafts.filter((_, i) => i !== idx))}
            disabled={disabled}
            title="Remove class"
          >
            <Trash2 className="h-3 w-3 text-destructive" />
          </Button>
        </div>
      ))}
      <div className="flex items-center justify-between gap-2">
        <Button
          variant="outline"
          size="sm"
          className={`gap-1 ${compact ? "h-6 px-2 text-[11px]" : "h-7 text-xs"}`}
          onClick={() => onChange([...drafts, { className: "", pct: drafts.length === 0 ? "100" : "" }])}
          disabled={disabled}
        >
          <Plus className="h-3 w-3" />
          Add class
        </Button>
        {hasRows && (
          <span
            className={`text-[11px] font-mono ${sumOk ? "text-green-600 dark:text-green-400" : "text-destructive"}`}
          >
            {Math.round(sum * 100) / 100}% {sumOk ? "" : "(must equal 100%)"}
          </span>
        )}
      </div>
    </div>
  );
}
