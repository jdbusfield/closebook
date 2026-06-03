"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Star,
  Trash2,
  Plus,
  FileDown,
  Bookmark,
  Pencil,
  GripVertical,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  DYNAMIC_PRESET_LABELS,
  resolveDynamicPeriod,
  type DynamicPreset,
} from "@/lib/financial-model-templates/period-resolver";

export type FinancialModelTab =
  | "all"
  | "income-statement"
  | "balance-sheet"
  | "cash-flow"
  | "pro-forma"
  | "allocations"
  | "fixed-asset-schedule"
  | "entity-breakdown"
  | "re-breakdown"
  | "bridge";

const TAB_LABELS: Record<FinancialModelTab, string> = {
  all: "All Statements",
  "income-statement": "Income Statement",
  "balance-sheet": "Balance Sheet",
  "cash-flow": "Cash Flow",
  "pro-forma": "Pro Forma Adjustments",
  allocations: "Allocations",
  "fixed-asset-schedule": "Fixed-Asset Activity",
  "entity-breakdown": "Entity Breakdown",
  "re-breakdown": "RE Breakdown",
  bridge: "Bridge",
};

// Mirror of the API's FinancialModelTemplate shape (client-side copy so this
// component does not need to import a route file).
export interface FinancialModelTemplate {
  id: string;
  name: string;
  isFavorite: boolean;
  scope: "organization" | "entity" | "reporting_entity";
  entityId: string | null;
  reportingEntityId: string | null;
  chartId: string | null;
  periodMode: "static" | "dynamic" | "hybrid";
  startYear: number | null;
  startMonth: number | null;
  endYear: number | null;
  endMonth: number | null;
  dynamicPreset: DynamicPreset | null;
  granularity: "monthly" | "quarterly" | "yearly";
  includeBudget: boolean;
  includeYoY: boolean;
  includeProForma: boolean;
  includeAllocations: boolean;
  includeTotal: boolean;
  ebitdaOnly: boolean;
  varianceDisplay: "dollars" | "percentage";
  includeIncomeStatement: boolean;
  includeBalanceSheet: boolean;
  includeCashFlow: boolean;
  includeProFormaSchedule: boolean;
  activeTab: FinancialModelTab;
  displayOrder: number;
}

export interface CurrentConfigSnapshot {
  scope: "organization" | "entity" | "reporting_entity";
  entityId: string | null;
  reportingEntityId: string | null;
  chartId: string | null;
  startYear: number;
  startMonth: number;
  endYear: number;
  endMonth: number;
  granularity: "monthly" | "quarterly" | "yearly";
  includeBudget: boolean;
  includeYoY: boolean;
  includeProForma: boolean;
  includeAllocations: boolean;
  includeTotal: boolean;
  ebitdaOnly: boolean;
  varianceDisplay: "dollars" | "percentage";
  activeTab: FinancialModelTab;
}

interface TemplatesMenuProps {
  organizationId: string | null;
  current: CurrentConfigSnapshot;
  onLoadTemplate: (t: FinancialModelTemplate) => void;
}

