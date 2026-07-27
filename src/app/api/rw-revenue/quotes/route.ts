import { NextResponse } from "next/server";
import type { RWQuoteRow } from "@/lib/utils/revenue-projection";

export const maxDuration = 60;

export async function GET() {
  try {
    const { RentalWorksClient } = await import("@/lib/rentalworks/client");
    const rw = new RentalWorksClient(process.env.RW_BASE_URL!);
    await rw.ensureAuth(process.env.RW_USERNAME!, process.env.RW_PASSWORD!);

    const now = new Date();
    const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1);

    // Month-windowed: a single 3-month browse can exceed Vercel's 60s cap.
    const result = await rw.browseAllByMonthWindows<RWQuoteRow>("quote", "QuoteDate", threeMonthsAgo, {
      pagesize: 2000,
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
