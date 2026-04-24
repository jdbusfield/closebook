"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ArrowRight, Car, Download, Search } from "lucide-react";
import { formatCurrency, formatIsoDateLocal } from "@/lib/utils/dates";
import {
  getVehicleClassification,
  getReportingGroup,
  getEffectiveMasterType,
  REPORTING_GROUPS,
} from "@/lib/utils/vehicle-classification";
import {
  addSheet,
  createWorkbook,
  downloadWorkbook,
  formatLongDate,
  NUMBER_FORMATS,
  parseIsoDate,
  type ColumnDef,
} from "@/lib/utils/excel";
import { toast } from "sonner";

interface SoldTabProps {
  entityId: string;
}

interface SoldAsset {
  id: string;
  asset_name: string;
  asset_tag: string | null;
  vehicle_year: number | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_class: string | null;
  vin: string | null;
  acquisition_cost: number;
  book_accumulated_depreciation: number;
  book_net_value: number;
  tax_cost_basis: number | null;
  tax_accumulated_depreciation: number;
  tax_net_value: number;
  disposed_date: string | null;
  disposed_sale_price: number | null;
  disposed_book_gain_loss: number | null;
  disposed_tax_gain_loss: number | null;
  disposed_buyer: string | null;
  master_type_override: string | null;
}