const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function TemplatesMenu({
  organizationId,
  current,
  onLoadTemplate,
}: TemplatesMenuProps) {
  const [templates, setTemplates] = useState<FinancialModelTemplate[]>([]);
  const [loading, setLoading] = useState(false);

  // Save dialog state
  const [saveOpen, setSaveOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftPeriodMode, setDraftPeriodMode] = useState<
    "static" | "dynamic" | "hybrid"
  >("static");
  const [draftPreset, setDraftPreset] = useState<DynamicPreset>("last_month");
  const [draftIncludeIS, setDraftIncludeIS] = useState(true);
  const [draftIncludeBS, setDraftIncludeBS] = useState(true);
  const [draftIncludeCF, setDraftIncludeCF] = useState(true);
  const [draftIncludePFS, setDraftIncludePFS] = useState(false);
  const [draftFavorite, setDraftFavorite] = useState(false);

  const reload = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/financial-model-templates?organizationId=${organizationId}`
      );
      if (res.ok) {
        const data = await res.json();
        setTemplates(data.templates ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    reload();
  }, [reload]);

  function openSaveDialog() {
    setEditingId(null);
    setDraftName("");
    setDraftPeriodMode("static");
    setDraftPreset("last_month");
    setDraftIncludeIS(true);
    setDraftIncludeBS(true);
    setDraftIncludeCF(true);
    setDraftIncludePFS(current.includeProForma);
    setDraftFavorite(false);
    setSaveOpen(true);
  }

  function openEditDialog(t: FinancialModelTemplate) {
    setEditingId(t.id);
    setDraftName(t.name);
    setDraftPeriodMode(t.periodMode);
    setDraftPreset((t.dynamicPreset as DynamicPreset) ?? "last_month");
    setDraftIncludeIS(t.includeIncomeStatement);
    setDraftIncludeBS(t.includeBalanceSheet);
    setDraftIncludeCF(t.includeCashFlow);
    setDraftIncludePFS(t.includeProFormaSchedule);
    setDraftFavorite(t.isFavorite);
    setSaveOpen(true);
  }

  async function handleSave() {
    if (!organizationId || !draftName.trim()) {
      toast.error("Template name is required");
      return;
    }

    const body = {
      name: draftName.trim(),
      isFavorite: draftFavorite,
      scope: current.scope,
      entityId: current.entityId,
      reportingEntityId: current.reportingEntityId,
      chartId: current.chartId,
      periodMode: draftPeriodMode,
      startYear:
        draftPeriodMode === "static" || draftPeriodMode === "hybrid"
          ? current.startYear
          : null,
      startMonth:
        draftPeriodMode === "static" || draftPeriodMode === "hybrid"
          ? current.startMonth
          : null,
      endYear: draftPeriodMode === "static" ? current.endYear : null,
      endMonth: draftPeriodMode === "static" ? current.endMonth : null,
      dynamicPreset:
        draftPeriodMode === "dynamic" || draftPeriodMode === "hybrid"
          ? draftPreset
          : null,
      granularity: current.granularity,
      includeBudget: current.includeBudget,
      includeYoY: current.includeYoY,
      includeProForma: current.includeProForma,
      includeAllocations: current.includeAllocations,
      includeTotal: current.includeTotal,
      ebitdaOnly: current.ebitdaOnly,
      varianceDisplay: current.varianceDisplay,
      includeIncomeStatement: draftIncludeIS,
      includeBalanceSheet: draftIncludeBS,
      includeCashFlow: draftIncludeCF,
      includeProFormaSchedule: draftIncludePFS,
      activeTab: current.activeTab,
    };

    try {
      const res = editingId
        ? await fetch("/api/financial-model-templates", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ templateId: editingId, template: body }),
          })
        : await fetch("/api/financial-model-templates", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ organizationId, template: body }),
          });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Failed to save template");
      }
      toast.success(editingId ? "Template updated" : "Template saved");
      setSaveOpen(false);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    }
  }

  async function toggleFavorite(t: FinancialModelTemplate) {
    const res = await fetch("/api/financial-model-templates", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        templateId: t.id,
        template: { isFavorite: !t.isFavorite },
      }),
    });
    if (res.ok) {
      await reload();
    } else {
      toast.error("Failed to update favorite");
    }
  }

  async function handleDelete(t: FinancialModelTemplate) {
    if (!confirm(`Delete template "${t.name}"?`)) return;
    const res = await fetch(
      `/api/financial-model-templates?templateId=${t.id}`,
      { method: "DELETE" }
    );
    if (res.ok) {
      toast.success("Template deleted");
      await reload();
    } else {
      toast.error("Failed to delete");
    }
  }

  // ---- Export builder state ----
  // The export dialog now lets the user assemble a sequence containing
  // both templates and user-defined separator/title pages. Drag-to-reorder
  // moves items within the sequence.
  type SequenceItem =
    | { kind: "template"; key: string; id: string }
    | {
        kind: "separator";
        key: string;
        title: string;
        subtitle?: string;
      };

  const [exportOpen, setExportOpen] = useState(false);
  const [sequence, setSequence] = useState<SequenceItem[]>([]);
  const [seqDragKey, setSeqDragKey] = useState<string | null>(null);
  const [seqDragOverKey, setSeqDragOverKey] = useState<string | null>(null);

  function genKey(prefix: string) {
    return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function openExportDialog() {
    const favs = templates.filter((t) => t.isFavorite);
    const initial = (favs.length > 0 ? favs : templates).map((t) => ({
      kind: "template" as const,
      key: genKey("t"),
      id: t.id,
    }));
    setSequence(initial);
    setExportOpen(true);
  }

  function applyPreset(preset: "all" | "favorites" | "none") {
    if (preset === "none") {
      setSequence([]);
      return;
    }
    const src =
      preset === "favorites"
        ? templates.filter((t) => t.isFavorite)
        : templates;
    setSequence(
      src.map((t) => ({
        kind: "template" as const,
        key: genKey("t"),
        id: t.id,
      }))
    );
  }

  function addTemplateToSequence(id: string) {
    setSequence((prev) => [
      ...prev,
      { kind: "template", key: genKey("t"), id },
    ]);
  }

  function addSeparatorAt(index?: number) {
    const sep: SequenceItem = {
      kind: "separator",
      key: genKey("sep"),
      title: "Section title",
      subtitle: "",
    };
    setSequence((prev) => {
      if (index === undefined || index >= prev.length) return [...prev, sep];
      const next = prev.slice();
      next.splice(index, 0, sep);
      return next;
    });
  }

  function removeFromSequence(key: string) {
    setSequence((prev) => prev.filter((i) => i.key !== key));
  }

  function updateSeparator(
    key: string,
    field: "title" | "subtitle",
    value: string
  ) {
    setSequence((prev) =>
      prev.map((i) =>
        i.key === key && i.kind === "separator"
          ? { ...i, [field]: value }
          : i
      )
    );
  }

  function handleSeqDrop(targetKey: string) {
    if (!seqDragKey || seqDragKey === targetKey) {
      setSeqDragKey(null);
      setSeqDragOverKey(null);
      return;
    }
    setSequence((prev) => {
      const fromIdx = prev.findIndex((i) => i.key === seqDragKey);
      const toIdx = prev.findIndex((i) => i.key === targetKey);
      if (fromIdx < 0 || toIdx < 0) return prev;
      const next = prev.slice();
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
    setSeqDragKey(null);
    setSeqDragOverKey(null);
  }

  function handleRunExport() {
    if (!organizationId || sequence.length === 0) {
      toast.error("Add at least one template or page");
      return;
    }
    const usedTemplates = sequence.filter(
      (i) => i.kind === "template"
    ).length;
    if (usedTemplates === 0) {
      toast.error("Add at least one template");
      return;
    }
    const encoded = btoa(JSON.stringify(sequence));
    const url = `/reports/financial-model/templates-print?organizationId=${organizationId}&seq=${encodeURIComponent(encoded)}`;
    setExportOpen(false);
    window.open(url, "_blank", "noopener");
  }

  function formatTemplatePeriod(t: FinancialModelTemplate): string {
    if (t.periodMode === "dynamic" && t.dynamicPreset) {
      const r = resolveDynamicPeriod(t.dynamicPreset);
      const range =
        r.startYear === r.endYear && r.startMonth === r.endMonth
          ? `${MONTH_ABBR[r.startMonth - 1]} ${r.startYear}`
          : `${MONTH_ABBR[r.startMonth - 1]} ${r.startYear} – ${MONTH_ABBR[r.endMonth - 1]} ${r.endYear}`;
      return `${DYNAMIC_PRESET_LABELS[t.dynamicPreset]} → ${range}`;
    }
    if (
      t.periodMode === "hybrid" &&
      t.startYear &&
      t.startMonth &&
      t.dynamicPreset
    ) {
      const r = resolveDynamicPeriod(t.dynamicPreset);
      return `${MONTH_ABBR[t.startMonth - 1]} ${t.startYear} – ${MONTH_ABBR[r.endMonth - 1]} ${r.endYear}`;
    }
    if (t.startYear && t.startMonth && t.endYear && t.endMonth) {
      return t.startYear === t.endYear && t.startMonth === t.endMonth
        ? `${MONTH_ABBR[t.startMonth - 1]} ${t.startYear}`
        : `${MONTH_ABBR[t.startMonth - 1]} ${t.startYear} – ${MONTH_ABBR[t.endMonth - 1]} ${t.endYear}`;
    }
    return "—";
  }

  const favorites = templates.filter((t) => t.isFavorite);
  const others = templates.filter((t) => !t.isFavorite);

  // Drag-and-drop state for favorites reordering
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  async function persistFavoriteOrder(orderedIds: string[]) {
    if (!organizationId) return;
    const res = await fetch("/api/financial-model-templates/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId, orderedIds }),
    });
    if (!res.ok) {
      toast.error("Failed to save order");
      // Roll back by reloading
      await reload();
    }
  }

  // Reorder within a single group (favorites OR non-favorites). Cross-group
  // drag is intentionally not supported — use the star button to move a
  // template between groups.
  function handleDropWithinGroup(
    targetId: string,
    group: FinancialModelTemplate[],
    otherGroup: FinancialModelTemplate[],
    favoritesFirst: boolean
  ) {
    if (!dragId || dragId === targetId) {
      setDragId(null);
      setDragOverId(null);
      return;
    }

    const ids = group.map((t) => t.id);
    const fromIdx = ids.indexOf(dragId);
    const toIdx = ids.indexOf(targetId);
    if (fromIdx < 0 || toIdx < 0) {
      // Dragged template isn't in this group; ignore.
      setDragId(null);
      setDragOverId(null);
      return;
    }

    const nextIds = ids.slice();
    nextIds.splice(fromIdx, 1);
    nextIds.splice(toIdx, 0, dragId);

    const byId = new Map(group.map((t) => [t.id, t]));
    const reordered = nextIds
      .map((id) => byId.get(id))
      .filter((t): t is FinancialModelTemplate => !!t);

    const combined = favoritesFirst
      ? [...reordered, ...otherGroup]
      : [...otherGroup, ...reordered];

    setTemplates(combined);
    setDragId(null);
    setDragOverId(null);

    persistFavoriteOrder(combined.map((t) => t.id));
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 gap-1.5">
            <Bookmark className="h-3.5 w-3.5" />
            Templates
            {templates.length > 0 && (
              <Badge variant="secondary" className="ml-1 text-[10px] h-4 px-1.5">
                {templates.length}
              </Badge>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[360px]">
          <DropdownMenuLabel className="flex items-center justify-between">
            <span>Saved templates</span>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 gap-1 text-xs"
              onClick={openSaveDialog}
            >
              <Plus className="h-3 w-3" />
              Save current
            </Button>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />

          {loading && (
            <div className="px-2 py-3 text-xs text-muted-foreground">
              Loading...
            </div>
          )}

          {!loading && templates.length === 0 && (
            <div className="px-2 py-3 text-xs text-muted-foreground">
              No templates yet. Configure the model above, then click
              &ldquo;Save current&rdquo;.
            </div>
          )}

          {favorites.length > 0 && (
            <>
              <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Favorites
                {favorites.length > 1 && (
                  <span className="ml-1 normal-case tracking-normal text-muted-foreground/70">
                    · drag to reorder
                  </span>
                )}
              </DropdownMenuLabel>
              {favorites.map((t) => (
                <TemplateRow
                  key={t.id}
                  template={t}
                  periodLabel={formatTemplatePeriod(t)}
                  onLoad={() => onLoadTemplate(t)}
                  onEdit={() => openEditDialog(t)}
                  onToggleFavorite={() => toggleFavorite(t)}
                  onDelete={() => handleDelete(t)}
                  draggable={favorites.length > 1}
                  isDragging={dragId === t.id}
                  isDragOver={dragOverId === t.id && dragId !== t.id}
                  onDragStart={() => setDragId(t.id)}
                  onDragEnd={() => {
                    setDragId(null);
                    setDragOverId(null);
                  }}
                  onDragOver={() => {
                    if (dragId && dragId !== t.id) setDragOverId(t.id);
                  }}
                  onDrop={() =>
                    handleDropWithinGroup(t.id, favorites, others, true)
                  }
                />
              ))}
              <DropdownMenuSeparator />
            </>
          )}

          {others.length > 0 && (
            <>
              <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {favorites.length > 0 ? "Other" : "Saved"}
                {others.length > 1 && (
                  <span className="ml-1 normal-case tracking-normal text-muted-foreground/70">
                    · drag to reorder
                  </span>
                )}
              </DropdownMenuLabel>
              {others.map((t) => (
                <TemplateRow
                  key={t.id}
                  template={t}
                  periodLabel={formatTemplatePeriod(t)}
                  onLoad={() => onLoadTemplate(t)}
                  onEdit={() => openEditDialog(t)}
                  onToggleFavorite={() => toggleFavorite(t)}
                  onDelete={() => handleDelete(t)}
                  draggable={others.length > 1}
                  isDragging={dragId === t.id}
                  isDragOver={dragOverId === t.id && dragId !== t.id}
                  onDragStart={() => setDragId(t.id)}
                  onDragEnd={() => {
                    setDragId(null);
                    setDragOverId(null);
                  }}
                  onDragOver={() => {
                    if (dragId && dragId !== t.id) setDragOverId(t.id);
                  }}
                  onDrop={() =>
                    handleDropWithinGroup(t.id, others, favorites, false)
                  }
                />
              ))}
              <DropdownMenuSeparator />
            </>
          )}

          {templates.length > 0 && (
            <DropdownMenuItem
              onClick={openExportDialog}
              className="text-xs gap-2"
            >
              <FileDown className="h-3.5 w-3.5" />
              Export templates to PDF…
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Export builder — drag templates and separator pages into the
          sequence that will be rendered to PDF. */}
      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent className="sm:max-w-[640px]">
          <DialogHeader>
            <DialogTitle>Export templates to PDF</DialogTitle>
            <DialogDescription>
              Build the PDF sequence. Drag rows to reorder. Insert title /
              divider pages between templates to organize the output (e.g. a
              &ldquo;Monthly&rdquo; cover before monthly templates and a
              &ldquo;Year to Date&rdquo; cover before YTD ones).
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center gap-1 -mb-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => applyPreset("all")}
            >
              Select all
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => applyPreset("favorites")}
            >
              Favorites only
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => applyPreset("none")}
            >
              Clear
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1 ml-auto"
              onClick={() => addSeparatorAt()}
            >
              <Plus className="h-3 w-3" />
              Add title page
            </Button>
          </div>

          <div className="max-h-[380px] overflow-y-auto rounded border divide-y">
            {sequence.length === 0 && (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                Sequence is empty. Use the buttons above to add templates, or
                pick from &ldquo;Add template&hellip;&rdquo; below.
              </div>
            )}
            {sequence.map((item) => {
              const isDragging = seqDragKey === item.key;
              const isDragOver =
                seqDragOverKey === item.key && seqDragKey !== item.key;
              const rowClass = [
                "px-3 py-2 hover:bg-muted/40",
                isDragging ? "opacity-40" : "",
                isDragOver ? "border-t-2 border-blue-500" : "",
              ]
                .filter(Boolean)
                .join(" ");

              const dragProps = {
                draggable: true,
                onDragStart: (e: React.DragEvent) => {
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", item.key);
                  setSeqDragKey(item.key);
                },
                onDragEnd: () => {
                  setSeqDragKey(null);
                  setSeqDragOverKey(null);
                },
                onDragOver: (e: React.DragEvent) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (seqDragKey && seqDragKey !== item.key) {
                    setSeqDragOverKey(item.key);
                  }
                },
                onDrop: (e: React.DragEvent) => {
                  e.preventDefault();
                  handleSeqDrop(item.key);
                },
              };

              if (item.kind === "separator") {
                return (
                  <div key={item.key} className={rowClass} {...dragProps}>
                    <div className="flex items-start gap-2">
                      <GripVertical className="h-3.5 w-3.5 mt-1.5 text-muted-foreground cursor-grab active:cursor-grabbing shrink-0" />
                      <div className="flex-1 space-y-1">
                        <div className="flex items-center gap-1.5">
                          <Badge
                            variant="secondary"
                            className="text-[10px] h-4 px-1.5"
                          >
                            Title page
                          </Badge>
                        </div>
                        <Input
                          value={item.title}
                          onChange={(e) =>
                            updateSeparator(item.key, "title", e.target.value)
                          }
                          className="h-7 text-sm"
                          placeholder="Section title"
                        />
                        <Input
                          value={item.subtitle ?? ""}
                          onChange={(e) =>
                            updateSeparator(
                              item.key,
                              "subtitle",
                              e.target.value
                            )
                          }
                          className="h-7 text-xs"
                          placeholder="Subtitle (optional)"
                        />
                      </div>
                      <button
                        onClick={() => removeFromSequence(item.key)}
                        className="p-1 hover:bg-muted rounded-sm"
                        aria-label="Remove"
                      >
                        <Trash2 className="h-3 w-3 text-destructive" />
                      </button>
                    </div>
                  </div>
                );
              }

              const t = templates.find((x) => x.id === item.id);
              if (!t) {
                return (
                  <div
                    key={item.key}
                    className={rowClass + " text-xs text-destructive"}
                    {...dragProps}
                  >
                    <div className="flex items-center gap-2">
                      <GripVertical className="h-3.5 w-3.5 text-muted-foreground cursor-grab active:cursor-grabbing shrink-0" />
                      Template no longer exists
                      <button
                        onClick={() => removeFromSequence(item.key)}
                        className="ml-auto p-1 hover:bg-muted rounded-sm"
                        aria-label="Remove"
                      >
                        <Trash2 className="h-3 w-3 text-destructive" />
                      </button>
                    </div>
                  </div>
                );
              }

              return (
                <div key={item.key} className={rowClass} {...dragProps}>
                  <div className="flex items-start gap-2">
                    <GripVertical className="h-3.5 w-3.5 mt-0.5 text-muted-foreground cursor-grab active:cursor-grabbing shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        {t.isFavorite && (
                          <Star className="h-3 w-3 fill-yellow-400 text-yellow-500 shrink-0" />
                        )}
                        <span className="text-sm font-medium truncate">
                          {t.name}
                        </span>
                        <Badge
                          variant="outline"
                          className="text-[10px] h-4 px-1.5"
                        >
                          {TAB_LABELS[t.activeTab]}
                        </Badge>
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {formatTemplatePeriod(t)}
                      </div>
                    </div>
                    <button
                      onClick={() => removeFromSequence(item.key)}
                      className="p-1 hover:bg-muted rounded-sm"
                      aria-label="Remove"
                    >
                      <Trash2 className="h-3 w-3 text-destructive" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Add-template picker: any template not already in sequence */}
          {(() => {
            const usedIds = new Set(
              sequence
                .filter((i): i is { kind: "template"; key: string; id: string } => i.kind === "template")
                .map((i) => i.id)
            );
            const remaining = templates.filter((t) => !usedIds.has(t.id));
            if (remaining.length === 0) return null;
            return (
              <div className="flex items-center gap-2">
                <Label className="text-xs whitespace-nowrap">
                  Add template
                </Label>
                <Select
                  value=""
                  onValueChange={(v) => {
                    if (v) addTemplateToSequence(v);
                  }}
                >
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue placeholder="Pick a template…" />
                  </SelectTrigger>
                  <SelectContent>
                    {remaining.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            );
          })()}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setExportOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleRunExport}
              disabled={
                sequence.filter((i) => i.kind === "template").length === 0
              }
            >
              <FileDown className="h-3.5 w-3.5 mr-1.5" />
              Export PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Save / edit dialog */}
      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>
              {editingId ? "Edit template" : "Save as template"}
            </DialogTitle>
            <DialogDescription>
              Captures the current scope, configuration, and toggles. Pick a
              period mode and choose which statements to include in the PDF
              export.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label className="text-xs">Name</Label>
              <Input
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                placeholder="e.g. Monthly Close — Last Month"
                className="h-8 text-sm"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Period mode</Label>
              <Select
                value={draftPeriodMode}
                onValueChange={(v) =>
                  setDraftPeriodMode(v as "static" | "dynamic" | "hybrid")
                }
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="static">
                    Static — lock today&rsquo;s selected dates
                  </SelectItem>
                  <SelectItem value="dynamic">
                    Dynamic — resolve relative to today&rsquo;s date
                  </SelectItem>
                  <SelectItem value="hybrid">
                    Hybrid — fixed start, end follows today
                  </SelectItem>
                </SelectContent>
              </Select>
              {draftPeriodMode === "static" && (
                <p className="text-[11px] text-muted-foreground">
                  Will save{" "}
                  <span className="font-medium">
                    {MONTH_ABBR[current.startMonth - 1]} {current.startYear} –{" "}
                    {MONTH_ABBR[current.endMonth - 1]} {current.endYear}
                  </span>{" "}
                  exactly.
                </p>
              )}
              {draftPeriodMode === "hybrid" && (
                <p className="text-[11px] text-muted-foreground">
                  Start is pinned to{" "}
                  <span className="font-medium">
                    {MONTH_ABBR[current.startMonth - 1]} {current.startYear}
                  </span>{" "}
                  (the currently-selected start). The end re-resolves against
                  today using the preset below.
                </p>
              )}
            </div>

            {(draftPeriodMode === "dynamic" || draftPeriodMode === "hybrid") && (
              <div className="space-y-1">
                <Label className="text-xs">
                  {draftPeriodMode === "hybrid"
                    ? "Dynamic end"
                    : "Dynamic preset"}
                </Label>
                <Select
                  value={draftPreset}
                  onValueChange={(v) => setDraftPreset(v as DynamicPreset)}
                >
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(
                      Object.keys(DYNAMIC_PRESET_LABELS) as DynamicPreset[]
                    ).map((p) => (
                      <SelectItem key={p} value={p}>
                        {DYNAMIC_PRESET_LABELS[p]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {(() => {
                  const r = resolveDynamicPeriod(draftPreset);
                  if (draftPeriodMode === "hybrid") {
                    return (
                      <p className="text-[11px] text-muted-foreground">
                        Today resolves to:{" "}
                        <span className="font-medium">
                          {MONTH_ABBR[current.startMonth - 1]}{" "}
                          {current.startYear} –{" "}
                          {MONTH_ABBR[r.endMonth - 1]} {r.endYear}
                        </span>
                      </p>
                    );
                  }
                  return (
                    <p className="text-[11px] text-muted-foreground">
                      Today resolves to:{" "}
                      <span className="font-medium">
                        {MONTH_ABBR[r.startMonth - 1]} {r.startYear} –{" "}
                        {MONTH_ABBR[r.endMonth - 1]} {r.endYear}
                      </span>
                    </p>
                  );
                })()}
              </div>
            )}

            <div className="space-y-2">
              <Label className="text-xs">Include in PDF export</Label>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                  <Checkbox
                    checked={draftIncludeIS}
                    onCheckedChange={(v) => setDraftIncludeIS(v === true)}
                  />
                  Income statement
                </label>
                <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                  <Checkbox
                    checked={draftIncludeBS}
                    onCheckedChange={(v) => setDraftIncludeBS(v === true)}
                  />
                  Balance sheet
                </label>
                <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                  <Checkbox
                    checked={draftIncludeCF}
                    onCheckedChange={(v) => setDraftIncludeCF(v === true)}
                  />
                  Cash flow statement
                </label>
                <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                  <Checkbox
                    checked={draftIncludePFS}
                    onCheckedChange={(v) => setDraftIncludePFS(v === true)}
                  />
                  Pro forma adjustments
                </label>
              </div>
            </div>

            <label className="flex items-center gap-1.5 text-xs cursor-pointer">
              <Checkbox
                checked={draftFavorite}
                onCheckedChange={(v) => setDraftFavorite(v === true)}
              />
              Mark as favorite
            </label>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setSaveOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave}>
              {editingId ? "Save changes" : "Create template"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

interface TemplateRowProps {
  template: FinancialModelTemplate;
  periodLabel: string;
  onLoad: () => void;
  onEdit: () => void;
  onToggleFavorite: () => void;
  onDelete: () => void;
  draggable?: boolean;
  isDragging?: boolean;
  isDragOver?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onDragOver?: () => void;
  onDrop?: () => void;
}

function TemplateRow({
  template,
  periodLabel,
  onLoad,
  onEdit,
  onToggleFavorite,
  onDelete,
  draggable,
  isDragging,
  isDragOver,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: TemplateRowProps) {
  return (
    <div
      className={[
        "flex items-center gap-1 px-2 py-1.5 hover:bg-muted/50 rounded-sm",
        isDragging ? "opacity-40" : "",
        isDragOver ? "border-t-2 border-blue-500" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      draggable={draggable}
      onDragStart={(e) => {
        if (!draggable) return;
        e.dataTransfer.effectAllowed = "move";
        // Required for Firefox to start drag
        e.dataTransfer.setData("text/plain", template.id);
        onDragStart?.();
      }}
      onDragEnd={onDragEnd}
      onDragOver={(e) => {
        if (!draggable) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        onDragOver?.();
      }}
      onDrop={(e) => {
        if (!draggable) return;
        e.preventDefault();
        onDrop?.();
      }}
    >
      {draggable && (
        <span
          className="p-0.5 text-muted-foreground cursor-grab active:cursor-grabbing"
          aria-label="Drag to reorder"
        >
          <GripVertical className="h-3 w-3" />
        </span>
      )}
      <button
        onClick={onToggleFavorite}
        className="p-1 hover:bg-muted rounded-sm"
        aria-label={template.isFavorite ? "Unfavorite" : "Favorite"}
      >
        <Star
          className={`h-3.5 w-3.5 ${
            template.isFavorite
              ? "fill-yellow-400 text-yellow-500"
              : "text-muted-foreground"
          }`}
        />
      </button>
      <button
        onClick={onLoad}
        className="flex-1 text-left min-w-0"
      >
        <div className="text-sm font-medium truncate">{template.name}</div>
        <div className="text-[10px] text-muted-foreground truncate">
          <span className="inline-flex items-center mr-1 px-1 rounded bg-muted text-foreground/80 text-[9px] font-medium">
            {TAB_LABELS[template.activeTab]}
          </span>
          {periodLabel}
          {template.periodMode === "dynamic" && (
            <span className="ml-1 inline-flex items-center px-1 rounded bg-blue-50 text-blue-700 text-[9px] font-medium">
              dyn
            </span>
          )}
          {template.periodMode === "hybrid" && (
            <span className="ml-1 inline-flex items-center px-1 rounded bg-purple-50 text-purple-700 text-[9px] font-medium">
              hybrid
            </span>
          )}
        </div>
      </button>
      <button
        onClick={onEdit}
        className="p-1 hover:bg-muted rounded-sm"
        aria-label="Edit"
      >
        <Pencil className="h-3 w-3 text-muted-foreground" />
      </button>
      <button
        onClick={onDelete}
        className="p-1 hover:bg-muted rounded-sm"
        aria-label="Delete"
      >
        <Trash2 className="h-3 w-3 text-destructive" />
      </button>
    </div>
  );
}
