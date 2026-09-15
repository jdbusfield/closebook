"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Plus, Pencil, Trash2 } from "lucide-react";
import { fmtUsd, fmtNum, MONTH_ABBRS } from "@/lib/budget/format";

interface CapexItem {
  id: string;
  reporting_entity_id: string | null;
  entity_id: string | null;
  description: string;
  asset_group: string | null;
  vehicle_class: string | null;
  quantity: number;
  unit_cost: number;
  in_service_year: number;
  in_service_month: number;
  useful_life_months: number | null;
  salvage_pct: number | null;
  funding: string;
  debt_rate: number | null;
  debt_term_months: number | null;
  debt_pct: number | null;
  status: string;
  notes: string | null;
}

interface DisposalItem {
  id: string;
  reporting_entity_id: string | null;
  entity_id: string | null;
  description: string | null;
  asset_group: string | null;
  quantity: number;
  disposal_year: number;
  disposal_month: number;
  expected_proceeds: number;
  nbv_at_disposal: number | null;
  monthly_depreciation: number | null;
  status: string;
  notes: string | null;
}

interface Summary {
  capexCash: number[];
  depreciation: number[];
  debtDraw: number[];
  debtInterest: number[];
  debtPrincipal: number[];
  disposalProceeds: number[];
  disposalGainLoss: number[];
  depreciationAvoided: number[];
  fleetDelta: Record<string, number[]>;
}

interface Payload {
  organizationId: string;
  year: number;
  items: CapexItem[];
  disposals: DisposalItem[];
  reportingEntities: Array<{ id: string; name: string; code: string }>;
  entities: Array<{ id: string; name: string; code: string }>;
  assetGroups: string[];
  defaultsByGroup: Record<string, { usefulLifeMonths: number; salvagePct: number }>;
  summary: Summary;
  byReportingEntity: Record<string, Summary>;
  canEdit: boolean;
}

const sum = (a: number[] | undefined) => (a ?? []).reduce((t, v) => t + v, 0);

const EMPTY_ITEM = {
  reporting_entity_id: "",
  entity_id: "",
  description: "",
  asset_group: "",
  quantity: "1",
  unit_cost: "",
  in_service_year: "",
  in_service_month: "1",
  useful_life_months: "",
  salvage_pct: "",
  funding: "cash",
  debt_rate: "",
  debt_term_months: "60",
  debt_pct: "100",
  status: "planned",
  notes: "",
};

const EMPTY_DISPOSAL = {
  reporting_entity_id: "",
  entity_id: "",
  description: "",
  asset_group: "",
  quantity: "1",
  disposal_year: "",
  disposal_month: "1",
  expected_proceeds: "",
  nbv_at_disposal: "",
  monthly_depreciation: "",
  status: "planned",
  notes: "",
};

