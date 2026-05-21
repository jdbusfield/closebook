import Link from "next/link";
import { Search, Calendar as CalendarIcon, MessageSquare } from "lucide-react";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  getCrmBoardProductions,
  getCrmCompanies,
  type BoardProductionCard,
} from "@/lib/db/queries/crm";

interface PageProps {
  searchParams: Promise<{
    q?: string;
    ca?: string;
    only399?: string;
    tab?: string;
  }>;
}

const COLUMNS: Array<{ key: string; label: string; headerClass: string; cardBorder: string }> = [
  { key: "pre-prepping", label: "Pre-Prepping", headerClass: "text-purple-700",  cardBorder: "border-l-4 border-l-purple-400" },
  { key: "prepping",     label: "Prepping",     headerClass: "text-sky-700",     cardBorder: "border-l-4 border-l-sky-400" },
  { key: "shooting",     label: "Shooting",     headerClass: "text-emerald-700", cardBorder: "border-l-4 border-l-emerald-400" },
  { key: "reshoots",     label: "Reshoots",     headerClass: "text-cyan-700",    cardBorder: "border-l-4 border-l-cyan-400" },
  { key: "wrapping",     label: "Wrapping",     headerClass: "text-amber-700",   cardBorder: "border-l-4 border-l-amber-400" },
];

function formatRange(start: string | null, end: string | null): string {
  const fmt = (d: string) => {
    const date = new Date(d);
    return Number.isNaN(date.getTime())
      ? null
      : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  };
  const s = start ? fmt(start) : null;
  const e = end ? fmt(end) : null;
  if (s && e) return `${s} - ${e}`;
  if (s) return s;
  if (e) return `→ ${e}`;
  return "Dates TBD";
}

function CaSpendPips({ level }: { level: number | null }) {
  if (!level || level < 1) return null;
  return (
    <span className="ml-2 font-bold tracking-tighter text-emerald-600" title={`CA spend level ${level}`}>
      {"$".repeat(Math.min(level, 5))}
    </span>
  );
}

