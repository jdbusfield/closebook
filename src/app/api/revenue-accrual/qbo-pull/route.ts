import { NextRequest, NextResponse } from "next/server";
import { parsePeriod, requireAccrualAccess } from "@/lib/revenue-accrual/access";
import { store } from "@/lib/revenue-accrual/store";
import { pullFromQuickBooks } from "@/lib/revenue-accrual/qbo";
import { monthStart, shiftMonth } from "@/lib/revenue-accrual/dates";

export const maxDuration = 300;

/**
 * POST /api/revenue-accrual/qbo-pull  Body: { entityId, year, month }
 * Pulls invoices, sales receipts, credit memos and refunds from seven months
 * before the closing month through today, plus journal entries from the
 * month before it, and saves them for the report.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const auth = await requireAccrualAccess(body?.entityId ?? null, true);
  if ("error" in auth) return auth.error;
  const period = parsePeriod(body?.year, body?.month);
  if (!period) return NextResponse.json({ error: "year and month are required" }, { status: 400 });
  const from = monthStart(shiftMonth(period, -7));
  const journalsFrom = monthStart(shiftMonth(period, -1));
  const to = new Date().toISOString().slice(0, 10);
  try {
    const pull = await pullFromQuickBooks(auth.admin, auth.entity.id, from, to, journalsFrom);
    await store.saveQbo(auth.admin, auth.entity.id, pull);
    return NextResponse.json({ ok: true, docs: pull.docs.length, journals: pull.journals.length, from, to });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
