import { notFound } from "next/navigation";
import Link from "next/link";
import { Building, ArrowLeft } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getCrmCommercialCompany } from "@/lib/db/queries/crm";
import { formatDate } from "../../_components/crm-shared";

interface PageProps { params: Promise<{ id: string }> }

export default async function CommercialCompanyDetailPage({ params }: PageProps) {
  const { id } = await params;
  const company = await getCrmCommercialCompany(id);
  if (!company) notFound();

  return (
    <div className="space-y-6 p-6">
      <div>
        <Link href="/crm/commercial-companies" className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline">
          <ArrowLeft className="h-3 w-3" /> Back to commercial companies
        </Link>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Building className="h-6 w-6" /> {company.name}
        </h1>
      </div>
      <Card>
        <CardHeader><CardTitle>Details</CardTitle></CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-y-3 text-sm md:grid-cols-3">
            <dt className="text-muted-foreground">Avon customer #</dt>
            <dd>{company.avon_customer_number ?? "—"}</dd>
            <dt className="text-muted-foreground">Location</dt>
            <dd>{company.location ?? "—"}</dd>
            <dt className="text-muted-foreground">Added</dt>
            <dd>{formatDate(company.created_at)}</dd>
          </dl>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          Contacts, opportunities, and communications for commercial companies will be wired up in the next iteration.
        </CardContent>
      </Card>
    </div>
  );
}
