"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { fetchAllPaginated } from "@/lib/utils/paginated-fetch";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, CheckCircle2, AlertTriangle } from "lucide-react";
import { formatStatementAmount } from "./format-utils";
import type { Scope, FixedAssetCfEntry, FixedAssetCfEntryType } from "./types";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const YEARS = [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026, 2027, 2028];

const ENTRY_TYPES: { value: FixedAssetCfEntryType; label: string; hint: string }[] = [
  { value: "cash_purchase", label: "Cash purchase (capex)", hint: "Cash outflow — enter the cash spent." },
  { value: "disposal_proceeds", label: "Disposal proceeds", hint: "Cash inflow — enter the cash received." },
  { value: "disposal_writeoff", label: "Disposal / write-off (non-cash)", hint: "Non-cash NBV removed — enter the net book value." },
  { value: "reclass_transfer", label: "Reclass / transfer (non-cash)", hint: "Non-cash. Enter + if assets decreased, − if assets increased." },
];
const TYPE_LABEL: Record<FixedAssetCfEntryType, string> = {
  cash_purchase: "Cash purchase",
  disposal_proceeds: "Disposal proceeds",
  disposal_writeoff: "Write-off (non-cash)",
  reclass_transfer: "Reclass (non-cash)",
};

function formatPeriod(year: number, month: number): string {
  return `${MONTHS[month - 1]?.slice(0, 3)} ${year}`;
}

interface ReconRow {
  entityId: string;
  entityCode: string;
  entityName: string;
  byBucket: Record<
    string,
    { carryingChange: number; depreciation: number; subledgerNet: number; scheduleNet: number; residual: number }
  >;
  totals: { carryingChange: number; depreciation: number; subledgerNet: number; scheduleNet: number; residual: number };
}

interface FixedAssetScheduleTabProps {
  organizationId: string | null;
  entities: Array<{ id: string; name: string; code: string }>;
  scope: Scope;
  selectedEntityId: string | null;
  startYear: number;
  startMonth: number;
  endYear: number;
  endMonth: number;
  granularity: "monthly" | "quarterly" | "yearly";
  onScheduleActivated?: () => void;
}

