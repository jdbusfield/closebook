import Link from "next/link";
import { Building } from "lucide-react";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { getCrmCommercialCompanies } from "@/lib/db/queries/crm";
import { formatDate } from "../_components/crm-shared";

export default async function CommercialCompaniesListPage() {
  const companies = await getCrmCommercialCompanies();

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Building className="h-6 w-6" /> Commercial Companies
        </h1>
        <p className="text-sm text-muted-foreground">{companies.length} advertising / commercial client accounts</p>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left">Name</th>
                  <th className="px-4 py-2 text-left">Avon Customer #</th>
                  <th className="px-4 py-2 text-left">Location</th>
                  <th className="px-4 py-2 text-left">Added</th>
                </tr>
              </thead>
              <tbody>
                {companies.length === 0 ? (
                  <tr><td colSpan={4} className="px-4 py-12 text-center text-muted-foreground">No commercial companies yet.</td></tr>
                ) : (
                  companies.map(c => (
                    <tr key={c.id} className="border-t hover:bg-muted/30">
                      <td className="px-4 py-2 font-medium">
                        <Link href={`/crm/commercial-companies/${c.id}`} className="hover:underline">{c.name}</Link>
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">{c.avon_customer_number ?? "—"}</td>
                      <td className="px-4 py-2 text-muted-foreground">{c.location ?? "—"}</td>
                      <td className="px-4 py-2 text-muted-foreground">{formatDate(c.created_at)}</td>
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
