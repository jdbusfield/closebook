import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  calculateCustomerRebates,
  aggregateByQuarter,
  type RebateCustomerConfig,
  type CachedInvoice,
  type CachedInvoiceItem,
  type RebateTier,
} from "@/lib/utils/rebate-calculations";

export async function POST(request: Request) {
  const embedKey = request.headers.get("x-embed-key");
  const validEmbedKey = embedKey && process.env.EMBED_API_KEY && embedKey === process.env.EMBED_API_KEY;
  if (!validEmbedKey) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const body = await request.json();
  const { action } = body;
  const admin = createAdminClient();

  switch (action) {
    case "calculate_customer": {
      const { entityId, customerId } = body;
      try {
        const result = await calculateForCustomer(admin, entityId, customerId);
        return NextResponse.json({ success: true, ...result });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Calculation failed";
        return NextResponse.json({ error: msg }, { status: 500 });
      }
    }

    case "calculate_all": {
      const { entityId } = body;

      const { data: customers } = await admin
        .from("rebate_customers")
        .select("*")
        .eq("entity_id", entityId)
        .eq("status", "active");

      if (!customers || customers.length === 0) {
        return NextResponse.json({
          success: true,
          message: "No active customers",
        });
      }

      const results = [];
      for (const customer of customers) {
        try {
          const result = await calculateForCustomer(
            admin,
            entityId,
            customer.id,
          );
          results.push({
            customerId: customer.id,
            customerName: customer.customer_name,
            ...result,
          });
        } catch (err) {
          results.push({
            customerId: customer.id,
            customerName: customer.customer_name,
            error: err instanceof Error ? err.message : "Calculation failed",
          });
        }
      }

      return NextResponse.json({ success: true, results });
    }

    default:
      return NextResponse.json(
        { error: `Unknown action: ${action}` },
        { status: 400 },
      );
  }
}

async function calculateForCustomer(
  admin: ReturnType<typeof createAdminClient>,
  entityId: string,
  customerId: string,
) {
  // Load customer + tiers
  const { data: customer, error: custErr } = await admin
    .from("rebate_customers")
    .select("*")
    .eq("id", customerId)
    .single();

  if (custErr || !customer) {
    throw new Error("Customer not found");
  }

  const { data: tiers } = await admin
    .from("rebate_tiers")
    .select("*")
    .eq("rebate_customer_id", customerId)
    .order("sort_order");

  // Load invoices
  const { data: invoices } = await admin
    .from("rebate_invoices")
    .select("*")
    .eq("rebate_customer_id", customerId)
    .order("billing_end_date", { ascending: true });

  if (!invoices || invoices.length === 0) {
    return { invoiceCount: 0, totalRebate: 0, totalRevenue: 0 };
  }

  // Load invoice items
  const invoiceIds = invoices.map((inv) => inv.id);
  const { data: items } = await admin
    .from("rebate_invoice_items")
    .select("*")
    .in("rebate_invoice_id", invoiceIds);

  // Build items map
  const itemsMap = new Map<string, CachedInvoiceItem[]>();
  for (const item of items || []) {
    const key = item.rebate_invoice_id;
    if (!itemsMap.has(key)) itemsMap.set(key, []);
    itemsMap.get(key)!.push(item as CachedInvoiceItem);
  }

  // Build excluded I-codes set
  const excludedICodes = new Set<string>();

  // Global exclusions
  if (customer.use_global_exclusions) {
    const { data: globalCodes } = await admin
      .from("rebate_excluded_icodes")
      .select("i_code")
      .eq("entity_id", entityId)
      .is("rebate_customer_id", null);
    for (const ic of globalCodes || []) {
      excludedICodes.add(ic.i_code.trim());
    }
  }

  // Customer-specific exclusions
  const { data: customerCodes } = await admin
    .from("rebate_excluded_icodes")
    .select("i_code")
    .eq("rebate_customer_id", customerId);
  for (const ic of customerCodes || []) {
    excludedICodes.add(ic.i_code.trim());
  }

  // Reset all item exclusion flags before recalculating
  await admin
    .from("rebate_invoice_items")
    .update({ is_excluded: false })
    .in("rebate_invoice_id", invoiceIds);

  // Build config
  const config: RebateCustomerConfig = {
    id: customer.id,
    customer_name: customer.customer_name,
    rw_customer_id: customer.rw_customer_id,
    agreement_type: customer.agreement_type as "commercial" | "freelancer",
    tax_rate: customer.tax_rate,
    max_discount_percent: customer.max_discount_percent,
    tiers: (tiers || []) as RebateTier[],
  };

  // Run calculation engine
  const results = calculateCustomerRebates(
    config,
    invoices as CachedInvoice[],
    itemsMap,
    excludedICodes,
  );

  // Update invoices with calculated fields
  for (const r of results) {
    await admin
      .from("rebate_invoices")
      .update({
        excluded_total: r.excluded_total,
        taxable_sales: r.taxable_sales,
        before_discount: r.before_discount,
        discount_percent: r.discount_percent,
        discount_eligible_amount: r.discount_eligible_amount,
        final_amount: r.final_amount,
        tier_label: r.tier_label,
        rebate_rate: r.rebate_rate,
        remaining_rebate_pct: r.remaining_rebate_pct,
        net_rebate: r.net_rebate,
        cumulative_revenue: r.cumulative_revenue,
        cumulative_rebate: r.cumulative_rebate,
        quarter: r.quarter,
      })
      .eq("id", r.invoice_id);

    // Update item exclusion flags
    for (const excl of r.excluded_items) {
      if (excl.reason === "loss_damage") {
        // Mark all L&D items on this invoice as excluded (F = forfeited/L&D, L = legacy)
        await admin
          .from("rebate_invoice_items")
          .update({ is_excluded: true })
          .eq("rebate_invoice_id", r.invoice_id)
          .in("record_type", ["F", "L"]);
      } else {
        await admin
          .from("rebate_invoice_items")
          .update({ is_excluded: true })
          .eq("rebate_invoice_id", r.invoice_id)
          .eq("i_code", excl.iCode);
      }
    }
  }

  // Aggregate quarterly summaries
  const quarterlySummaries = aggregateByQuarter(results);

  // Upsert quarterly summaries
  for (const qs of quarterlySummaries) {
    await admin.from("rebate_quarterly_summaries").upsert(
      {
        entity_id: entityId,
        rebate_customer_id: customerId,
        quarter: qs.quarter,
        year: qs.year,
        quarter_num: qs.quarter_num,
        total_revenue: qs.total_revenue,
        total_list_revenue: qs.total_list_revenue,
        total_rebate: qs.total_rebate,
        invoice_count: qs.invoice_count,
        tier_label: qs.tier_label,
        calculated_at: new Date().toISOString(),
      },
      { onConflict: "rebate_customer_id,quarter" },
    );
  }

  const totalRebate = results.reduce((s, r) => s + r.net_rebate, 0);
  const totalRevenue = results.reduce((s, r) => s + r.final_amount, 0);

  return {
    invoiceCount: results.length,
    totalRebate,
    totalRevenue,
    quarterCount: quarterlySummaries.length,
  };
}
