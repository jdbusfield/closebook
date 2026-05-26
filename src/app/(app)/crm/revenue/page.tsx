import Link from "next/link";
import { DollarSign, Upload, TrendingUp } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getProductionRevenueList } from "@/lib/db/queries/crm-revenue";
import { ProductionStatusBadge } from "../_components/crm-shared";

function money(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}
function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default async function CrmRevenuePage() {
  const rows = await getProductionRevenueList();
  const totals = rows.reduce(
    (acc, r) => {
      acc.ytd += r.ytd_revenue;
      acc.lifetime += r.lifetime_revenue;
      acc.invoices += r.invoice_count;
      return acc;
    },
    { ytd: 0, lifetime: 0, invoices: 0 },
  );

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <DollarSign className="h-6 w-6" /> Revenue by Production
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Combined revenue from RentalWorks (live) and Cars Plus (legacy uploads). Link customer numbers on each production to feed this view.
          </p>
        </div>
        <Button asChild>
          <Link href="/crm/revenue/upload"><Upload className="mr-1 h-4 w-4" /> Upload Cars Plus export</Link>
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="flex items-start justify-between p-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">YTD revenue (all productions)</p>
              <p className="mt-1 text-2xl font-semibold">{money(totals.ytd)}</p>
            </div>
            <TrendingUp className="h-5 w-5 text-muted-foreground" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-start justify-between p-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Lifetime</p>
              <p className="mt-1 text-2xl font-semibold">{money(totals.lifetime)}</p>
            </div>
            <DollarSign className="h-5 w-5 text-muted-foreground" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-start justify-between p-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Total invoices</p>
              <p className="mt-1 text-2xl font-semibold">{totals.invoices.toLocaleString()}</p>
            </div>
            <Badge variant="outline">{rows.filter(r => r.invoice_count > 0).length} productions earning</Badge>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All productions</CardTitle>
          <CardDescription>Sorted by YTD revenue, descending.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">No productions yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left">Production</th>
                  <th className="px-4 py-2 text-left">Status</th>
                  <th className="px-4 py-2 text-left">Owner</th>
                  <th className="px-4 py-2 text-right">YTD</th>
                  <th className="px-4 py-2 text-right">Lifetime</th>
                  <th className="px-4 py-2 text-right">Invoices</th>
                  <th className="px-4 py-2 text-left">Last invoice</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.production_id} className="border-t hover:bg-muted/30">
                    <td className="px-4 py-2 font-medium">
                      <Link href={`/crm/productions/${r.production_id}`} className="hover:underline">{r.name}</Link>
                    </td>
                    <td className="px-4 py-2"><ProductionStatusBadge status={r.status} /></td>
                    <td className="px-4 py-2 text-muted-foreground">{r.owner_name ?? "—"}</td>
                    <td className="px-4 py-2 text-right font-medium">{money(r.ytd_revenue)}</td>
                    <td className="px-4 py-2 text-right">{money(r.lifetime_revenue)}</td>
                    <td className="px-4 py-2 text-right text-muted-foreground">{r.invoice_count}</td>
                    <td className="px-4 py-2 text-muted-foreground">{fmtDate(r.last_invoice_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
