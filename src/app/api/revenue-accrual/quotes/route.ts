import { NextRequest, NextResponse } from "next/server";
import { requireAccrualAccess } from "@/lib/revenue-accrual/access";
import { store } from "@/lib/revenue-accrual/store";
import type { Quote } from "@/lib/revenue-accrual/types";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * POST /api/revenue-accrual/quotes
 * Body: { entityId, fileName, sheet, quotes: Quote[] }. The browser reads the
 * Quotes Report workbook and sends one row per quote.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const auth = await requireAccrualAccess(body?.entityId ?? null, true);
  if ("error" in auth) return auth.error;
  const raw: unknown[] = Array.isArray(body?.quotes) ? body.quotes : [];
  const quotes: Quote[] = [];
  for (const r of raw as Record<string, unknown>[]) {
    const amount = Number(r.amount);
    if (typeof r.id !== "string" || !ISO.test(String(r.start)) || !ISO.test(String(r.end)) || !Number.isFinite(amount)) continue;
    quotes.push({
      id: r.id,
      project: String(r.project ?? ""),
      start: String(r.start),
      end: String(r.end),
      amount,
      status: String(r.status ?? ""),
      salesRep: r.salesRep ? String(r.salesRep) : null,
      path: r.path ? String(r.path) : null,
      version: r.version != null && Number.isFinite(Number(r.version)) ? Number(r.version) : null,
    });
  }
  if (!quotes.length) {
    return NextResponse.json({ error: "No quotes with dates and amounts were found in the file." }, { status: 400 });
  }
  await store.saveQuotes(auth.admin, auth.entity.id, {
    uploadedAt: new Date().toISOString(),
    uploadedBy: auth.user.email ?? auth.user.id,
    fileName: String(body.fileName ?? "Quotes Report.xlsx"),
    sheet: String(body.sheet ?? ""),
    quotes,
  });
  return NextResponse.json({ ok: true, count: quotes.length, skipped: raw.length - quotes.length });
}