export default function CapexPlanPage() {
  const nextYear = new Date().getFullYear() + 1;
  const [year, setYear] = useState(nextYear);
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);

  const [itemOpen, setItemOpen] = useState(false);
  const [itemEditId, setItemEditId] = useState<string | null>(null);
  const [item, setItem] = useState({ ...EMPTY_ITEM, in_service_year: String(nextYear) });
  const [dispOpen, setDispOpen] = useState(false);
  const [dispEditId, setDispEditId] = useState<string | null>(null);
  const [disp, setDisp] = useState({ ...EMPTY_DISPOSAL, disposal_year: String(nextYear) });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (y: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/capex-plan?year=${y}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load");
      setData(json);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load the capex plan");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(year);
  }, [load, year]);

  const reName = useMemo(() => new Map((data?.reportingEntities ?? []).map((r) => [r.id, r.name])), [data]);
  const entName = useMemo(() => new Map((data?.entities ?? []).map((e) => [e.id, e.code])), [data]);
  const readOnly = !data?.canEdit;

  const openNewItem = () => {
    setItemEditId(null);
    setItem({ ...EMPTY_ITEM, in_service_year: String(year) });
    setItemOpen(true);
  };
  const openEditItem = (it: CapexItem) => {
    setItemEditId(it.id);
    setItem({
      reporting_entity_id: it.reporting_entity_id ?? "",
      entity_id: it.entity_id ?? "",
      description: it.description,
      asset_group: it.asset_group ?? "",
      quantity: String(it.quantity),
      unit_cost: String(it.unit_cost),
      in_service_year: String(it.in_service_year),
      in_service_month: String(it.in_service_month),
      useful_life_months: it.useful_life_months == null ? "" : String(it.useful_life_months),
      salvage_pct: it.salvage_pct == null ? "" : String(it.salvage_pct),
      funding: it.funding,
      debt_rate: it.debt_rate == null ? "" : String(it.debt_rate * 100),
      debt_term_months: it.debt_term_months == null ? "" : String(it.debt_term_months),
      debt_pct: it.debt_pct == null ? "" : String(it.debt_pct),
      status: it.status,
      notes: it.notes ?? "",
    });
    setItemOpen(true);
  };

  const saveItem = async () => {
    if (!item.description || !item.in_service_year || !item.in_service_month) {
      toast.error("Description, year and month are required.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        kind: "item",
        id: itemEditId ?? undefined,
        reporting_entity_id: item.reporting_entity_id || null,
        entity_id: item.entity_id || null,
        description: item.description,
        asset_group: item.asset_group || null,
        quantity: Number(item.quantity || 1),
        unit_cost: Number(item.unit_cost || 0),
        in_service_year: Number(item.in_service_year),
        in_service_month: Number(item.in_service_month),
        useful_life_months: item.useful_life_months ? Number(item.useful_life_months) : null,
        salvage_pct: item.salvage_pct ? Number(item.salvage_pct) : null,
        funding: item.funding,
        debt_rate: item.debt_rate ? Number(item.debt_rate) / 100 : null,
        debt_term_months: item.debt_term_months ? Number(item.debt_term_months) : null,
        debt_pct: item.debt_pct ? Number(item.debt_pct) : null,
        status: item.status,
        notes: item.notes || null,
      };
      const res = await fetch("/api/capex-plan", {
        method: itemEditId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Save failed");
      toast.success(itemEditId ? "Purchase updated" : "Purchase added");
      setItemOpen(false);
      await load(year);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const openNewDisposal = () => {
    setDispEditId(null);
    setDisp({ ...EMPTY_DISPOSAL, disposal_year: String(year) });
    setDispOpen(true);
  };
  const openEditDisposal = (d: DisposalItem) => {
    setDispEditId(d.id);
    setDisp({
      reporting_entity_id: d.reporting_entity_id ?? "",
      entity_id: d.entity_id ?? "",
      description: d.description ?? "",
      asset_group: d.asset_group ?? "",
      quantity: String(d.quantity),
      disposal_year: String(d.disposal_year),
      disposal_month: String(d.disposal_month),
      expected_proceeds: String(d.expected_proceeds),
      nbv_at_disposal: d.nbv_at_disposal == null ? "" : String(d.nbv_at_disposal),
      monthly_depreciation: d.monthly_depreciation == null ? "" : String(d.monthly_depreciation),
      status: d.status,
      notes: d.notes ?? "",
    });
    setDispOpen(true);
  };

  const saveDisposal = async () => {
    if (!disp.disposal_year || !disp.disposal_month) {
      toast.error("Year and month are required.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        kind: "disposal",
        id: dispEditId ?? undefined,
        reporting_entity_id: disp.reporting_entity_id || null,
        entity_id: disp.entity_id || null,
        description: disp.description || null,
        asset_group: disp.asset_group || null,
        quantity: Number(disp.quantity || 1),
        disposal_year: Number(disp.disposal_year),
        disposal_month: Number(disp.disposal_month),
        expected_proceeds: Number(disp.expected_proceeds || 0),
        nbv_at_disposal: disp.nbv_at_disposal ? Number(disp.nbv_at_disposal) : null,
        monthly_depreciation: disp.monthly_depreciation ? Number(disp.monthly_depreciation) : null,
        status: disp.status,
        notes: disp.notes || null,
      };
      const res = await fetch("/api/capex-plan", {
        method: dispEditId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Save failed");
      toast.success(dispEditId ? "Disposal updated" : "Disposal added");
      setDispOpen(false);
      await load(year);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (kind: "item" | "disposal", id: string, label: string) => {
    if (!window.confirm(`Delete "${label}"?`)) return;
    const res = await fetch(`/api/capex-plan?kind=${kind}&id=${id}`, { method: "DELETE" });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      toast.error(json.error ?? "Delete failed");
      return;
    }
    toast.success("Deleted");
    await load(year);
  };

  const yearItems = (data?.items ?? []).filter((i) => i.in_service_year === year);
  const yearDisposals = (data?.disposals ?? []).filter((d) => d.disposal_year === year);
  const s = data?.summary;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Capex and disposal plan</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Planned purchases and disposals by month. The budget reads this plan for depreciation, financing interest, gain or loss on sale, and the unit count behind rental revenue.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger className="w-[110px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[nextYear - 1, nextYear, nextYear + 1, nextYear + 2].map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={openNewDisposal} disabled={readOnly}>
            <Plus className="mr-2 h-4 w-4" /> Disposal
          </Button>
          <Button onClick={openNewItem} disabled={readOnly}>
            <Plus className="mr-2 h-4 w-4" /> Purchase
          </Button>
        </div>
      </div>

      {loading && !data ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading
        </div>
      ) : s ? (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Purchases, {year}</CardDescription>
                <CardTitle className="text-2xl tabular-nums">{fmtUsd(sum(s.capexCash))}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">{yearItems.reduce((t, i) => t + i.quantity, 0)} units, debt drawn {fmtUsd(sum(s.debtDraw))}</CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Depreciation added</CardDescription>
                <CardTitle className="text-2xl tabular-nums">{fmtUsd(sum(s.depreciation))}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">Financing interest {fmtUsd(sum(s.debtInterest))}</CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Disposal proceeds</CardDescription>
                <CardTitle className="text-2xl tabular-nums">{fmtUsd(sum(s.disposalProceeds))}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Gain / (loss) {fmtUsd(sum(s.disposalGainLoss))}, depreciation avoided {fmtUsd(sum(s.depreciationAvoided))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Fleet change by December</CardDescription>
                <CardTitle className="text-2xl tabular-nums">
                  {fmtNum(Object.values(s.fleetDelta).reduce((t, arr) => t + (arr[11] ?? 0), 0))}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {Object.entries(s.fleetDelta)
                  .filter(([, arr]) => arr[11])
                  .map(([g, arr]) => `${g} ${arr[11] > 0 ? "+" : ""}${arr[11]}`)
                  .join(", ") || "No change"}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Purchases</CardTitle>
              <CardDescription>In-service month drives cash, depreciation start and the fleet count. Blank life and salvage use the group defaults.</CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {yearItems.length === 0 ? (
                <p className="text-sm text-muted-foreground">No purchases planned for {year}.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Description</TableHead>
                      <TableHead>Group</TableHead>
                      <TableHead>Reporting group</TableHead>
                      <TableHead>Month</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Unit cost</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead>Funding</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {yearItems.map((it) => (
                      <TableRow key={it.id}>
                        <TableCell>
                          <div className="font-medium">{it.description}</div>
                          {it.notes && <div className="text-xs text-muted-foreground">{it.notes}</div>}
                        </TableCell>
                        <TableCell>{it.asset_group ?? ""}</TableCell>
                        <TableCell>{it.reporting_entity_id ? reName.get(it.reporting_entity_id) : it.entity_id ? entName.get(it.entity_id) : ""}</TableCell>
                        <TableCell>{MONTH_ABBRS[it.in_service_month - 1]}</TableCell>
                        <TableCell className="text-right tabular-nums">{it.quantity}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtUsd(it.unit_cost)}</TableCell>
                        <TableCell className="text-right font-medium tabular-nums">{fmtUsd(it.quantity * it.unit_cost)}</TableCell>
                        <TableCell className="capitalize">
                          {it.funding}
                          {it.funding === "debt" && it.debt_rate != null ? ` ${(it.debt_rate * 100).toFixed(2)}% / ${it.debt_term_months ?? 60} mo` : ""}
                        </TableCell>
                        <TableCell className="capitalize">{it.status}</TableCell>
                        <TableCell>
                          {!readOnly && (
                            <div className="flex gap-1">
                              <Button variant="ghost" size="icon-xs" onClick={() => openEditItem(it)} aria-label="Edit">
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button variant="ghost" size="icon-xs" onClick={() => remove("item", it.id, it.description)} aria-label="Delete">
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Disposals</CardTitle>
              <CardDescription>Proceeds against net book value give the gain or loss; depreciation stops in the disposal month.</CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {yearDisposals.length === 0 ? (
                <p className="text-sm text-muted-foreground">No disposals planned for {year}.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Description</TableHead>
                      <TableHead>Group</TableHead>
                      <TableHead>Reporting group</TableHead>
                      <TableHead>Month</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Proceeds</TableHead>
                      <TableHead className="text-right">NBV</TableHead>
                      <TableHead className="text-right">Gain / (loss)</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {yearDisposals.map((d) => (
                      <TableRow key={d.id}>
                        <TableCell className="font-medium">{d.description ?? ""}</TableCell>
                        <TableCell>{d.asset_group ?? ""}</TableCell>
                        <TableCell>{d.reporting_entity_id ? reName.get(d.reporting_entity_id) : d.entity_id ? entName.get(d.entity_id) : ""}</TableCell>
                        <TableCell>{MONTH_ABBRS[d.disposal_month - 1]}</TableCell>
                        <TableCell className="text-right tabular-nums">{d.quantity}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtUsd(d.expected_proceeds)}</TableCell>
                        <TableCell className="text-right tabular-nums">{d.nbv_at_disposal == null ? "" : fmtUsd(d.nbv_at_disposal)}</TableCell>
                        <TableCell className="text-right tabular-nums">{d.nbv_at_disposal == null ? "" : fmtUsd(d.expected_proceeds - d.nbv_at_disposal)}</TableCell>
                        <TableCell className="capitalize">{d.status}</TableCell>
                        <TableCell>
                          {!readOnly && (
                            <div className="flex gap-1">
                              <Button variant="ghost" size="icon-xs" onClick={() => openEditDisposal(d)} aria-label="Edit">
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button variant="ghost" size="icon-xs" onClick={() => remove("disposal", d.id, d.description ?? "disposal")} aria-label="Delete">
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>By month, {year}</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Line</TableHead>
                    {MONTH_ABBRS.map((m) => <TableHead key={m} className="text-right">{m}</TableHead>)}
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(
                    [
                      ["Purchases (cash)", s.capexCash],
                      ["Debt drawn", s.debtDraw],
                      ["Depreciation added", s.depreciation],
                      ["Financing interest", s.debtInterest],
                      ["Financing principal", s.debtPrincipal],
                      ["Disposal proceeds", s.disposalProceeds],
                      ["Gain / (loss) on disposals", s.disposalGainLoss],
                      ["Depreciation avoided", s.depreciationAvoided],
                    ] as Array<[string, number[]]>
                  ).map(([label, arr]) => (
                    <TableRow key={label}>
                      <TableCell className="whitespace-nowrap">{label}</TableCell>
                      {arr.map((v, i) => <TableCell key={i} className="text-right tabular-nums">{v ? fmtUsd(v) : ""}</TableCell>)}
                      <TableCell className="text-right font-medium tabular-nums">{fmtUsd(sum(arr))}</TableCell>
                    </TableRow>
                  ))}
                  {Object.entries(s.fleetDelta).map(([g, arr]) => (
                    <TableRow key={g}>
                      <TableCell className="whitespace-nowrap">Fleet change: {g}</TableCell>
                      {arr.map((v, i) => <TableCell key={i} className="text-right tabular-nums">{v ? (v > 0 ? `+${v}` : v) : ""}</TableCell>)}
                      <TableCell className="text-right font-medium tabular-nums">{arr[11] > 0 ? `+${arr[11]}` : arr[11]}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      ) : null}

      {/* Purchase dialog */}
      <Dialog open={itemOpen} onOpenChange={setItemOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{itemEditId ? "Edit purchase" : "Planned purchase"}</DialogTitle>
            <DialogDescription>Quantity of identical units placed in service in one month.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="cx-desc">Description</Label>
              <Input id="cx-desc" value={item.description} onChange={(e) => setItem((f) => ({ ...f, description: e.target.value }))} placeholder="2027 Ford Transit cargo vans" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="cx-re">Reporting group</Label>
                <Select value={item.reporting_entity_id || "none"} onValueChange={(v) => setItem((f) => ({ ...f, reporting_entity_id: v === "none" ? "" : v }))}>
                  <SelectTrigger id="cx-re"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not set</SelectItem>
                    {data?.reportingEntities.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="cx-entity">Owning entity</Label>
                <Select value={item.entity_id || "none"} onValueChange={(v) => setItem((f) => ({ ...f, entity_id: v === "none" ? "" : v }))}>
                  <SelectTrigger id="cx-entity"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not set</SelectItem>
                    {data?.entities.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="cx-group">Asset group</Label>
                <Input id="cx-group" list="cx-groups" value={item.asset_group} onChange={(e) => setItem((f) => ({ ...f, asset_group: e.target.value }))} placeholder="Cargo Van" />
                <datalist id="cx-groups">{data?.assetGroups.map((g) => <option key={g} value={g} />)}</datalist>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="cx-qty">Quantity</Label>
                <Input id="cx-qty" type="number" min={1} value={item.quantity} onChange={(e) => setItem((f) => ({ ...f, quantity: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="cx-cost">Unit cost</Label>
                <Input id="cx-cost" type="number" step="1" value={item.unit_cost} onChange={(e) => setItem((f) => ({ ...f, unit_cost: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-4 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="cx-year">In-service year</Label>
                <Input id="cx-year" type="number" value={item.in_service_year} onChange={(e) => setItem((f) => ({ ...f, in_service_year: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="cx-month">Month</Label>
                <Input id="cx-month" type="number" min={1} max={12} value={item.in_service_month} onChange={(e) => setItem((f) => ({ ...f, in_service_month: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="cx-life">Life (months)</Label>
                <Input id="cx-life" type="number" placeholder={String(data?.defaultsByGroup[item.asset_group]?.usefulLifeMonths ?? 60)} value={item.useful_life_months} onChange={(e) => setItem((f) => ({ ...f, useful_life_months: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="cx-salvage">Salvage %</Label>
                <Input id="cx-salvage" type="number" placeholder={String(data?.defaultsByGroup[item.asset_group]?.salvagePct ?? 0)} value={item.salvage_pct} onChange={(e) => setItem((f) => ({ ...f, salvage_pct: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-4 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="cx-funding">Funding</Label>
                <Select value={item.funding} onValueChange={(v) => setItem((f) => ({ ...f, funding: v }))}>
                  <SelectTrigger id="cx-funding"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="debt">Debt</SelectItem>
                    <SelectItem value="lease">Lease</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="cx-rate">Rate %</Label>
                <Input id="cx-rate" type="number" step="0.01" disabled={item.funding !== "debt"} value={item.debt_rate} onChange={(e) => setItem((f) => ({ ...f, debt_rate: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="cx-term">Term (months)</Label>
                <Input id="cx-term" type="number" disabled={item.funding !== "debt"} value={item.debt_term_months} onChange={(e) => setItem((f) => ({ ...f, debt_term_months: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="cx-pct">Financed %</Label>
                <Input id="cx-pct" type="number" disabled={item.funding !== "debt"} value={item.debt_pct} onChange={(e) => setItem((f) => ({ ...f, debt_pct: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="cx-status">Status</Label>
                <Select value={item.status} onValueChange={(v) => setItem((f) => ({ ...f, status: v }))}>
                  <SelectTrigger id="cx-status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["planned", "approved", "ordered", "received", "cancelled"].map((st) => <SelectItem key={st} value={st} className="capitalize">{st}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="cx-notes">Notes</Label>
                <Textarea id="cx-notes" rows={1} value={item.notes} onChange={(e) => setItem((f) => ({ ...f, notes: e.target.value }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setItemOpen(false)}>Cancel</Button>
            <Button onClick={saveItem} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {itemEditId ? "Save" : "Add purchase"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Disposal dialog */}
      <Dialog open={dispOpen} onOpenChange={setDispOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{dispEditId ? "Edit disposal" : "Planned disposal"}</DialogTitle>
            <DialogDescription>Units leaving the fleet. Proceeds minus net book value is the gain or loss; blank monthly depreciation uses the group average.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="dx-desc">Description</Label>
              <Input id="dx-desc" value={disp.description} onChange={(e) => setDisp((f) => ({ ...f, description: e.target.value }))} placeholder="2019 cube trucks past 8 years" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="dx-re">Reporting group</Label>
                <Select value={disp.reporting_entity_id || "none"} onValueChange={(v) => setDisp((f) => ({ ...f, reporting_entity_id: v === "none" ? "" : v }))}>
                  <SelectTrigger id="dx-re"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not set</SelectItem>
                    {data?.reportingEntities.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="dx-entity">Owning entity</Label>
                <Select value={disp.entity_id || "none"} onValueChange={(v) => setDisp((f) => ({ ...f, entity_id: v === "none" ? "" : v }))}>
                  <SelectTrigger id="dx-entity"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not set</SelectItem>
                    {data?.entities.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="dx-group">Asset group</Label>
                <Input id="dx-group" list="cx-groups" value={disp.asset_group} onChange={(e) => setDisp((f) => ({ ...f, asset_group: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="dx-qty">Quantity</Label>
                <Input id="dx-qty" type="number" min={1} value={disp.quantity} onChange={(e) => setDisp((f) => ({ ...f, quantity: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="dx-year">Year</Label>
                <Input id="dx-year" type="number" value={disp.disposal_year} onChange={(e) => setDisp((f) => ({ ...f, disposal_year: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="dx-month">Month</Label>
                <Input id="dx-month" type="number" min={1} max={12} value={disp.disposal_month} onChange={(e) => setDisp((f) => ({ ...f, disposal_month: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="dx-proceeds">Expected proceeds (total)</Label>
                <Input id="dx-proceeds" type="number" step="1" value={disp.expected_proceeds} onChange={(e) => setDisp((f) => ({ ...f, expected_proceeds: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="dx-nbv">Net book value (total)</Label>
                <Input id="dx-nbv" type="number" step="1" value={disp.nbv_at_disposal} onChange={(e) => setDisp((f) => ({ ...f, nbv_at_disposal: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="dx-depr">Monthly depreciation (total)</Label>
                <Input id="dx-depr" type="number" step="1" value={disp.monthly_depreciation} onChange={(e) => setDisp((f) => ({ ...f, monthly_depreciation: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="dx-status">Status</Label>
                <Select value={disp.status} onValueChange={(v) => setDisp((f) => ({ ...f, status: v }))}>
                  <SelectTrigger id="dx-status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["planned", "approved", "listed", "sold", "cancelled"].map((st) => <SelectItem key={st} value={st} className="capitalize">{st}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="dx-notes">Notes</Label>
                <Textarea id="dx-notes" rows={1} value={disp.notes} onChange={(e) => setDisp((f) => ({ ...f, notes: e.target.value }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDispOpen(false)}>Cancel</Button>
            <Button onClick={saveDisposal} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {dispEditId ? "Save" : "Add disposal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
