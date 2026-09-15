import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { accessErrorResponse, getBudgetActor, requireVersionAccess } from "@/lib/budget/access";
import { fetchAllPaginated } from "@/lib/utils/paginated-fetch";
import { loadMasters, loadMonthlyActuals, monthKey, rollupActualsToParents } from "@/lib/budget/actuals";
import { loadMemberEntityIds, resolveVersionChartId } from "@/lib/budget/recompute";
import { INCOME_STATEMENT_SECTIONS } from "@/lib/config/statement-sections";

const NIL_CLASS = "00000000-0000-0000-0000-000000000000";

/**
 * GET /api/budget/lines?versionId=&priorYears=1
 * Every P&L master on the chart in statement order with the version's cells
 * (by class), build counts per line, notes, and prior-year actuals by month
 * for the comparison row.
 */
export async function GET(request: Request) {
  try {
    const actor = await getBudgetActor();
    const { searchParams } = new URL(request.url);
    const versionId = searchParams.get("versionId");
    const withActuals = searchParams.get("actuals") !== "0";
    if (!versionId) return NextResponse.json({ error: "versionId is required" }, { status: 400 });

    const admin = createAdminClient();
    const owner = await requireVersionAccess(admin, actor, versionId, false);
    const [memberSet, chartId] = await Promise.all([loadMemberEntityIds(admin, owner), resolveVersionChartId(admin, owner)]);
    const memberEntityIds = [...memberSet];
    const masters = await loadMasters(admin, chartId);

    const [cells, builds, notes] = await Promise.all([
      fetchAllPaginated<{ master_account_id: string; qbo_class_id: string | null; class_key: string; period_month: number; amount: number; source: string; note: string | null }>((o, l) =>
        admin
          .from("budget_amounts")
          .select("master_account_id, qbo_class_id, class_key, period_month, amount, source, note")
          .eq("budget_version_id", owner.id)
          .eq("period_year", owner.fiscalYear)
          .range(o, o + l - 1),
      ),
      fetchAllPaginated<{ master_account_id: string; class_key: string; build_type: string }>((o, l) =>
        admin.from("budget_builds").select("master_account_id, class_key, build_type").eq("budget_version_id", owner.id).range(o, o + l - 1),
      ),
      fetchAllPaginated<{ master_account_id: string; class_key: string; note: string | null; review_flag: string | null }>((o, l) =>
        admin.from("budget_line_notes").select("master_account_id, class_key, note, review_flag").eq("budget_version_id", owner.id).range(o, o + l - 1),
      ),
    ]);

    const classIds = [...new Set(cells.map((c) => c.qbo_class_id).filter(Boolean))] as string[];
    const { data: classes } = classIds.length ? await admin.from("qbo_classes").select("id, name").in("id", classIds) : { data: [] };
    const { data: memberClasses } = memberEntityIds.length
      ? await admin.from("qbo_classes").select("id, name, entity_id").in("entity_id", memberEntityIds).eq("is_active", true).order("name")
      : { data: [] };

    // line key = master|class_key
    const lines = new Map<string, { masterAccountId: string; classId: string | null; months: number[]; sources: Set<string>; builds: Record<string, number>; note: string | null; reviewFlag: string | null }>();
    const lineFor = (masterId: string, classKey: string, classId: string | null) => {
      const key = `${masterId}|${classKey ?? NIL_CLASS}`;
      let line = lines.get(key);
      if (!line) {
        line = { masterAccountId: masterId, classId, months: new Array(12).fill(0), sources: new Set(), builds: {}, note: null, reviewFlag: null };
        lines.set(key, line);
      }
      return line;
    };
    for (const c of cells) {
      const line = lineFor(c.master_account_id, c.class_key, c.qbo_class_id);
      line.months[c.period_month - 1] += Number(c.amount ?? 0);
      line.sources.add(c.source);
    }
    for (const b of builds) {
      const line = lineFor(b.master_account_id, b.class_key, null);
      line.builds[b.build_type] = (line.builds[b.build_type] ?? 0) + 1;
    }
    for (const n of notes) {
      const line = lineFor(n.master_account_id, n.class_key, null);
      line.note = n.note;
      line.reviewFlag = n.review_flag;
    }

    // Prior-year actuals (rolled to parents so they align with displayed lines)
    let priorYear: Record<string, number[]> = {};
    let priorYear2: Record<string, number[]> = {};
    if (withActuals && memberEntityIds.length > 0) {
      const actuals = await loadMonthlyActuals(admin, {
        chartId,
        entityIds: memberEntityIds,
        startYear: owner.fiscalYear - 2,
        startMonth: 1,
        endYear: owner.fiscalYear - 1,
        endMonth: 12,
        masters,
      });
      const byMaster = rollupActualsToParents(actuals.byMaster, masters);
      const toArr = (year: number) => {
        const out: Record<string, number[]> = {};
        for (const [id, series] of byMaster) {
          out[id] = Array.from({ length: 12 }, (_, i) => Math.round((series.get(monthKey(year, i + 1)) ?? 0) * 100) / 100);
        }
        return out;
      };
      priorYear = toArr(owner.fiscalYear - 1);
      priorYear2 = toArr(owner.fiscalYear - 2);
    }

    const plMasters = masters.filter((m) => m.classification === "Revenue" || m.classification === "Expense");
    const sections = INCOME_STATEMENT_SECTIONS.map((s) => ({
      id: s.id,
      title: s.title || (s.id === "other_expense" ? "Other Expense" : s.id === "other_income" ? "Other Income" : s.id),
      masters: plMasters
        .filter((m) => m.classification === s.classification && s.accountTypes.includes(m.accountType))
        .map((m) => ({ id: m.id, accountNumber: m.accountNumber, name: m.name, parentAccountId: m.parentAccountId })),
    }));

    return NextResponse.json({
      version: owner,
      sections,
      lines: [...lines.values()].map((l) => ({ ...l, sources: [...l.sources] })),
      classes: (classes ?? []),
      memberClasses: memberClasses ?? [],
      priorYear,
      priorYear2,
    });
  } catch (err) {
    console.error("GET /api/budget/lines error:", err);
    const { body, status } = accessErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}

/** PUT /api/budget/lines/note  { versionId, masterAccountId, classId?, note?, reviewFlag? } */
export async function PUT(request: Request) {
  try {
    const actor = await getBudgetActor();
    const body = await request.json();
    const { versionId, masterAccountId, classId, note, reviewFlag } = body ?? {};
    if (!versionId || !masterAccountId) return NextResponse.json({ error: "versionId and masterAccountId are required" }, { status: 400 });
    const admin = createAdminClient();
    const owner = await requireVersionAccess(admin, actor, versionId, true);
    let find = admin.from("budget_line_notes").select("id").eq("budget_version_id", owner.id).eq("master_account_id", masterAccountId);
    find = classId ? find.eq("qbo_class_id", classId) : find.eq("class_key", NIL_CLASS);
    const { data: existing } = await find.limit(1);
    const payload = { budget_version_id: owner.id, master_account_id: masterAccountId, qbo_class_id: classId ?? null, note: note ?? null, review_flag: reviewFlag ?? null, updated_by: actor.userId };
    const res = existing && existing.length
      ? await admin.from("budget_line_notes").update(payload).eq("id", existing[0].id)
      : await admin.from("budget_line_notes").insert(payload);
    if (res.error) return NextResponse.json({ error: res.error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("PUT /api/budget/lines error:", err);
    const { body, status } = accessErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
