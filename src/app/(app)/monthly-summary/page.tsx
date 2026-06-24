"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { FileText, Download, Loader2, AlertCircle } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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
import { buildMonthlySummary, MONTH_NAMES } from "./monthly-summary-data";
import { MonthlySummaryView } from "./monthly-summary-view";
import { exportMonthlySummaryPdf } from "./monthly-summary-pdf";

export default function MonthlySummaryPage() {
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [orgName, setOrgName] = useState<string>("");
  const [checked, setChecked] = useState(false);

  const [includeService, setIncludeService] = useState(false);
  const [{ year, month }, setPeriod] = useState(() => {
    const now = getCurrentPeriod();
    const m = now.month - 1;
    return m < 1 ? { year: now.year - 1, month: 12 } : { year: now.year, month: m };
  });

  const [data, setData] = useState<MonthlySummaryInput | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

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
        setOrganizationId(memberships[0].organization_id);
        const orgRel = (memberships[0] as { organizations?: { name?: string } | { name?: string }[] })
          .organizations;
        const name = Array.isArray(orgRel) ? orgRel[0]?.name : orgRel?.name;
        setOrgName(name ?? "Organization");
      }
      setChecked(true);
    })();
  }, []);

  const yearOptions = useMemo(() => {
    const now = getCurrentPeriod();
    return [now.year, now.year - 1, now.year - 2];
  }, []);

  const load = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    setError(null);
    try {
      const model = await buildMonthlySummary({
        organizationId,
        organizationName: orgName,
        year,
        month,
        includeService,
      });
      setData(model);
    } catch (e) {
      console.error(e);
      setData(null);
      setError(e instanceof Error ? e.message : "Failed to load summary");
    } finally {
      setLoading(false);
    }
  }, [organizationId, orgName, year, month, includeService]);

  // Re-fetch the preview whenever the inputs change.
  useEffect(() => {
    load();
  }, [load]);

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
