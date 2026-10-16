"use client";

/**
 * Function, location and class on budget items (docs/budget-dashboard-plan.md).
 * TagSummary shows where an item's tags come from; TagDialog edits them in the right place:
 * on the item, as a rule on its source (lease, run rate, schedule) or on the GL account.
 * Payroll is tagged per person in the payroll plan.
 */
import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export interface Split {
  key: string;
  pct: number;
}
export type TagOrigin = "item" | "person" | "source" | "account" | "none" | "mixed";
export type TagTarget =
  | { type: "item"; buildId: string }
  | { type: "people" }
  | { type: "source"; sourceTable: string; sourceId: string }
  | { type: "account"; masterAccountId: string };
export interface ItemTagsView {
  functions: Split[];
  locations: Split[];
  functionOrigin: TagOrigin;
  locationOrigin: TagOrigin;
  classNames: string[];
  target: TagTarget;
  ruleScope?: "group" | "organization" | null;
}
export interface TagOptions {
  functions: string[];
  locations: string[];
  classes: Array<{ id: string; name: string; entityId: string }>;
}

const ORIGIN_TEXT: Record<TagOrigin, string> = {
  item: "set on the item",
  person: "from the payroll plan",
  source: "from its source rule",
  account: "account default",
  none: "",
  mixed: "mixed sources",
};

const splitText = (s: Split[]) => (s.length === 0 ? "" : s.length === 1 ? s[0].key : s.map((x) => `${x.key} ${Math.round(x.pct)}%`).join(" / "));

/** One muted line under an item: Function · Location · Class, with Unassigned called out. */
export function TagSummary({ tags, onEdit }: { tags: ItemTagsView | undefined; onEdit?: () => void }) {
  if (!tags) return null;
  const fnUnset = tags.functions.length === 0 || (tags.functions.length === 1 && tags.functions[0].key === "Unassigned");
  const locUnset = tags.locations.length === 0 || (tags.locations.length === 1 && tags.locations[0].key === "Unassigned");
  const part = (label: string, value: string, unset: boolean, origin: TagOrigin) => (
    <span className={cn(unset && "text-amber-700 dark:text-amber-400")} title={origin !== "none" ? `${label}: ${ORIGIN_TEXT[origin]}` : `${label} not set`}>
      {unset ? `No ${label.toLowerCase()}` : value}
    </span>
  );
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
      {part("Function", splitText(tags.functions), fnUnset, tags.functionOrigin)}
      <span aria-hidden>·</span>
      {part("Location", splitText(tags.locations), locUnset, tags.locationOrigin)}
      {tags.classNames.length > 0 && (
        <>
          <span aria-hidden>·</span>
          <span title="QBO class">{tags.classNames.join(", ")}</span>
        </>
      )}
      {onEdit && (
        <button type="button" onClick={onEdit} className="ml-1 rounded px-1 underline-offset-2 hover:bg-muted hover:text-foreground hover:underline">
          Tags
        </button>
      )}
    </div>
  );
}

