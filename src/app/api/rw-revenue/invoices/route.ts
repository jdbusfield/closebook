import { NextResponse } from "next/server";
import type { RWInvoiceRow } from "@/lib/utils/revenue-projection";

export const maxDuration = 60;

function formatRWDate(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}/${dd}/${d.getFullYear()}`;
}

export async function GET() {
  try {
    const { RentalWorksClient } = await import("@/lib/rentalworks/client");
    const rw = new RentalWorksClient(process.env.RW_BASE_URL!);
    await rw.ensureAuth(process.env.RW_USERNAME!, process.env.RW_PASSWORD!);

    const now = new Date();
    const thirteenMonthsAgo = formatRWDate(new Date(now.getFullYear(), now.getMonth() - 13, 1));
    const thirtySixMonthsAgo = formatRWDate(new Date(now.getFullYear(), now.getMonth() - 36, 1));

    const [byDate, byBilling] = await Promise.all([
      rw.browseAll<RWInvoiceRow>("invoice", {
        pagesize: 2000,
        searchfields: ["InvoiceDate"],
        searchfieldoperators: [">="],
        searchfieldvalues: [thirteenMonthsAgo],
        searchfieldtypes: ["date"],
        orderby: "InvoiceDate",
        orderbydirection: "desc",
      }),
      rw.browseAll<RWInvoiceRow>("invoice", {
        pagesize: 2000,
        searchfields: ["BillingEndDate"],
        searchfieldoperators: [">="],
        searchfieldvalues: [thirtySixMonthsAgo],
        searchfieldtypes: ["date"],
        orderby: "BillingEndDate",
        orderbydirection: "desc",
      }),
    ]);

    const map = new Map<string, RWInvoiceRow>();
    for (const inv of byDate.rows) map.set(inv.InvoiceId, inv);
    for (const inv of byBilling.rows) if (!map.has(inv.InvoiceId)) map.set(inv.InvoiceId, inv);

    return NextResponse.json(Array.from(map.values()));
  } catch (err) {
    console.error("GET /api/rw-revenue/invoices error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 },
    );
  }
}
