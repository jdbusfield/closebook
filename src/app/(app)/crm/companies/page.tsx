import Link from "next/link";
import { Building2, Search } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getCrmCompanies } from "@/lib/db/queries/crm";

interface PageProps {
  searchParams: Promise<{ q?: string }>;
}

function CompaniesTable({ rows }: { rows: Array<{ id: string; name: string; type: string }> }) {
  if (rows.length === 0) return <p className="p-6 text-center text-muted-foreground">No companies in this view.</p>;
  return (
    <table className="w-full text-sm">
      <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
        <tr>
          <th className="px-4 py-2 text-left">Name</th>
          <th className="px-4 py-2 text-left">Type</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(c => (
          <tr key={c.id} className="border-t hover:bg-muted/30">
            <td className="px-4 py-2 font-medium">
              <Link href={`/crm/companies/${c.id}`} className="hover:underline">{c.name}</Link>
            </td>
            <td className="px-4 py-2">
              <Badge variant="outline" className="text-xs">{c.type}</Badge>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default async function CompaniesListPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const all = await getCrmCompanies({ search: sp.q });
  const productionCompanies = all.filter(c => c.type === "production_company");
  const studios = all.filter(c => c.type === "studio");
  const others = all.filter(c => c.type !== "production_company" && c.type !== "studio");

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Building2 className="h-6 w-6" /> Companies
        </h1>
        <p className="text-sm text-muted-foreground">
          {all.length} total · {productionCompanies.length} production companies · {studios.length} studios
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardDescription>Search</CardDescription>
          <form className="flex items-end gap-2">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input name="q" defaultValue={sp.q ?? ""} placeholder="Search company name…" className="pl-8" />
              </div>
            </div>
            <Button type="submit" size="sm">Apply</Button>
            {sp.q && (
              <Button asChild type="button" variant="ghost" size="sm">
                <Link href="/crm/companies">Clear</Link>
              </Button>
            )}
          </form>
        </CardHeader>
      </Card>

      <Tabs defaultValue="all">
        <TabsList>
          <TabsTrigger value="all">All ({all.length})</TabsTrigger>
          <TabsTrigger value="production">Production Cos. ({productionCompanies.length})</TabsTrigger>
          <TabsTrigger value="studio">Studios ({studios.length})</TabsTrigger>
          {others.length > 0 && <TabsTrigger value="other">Other ({others.length})</TabsTrigger>}
        </TabsList>
        <TabsContent value="all"><Card><CardContent className="p-0"><CompaniesTable rows={all} /></CardContent></Card></TabsContent>
        <TabsContent value="production"><Card><CardContent className="p-0"><CompaniesTable rows={productionCompanies} /></CardContent></Card></TabsContent>
        <TabsContent value="studio"><Card><CardContent className="p-0"><CompaniesTable rows={studios} /></CardContent></Card></TabsContent>
        {others.length > 0 && <TabsContent value="other"><Card><CardContent className="p-0"><CompaniesTable rows={others} /></CardContent></Card></TabsContent>}
      </Tabs>
    </div>
  );
}
