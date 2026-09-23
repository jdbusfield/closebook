import { NextRequest, NextResponse } from "next/server";
import { parsePeriod, requireAccrualAccess } from "@/lib/revenue-accrual/access";
import { store } from "@/lib/revenue-accrual/store";
import { mergeSettings } from "@/lib/revenue-accrual/defaults";
import { buildReport } from "@/lib/revenue-accrual/report";

export const maxDuration = 60;

/**
 * GET /api/revenue-accrual?entityId&year&month
 * The month-end accrual / deferral report from the saved Quotes Report and
 * the last QuickBooks pull, with the month's review decisions applied.
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
  const settings = mergeSettings(savedSettings);
  const meta = {
    quotes: quotesFile
      ? { fileName: quotesFile.fileName, uploadedAt: quotesFile.uploadedAt, count: quotesFile.quotes.length, sheet: quotesFile.sheet }
      : null,
    qbo: pull
      ? { pulledAt: pull.pulledAt, from: pull.from, to: pull.to, docs: pull.docs.length, companyName: pull.companyName }
      : null,
    decisionsUpdatedAt: run?.updatedAt ?? null,
  };
  if (!quotesFile || !pull) return NextResponse.json({ meta, settings, report: null });

  const report = buildReport(period, quotesFile.quotes, pull, settings, run?.decisions ?? {});
  return NextResponse.json({ meta, settings, report });
}
