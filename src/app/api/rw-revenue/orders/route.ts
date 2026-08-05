import { NextResponse } from "next/server";
import type { RWOrderRow } from "@/lib/utils/revenue-projection";

export const maxDuration = 120;

export async function GET() {
  try {
    const { RentalWorksClient } = await import("@/lib/rentalworks/client");
    const rw = new RentalWorksClient(process.env.RW_BASE_URL!);
    await rw.ensureAuth(process.env.RW_USERNAME!, process.env.RW_PASSWORD!);

    const now = new Date();
    // 13 months to match the invoice window — long-outstanding orders must
    // stay visible to the projection's unbilled/overdue calculations.
    const thirteenMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 13, 1);

    // Month-windowed: a single wide browse exceeds Vercel's function cap.
    const result = await rw.browseAllByMonthWindows<RWOrderRow>("order", "OrderDate", thirteenMonthsAgo, {
      pagesize: 2000,
      orderby: "OrderDate",
      orderbydirection: "desc",
    });

    return NextResponse.json(result.rows);
  } catch (err) {
    console.error("GET /api/rw-revenue/orders error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 },
    );
  }
}
