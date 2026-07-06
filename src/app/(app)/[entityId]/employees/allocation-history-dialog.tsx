"use client";

import { useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Plus, Trash2, Save } from "lucide-react";
import {
  ClassSplitsEditor,
  draftsFromAllocation,
  draftsToPayload,
  draftsValid,
  formatClassSplits,
  EntitySplitsEditor,
  entityDraftsFromAllocation,
  entityDraftsToPayload,
  entityDraftsValid,
  formatEntitySplits,
  type ClassAllocationEntry,
  type ClassSplitDraft,
  type EntityAllocationEntry,
  type EntitySplitDraft,
} from "./class-splits-editor";

// --- Types ---

export interface AllocationPeriod {
  employee_id: string;
  paylocity_company_id: string;
  effective_date: string; // "YYYY-MM-DD"
  department: string | null;
  class: string | null;
  class_allocations?: ClassAllocationEntry[] | null;
  entity_allocations?: EntityAllocationEntry[] | null;
  allocated_entity_id: string | null;
  allocated_entity_name: string | null;
}

interface EntityOption {
  id: string;
  code: string;
  name: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employeeName: string;
  employeeId: string;
  companyId: string;
  /** All allocation periods for this employee (sorted by effective_date ASC) */
  periods: AllocationPeriod[];
  /** Available operating entities for the Company dropdown */
  entities: EntityOption[];
  /** Default department from cost center config */
  defaultDepartment: string;
  /** Default entity from cost center config */
  defaultEntityId: string;
  defaultEntityName: string;
  /** Called after any save/delete so the parent can refresh */
  onChanged: () => void;
}

interface DraftRow {
  effectiveDate: string;
  entityDrafts: EntitySplitDraft[];
  department: string;
  classDrafts: ClassSplitDraft[];
  isNew: boolean;
  saving: boolean;
}

function formatDate(d: string): string {
  if (d === "2000-01-01") return "Initial";
  const [y, m, day] = d.split("-");
  return `${Number(m)}/${Number(day)}/${y}`;
}

