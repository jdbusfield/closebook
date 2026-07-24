import { NextResponse } from "next/server";
import type { RWQuoteRow } from "@/lib/utils/revenue-projection";

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
    const threeMonthsAgo = formatRWDate(new Date(now.getFullYear(), now.getMonth() - 3, 1));

    const result = await rw.browseAll<RWQuoteRow>("quote", {
      pagesize: 2000,
      searchfields: ["QuoteDate"],
      searchfieldoperators: [">="],
      searchfieldvalues: [threeMonthsAgo],
      searchfieldtypes: ["date"],
      orderby: "QuoteDate",
      orderbydirection: "desc",
    });

    return NextResponse.json(result.rows);
  } catch (err) {
    console.error("GET /api/rw-revenue/quotes error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 },
    );
  }
}
