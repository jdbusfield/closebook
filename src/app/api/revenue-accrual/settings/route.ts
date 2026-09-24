import { NextRequest, NextResponse } from "next/server";
import { requireAccrualAccess } from "@/lib/revenue-accrual/access";
import { store } from "@/lib/revenue-accrual/store";
import { normKey } from "@/lib/revenue-accrual/names";
import type { AccountRef, AccrualSettings } from "@/lib/revenue-accrual/types";

function account(v: unknown): AccountRef | undefined {
  const a = v as { number?: unknown; name?: unknown } | null;
  if (!a || typeof a.name !== "string" || !a.name.trim()) return undefined;
  return { number: a.number ? String(a.number).trim() : null, name: a.name.trim() };
}

/**
 * POST /api/revenue-accrual/settings
 * Body: { entityId, accruedAccount?, deferredAccount?, aliases? }
 * aliases maps a quote project name to the QuickBooks customer it bills under.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const auth = await requireAccrualAccess(body?.entityId ?? null, true);
  if ("error" in auth) return auth.error;
  const saved: Partial<AccrualSettings> = (await store.settings(auth.admin, auth.entity.id)) ?? {};
  const accrued = account(body?.accruedAccount);
  const deferred = account(body?.deferredAccount);
  if (accrued) saved.accruedAccount = accrued;
  if (deferred) saved.deferredAccount = deferred;
  if (body?.aliases && typeof body.aliases === "object") {
    const aliases: Record<string, string> = {};
    for (const [k, v] of Object.entries(body.aliases as Record<string, unknown>)) {
      const from = normKey(k);
      const to = normKey(String(v ?? ""));
      if (from && to) aliases[from] = to;
    }
    saved.aliases = aliases;
  }
  await store.saveSettings(auth.admin, auth.entity.id, saved);
  return NextResponse.json({ ok: true });
}
