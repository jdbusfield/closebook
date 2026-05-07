import type { AiTool } from "./types";

interface RebateCustomer {
  id: string;
  entity_id: string;
  customer_name: string;
  rw_customer_id: string;
  agreement_type: string;
  status: string;
  effective_date: string | null;
}

interface RebateInvoice {
  rebate_customer_id: string;
  invoice_date: string | null;
  list_total: number | null;
  net_rebate: number | null;
  cumulative_revenue: number | null;
  cumulative_rebate: number | null;
  tier_label: string | null;
  quarter: string | null;
  equipment_type: string;
}

export const getRebateTracker: AiTool = {
  name: "get_rebate_tracker",
  description:
    "Summarize the rebate tracker — for each commercial / freelancer rebate customer return YTD rebate-eligible revenue, accrued rebate, and current tier. Optionally filter to a specific customer or quarter.",
  inputSchema: {
    type: "object",
    properties: {
      entity_id: { type: "string", description: "UUID of the entity. Defaults to current entity." },
      customer_name_contains: {
        type: "string",
        description: "Case-insensitive customer name filter.",
      },
      quarter: {
        type: "string",
        description: 'Quarter filter, e.g. "2026-Q1". If omitted, returns all-time.',
      },
      agreement_type: { type: "string", enum: ["commercial", "freelancer"] },
    },
  },
  async run(
    input: {
      entity_id?: string;
      customer_name_contains?: string;
      quarter?: string;
      agreement_type?: string;
    },
    ctx,
  ) {
    const entityId = input.entity_id ?? ctx.currentEntityId;
    if (!entityId) {
      return { error: "No entity_id provided. Call get_entities first." };
    }

    let custQ = ctx.supabase
      .from("rebate_customers")
      .select("id, entity_id, customer_name, rw_customer_id, agreement_type, status, effective_date")
      .eq("entity_id", entityId)
      .eq("status", "active");

    if (input.agreement_type) custQ = custQ.eq("agreement_type", input.agreement_type);
    if (input.customer_name_contains)
      custQ = custQ.ilike("customer_name", `%${input.customer_name_contains}%`);

    const { data: customers, error: cErr } = await custQ;
    if (cErr) return { error: cErr.message };
    const customersTyped = (customers ?? []) as unknown as RebateCustomer[];
    if (customersTyped.length === 0) {
      return { entity_id: entityId, customers: [], note: "No matching rebate customers." };
    }

    const ids = customersTyped.map((c) => c.id);
    let invQ = ctx.supabase
      .from("rebate_invoices")
      .select(
        "rebate_customer_id, invoice_date, list_total, net_rebate, cumulative_revenue, cumulative_rebate, tier_label, quarter, equipment_type",
      )
      .in("rebate_customer_id", ids);
    if (input.quarter) invQ = invQ.eq("quarter", input.quarter);

    const { data: invoices, error: iErr } = await invQ;
    if (iErr) return { error: iErr.message };
    const invoicesTyped = (invoices ?? []) as unknown as RebateInvoice[];

    const summary = customersTyped.map((c) => {
      const own = invoicesTyped.filter((i) => i.rebate_customer_id === c.id);
      const list = own.reduce((s, i) => s + Number(i.list_total ?? 0), 0);
      const rebate = own.reduce((s, i) => s + Number(i.net_rebate ?? 0), 0);
      const latestTier =
        own
          .slice()
          .sort((a, b) => (a.invoice_date ?? "").localeCompare(b.invoice_date ?? ""))
          .pop()?.tier_label ?? null;
      return {
        customer_name: c.customer_name,
        agreement_type: c.agreement_type,
        rw_customer_id: c.rw_customer_id,
        invoice_count: own.length,
        list_revenue: list,
        net_rebate: rebate,
        current_tier: latestTier,
      };
    });

    summary.sort((a, b) => b.list_revenue - a.list_revenue);

    return {
      entity_id: entityId,
      quarter: input.quarter ?? null,
      customer_count: summary.length,
      total_list_revenue: summary.reduce((s, r) => s + r.list_revenue, 0),
      total_net_rebate: summary.reduce((s, r) => s + r.net_rebate, 0),
      customers: summary,
    };
  },
};
