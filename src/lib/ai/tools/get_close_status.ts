import type { AiTool } from "./types";

interface ClosePeriod {
  id: string;
  entity_id: string;
  period_year: number;
  period_month: number;
  status: string;
  due_date: string | null;
}

interface CloseTask {
  id: string;
  close_period_id: string;
  name: string;
  category: string | null;
  status: string;
  due_date: string | null;
  variance: number | null;
}

export const getCloseStatus: AiTool = {
  name: "get_close_status",
  description:
    "Return month-end close status for an entity and period — overall status, due date, and a breakdown of close tasks by status with the list of tasks that are still open or pending review.",
  inputSchema: {
    type: "object",
    properties: {
      entity_id: { type: "string", description: "UUID of the entity. Defaults to current entity." },
      period_year: { type: "integer" },
      period_month: { type: "integer", description: "1-12." },
    },
    required: ["period_year", "period_month"],
  },
  async run(
    input: { entity_id?: string; period_year: number; period_month: number },
    ctx,
  ) {
    const entityId = input.entity_id ?? ctx.currentEntityId;
    if (!entityId) {
      return { error: "No entity_id provided. Call get_entities first." };
    }

    const { data: period, error: pErr } = await ctx.supabase
      .from("close_periods")
      .select("id, entity_id, period_year, period_month, status, due_date")
      .eq("entity_id", entityId)
      .eq("period_year", input.period_year)
      .eq("period_month", input.period_month)
      .maybeSingle();
    if (pErr) return { error: pErr.message };
    if (!period) {
      return {
        error: `No close period found for ${input.period_year}-${String(input.period_month).padStart(2, "0")}.`,
      };
    }
    const periodTyped = period as unknown as ClosePeriod;

    const { data: tasks, error: tErr } = await ctx.supabase
      .from("close_tasks")
      .select("id, close_period_id, name, category, status, due_date, variance")
      .eq("close_period_id", periodTyped.id);
    if (tErr) return { error: tErr.message };
    const tasksTyped = (tasks ?? []) as unknown as CloseTask[];

    const counts: Record<string, number> = {
      not_started: 0,
      in_progress: 0,
      pending_review: 0,
      approved: 0,
      rejected: 0,
      na: 0,
    };
    for (const t of tasksTyped) counts[t.status] = (counts[t.status] ?? 0) + 1;

    const openOrPending = tasksTyped
      .filter((t) =>
        ["not_started", "in_progress", "pending_review", "rejected"].includes(t.status),
      )
      .map((t) => ({
        name: t.name,
        category: t.category,
        status: t.status,
        due_date: t.due_date,
        variance: t.variance,
      }));

    return {
      entity_id: entityId,
      period: { year: periodTyped.period_year, month: periodTyped.period_month },
      period_status: periodTyped.status,
      period_due_date: periodTyped.due_date,
      task_total: tasksTyped.length,
      task_counts: counts,
      open_or_pending_tasks: openOrPending,
    };
  },
};
