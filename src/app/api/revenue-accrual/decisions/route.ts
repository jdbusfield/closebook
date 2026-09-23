import { NextRequest, NextResponse } from "next/server";
import { parsePeriod, requireAccrualAccess } from "@/lib/revenue-accrual/access";
import { store } from "@/lib/revenue-accrual/store";

/**
 * POST /api/revenue-accrual/decisions
 * Body: { entityId, year, month, decisions: { [itemId]: boolean } }. Replaces
 * the month's include / exclude choices.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const auth = await requireAccrualAccess(body?.entityId ?? null, true);
  if ("error" in auth) return auth.error;
  const period = parsePeriod(body?.year, body?.month);
  if (!period) return NextResponse.json({ error: "year and month are required" }, { status: 400 });
  const decisions: Record<string, boolean> = {};
  for (const [k, v] of Object.entries((body?.decisions ?? {}) as Record<string, unknown>)) {
    if (typeof v === "boolean") decisions[k] = v;
  }
  const updatedAt = new Date().toISOString();
  await store.saveRun(auth.admin, auth.entity.id, period, {
    decisions,
    updatedAt,
    updatedBy: auth.user.email ?? auth.user.id,
  });
  return NextResponse.json({ ok: true, updatedAt });
}
