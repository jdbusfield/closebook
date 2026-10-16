/**
 * Monthly statement emails (server-only). Sent for the month just ended to
 * every contact of an active member who hasn't turned statements off. Off
 * until the program's statements_enabled switch is on, never before launch,
 * and once per month (last_statement_month).
 */

import type { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll, isRewardsEntity, loadProgram } from "../run";
import { memberLedgerRows } from "../redemptions";
import { sendStatementEmail } from "./email";
import { publicPortalUrl } from "./hosts";
import { buildMemberView, fmtDate, fmtMoney, fmtMonth, fmtPoints, fmtShortDate, fmtSignedPoints, type ViewLedgerRow } from "./view";

type Admin = ReturnType<typeof createAdminClient>;

export interface StatementRun {
  entityId: string;
  month: string;
  skipped?: string;
  members: number;
  sent: number;
  failed: number;
}

/** Last day of the month before `today` (YYYY-MM-DD). */
export function previousMonthEnd(today: string): string {
  const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

export async function sendMonthlyStatements(admin: Admin, entityId: string, monthEnd: string): Promise<StatementRun> {
  const month = monthEnd.slice(0, 7);
  const run: StatementRun = { entityId, month, members: 0, sent: 0, failed: 0 };
  if (!(await isRewardsEntity(admin, entityId))) return { ...run, skipped: "rewards feature off" };

  const { data: prog } = await admin.from("rewards_programs").select("statements_enabled, last_statement_month").eq("entity_id", entityId).single();
  if (!prog?.statements_enabled) return { ...run, skipped: "statements switched off" };
  if (prog.last_statement_month === month) return { ...run, skipped: "already sent" };
  const { settings, tiers } = await loadProgram(admin, entityId);
  if (monthEnd < settings.programStartDate) return { ...run, skipped: "before launch" };

  const members = await fetchAll((from, to) =>
    admin.from("rewards_members").select("id, name").eq("entity_id", entityId).eq("status", "active").order("id").range(from, to),
  );
  const portal = publicPortalUrl();

  for (const m of members) {
    const { data: contacts } = await admin.from("rewards_contacts").select("email").eq("member_id", m.id).eq("receives_statements", true);
    if (!contacts?.length) continue;
    run.members += 1;
    const rows = (await memberLedgerRows(admin, m.id)) as ViewLedgerRow[];
    const view = buildMemberView(rows, tiers, settings, monthEnd, false);
    const inMonth = view.rows.filter((r) => r.entry_type === "earn" && r.earned_on.startsWith(month));
    const earned = inMonth.reduce((s, r) => s + r.points, 0);
    const next = view.status.next;
    for (const c of contacts) {
      const result = await sendStatementEmail({
        to: c.email,
        memberName: m.name,
        monthLabel: fmtMonth(monthEnd),
        asOfLabel: fmtDate(monthEnd),
        pointsToSpend: fmtPoints(view.balance.available),
        earnedInMonth: fmtPoints(earned),
        pending: fmtPoints(view.balance.pending),
        tierName: view.status.tier.name,
        nextTier: next ? { name: next.name, spendToGo: fmtMoney(view.status.spendToNext ?? 0) } : null,
        invoices: inMonth.slice(0, 25).map((r) => ({
          number: r.invoice_number ?? "",
          date: fmtShortDate(r.earned_on),
          points: fmtSignedPoints(r.points),
          paid: r.is_available,
        })),
        expiringSoon: view.balance.expiringSoon > 0 ? fmtPoints(view.balance.expiringSoon) : "None",
        url: `${portal}/`,
        accountUrl: `${portal}/account`,
        assetBase: portal,
      });
      if (result.ok) run.sent += 1;
      else run.failed += 1;
    }
  }
  await admin.from("rewards_programs").update({ last_statement_month: month }).eq("entity_id", entityId);
  return run;
}