export function SoldTab({ entityId }: SoldTabProps) {
  const supabase = createClient();
  const currentYear = new Date().getFullYear();

  const [assets, setAssets] = useState<SoldAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState(String(currentYear));
  const [searchQuery, setSearchQuery] = useState("");
  const [masterTypeFilter, setMasterTypeFilter] = useState("all");
  const [reportingGroupFilter, setReportingGroupFilter] = useState("all");

  // Export wizard
  const [exportOpen, setExportOpen] = useState(false);
  const [exportMasterType, setExportMasterType] = useState<"all" | "Vehicle" | "Trailer">("all");
  const [exportIncludeTax, setExportIncludeTax] = useState(false);
  const [exporting, setExporting] = useState(false);

  const loadSoldAssets = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("fixed_assets")
      .select(
        "id, asset_name, asset_tag, vehicle_year, vehicle_make, vehicle_model, vehicle_class, vin, acquisition_cost, book_accumulated_depreciation, book_net_value, tax_cost_basis, tax_accumulated_depreciation, tax_net_value, disposed_date, disposed_sale_price, disposed_book_gain_loss, disposed_tax_gain_loss, disposed_buyer, master_type_override"
      )
      .eq("entity_id", entityId)
      .eq("status", "disposed")
      .gte("disposed_date", `${year}-01-01`)
      .lte("disposed_date", `${year}-12-31`)
      .order("disposed_date", { ascending: false });

    setAssets((data as unknown as SoldAsset[]) ?? []);
    setLoading(false);
  }, [supabase, entityId, year]);

  useEffect(() => {
    loadSoldAssets();
  }, [loadSoldAssets]);

  const filteredAssets = assets.filter((a) => {
    if (masterTypeFilter !== "all") {
      const mt = getEffectiveMasterType(a.vehicle_class, a.master_type_override);
      if (mt !== masterTypeFilter) return false;
    }
    if (reportingGroupFilter !== "all") {
      const rg = getReportingGroup(a.vehicle_class);
      if (rg !== reportingGroupFilter) return false;
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const name = a.asset_name.toLowerCase();
      const vin = (a.vin ?? "").toLowerCase();
      const desc = `${a.vehicle_year ?? ""} ${a.vehicle_make ?? ""} ${a.vehicle_model ?? ""}`.toLowerCase();
      const buyer = (a.disposed_buyer ?? "").toLowerCase();
      const classification = getVehicleClassification(a.vehicle_class);
      const classInfo = classification
        ? `${classification.className} ${classification.reportingGroup}`.toLowerCase()
        : "";
      if (
        !name.includes(q) &&
        !vin.includes(q) &&
        !desc.includes(q) &&
        !buyer.includes(q) &&
        !classInfo.includes(q)
      ) {
        return false;
      }
    }
    return true;
  });

  // Derive NBV and accumulated at sale from the frozen gain/loss rather than
  // the asset-header `book_accumulated_depreciation` / `book_net_value`. The
  // header is updated by the regenerate routine from the formula-computed
  // schedule, which can drift from the subledger's prior-month-end value
  // used to compute gain/loss (manual overrides, imported opening balances).
  // Deriving here keeps Cost − Accum = NBV and NBV − Sale Price = Loss.
  function getSaleFigures(a: SoldAsset) {
    const taxBasis = a.tax_cost_basis ?? a.acquisition_cost;
    const sp = a.disposed_sale_price;
    const bookGL = a.disposed_book_gain_loss;
    const taxGL = a.disposed_tax_gain_loss;
    const bookNbv =
      sp != null && bookGL != null ? sp - bookGL : a.book_net_value ?? 0;
    const bookAccum =
      sp != null && bookGL != null
        ? a.acquisition_cost - bookNbv
        : a.book_accumulated_depreciation ?? 0;
    const taxNbv =
      sp != null && taxGL != null ? sp - taxGL : a.tax_net_value ?? 0;
    const taxAccum =
      sp != null && taxGL != null
        ? taxBasis - taxNbv
        : a.tax_accumulated_depreciation ?? 0;
    return { bookNbv, bookAccum, taxNbv, taxAccum };
  }

  const totalCost = filteredAssets.reduce((s, a) => s + a.acquisition_cost, 0);
  const totalAccumDepr = filteredAssets.reduce(
    (s, a) => s + getSaleFigures(a).bookAccum,
    0
  );
  const totalNbv = filteredAssets.reduce(
    (s, a) => s + getSaleFigures(a).bookNbv,
    0
  );
  const totalProceeds = filteredAssets.reduce((s, a) => s + (a.disposed_sale_price ?? 0), 0);
  const totalBookGainLoss = filteredAssets.reduce((s, a) => s + (a.disposed_book_gain_loss ?? 0), 0);
  const totalTaxGainLoss = filteredAssets.reduce((s, a) => s + (a.disposed_tax_gain_loss ?? 0), 0);

  // Year options: current year and 4 years back
  const yearOptions = Array.from({ length: 5 }, (_, i) => String(currentYear - i));

  function openExportWizard() {
    if (filteredAssets.length === 0) {
      toast.error("No sold assets to export");
      return;
    }
    setExportOpen(true);
  }

  async function handleExportExcel() {
    if (filteredAssets.length === 0) {
      toast.error("No sold assets to export");
      return;
    }
    setExporting(true);
    try {
      // Scope filter — the on-screen filters still apply; this narrows
      // further. "all" = Vehicles & Trailers.
      const toExport = filteredAssets.filter((a) => {
        if (exportMasterType === "all") return true;
        const mt = getEffectiveMasterType(a.vehicle_class, a.master_type_override);
        return mt === exportMasterType;
      });

      if (toExport.length === 0) {
        toast.error("Nothing to export for the selected scope");
        setExporting(false);
        return;
      }

      const { data: entityRow } = await supabase
        .from("entities")
        .select("name")
        .eq("id", entityId)
        .single();
      const entityName = (entityRow as { name?: string } | null)?.name ?? "";

      type Row = (typeof toExport)[number];
      const columns: ColumnDef<Row>[] = [
        {
          header: "Asset Tag",
          width: 14,
          value: (r) => r.asset_tag ?? "",
        },
        {
          header: "Class",
          width: 8,
          align: "center",
          value: (r) =>
            getVehicleClassification(r.vehicle_class)?.class ?? "",
        },
        {
          header: "Class Description",
          width: 26,
          value: (r) =>
            getVehicleClassification(r.vehicle_class)?.className ?? "",
        },
        {
          header: "Reporting Group",
          width: 18,
          value: (r) =>
            getVehicleClassification(r.vehicle_class)?.reportingGroup ?? "",
        },
        {
          header: "Master Type",
          width: 12,
          value: (r) =>
            getEffectiveMasterType(r.vehicle_class, r.master_type_override) ?? "",
        },
        {
          header: "Vehicle",
          width: 28,
          value: (r) =>
            r.vehicle_year || r.vehicle_make || r.vehicle_model
              ? `${r.vehicle_year ?? ""} ${r.vehicle_make ?? ""} ${r.vehicle_model ?? ""}`.trim()
              : r.asset_name,
        },
        {
          header: "VIN",
          width: 20,
          value: (r) => r.vin ?? "",
        },
        {
          header: "Sale Date",
          width: 12,
          format: NUMBER_FORMATS.date,
          value: (r) => parseIsoDate(r.disposed_date) ?? "",
        },
        {
          header: "Buyer",
          width: 22,
          value: (r) => r.disposed_buyer ?? "",
        },
        {
          header: "Original Cost",
          width: 16,
          format: NUMBER_FORMATS.currency,
          total: "sum",
          value: (r) => Number(r.acquisition_cost) || 0,
        },
        {
          header: "Accum. Depreciation",
          width: 18,
          format: NUMBER_FORMATS.currency,
          total: "sum",
          value: (r) => getSaleFigures(r).bookAccum,
        },
        {
          header: "Book NBV at Sale",
          width: 18,
          format: NUMBER_FORMATS.currency,
          total: "sum",
          value: (r) => getSaleFigures(r).bookNbv,
        },
        {
          header: "Sale Price",
          width: 16,
          format: NUMBER_FORMATS.currency,
          total: "sum",
          value: (r) => Number(r.disposed_sale_price ?? 0) || 0,
        },
        {
          header: "Book Gain/(Loss)",
          width: 18,
          format: NUMBER_FORMATS.currency,
          total: "sum",
          value: (r) => Number(r.disposed_book_gain_loss ?? 0) || 0,
        },
      ];

      if (exportIncludeTax) {
        columns.push(
          {
            header: "Tax Cost Basis",
            width: 18,
            format: NUMBER_FORMATS.currency,
            total: "sum",
            value: (r) =>
              Number(r.tax_cost_basis ?? r.acquisition_cost) || 0,
          },
          {
            header: "Tax Accum. Depreciation",
            width: 20,
            format: NUMBER_FORMATS.currency,
            total: "sum",
            value: (r) => getSaleFigures(r).taxAccum,
          },
          {
            header: "Tax NBV at Sale",
            width: 18,
            format: NUMBER_FORMATS.currency,
            total: "sum",
            value: (r) => getSaleFigures(r).taxNbv,
          },
          {
            header: "Tax Gain/(Loss)",
            width: 18,
            format: NUMBER_FORMATS.currency,
            total: "sum",
            value: (r) => Number(r.disposed_tax_gain_loss ?? 0) || 0,
          }
        );
      }

      const scopeLabel =
        exportMasterType === "Vehicle"
          ? "Vehicles"
          : exportMasterType === "Trailer"
            ? "Trailers"
            : "Vehicles & Trailers";

      const wb = createWorkbook({
        company: entityName,
        title: `Disposed Assets — ${year}`,
      });
      addSheet(wb, {
        name: "Disposed Assets",
        columns,
        rows: toExport,
        title: {
          entityName,
          reportTitle: "Disposed Assets Schedule",
          subtitle: `Rental Fleet — ${scopeLabel}`,
          period: `January 1, ${year} through December 31, ${year}`,
          asOf: `Generated ${formatLongDate(new Date().toISOString().slice(0, 10))}`,
        },
        groupBy: (r) =>
          getEffectiveMasterType(r.vehicle_class, r.master_type_override) ??
          "Unallocated",
        sort: (a, b) =>
          (b.disposed_date ?? "").localeCompare(a.disposed_date ?? ""),
        grandTotal: true,
        footnote:
          "Gain/(loss) computed as Sale Price less Net Book Value at disposal.",
      });

      await downloadWorkbook(
        wb,
        `disposed-assets-${year}-${entityId.slice(0, 8)}`
      );
      toast.success("Excel export downloaded");
      setExportOpen(false);
    } catch (err) {
      console.error(err);
      toast.error("Failed to export Excel");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Vehicles Sold</p>
            <p className="text-2xl font-semibold tabular-nums">
              {filteredAssets.length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Original Cost</p>
            <p className="text-2xl font-semibold tabular-nums">
              {formatCurrency(totalCost)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Sale Proceeds</p>
            <p className="text-2xl font-semibold tabular-nums">
              {formatCurrency(totalProceeds)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Book Gain/(Loss)</p>
            <p
              className={`text-2xl font-semibold tabular-nums ${
                totalBookGainLoss >= 0 ? "text-green-600" : "text-red-600"
              }`}
            >
              {formatCurrency(totalBookGainLoss)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, VIN, buyer, or class..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={year} onValueChange={setYear}>
          <SelectTrigger className="w-[120px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {yearOptions.map((y) => (
              <SelectItem key={y} value={y}>
                {y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={masterTypeFilter} onValueChange={setMasterTypeFilter}>
          <SelectTrigger className="w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="Vehicle">Vehicle</SelectItem>
            <SelectItem value="Trailer">Trailer</SelectItem>
          </SelectContent>
        </Select>
        <Select value={reportingGroupFilter} onValueChange={setReportingGroupFilter}>
          <SelectTrigger className="w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Groups</SelectItem>
            {REPORTING_GROUPS.map((group) => (
              <SelectItem key={group} value={group}>
                {group}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          className="ml-auto"
          onClick={openExportWizard}
          disabled={filteredAssets.length === 0}
        >
          <Download className="mr-2 h-4 w-4" />
          Export Excel
        </Button>
      </div>

      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Export Sold Assets</DialogTitle>
            <DialogDescription>
              Choose the scope and whether to include tax-basis columns.
              On-screen search and filters are still applied.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Scope</Label>
              <Select
                value={exportMasterType}
                onValueChange={(v: "all" | "Vehicle" | "Trailer") =>
                  setExportMasterType(v)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Vehicles & Trailers (default)</SelectItem>
                  <SelectItem value="Vehicle">Vehicles only</SelectItem>
                  <SelectItem value="Trailer">Trailers only</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-start gap-2">
              <Checkbox
                id="export-include-tax"
                checked={exportIncludeTax}
                onCheckedChange={(c) => setExportIncludeTax(c === true)}
              />
              <div className="grid gap-0.5 leading-none">
                <Label htmlFor="export-include-tax" className="cursor-pointer">
                  Include tax basis columns
                </Label>
                <p className="text-xs text-muted-foreground">
                  Adds Tax Cost Basis, Tax Accum. Depreciation, Tax NBV at Sale,
                  and Tax Gain/(Loss). Off by default.
                </p>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setExportOpen(false)}
              disabled={exporting}
            >
              Cancel
            </Button>
            <Button onClick={handleExportExcel} disabled={exporting}>
              <Download className="mr-2 h-4 w-4" />
              {exporting ? "Generating..." : "Download"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sold Assets Table */}
      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : filteredAssets.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Car className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">No Sold Assets</h3>
              <p className="text-muted-foreground text-center">
                {searchQuery || masterTypeFilter !== "all" || reportingGroupFilter !== "all"
                  ? "No sold assets match your current filters."
                  : `No vehicles were sold in ${year}.`}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Asset Tag</TableHead>
                  <TableHead>Class</TableHead>
                  <TableHead>Vehicle</TableHead>
                  <TableHead>VIN</TableHead>
                  <TableHead>Sale Date</TableHead>
                  <TableHead>Buyer</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right">Accum. Depreciation</TableHead>
                  <TableHead className="text-right">Book NBV at Sale</TableHead>
                  <TableHead className="text-right">Sale Price</TableHead>
                  <TableHead className="text-right">Book Gain/(Loss)</TableHead>
                  <TableHead className="text-right">Tax Gain/(Loss)</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredAssets.map((asset) => {
                  const classification = getVehicleClassification(asset.vehicle_class);
                  const saleFigures = getSaleFigures(asset);
                  return (
                    <TableRow key={asset.id}>
                      <TableCell className="font-medium">
                        {asset.asset_tag ?? "---"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {classification ? (
                          <div>
                            <span className="font-medium">{classification.class}</span>
                            <span className="text-muted-foreground ml-1">
                              {classification.className}
                            </span>
                          </div>
                        ) : (
                          "---"
                        )}
                      </TableCell>
                      <TableCell>
                        {asset.vehicle_year || asset.vehicle_make || asset.vehicle_model
                          ? `${asset.vehicle_year ?? ""} ${asset.vehicle_make ?? ""} ${asset.vehicle_model ?? ""}`.trim()
                          : asset.asset_name}
                      </TableCell>
                      <TableCell className="text-muted-foreground font-mono text-xs">
                        {asset.vin ?? "---"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {asset.disposed_date
                          ? formatIsoDateLocal(asset.disposed_date)
                          : "---"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {asset.disposed_buyer ?? "---"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(asset.acquisition_cost)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-red-600">
                        {saleFigures.bookAccum > 0
                          ? `(${formatCurrency(saleFigures.bookAccum)})`
                          : formatCurrency(0)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(saleFigures.bookNbv)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(asset.disposed_sale_price ?? 0)}
                      </TableCell>
                      <TableCell
                        className={`text-right tabular-nums font-medium ${
                          (asset.disposed_book_gain_loss ?? 0) >= 0
                            ? "text-green-600"
                            : "text-red-600"
                        }`}
                      >
                        {formatCurrency(asset.disposed_book_gain_loss ?? 0)}
                      </TableCell>
                      <TableCell
                        className={`text-right tabular-nums font-medium ${
                          (asset.disposed_tax_gain_loss ?? 0) >= 0
                            ? "text-green-600"
                            : "text-red-600"
                        }`}
                      >
                        {formatCurrency(asset.disposed_tax_gain_loss ?? 0)}
                      </TableCell>
                      <TableCell>
                        <Link href={`/${entityId}/assets/${asset.id}`}>
                          <Button variant="ghost" size="sm">
                            <ArrowRight className="h-4 w-4" />
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {/* Totals Row */}
                <TableRow className="font-semibold border-t-2">
                  <TableCell colSpan={6}>Total</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCurrency(totalCost)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-red-600">
                    {totalAccumDepr > 0
                      ? `(${formatCurrency(totalAccumDepr)})`
                      : formatCurrency(0)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCurrency(totalNbv)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCurrency(totalProceeds)}
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums ${
                      totalBookGainLoss >= 0 ? "text-green-600" : "text-red-600"
                    }`}
                  >
                    {formatCurrency(totalBookGainLoss)}
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums ${
                      totalTaxGainLoss >= 0 ? "text-green-600" : "text-red-600"
                    }`}
                  >
                    {formatCurrency(totalTaxGainLoss)}
                  </TableCell>
                  <TableCell></TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
