"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { FileText, Download, Loader2, AlertCircle, Pencil } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { getCurrentPeriod } from "@/lib/utils/dates";
import type { MonthlySummaryInput } from "./monthly-summary-model";
import {
  fetchSummaryBase,
  buildManualPanels,
  loadManualInputs,
  saveManualInputs,
  emptyManualInputs,
  MONTH_NAMES,
  MONTH_SHORT,
  type ManualInputs,
} from "./monthly-summary-data";
import { MonthlySummaryView } from "./monthly-summary-view";
import { exportMonthlySummaryPdf } from "./monthly-summary-pdf";

interface Entity {
  id: string;
  name: string;
  code: string;
}

// Parse a number input into number | null (blank → null).
function toNum(v: string): number | null {
  if (v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export default function MonthlySummaryPage() {
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [orgName, setOrgName] = useState<string>("");
  const [checked, setChecked] = useState(false);
  const [entities, setEntities] = useState<Entity[]>([]);

  const [includeService, setIncludeService] = useState(false);
  const [{ year, month }, setPeriod] = useState(() => {
    const now = getCurrentPeriod();
    const m = now.month - 1;
    return m < 1 ? { year: now.year - 1, month: 12 } : { year: now.year, month: m };
  });

  const [base, setBase] = useState<MonthlySummaryInput | null>(null);
  const [manual, setManual] = useState<ManualInputs>(emptyManualInputs);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const monthShort = `${MONTH_SHORT[month]}-${String(year).slice(2)}`;
  const pyShort = `${MONTH_SHORT[month]}-${String(year - 1).slice(2)}`;

  // ── Load org + entities ──
  useEffect(() => {
    const supabase = createClient();
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setChecked(true);
        return;
      }
      const { data: memberships } = await supabase
        .from("organization_members")
        .select("organization_id, organizations(name)")
        .eq("user_id", user.id)
        .limit(1);
      if (memberships && memberships[0]) {
        const orgId = memberships[0].organization_id;
        setOrganizationId(orgId);
        const orgRel = (memberships[0] as { organizations?: { name?: string } | { name?: string }[] })
          .organizations;
        const name = Array.isArray(orgRel) ? orgRel[0]?.name : orgRel?.name;
        setOrgName(name ?? "Organization");

        // Headcount is entered against the three top-level reporting entities
        // (Avon, HDR, VS) — not every legal entity. Pull them in that order.
        // reporting_entities isn't in the generated types, so use a loose client.
        const HEADCOUNT_CODES = ["Avon", "HDR", "VS"];
        const order = new Map(HEADCOUNT_CODES.map((c, i) => [c, i]));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const reRes = await (supabase as any)
          .from("reporting_entities")
          .select("id, name, code")
          .eq("organization_id", orgId);
        const groups = ((reRes.data ?? []) as Entity[])
          .filter((r) => order.has(r.code))
          .sort((a, b) => (order.get(a.code) ?? 0) - (order.get(b.code) ?? 0));
        setEntities(groups);
      }
      setChecked(true);
    })();
  }, []);

  const yearOptions = useMemo(() => {
    const now = getCurrentPeriod();
    return [now.year, now.year - 1, now.year - 2];
  }, []);

  // ── Load saved manual inputs whenever the period changes ──
  useEffect(() => {
    if (!organizationId) return;
    setManual(loadManualInputs(organizationId, year, month));
  }, [organizationId, year, month]);

  // ── Fetch the data-driven base whenever inputs change ──
  const load = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    setError(null);
    try {
      const model = await fetchSummaryBase({
        organizationId,
        organizationName: orgName,
        year,
        month,
        includeService,
      });
      setBase(model);
    } catch (e) {
      console.error(e);
      setBase(null);
      setError(e instanceof Error ? e.message : "Failed to load summary");
    } finally {
      setLoading(false);
    }
  }, [organizationId, orgName, year, month, includeService]);

  useEffect(() => {
    load();
  }, [load]);

  // ── Combine base + manual panels (cheap; recomputes on every edit) ──
  const data = useMemo<MonthlySummaryInput | null>(() => {
    if (!base) return null;
    return {
      ...base,
      panels: [
        ...(base.panels ?? []),
        ...buildManualPanels(entities, manual, monthShort, pyShort),
      ],
    };
  }, [base, entities, manual, monthShort, pyShort]);

  // ── Manual input setters (persist to localStorage) ──
  const persist = useCallback(
    (next: ManualInputs) => {
      if (organizationId) saveManualInputs(organizationId, year, month, next);
    },
    [organizationId, year, month]
  );

  function setHeadcount(entityId: string, field: "current" | "py", value: string) {
    setManual((m) => {
      const prev = m.headcount[entityId] ?? { current: null, py: null };
      const next: ManualInputs = {
        ...m,
        headcount: { ...m.headcount, [entityId]: { ...prev, [field]: toNum(value) } },
      };
      persist(next);
      return next;
    });
  }
  function setCaShows(field: "current" | "py", value: string) {
    setManual((m) => {
      const next: ManualInputs = {
        ...m,
        caShows: { ...m.caShows, [field]: toNum(value) },
      };
      persist(next);
      return next;
    });
  }

  async function handleDownload() {
    if (!data) return;
    setDownloading(true);
    try {
      await exportMonthlySummaryPdf(data);
      toast.success("Monthly summary PDF generated");
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : "Failed to generate PDF");
    } finally {
      setDownloading(false);
    }
  }

  if (!checked) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }
  if (!organizationId) {
    return (
      <div className="p-6 text-muted-foreground">No organization membership found.</div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Monthly Summary</h1>
        <p className="text-sm text-muted-foreground">
          One-page performance summary (P&amp;L, utilization, rates, fleet) for the
          financial package.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" /> Report Settings
          </CardTitle>
          <CardDescription>
            Consolidated across all entities. Month Performance includes vs-Budget
            and vs-Prior-Year; utilization, rates, and fleet show vs-Prior-Year.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1.5">
              <Label>Month</Label>
              <Select
                value={String(month)}
                onValueChange={(v) => setPeriod((p) => ({ ...p, month: Number(v) }))}
              >
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <SelectItem key={m} value={String(m)}>
                      {MONTH_NAMES[m]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Year</Label>
              <Select
                value={String(year)}
                onValueChange={(v) => setPeriod((p) => ({ ...p, year: Number(v) }))}
              >
                <SelectTrigger className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {yearOptions.map((y) => (
                    <SelectItem key={y} value={String(y)}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2 pb-2">
              <Switch id="svc" checked={includeService} onCheckedChange={setIncludeService} />
              <Label htmlFor="svc" className="text-sm font-normal">
                Include service vehicles
              </Label>
            </div>
            <div className="ml-auto pb-0.5">
              <Button onClick={handleDownload} disabled={!data || loading || downloading}>
                {downloading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generating…
                  </>
                ) : (
                  <>
                    <Download className="mr-2 h-4 w-4" /> Download PDF
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Manual data entry */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Pencil className="h-4 w-4" /> Additional Data ({MONTH_NAMES[month]} {year})
          </CardTitle>
          <CardDescription>
            Manually entered. Saved in this browser per month and flows into the
            report below.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div>
            <div className="mb-2 text-sm font-medium">Headcount</div>
            <div className="overflow-x-auto">
              <table className="text-sm">
                <thead>
                  <tr className="text-muted-foreground">
                    <th className="px-2 py-1 text-left font-medium">Reporting Entity</th>
                    <th className="px-2 py-1 text-right font-medium">{monthShort}</th>
                    <th className="px-2 py-1 text-right font-medium">{pyShort}</th>
                  </tr>
                </thead>
                <tbody>
                  {entities.map((e) => (
                    <tr key={e.id}>
                      <td className="px-2 py-1 whitespace-nowrap">{e.code || e.name}</td>
                      <td className="px-2 py-1">
                        <Input
                          type="number"
                          inputMode="numeric"
                          className="h-8 w-24 text-right"
                          value={manual.headcount[e.id]?.current ?? ""}
                          onChange={(ev) => setHeadcount(e.id, "current", ev.target.value)}
                        />
                      </td>
                      <td className="px-2 py-1">
                        <Input
                          type="number"
                          inputMode="numeric"
                          className="h-8 w-24 text-right"
                          value={manual.headcount[e.id]?.py ?? ""}
                          onChange={(ev) => setHeadcount(e.id, "py", ev.target.value)}
                        />
                      </td>
                    </tr>
                  ))}
                  {entities.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-2 py-2 text-muted-foreground">
                        No reporting entities found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <div className="mb-2 text-sm font-medium">California Shows</div>
            <div className="flex items-end gap-4">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">{monthShort}</Label>
                <Input
                  type="number"
                  inputMode="numeric"
                  className="h-8 w-28 text-right"
                  value={manual.caShows.current ?? ""}
                  onChange={(ev) => setCaShows("current", ev.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">{pyShort}</Label>
                <Input
                  type="number"
                  inputMode="numeric"
                  className="h-8 w-28 text-right"
                  value={manual.caShows.py ?? ""}
                  onChange={(ev) => setCaShows("py", ev.target.value)}
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Preview */}
      {loading ? (
        <div className="flex h-64 items-center justify-center text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Building preview…
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
        </div>
      ) : data ? (
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground">
            Preview — this is exactly what the PDF will contain.
          </div>
          <MonthlySummaryView data={data} />
        </div>
      ) : null}
    </div>
  );
}
