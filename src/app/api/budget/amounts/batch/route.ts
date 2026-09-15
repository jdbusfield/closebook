import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { accessErrorResponse, getBudgetActor, requireVersionAccess } from "@/lib/budget/access";
import { upsertBudgetCells, type BudgetCell } from "@/lib/budget/amounts";

/**
 * PUT /api/budget/amounts/batch
 * Body: { versionId, cells: [{ masterAccountId, classId?, periodYear, periodMonth, amount, source?, note? }] }
 * Writes every cell in one call (a row fill, a spread, a paste). Amount 0
 * deletes the cell.
 */
export async function PUT(request: Request) {
  try {
    const actor = await getBudgetActor();
    const body = await request.json();
    const versionId: string | undefined = body?.versionId;
    const cells: BudgetCell[] = Array.isArray(body?.cells) ? body.cells : [];

    if (!versionId) {
      return NextResponse.json({ error: "versionId is required" }, { status: 400 });
    }
    if (cells.length === 0) {
      return NextResponse.json({ error: "cells is empty" }, { status: 400 });
    }
    if (cells.length > 5000) {
      return NextResponse.json({ error: "Too many cells in one call (max 5000)" }, { status: 400 });
    }
    for (const c of cells) {
      if (!c.masterAccountId || !c.periodYear || !c.periodMonth || c.periodMonth < 1 || c.periodMonth > 12) {
        return NextResponse.json(
          { error: "Each cell needs masterAccountId, periodYear and periodMonth (1-12)" },
          { status: 400 },
        );
      }
    }

    const admin = createAdminClient();
    const owner = await requireVersionAccess(admin, actor, versionId, true);
    const result = await upsertBudgetCells(admin, owner, cells);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error("PUT /api/budget/amounts/batch error:", err);
    const { body, status } = accessErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
