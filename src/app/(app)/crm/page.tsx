import Link from "next/link";
import { Clapperboard, Building2, Users, Activity } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  getCrmProductions,
  getCrmStatusCounts,
  getCrmContactCount,
  getCrmCompanyCount,
} from "@/lib/db/queries/crm";

const STATUS_ORDER = [
  "pre-prepping",
  "prepping",
  "shooting",
  "reshoots",
  "wrapping",
  "completed",
  "archived",
] as const;

const STATUS_LABEL: Record<string, string> = {
  "pre-prepping": "Pre-prepping",
  prepping: "Prepping",
  shooting: "Shooting",
  reshoots: "Reshoots",
  wrapping: "Wrapping",
  completed: "Completed",
  archived: "Archived",
};

const STATUS_BADGE: Record<string, string> = {
  "pre-prepping": "bg-slate-100 text-slate-700",
  prepping: "bg-amber-100 text-amber-800",
  shooting: "bg-emerald-100 text-emerald-800",
  reshoots: "bg-sky-100 text-sky-800",
  wrapping: "bg-purple-100 text-purple-800",
  completed: "bg-slate-100 text-slate-600",
  archived: "bg-slate-200 text-slate-500",
};

function formatDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default async function CrmPage() {
  const [productions, statusCounts, contactCount, companyCount] = await Promise.all([
    getCrmProductions(),
    getCrmStatusCounts(),
    getCrmContactCount(),
    getCrmCompanyCount(),
  ]);

  const activeCount = STATUS_ORDER
    .filter(s => s !== "completed" && s !== "archived")
    .reduce((sum, s) => sum + (statusCounts[s] ?? 0), 0);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Clapperboard className="h-6 w-6" /> CRM
          </h1>
          <p className="text-sm text-muted-foreground">
            Productions, studios, and the contacts who run them.
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Active productions</CardDescription>
            <CardTitle className="text-3xl">{activeCount}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Anything not completed or archived
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total productions</CardDescription>
            <CardTitle className="text-3xl">{productions.length}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            <Activity className="mr-1 inline h-3 w-3" /> All-time
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Contacts</CardDescription>
            <CardTitle className="text-3xl">{contactCount}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            <Users className="mr-1 inline h-3 w-3" /> Across all companies
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Companies</CardDescription>
            <CardTitle className="text-3xl">{companyCount}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            <Building2 className="mr-1 inline h-3 w-3" /> Production cos + studios
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>By status</CardTitle>
          <CardDescription>Production pipeline at a glance</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {STATUS_ORDER.map(status => (
              <Badge
                key={status}
                className={`${STATUS_BADGE[status] ?? "bg-slate-100"} px-3 py-1`}
                variant="secondary"
              >
                {STATUS_LABEL[status]}: {statusCounts[status] ?? 0}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Productions</CardTitle>
          <CardDescription>{productions.length} total</CardDescription>
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
                      No productions yet. Run the import script (scripts/crm-import.ts) or upload a
                      weekly production report to populate this view.
                    </td>
                  </tr>
                ) : (
                  productions.map(p => (
                    <tr key={p.id} className="border-t hover:bg-muted/30">
                      <td className="px-4 py-2 font-medium">
                        <Link href={`/crm/productions/${p.id}`} className="hover:underline">
                          {p.name}
                        </Link>
                      </td>
                      <td className="px-4 py-2">{p.company?.name ?? "—"}</td>
                      <td className="px-4 py-2">{p.studio?.name ?? "—"}</td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {p.production_type ?? "—"}
                      </td>
                      <td className="px-4 py-2">
                        <Badge
                          className={`${STATUS_BADGE[p.status] ?? "bg-slate-100"} text-xs`}
                          variant="secondary"
                        >
                          {STATUS_LABEL[p.status] ?? p.status}
                        </Badge>
                      </td>
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
