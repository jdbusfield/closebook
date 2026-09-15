import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { accessErrorResponse, getBudgetActor, requireVersionAccess } from "@/lib/budget/access";
import { upsertBudgetCells } from "@/lib/budget/amounts";

// PUT — upsert a single budget amount (or delete if amount is 0)
export async function PUT(request: Request) {
  try {
    const actor = await getBudgetActor();

    const body = await request.json();
    const { versionId, masterAccountId, periodYear, periodMonth, amount, classId } = body;

    if (
      !versionId ||
      !masterAccountId ||
      !periodYear ||
      periodMonth === undefined
    ) {
      return NextResponse.json(
        {
          error:
            "versionId, masterAccountId, periodYear, and periodMonth are required",
        },
        { status: 400 }
      );
    }

    const admin = createAdminClient();
    const owner = await requireVersionAccess(admin, actor, versionId, true);

    const result = await upsertBudgetCells(admin, owner, [
      {
        masterAccountId,
        classId: classId ?? null,
        periodYear,
        periodMonth,
        amount: Number(amount ?? 0),
        source: "manual",
      },
    ]);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error("PUT /api/budgets/amounts error:", err);
    const { body, status } = accessErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