function ProductionCardBox({ card, borderClass }: { card: BoardProductionCard; borderClass: string }) {
  const bgClass = card.is_independent ? "bg-sky-50" : "bg-card";
  return (
    <Link
      href={`/crm/productions/${card.id}`}
      className={`relative block rounded-lg ${borderClass} ${bgClass} p-3 shadow-sm transition hover:shadow-md`}
    >
      {card.communication_count > 0 && (
        <div className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-blue-500 text-[10px] font-semibold text-white">
          {card.communication_count}
        </div>
      )}
      <div className="pr-8">
        <div className="flex flex-wrap items-center gap-x-1 gap-y-1 leading-tight">
          <span className="font-semibold">{card.name}</span>
          {card.alias_count > 0 && (
            <Badge variant="outline" className="ml-1 h-5 rounded-full px-2 py-0 text-[10px]">
              {card.alias_count} alias{card.alias_count > 1 ? "es" : ""}
            </Badge>
          )}
          <CaSpendPips level={card.ca_spend_level} />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{card.studio_or_company_name}</p>
        <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
          <CalendarIcon className="h-3 w-3" />
          <span>{formatRange(card.start_date, card.end_date)}</span>
        </div>
        {card.avon_customer_number && (
          <p className="mt-1 text-xs text-muted-foreground">
            Avon Customer #: {card.avon_customer_number}
          </p>
        )}
        <div className="mt-2 flex flex-wrap gap-1">
          {card.vendors.avon && (
            <span className="rounded-md bg-red-500 px-2 py-0.5 text-[10px] font-semibold text-white">Avon</span>
          )}
          {card.vendors.hdr && (
            <span className="rounded-md bg-blue-600 px-2 py-0.5 text-[10px] font-semibold text-white">HDR</span>
          )}
          {card.is_399_production && (
            <span className="rounded-md bg-slate-700 px-2 py-0.5 text-[10px] font-semibold text-white">399</span>
          )}
        </div>
      </div>
    </Link>
  );
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
            <td className="px-4 py-2"><Badge variant="outline" className="text-xs">{c.type}</Badge></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default async function ClientsBoardPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  // California Only defaults to true (matches operational view) — explicit "off" disables
  const californiaOnly = sp.ca === "off" ? false : true;
  const only399 = sp.only399 === "true";
  const tab = sp.tab ?? "productions";

  const [productions, allCompanies] = await Promise.all([
    getCrmBoardProductions({ californiaOnly, only399, search: sp.q }),
    getCrmCompanies(),
  ]);

  const byStatus: Record<string, BoardProductionCard[]> = {};
  for (const col of COLUMNS) byStatus[col.key] = [];
  for (const p of productions) {
    if (byStatus[p.status]) byStatus[p.status].push(p);
  }

  const productionCompanies = allCompanies.filter(c => c.type === "production_company");
  const studios = allCompanies.filter(c => c.type === "studio");

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Clients &amp; Productions</h1>
        <form className="flex flex-wrap items-center gap-2">
          {sp.tab && <input type="hidden" name="tab" value={sp.tab} />}
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input name="q" defaultValue={sp.q ?? ""} placeholder="Search..." className="h-9 w-64 pl-8" />
          </div>
          <label className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
            <input
              type="checkbox"
              name="ca"
              value="on"
              defaultChecked={californiaOnly}
              className="h-4 w-4"
            />
            California Only
          </label>
          <label className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
            <input
              type="checkbox"
              name="only399"
              value="true"
              defaultChecked={only399}
              className="h-4 w-4"
            />
            399 Only
          </label>
          <Button type="submit" size="sm">Apply</Button>
          {(sp.q || only399 || sp.ca === "off") && (
            <Button asChild type="button" variant="ghost" size="sm">
              <Link href="/crm/clients">Reset</Link>
            </Button>
          )}
        </form>
      </div>

      {/* Hidden form value used by the checkbox-off case: if the box is unchecked, no value is submitted.
          The page's default is california=true; clicking Reset reverts to default. To disable CA, the user unchecks. */}

      <Tabs defaultValue={tab}>
        <TabsList>
          <TabsTrigger value="productions" asChild><Link href={{ query: { ...(sp.q && { q: sp.q }), ...(only399 && { only399: "true" }), ...(sp.ca === "off" && { ca: "off" }), tab: "productions" } }}>Productions</Link></TabsTrigger>
          <TabsTrigger value="companies" asChild><Link href={{ query: { tab: "companies" } }}>Companies</Link></TabsTrigger>
          <TabsTrigger value="studios" asChild><Link href={{ query: { tab: "studios" } }}>Studios</Link></TabsTrigger>
        </TabsList>

        <TabsContent value="productions" className="mt-4">
          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-5">
            {COLUMNS.map(col => {
              const cards = byStatus[col.key] ?? [];
              const indyCount = cards.filter(c => c.is_independent).length;
              if (cards.length === 0 && (col.key === "reshoots")) {
                return null; // hide empty Reshoots column to save space
              }
              return (
                <div key={col.key} className="space-y-3">
                  <div className="flex items-center justify-between rounded-md bg-muted/30 px-3 py-2">
                    <h2 className={`text-sm font-bold uppercase tracking-wide ${col.headerClass}`}>{col.label}</h2>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-muted-foreground">{cards.length} total</span>
                      {indyCount > 0 && (
                        <Badge variant="outline" className="h-5 rounded-full px-2 py-0 text-[10px]">
                          {indyCount} Independent
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="space-y-2">
                    {cards.length === 0 ? (
                      <p className="rounded-md border border-dashed py-6 text-center text-xs text-muted-foreground">
                        No productions in {col.label.toLowerCase()}.
                      </p>
                    ) : (
                      cards.map(card => (
                        <ProductionCardBox key={card.id} card={card} borderClass={col.cardBorder} />
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </TabsContent>

        <TabsContent value="companies" className="mt-4">
          <Card><CardContent className="p-0"><CompaniesTable rows={productionCompanies} /></CardContent></Card>
        </TabsContent>

        <TabsContent value="studios" className="mt-4">
          <Card><CardContent className="p-0"><CompaniesTable rows={studios} /></CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
