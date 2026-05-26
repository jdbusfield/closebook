import { NextRequest, NextResponse } from "next/server";
import { getCallerOrg } from "../../_lib/org";
import { searchUnlinkedRwCustomers } from "@/lib/db/queries/crm-revenue";

export async function GET(req: NextRequest) {
  const ctx = await getCallerOrg();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const q = req.nextUrl.searchParams.get("q") ?? "";
  const results = await searchUnlinkedRwCustomers(q);
  return NextResponse.json({ results });
}