export function AllocationHistoryDialog({
  open,
  onOpenChange,
  employeeName,
  employeeId,
  companyId,
  periods,
  entities,
  defaultDepartment,
  defaultEntityId,
  defaultEntityName,
  onChanged,
}: Props) {
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [deleting, setDeleting] = useState<string | null>(null);

  // Initialize a new draft row, carrying forward the latest period's values
  const addDraft = useCallback(() => {
    const today = new Date().toISOString().slice(0, 10);
    const latest = periods[periods.length - 1];
    setDrafts((prev) => [
      ...prev,
      {
        effectiveDate: today,
        entityDrafts: entityDraftsFromAllocation(
          latest?.entity_allocations,
          latest?.allocated_entity_id ?? defaultEntityId
        ),
        department: latest?.department ?? defaultDepartment,
        classDrafts: draftsFromAllocation(latest?.class_allocations, latest?.class),
        isNew: true,
        saving: false,
      },
    ]);
  }, [periods, defaultDepartment, defaultEntityId]);

  const updateDraft = useCallback(
    (idx: number, field: "effectiveDate" | "department", value: string) => {
      setDrafts((prev) => {
        const next = [...prev];
        next[idx] = { ...next[idx], [field]: value };
        return next;
      });
    },
    []
  );

  const updateDraftEntities = useCallback((idx: number, entityDrafts: EntitySplitDraft[]) => {
    setDrafts((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], entityDrafts };
      return next;
    });
  }, []);

  const updateDraftClass = useCallback((idx: number, classDrafts: ClassSplitDraft[]) => {
    setDrafts((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], classDrafts };
      return next;
    });
  }, []);

  const saveDraft = useCallback(
    async (idx: number) => {
      const draft = drafts[idx];
      setDrafts((prev) => {
        const next = [...prev];
        next[idx] = { ...next[idx], saving: true };
        return next;
      });

      try {
        const res = await fetch("/api/paylocity/allocations", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            employeeId,
            paylocityCompanyId: companyId,
            effectiveDate: draft.effectiveDate,
            department: draft.department || null,
            class: null, // derived by the API from classAllocations
            classAllocations: draftsToPayload(draft.classDrafts),
            // API syncs allocated_entity_id/_name to the largest split
            entityAllocations: entityDraftsToPayload(draft.entityDrafts, entities),
          }),
        });
        if (!res.ok) throw new Error("Failed to save");

        // Remove the draft and notify parent
        setDrafts((prev) => prev.filter((_, i) => i !== idx));
        onChanged();
      } catch {
        setDrafts((prev) => {
          const next = [...prev];
          next[idx] = { ...next[idx], saving: false };
          return next;
        });
      }
    },
    [drafts, employeeId, companyId, entities, onChanged]
  );

  const deletePeriod = useCallback(
    async (effectiveDate: string) => {
      setDeleting(effectiveDate);
      try {
        const res = await fetch("/api/paylocity/allocations", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            employeeId,
            paylocityCompanyId: companyId,
            effectiveDate,
          }),
        });
        if (!res.ok) {
          const data = await res.json();
          alert(data.error || "Failed to delete");
          return;
        }
        onChanged();
      } finally {
        setDeleting(null);
      }
    },
    [employeeId, companyId, onChanged]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Allocation History</DialogTitle>
          <DialogDescription>{employeeName}</DialogDescription>
        </DialogHeader>

        <div className="overflow-x-auto rounded-md border mt-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[120px]">Effective Date</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Class</TableHead>
                <TableHead className="w-[80px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {/* Existing periods */}
              {periods.map((p) => {
                const entityMatch = entities.find(
                  (e) => e.id === p.allocated_entity_id
                );
                const singleLabel = entityMatch
                  ? `${entityMatch.code} — ${entityMatch.name}`
                  : p.allocated_entity_name || "—";
                const companyLabel =
                  (p.entity_allocations?.length ?? 0) > 1
                    ? formatEntitySplits(p.entity_allocations, null, entities)
                    : singleLabel;
                return (
                  <TableRow key={p.effective_date}>
                    <TableCell className="font-mono text-sm">
                      {formatDate(p.effective_date)}
                    </TableCell>
                    <TableCell className="text-sm">{companyLabel}</TableCell>
                    <TableCell className="text-sm">
                      {p.department || "—"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {formatClassSplits(p.class_allocations, p.class) || "—"}
                    </TableCell>
                    <TableCell>
                      {p.effective_date !== "2000-01-01" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          disabled={deleting === p.effective_date}
                          onClick={() => deletePeriod(p.effective_date)}
                        >
                          {deleting === p.effective_date ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          )}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}

              {/* Draft rows */}
              {drafts.map((d, idx) => (
                <TableRow
                  key={`draft-${idx}`}
                  className="bg-blue-50/50 dark:bg-blue-950/20"
                >
                  <TableCell>
                    <input
                      type="date"
                      value={d.effectiveDate}
                      onChange={(e) =>
                        updateDraft(idx, "effectiveDate", e.target.value)
                      }
                      className="h-7 text-xs border rounded px-1.5 bg-background"
                      disabled={d.saving}
                    />
                  </TableCell>
                  <TableCell className="min-w-[240px]">
                    <EntitySplitsEditor
                      drafts={d.entityDrafts}
                      onChange={(next) => updateDraftEntities(idx, next)}
                      entities={entities}
                      disabled={d.saving}
                      compact
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      value={d.department}
                      onChange={(e) =>
                        updateDraft(idx, "department", e.target.value)
                      }
                      className="h-7 text-xs w-[140px]"
                      placeholder="Department"
                      disabled={d.saving}
                    />
                  </TableCell>
                  <TableCell className="min-w-[220px]">
                    <ClassSplitsEditor
                      drafts={d.classDrafts}
                      onChange={(next) => updateDraftClass(idx, next)}
                      disabled={d.saving}
                      compact
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => saveDraft(idx)}
                      disabled={
                        d.saving ||
                        !d.effectiveDate ||
                        !draftsValid(d.classDrafts) ||
                        !entityDraftsValid(d.entityDrafts)
                      }
                    >
                      {d.saving ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Save className="h-3.5 w-3.5 text-primary" />
                      )}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}

              {/* Empty state */}
              {periods.length === 0 && drafts.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="text-center text-muted-foreground py-6"
                  >
                    No allocation overrides set. Using default cost center
                    mapping.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <div className="flex justify-between items-center mt-3">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={addDraft}
          >
            <Plus className="h-3.5 w-3.5" />
            Add Period
          </Button>
          <p className="text-xs text-muted-foreground">
            Each period takes effect on its date and remains active until the
            next period begins.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
