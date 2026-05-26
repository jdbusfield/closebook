import Link from "next/link";
import { Clapperboard, Search } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getCrmProductions } from "@/lib/db/queries/crm";
import { getStaleProductions } from "@/lib/db/queries/crm-stale";
import {
  PRODUCTION_STATUS_ORDER,
  PRODUCTION_STATUS_LABEL,
  ProductionStatusBadge,
  formatDate,
} from "../_components/crm-shared";

interface PageProps {
  searchParams: Promise<{
    status?: string;
    is399?: string;
    category?: string;
    q?: string;
    stale?: string;
  }>;
}

export default async function ProductionsListPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const staleOnly = sp.stale === "1";
  const [allProductions, stale] = await Promise.all([
    getCrmProductions({
      status: sp.status,
      is399: sp.is399 === "true" ? true : undefined,
      category: sp.category,
      search: sp.q,
    }),
    staleOnly ? getStaleProductions() : Promise.resolve([]),
  ]);
  const staleIds = new Set(stale.map(s => s.production_id));
  const productions = staleOnly
    ? allProductions.filter(p => staleIds.has(p.id))
    : allProductions;

  const activeFilters: string[] = [];
  if (sp.status) activeFilters.push(`Status: ${PRODUCTION_STATUS_LABEL[sp.status] ?? sp.status}`);
  if (sp.is399 === "true") activeFilters.push("399 productions");
  if (sp.category) activeFilters.push(`Category: ${sp.category}`);
  if (sp.q) activeFilters.push(`Search: "${sp.q}"`);
  if (staleOnly) activeFilters.push("Stale only (no activity 30+ days)");

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Clapperboard className="h-6 w-6" /> Productions
          </h1>
          <p className="text-sm text-muted-foreground">
            {productions.length} {productions.length === 1 ? "production" : "productions"}
            {activeFilters.length > 0 && ` · ${activeFilters.join(" · ")}`}
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="space-y-4">
          <CardDescription>Filters</CardDescription>
          <form className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[200px]">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Search by name</label>
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input name="q" defaultValue={sp.q ?? ""} placeholder="e.g. Paradise" className="pl-8" />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Status</label>
              <select
                name="status"
                defaultValue={sp.status ?? ""}
                className="h-9 rounded-md border bg-background px-3 text-sm"
              >
                <option value="">All</option>
                {PRODUCTION_STATUS_ORDER.map(s => (
                  <option key={s} value={s}>{PRODUCTION_STATUS_LABEL[s]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Type</label>
              <select
                name="is399"
                defaultValue={sp.is399 ?? ""}
                className="h-9 rounded-md border bg-background px-3 text-sm"
              >
                <option value="">All</option>
                <option value="true">399 only</option>
              </select>
            </div>
            <Button type="submit" size="sm">Apply</Button>
            {activeFilters.length > 0 && (
              <Button asChild type="button" variant="ghost" size="sm">
                <Link href="/crm/productions">Clear</Link>
              </Button>
            )}
          </form>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left">Production</th>
                  <th className="px-4 py-2 text-left">Production Co.</th>
                  <th className="px-4 py-2 text-left">Studio</th>
                  <th className="px-4 py-2 text-left">Type</th>
                  <th className="px-4 py-2 text-left">Status</th>
                  <th className="px-4 py-2 text-left">Start</th>
                  <th className="px-4 py-2 text-left">End</th>
                  <th className="px-4 py-2 text-left">State</th>
                </tr>
              </thead>
              <tbody>
                {productions.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
                      No productions match those filters.
                    </td>
                  </tr>
                ) : (
                  productions.map(p => (
                    <tr key={p.id} className="border-t hover:bg-muted/30">
                      <td className="px-4 py-2 font-medium">
                        <Link href={`/crm/productions/${p.id}`} className="hover:underline">
                          {p.name}
                        </Link>
                        {p.is_399_production && (
                          <Badge variant="outline" className="ml-2 text-[10px]">399</Badge>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        {p.company ? (
                          <Link href={`/crm/companies/${p.company.id}`} className="hover:underline">
                            {p.company.name}
                          </Link>
                        ) : "—"}
                      </td>
                      <td className="px-4 py-2">
                        {p.studio ? (
                          <Link href={`/crm/companies/${p.studio.id}`} className="hover:underline">
                            {p.studio.name}
                          </Link>
                        ) : "—"}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">{p.production_type ?? "—"}</td>
                      <td className="px-4 py-2"><ProductionStatusBadge status={p.status} /></td>
                      <td className="px-4 py-2 text-muted-foreground">{formatDate(p.start_date)}</td>
                      <td className="px-4 py-2 text-muted-foreground">{formatDate(p.end_date)}</td>
                      <td className="px-4 py-2 text-muted-foreground">{p.state ?? "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