/** Rows of key + share; shares must add to 100. Empty = inherit. */
function SplitEditor({ id, label, options, value, onChange }: { id: string; label: string; options: string[]; value: Split[]; onChange: (v: Split[]) => void }) {
  const total = value.reduce((t, s) => t + (Number(s.pct) || 0), 0);
  const unused = options.filter((o) => !value.some((s) => s.key === o));
  const set = (i: number, patch: Partial<Split>) => onChange(value.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  return (
    <div className="space-y-2">
      <Label htmlFor={`${id}-0`}>{label}</Label>
      {value.length === 0 && <p className="text-xs text-muted-foreground">Not set here, so it follows the next rule down.</p>}
      {value.map((s, i) => (
        <div key={i} className="flex items-center gap-2">
          <Select value={s.key} onValueChange={(k) => set(i, { key: k })}>
            <SelectTrigger id={`${id}-${i}`} className="h-8 flex-1">
              <SelectValue placeholder="Pick one" />
            </SelectTrigger>
            <SelectContent>
              {[s.key, ...unused].filter(Boolean).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1">
            <Input aria-label={`${label} share`} inputMode="decimal" className="h-8 w-20 text-right tabular-nums" value={String(s.pct)} onChange={(e) => set(i, { pct: Number(e.target.value.replace(/[^0-9.]/g, "")) || 0 })} />
            <span className="text-sm text-muted-foreground">%</span>
          </div>
          <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0" aria-label={`Remove ${s.key || "row"}`} onClick={() => onChange(value.filter((_, j) => j !== i))}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <div className="flex items-center justify-between">
        <Button type="button" variant="outline" size="sm" className="h-7 text-xs" disabled={unused.length === 0}
          onClick={() => onChange([...value, { key: unused[0] ?? "", pct: value.length === 0 ? 100 : Math.max(0, 100 - total) }])}>
          <Plus className="mr-1 h-3 w-3" /> {value.length === 0 ? `Set ${label.toLowerCase()}` : "Add a split"}
        </Button>
        {value.length > 0 && <span className={cn("text-xs tabular-nums", Math.abs(total - 100) > 0.5 ? "text-destructive" : "text-muted-foreground")}>{total}% of 100%</span>}
      </div>
    </div>
  );
}

export interface TagDialogProps {
  title: string;
  target: TagTarget;
  /** What the item resolves to now, to start the editor from */
  current: { functions: Split[]; locations: Split[]; classId?: string | null };
  /** Whether the current tags were set at this target (else the editor starts empty = inherit) */
  ownAtTarget: boolean;
  /** Where the rule being edited lives; saves go back to the same scope */
  initialScope?: "group" | "organization";
  options: TagOptions;
  organizationId: string | null;
  reportingEntityId: string | null;
  groupName: string;
  versionId: string;
  fiscalYear: number;
  onClose: () => void;
  onSaved: () => Promise<void>;
}

export function TagDialog(p: TagDialogProps) {
  const start = (s: Split[]) => (p.ownAtTarget ? s.filter((x) => x.key !== "Unassigned") : []);
  const [fns, setFns] = useState<Split[]>(start(p.current.functions));
  const [locs, setLocs] = useState<Split[]>(start(p.current.locations));
  const [classId, setClassId] = useState<string>(p.current.classId ?? "");
  const [scope, setScope] = useState<"group" | "organization">(p.initialScope ?? "group");
  const [saving, setSaving] = useState(false);
  const target = p.target;

  const bad = (s: Split[]) => s.length > 0 && (s.some((x) => !x.key || !(x.pct > 0)) || Math.abs(s.reduce((t, x) => t + x.pct, 0) - 100) > 0.5);
  const save = async () => {
    if (bad(fns) || bad(locs)) {
      toast.error("Each split needs a pick and shares that add to 100%");
      return;
    }
    setSaving(true);
    try {
      let res: Response;
      if (target.type === "item") {
        res = await fetch("/api/budget/builds", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: target.buildId, functionAllocations: fns.length ? fns : null, locationAllocations: locs.length ? locs : null, classId: classId || null }),
        });
      } else {
        res = await fetch("/api/budget/tag-rules", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            organizationId: p.organizationId,
            reportingEntityId: scope === "group" ? p.reportingEntityId : null,
            ...(target.type === "account" ? { masterAccountId: target.masterAccountId } : target.type === "source" ? { sourceTable: target.sourceTable, sourceId: target.sourceId } : {}),
            functionAllocations: fns.length ? fns : null,
            locationAllocations: locs.length ? locs : null,
          }),
        });
      }
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Could not save the tags");
      toast.success("Tags saved");
      await p.onSaved();
      p.onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the tags");
    } finally {
      setSaving(false);
    }
  };

  const where = target.type === "item"
    ? "These tags belong to this item."
    : target.type === "account"
      ? "The default for this GL account: every item on it that has no tags of its own follows it."
      : target.type === "source"
        ? "A rule on this item's source, so it holds when the budget is recomputed."
        : "";

  return (
    <Dialog open onOpenChange={(o) => !o && p.onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Tags: {p.title}</DialogTitle>
          <DialogDescription>{target.type === "people" ? "Payroll is tagged person by person." : where}</DialogDescription>
        </DialogHeader>
        {target.type === "people" ? (
          <p className="text-sm">
            Set Function and Location on each person in the{" "}
            <Link href={`/budget/payroll/${p.fiscalYear}`} className="underline underline-offset-2">payroll plan</Link>. This item adds up their shares.
          </p>
        ) : (
          <div className="space-y-5">
            {target.type !== "item" && (
              <div className="space-y-2">
                <Label>Applies to</Label>
                <div className="inline-flex overflow-hidden rounded-md border" role="group" aria-label="Applies to">
                  {(["group", "organization"] as const).map((s) => (
                    <button key={s} type="button" aria-pressed={scope === s} onClick={() => setScope(s)}
                      className={cn("px-3 py-1.5 text-sm", scope === s ? "bg-muted font-medium" : "text-muted-foreground")}>
                      {s === "group" ? `${p.groupName} only` : "Every company"}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <SplitEditor id="tag-fn" label="Function" options={p.options.functions} value={fns} onChange={setFns} />
            <SplitEditor id="tag-loc" label="Location" options={p.options.locations} value={locs} onChange={setLocs} />
            {target.type === "item" && (
              <div className="space-y-2">
                <Label htmlFor="tag-class">Class</Label>
                <Select value={classId || "none"} onValueChange={(v) => setClassId(v === "none" ? "" : v)}>
                  <SelectTrigger id="tag-class" className="h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No class</SelectItem>
                    {p.options.classes.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={p.onClose}>{target.type === "people" ? "Close" : "Cancel"}</Button>
          {target.type !== "people" && (
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save tags
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
