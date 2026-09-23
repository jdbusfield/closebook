import { NextRequest, NextResponse } from "next/server";
import { parsePeriod, requireAccrualAccess } from "@/lib/revenue-accrual/access";
import { store } from "@/lib/revenue-accrual/store";
import { mergeSettings } from "@/lib/revenue-accrual/defaults";
import { buildReport } from "@/lib/revenue-accrual/report";
import { journalWorkbook, workingWorkbook } from "@/lib/revenue-accrual/export";
import { jePrefix } from "@/lib/revenue-accrual/dates";

export const maxDuration = 60;

/**
 * GET /api/revenue-accrual/export?entityId&year&month&kind=working|journals
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const auth = await requireAccrualAccess(sp.get("entityId"), false);
  if ("error" in auth) return auth.error;
  const period = parsePeriod(sp.get("year"), sp.get("month"));
  if (!period) return NextResponse.json({ error: "year and month are required" }, { status: 400 });
  const { admin, entity } = auth;
  const [quotesFile, pull, savedSettings, run] = await Promise.all([
    store.quotes(admin, entity.id),
    store.qbo(admin, entity.id),
    store.settings(admin, entity.id),
    store.run(admin, entity.id, period),
  ]);
  if (!quotesFile || !pull) {
    return NextResponse.json({ error: "Upload the Quotes Report and pull from QuickBooks first." }, { status: 400 });
  }
  const report = buildReport(period, quotesFile.quotes, pull, mergeSettings(savedSettings), run?.decisions ?? {});
  const kind = sp.get("kind") === "journals" ? "journals" : "working";
  const buffer = kind === "journals" ? await journalWorkbook(report.journals) : await workingWorkbook(entity.name, report);
  const filename = `${jePrefix(period)} Revenue ${kind === "journals" ? "Accrual JEs" : "Accrual Working File"}.xlsx`;
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