export function FixedAssetScheduleTab({
  organizationId,
  entities,
  scope,
  selectedEntityId,
  startYear,
  startMonth,
  endYear,
  endMonth,
  granularity,
  onScheduleActivated,
}: FixedAssetScheduleTabProps) {
  const supabase = createClient();

  const [entries, setEntries] = useState<FixedAssetCfEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // Reconciliation helper
  const [recon, setRecon] = useState<{ periods: { key: string; label: string }[]; rows: ReconRow[] } | null>(null);
  const [reconLoading, setReconLoading] = useState(false);

  // Dialog
  const [showDialog, setShowDialog] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Form
  const [formEntityId, setFormEntityId] = useState("");
  const [formType, setFormType] = useState<FixedAssetCfEntryType>("cash_purchase");
  const [formYear, setFormYear] = useState(endYear);
  const [formMonth, setFormMonth] = useState(endMonth);
  const [formAmount, setFormAmount] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formNotes, setFormNotes] = useState("");

  const entityMap = useMemo(() => {
    const m = new Map<string, { code: string; name: string }>();
    for (const e of entities) m.set(e.id, { code: e.code, name: e.name });
    return m;
  }, [entities]);

  const loadEntries = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = await fetchAllPaginated<any>((offset, limit) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let q = (supabase as any)
          .from("fixed_asset_cf_entries")
          .select("*")
          .eq("organization_id", organizationId)
          .order("period_year", { ascending: true })
          .order("period_month", { ascending: true });
        if (scope === "entity" && selectedEntityId) q = q.eq("entity_id", selectedEntityId);
        return q.range(offset, offset + limit - 1);
      });
      setEntries(data as FixedAssetCfEntry[]);
    } catch {
      toast.error("Failed to load schedule entries");
    }
    setLoading(false);
  }, [supabase, organizationId, scope, selectedEntityId]);

  const loadRecon = useCallback(async () => {
    if (!organizationId) return;
    setReconLoading(true);
    try {
      const params = new URLSearchParams({
        organizationId,
        startYear: String(startYear),
        startMonth: String(startMonth),
        endYear: String(endYear),
        endMonth: String(endMonth),
        granularity,
      });
      if (scope === "entity" && selectedEntityId) params.set("entityId", selectedEntityId);
      const res = await fetch(`/api/financial-statements/asset-reconciliation?${params.toString()}`);
      if (res.ok) setRecon(await res.json());
      else setRecon(null);
    } catch {
      setRecon(null);
    }
    setReconLoading(false);
  }, [organizationId, scope, selectedEntityId, startYear, startMonth, endYear, endMonth, granularity]);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);
  useEffect(() => {
    loadRecon();
  }, [loadRecon]);

  function resetForm() {
    setEditingId(null);
    setFormEntityId(scope === "entity" && selectedEntityId ? selectedEntityId : "");
    setFormType("cash_purchase");
    setFormYear(endYear);
    setFormMonth(endMonth);
    setFormAmount("");
    setFormDescription("");
    setFormNotes("");
  }

  function handleAdd(prefillEntityId?: string) {
    resetForm();
    if (prefillEntityId) setFormEntityId(prefillEntityId);
    setShowDialog(true);
  }

  function handleEdit(e: FixedAssetCfEntry) {
    setEditingId(e.id);
    setFormEntityId(e.entity_id);
    setFormType(e.entry_type);
    setFormYear(e.period_year);
    setFormMonth(e.period_month);
    setFormAmount(String(e.amount));
    setFormDescription(e.description);
    setFormNotes(e.notes ?? "");
    setShowDialog(true);
  }

  async function handleSave() {
    if (!formEntityId || !formDescription.trim()) {
      toast.error("Entity and description are required");
      return;
    }
    const amount = parseFloat(formAmount);
    if (isNaN(amount)) {
      toast.error("Amount must be a valid number");
      return;
    }
    setSaving(true);
    const payload = {
      organization_id: organizationId,
      entity_id: formEntityId,
      entry_type: formType,
      period_year: formYear,
      period_month: formMonth,
      amount,
      description: formDescription.trim(),
      notes: formNotes.trim() || null,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const { error } = editingId
      ? await sb.from("fixed_asset_cf_entries").update(payload).eq("id", editingId)
      : await sb.from("fixed_asset_cf_entries").insert([payload]);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success(editingId ? "Entry updated" : "Entry created");
      setShowDialog(false);
      loadEntries();
      loadRecon();
      onScheduleActivated?.();
    }
    setSaving(false);
  }

  async function handleDelete(id: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).from("fixed_asset_cf_entries").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Entry deleted");
      setEntries((prev) => prev.filter((e) => e.id !== id));
      loadRecon();
    }
  }

  async function handleToggleExclude(id: string, current: boolean) {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, is_excluded: !current } : e)));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from("fixed_asset_cf_entries")
      .update({ is_excluded: !current })
      .eq("id", id);
    if (error) {
      setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, is_excluded: current } : e)));
      toast.error("Failed to update");
    } else {
      loadRecon();
      if (current) onScheduleActivated?.();
    }
  }

  const showEntityColumn = scope !== "entity";
  const formTypeHint = ENTRY_TYPES.find((t) => t.value === formType)?.hint ?? "";

  return (
    <>
      {/* Reconciliation helper */}
      <Card className="mb-4">
        <CardHeader className="pb-3">
          <h3 className="text-lg font-semibold">Fixed-asset reconciliation</h3>
          <p className="text-sm text-muted-foreground">
            The unexplained residual is what lands in the cash-flow line{" "}
            <em>“Other property &amp; equipment activity, net.”</em> Add schedule entries below until
            each entity&apos;s residual is $0. (Residual = GL carrying-value change − depreciation −
            subledger − schedule, for Fixed Asset accounts.)
          </p>
        </CardHeader>
        <CardContent>
          {reconLoading ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Loading reconciliation…</p>
          ) : !recon || recon.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No reconciliation data.</p>
          ) : (
            <div className="rounded-md border overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[150px]">Entity</TableHead>
                    <TableHead className="text-right">GL carrying Δ</TableHead>
                    <TableHead className="text-right">Depreciation</TableHead>
                    <TableHead className="text-right">Subledger</TableHead>
                    <TableHead className="text-right">Schedule</TableHead>
                    <TableHead className="text-right">Unexplained residual</TableHead>
                    <TableHead className="w-[60px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recon.rows.map((r) => {
                    const resid = r.totals.residual;
                    const ok = Math.abs(resid) < 1;
                    return (
                      <TableRow key={r.entityId}>
                        <TableCell className="font-medium">{r.entityCode}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatStatementAmount(r.totals.carryingChange, false)}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatStatementAmount(-r.totals.depreciation, false)}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatStatementAmount(-r.totals.subledgerNet, false)}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatStatementAmount(-r.totals.scheduleNet, false)}
                        </TableCell>
                        <TableCell
                          className={`text-right font-mono tabular-nums font-semibold ${
                            ok ? "text-green-600" : "text-amber-600"
                          }`}
                        >
                          {formatStatementAmount(resid, true)}
                        </TableCell>
                        <TableCell>
                          {ok ? (
                            <CheckCircle2 className="h-4 w-4 text-green-600" />
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-amber-600"
                              onClick={() => handleAdd(r.entityId)}
                              title="Add an entry to explain this residual"
                            >
                              <AlertTriangle className="h-4 w-4" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Entries */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <div>
            <h3 className="text-lg font-semibold">Fixed-Asset Activity schedule</h3>
            <p className="text-sm text-muted-foreground">
              {entries.length} entr{entries.length === 1 ? "y" : "ies"}
              {entries.length > 0 && ` (${entries.filter((e) => !e.is_excluded).length} active)`}
            </p>
          </div>
          <Button size="sm" onClick={() => handleAdd()} disabled={!organizationId}>
            <Plus className="h-4 w-4 mr-1" /> Add Entry
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Loading entries…</p>
          ) : entries.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No schedule entries yet. Use the reconciliation table above to find the entities that
              need them, then click “Add Entry”.
            </p>
          ) : (
            <div className="rounded-md border overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {showEntityColumn && <TableHead className="w-[120px]">Entity</TableHead>}
                    <TableHead className="w-[170px]">Type</TableHead>
                    <TableHead className="w-[100px]">Period</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="w-[120px] text-right">Amount</TableHead>
                    <TableHead className="w-[80px] text-center">Active</TableHead>
                    <TableHead className="w-[90px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((e) => (
                    <TableRow key={e.id} className={e.is_excluded ? "opacity-50" : undefined}>
                      {showEntityColumn && (
                        <TableCell className="font-medium">
                          {entityMap.get(e.entity_id)?.code ?? "—"}
                        </TableCell>
                      )}
                      <TableCell>
                        <Badge variant="outline" className="text-[10px]">
                          {TYPE_LABEL[e.entry_type]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatPeriod(e.period_year, e.period_month)}
                      </TableCell>
                      <TableCell>{e.description}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {formatStatementAmount(e.amount, false)}
                      </TableCell>
                      <TableCell className="text-center">
                        <Checkbox
                          checked={!e.is_excluded}
                          onCheckedChange={() => handleToggleExclude(e.id, e.is_excluded)}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => handleEdit(e)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => handleDelete(e.id)}>
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add / edit dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit entry" : "Add schedule entry"}</DialogTitle>
            <DialogDescription>
              Explain a general-ledger fixed-asset movement that isn&apos;t in the subledger.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Entity</Label>
              <Select value={formEntityId} onValueChange={setFormEntityId}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Select entity" /></SelectTrigger>
                <SelectContent>
                  {entities.map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.code} — {e.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Type</Label>
              <Select value={formType} onValueChange={(v) => setFormType(v as FixedAssetCfEntryType)}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ENTRY_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground mt-1">{formTypeHint}</p>
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <Label className="text-xs">Month</Label>
                <Select value={String(formMonth)} onValueChange={(v) => setFormMonth(Number(v))}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MONTHS.map((m, i) => (
                      <SelectItem key={i + 1} value={String(i + 1)}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-[110px]">
                <Label className="text-xs">Year</Label>
                <Select value={String(formYear)} onValueChange={(v) => setFormYear(Number(v))}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {YEARS.map((y) => (
                      <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-[130px]">
                <Label className="text-xs">Amount</Label>
                <Input
                  value={formAmount}
                  onChange={(ev) => setFormAmount(ev.target.value)}
                  placeholder="0.00"
                  inputMode="decimal"
                  className="h-9"
                />
              </div>
            </div>
            <div>
              <Label className="text-xs">Description</Label>
              <Input
                value={formDescription}
                onChange={(ev) => setFormDescription(ev.target.value)}
                placeholder="e.g. Studio equipment purchased via JE"
                className="h-9"
              />
            </div>
            <div>
              <Label className="text-xs">Notes (optional)</Label>
              <Textarea
                value={formNotes}
                onChange={(ev) => setFormNotes(ev.target.value)}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : editingId ? "Save changes" : "Add entry"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
