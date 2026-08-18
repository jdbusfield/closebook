import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { RentalWorksClient } from "@/lib/rentalworks/client";

export const maxDuration = 300;

// ── RW row shape (invoice browse) ──────────────────────────────────────

interface RWInvoiceRow {
  InvoiceId: string;
  InvoiceNumber: string;
  InvoiceDate: string;
  Status: string;
  Customer: string;
  CustomerId: string;
  OrderNumber: string;
  InvoiceSubTotal: string;
  IsNoCharge: string;
  IsNonBillable: string;
  Warehouse?: string;
  OfficeLocation?: string;
  CustomerNumber?: string;
}

interface RWOrderRow {
  OrderNumber: string;
  OrderDate: string;
}

interface RWCustomerRow {
  CustomerId: string;
  Customer: string;
  CustomerNumber?: string;
}

const DEFAULT_WAREHOUSE_KEYWORDS = ["VERSATILE", "CAHUENGA"];

function matchesWarehouse(location: string, keywords: string[]): boolean {
  const upper = (location || "").toUpperCase();
  return keywords.some((k) => upper.includes(k.toUpperCase()));
}

function formatRWDate(d: Date): string {
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${mm}/${dd}/${d.getUTCFullYear()}`;
}

async function getRWClient(): Promise<RentalWorksClient> {
  const baseUrl = process.env.RW_BASE_URL;
  const username = process.env.RW_USERNAME;
  const password = process.env.RW_PASSWORD;
  if (!baseUrl || !username || !password) {
    throw new Error("RentalWorks credentials are not configured");
  }
  const rw = new RentalWorksClient(baseUrl);
  await rw.ensureAuth(username, password);
  return rw;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { action } = body;
  const admin = createAdminClient();

  try {
    switch (action) {
      case "get_config": {
        const { entityId } = body;
        if (!entityId) {
          return NextResponse.json({ error: "entityId is required" }, { status: 400 });
        }

        const { data: plans } = await admin
          .from("sales_commission_plans")
          .select("*")
          .eq("entity_id", entityId)
          .order("salesperson_name");

        const planIds = (plans || []).map((p) => p.id);
        let rateTypes: Record<string, unknown>[] = [];
        let assignments: Record<string, unknown>[] = [];
        let runs: Record<string, unknown>[] = [];
        if (planIds.length > 0) {
          const [rt, asg, rn] = await Promise.all([
            admin
              .from("sales_commission_rate_types")
              .select("*")
              .in("plan_id", planIds)
              .order("rate_percent", { ascending: false }),
            admin
              .from("sales_commission_customer_assignments")
              .select("*")
              .in("plan_id", planIds)
              .order("customer_name"),
            admin
              .from("sales_commission_runs")
              .select("*")
              .in("plan_id", planIds)
              .order("period_year", { ascending: false })
              .order("period_month", { ascending: false })
              .limit(36),
          ]);
          rateTypes = rt.data || [];
          assignments = asg.data || [];
          runs = rn.data || [];
        }

        return NextResponse.json({
          plans: plans || [],
          rateTypes,
          assignments,
          runs,
        });
      }

      case "upsert_plan": {
        const { entityId, planId, salespersonName, notes, isActive, commissionStartDate } = body;
        if (!entityId || !salespersonName?.trim()) {
          return NextResponse.json(
            { error: "entityId and salespersonName are required" },
            { status: 400 },
          );
        }
        if (commissionStartDate && !/^\d{4}-\d{2}-\d{2}$/.test(commissionStartDate)) {
          return NextResponse.json(
            { error: "commissionStartDate must be YYYY-MM-DD" },
            { status: 400 },
          );
        }

        if (planId) {
          const { data, error } = await admin
            .from("sales_commission_plans")
            .update({
              salesperson_name: salespersonName.trim(),
              notes: notes ?? null,
              is_active: isActive ?? true,
              commission_start_date: commissionStartDate || null,
              updated_at: new Date().toISOString(),
            })
            .eq("id", planId)
            .select()
            .single();
          if (error) throw error;
          return NextResponse.json({ plan: data });
        }

        const { data: plan, error } = await admin
          .from("sales_commission_plans")
          .insert({
            entity_id: entityId,
            salesperson_name: salespersonName.trim(),
            notes: notes ?? null,
            commission_start_date: commissionStartDate || null,
          })
          .select()
          .single();
        if (error) throw error;

        // Every plan starts with a default rate so unassigned customers
        // always resolve to something editable.
        const { error: rtError } = await admin
          .from("sales_commission_rate_types")
          .insert({
            plan_id: plan.id,
            name: "Default",
            rate_percent: 0,
            is_default: true,
          });
        if (rtError) throw rtError;

        return NextResponse.json({ plan });
      }

      case "delete_plan": {
        const { planId } = body;
        const { error } = await admin
          .from("sales_commission_plans")
          .delete()
          .eq("id", planId);
        if (error) throw error;
        return NextResponse.json({ ok: true });
      }

      case "upsert_rate_type": {
        const { planId, rateTypeId, name, ratePercent, isDefault } = body;
        if (!planId || !name?.trim() || ratePercent === undefined) {
          return NextResponse.json(
            { error: "planId, name, and ratePercent are required" },
            { status: 400 },
          );
        }
        const rate = Number(ratePercent);
        if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
          return NextResponse.json(
            { error: "ratePercent must be between 0 and 100" },
            { status: 400 },
          );
        }

        // Only one default per plan (partial unique index enforces this) —
        // demote the current default first when promoting a new one.
        if (isDefault) {
          const { error } = await admin
            .from("sales_commission_rate_types")
            .update({ is_default: false })
            .eq("plan_id", planId)
            .eq("is_default", true);
          if (error) throw error;
        }

        if (rateTypeId) {
          const { data, error } = await admin
            .from("sales_commission_rate_types")
            .update({
              name: name.trim(),
              rate_percent: rate,
              ...(isDefault ? { is_default: true } : {}),
            })
            .eq("id", rateTypeId)
            .select()
            .single();
          if (error) throw error;
          return NextResponse.json({ rateType: data });
        }

        const { data, error } = await admin
          .from("sales_commission_rate_types")
          .insert({
            plan_id: planId,
            name: name.trim(),
            rate_percent: rate,
            is_default: !!isDefault,
          })
          .select()
          .single();
        if (error) throw error;
        return NextResponse.json({ rateType: data });
      }

      case "delete_rate_type": {
        const { rateTypeId } = body;
        const { data: rt } = await admin
          .from("sales_commission_rate_types")
          .select("is_default")
          .eq("id", rateTypeId)
          .single();
        if (rt?.is_default) {
          return NextResponse.json(
            { error: "Cannot delete the default rate. Make another rate the default first." },
            { status: 400 },
          );
        }
        const { error } = await admin
          .from("sales_commission_rate_types")
          .delete()
          .eq("id", rateTypeId);
        if (error) {
          // FK restrict fires when customers are still assigned to this rate
          return NextResponse.json(
            { error: "Customers are still assigned to this rate. Reassign them first." },
            { status: 400 },
          );
        }
        return NextResponse.json({ ok: true });
      }

      case "assign_customer": {
        const { planId, rateTypeId, rwCustomerId, customerName } = body;
        if (!planId || !rateTypeId || !rwCustomerId) {
          return NextResponse.json(
            { error: "planId, rateTypeId, and rwCustomerId are required" },
            { status: 400 },
          );
        }
        const { data, error } = await admin
          .from("sales_commission_customer_assignments")
          .upsert(
            {
              plan_id: planId,
              rate_type_id: rateTypeId,
              rw_customer_id: String(rwCustomerId),
              customer_name: customerName || String(rwCustomerId),
            },
            { onConflict: "plan_id,rw_customer_id" },
          )
          .select()
          .single();
        if (error) throw error;
        return NextResponse.json({ assignment: data });
      }

      case "remove_assignment": {
        const { assignmentId } = body;
        const { error } = await admin
          .from("sales_commission_customer_assignments")
          .delete()
          .eq("id", assignmentId);
        if (error) throw error;
        return NextResponse.json({ ok: true });
      }

      case "search_rw_customers": {
        const { query } = body;
        if (!query || query.length < 2) {
          return NextResponse.json({ customers: [] });
        }
        const rw = await getRWClient();
        const result = await rw.browse<RWCustomerRow>("customer", {
          pagesize: 20,
          searchfields: ["Customer"],
          searchfieldoperators: ["like"],
          searchfieldvalues: [`%${query}%`],
          orderby: "Customer",
          orderbydirection: "asc",
        });
        return NextResponse.json({
          customers: result.rows.map((r) => ({
            rwCustomerId: r.CustomerId,
            customerName: r.Customer,
            customerNumber: r.CustomerNumber ?? null,
          })),
        });
      }

      case "customer_revenue": {
        // Trailing-12-month Versatile revenue per RW customer, on the same
        // basis as the calculator (pre-tax InvoiceSubTotal, VOID/no-charge/
        // non-billable skipped). Shown in the assignment search so the right
        // RW account can be picked when several share a name.
        const ids: string[] = Array.isArray(body.rwCustomerIds)
          ? body.rwCustomerIds.map(String).filter(Boolean).slice(0, 20)
          : [];
        if (ids.length === 0) return NextResponse.json({ revenue: {} });

        const warehouseKeywords: string[] =
          body.warehouseKeywords ?? DEFAULT_WAREHOUSE_KEYWORDS;
        const now = new Date();
        const ttmStartMs = Date.UTC(
          now.getUTCFullYear() - 1,
          now.getUTCMonth(),
          now.getUTCDate(),
        );

        const rw = await getRWClient();
        const revenue: Record<
          string,
          {
            ttmRevenue: number;
            ttmInvoiceCount: number;
            lifetimeRevenue: number;
            lastInvoiceDate: string | null;
            customerNumber: string | null;
          }
        > = {};

        const summarize = async (id: string) => {
          // CustomerId equality only; the date bound is applied in code
          // (RW browse mishandles multi-condition date searches).
          const res = await rw.browseAll<RWInvoiceRow>("invoice", {
            pagesize: 2000,
            searchfields: ["CustomerId"],
            searchfieldoperators: ["="],
            searchfieldvalues: [id],
            orderby: "InvoiceDate",
            orderbydirection: "desc",
          });
          let ttmRevenue = 0;
          let ttmInvoiceCount = 0;
          let lifetimeRevenue = 0;
          let lastMs = -Infinity;
          let customerNumber: string | null = null;
          for (const inv of res.rows) {
            if (!customerNumber && inv.CustomerNumber) {
              customerNumber = String(inv.CustomerNumber);
            }
            const locationText = inv.OfficeLocation ?? inv.Warehouse ?? "";
            const isVersatile = locationText
              ? matchesWarehouse(locationText, warehouseKeywords)
              : (inv.InvoiceNumber || "").toUpperCase().startsWith("V");
            if (!isVersatile) continue;
            const status = (inv.Status ?? "").toUpperCase();
            if (status === "VOID" || status === "VOIDED") continue;
            if (
              String(inv.IsNoCharge ?? "").toLowerCase() === "true" ||
              String(inv.IsNonBillable ?? "").toLowerCase() === "true"
            ) {
              continue;
            }
            const subtotal = parseFloat(inv.InvoiceSubTotal || "0") || 0;
            const invMs = Date.parse(inv.InvoiceDate);
            lifetimeRevenue += subtotal;
            if (!Number.isNaN(invMs)) {
              if (invMs > lastMs) lastMs = invMs;
              if (invMs >= ttmStartMs) {
                ttmRevenue += subtotal;
                ttmInvoiceCount++;
              }
            }
          }
          if (!customerNumber) {
            // Invoice rows may not carry the number; read the customer record.
            try {
              const cust = await rw.browse<RWCustomerRow>("customer", {
                pagesize: 1,
                searchfields: ["CustomerId"],
                searchfieldoperators: ["="],
                searchfieldvalues: [id],
              });
              customerNumber = cust.rows[0]?.CustomerNumber
                ? String(cust.rows[0].CustomerNumber)
                : null;
            } catch {
              customerNumber = null;
            }
          }
          revenue[id] = {
            ttmRevenue: Math.round(ttmRevenue * 100) / 100,
            ttmInvoiceCount,
            lifetimeRevenue: Math.round(lifetimeRevenue * 100) / 100,
            lastInvoiceDate: Number.isFinite(lastMs)
              ? new Date(lastMs).toISOString().slice(0, 10)
              : null,
            customerNumber,
          };
        };

        // Batches of 5 — RW's observed safe concurrency.
        for (let i = 0; i < ids.length; i += 5) {
          await Promise.all(ids.slice(i, i + 5).map(summarize));
        }
        return NextResponse.json({ revenue });
      }

      case "calculate": {
        const { planId, periodYear, periodMonth } = body;
        if (!planId || !periodYear || !periodMonth) {
          return NextResponse.json(
            { error: "planId, periodYear, and periodMonth are required" },
            { status: 400 },
          );
        }

        const [{ data: plan }, { data: rateTypes }, { data: assignments }] =
          await Promise.all([
            admin
              .from("sales_commission_plans")
              .select("*")
              .eq("id", planId)
              .single(),
            admin
              .from("sales_commission_rate_types")
              .select("*")
              .eq("plan_id", planId),
            admin
              .from("sales_commission_customer_assignments")
              .select("*")
              .eq("plan_id", planId),
          ]);
        if (!plan) {
          return NextResponse.json({ error: "Plan not found" }, { status: 404 });
        }
        const defaultRate = (rateTypes || []).find((rt) => rt.is_default);
        if (!defaultRate) {
          return NextResponse.json(
            { error: "Plan has no default rate. Add one before calculating." },
            { status: 400 },
          );
        }
        const rateById = new Map(
          (rateTypes || []).map((rt) => [rt.id as string, rt]),
        );
        const assignmentByCustomer = new Map(
          (assignments || []).map((a) => [String(a.rw_customer_id), a]),
        );

        // One calendar month of invoices by InvoiceDate. Single >= filter
        // only — RW browse mishandles dual-condition date searches (returns
        // an unbounded set, which timed out the function); the proven
        // pattern from rental-accruals-v2 is >= plus in-code upper bound.
        const periodStart = new Date(Date.UTC(periodYear, periodMonth - 1, 1));
        const periodStartMs = periodStart.getTime();
        const nextMonthStartMs = Date.UTC(periodYear, periodMonth, 1);

        const startDate: string | null = plan.commission_start_date ?? null;
        const startMs = startDate
          ? Date.parse(`${startDate}T00:00:00Z`)
          : null;

        const rw = await getRWClient();
        const [invoicesRes, ordersRes] = await Promise.all([
          rw.browseAll<RWInvoiceRow>("invoice", {
            pagesize: 2000,
            searchfields: ["InvoiceDate"],
            searchfieldoperators: [">="],
            searchfieldvalues: [formatRWDate(periodStart)],
            searchfieldtypes: ["date"],
            orderby: "InvoiceDate",
            orderbydirection: "desc",
          }),
          // Orders placed since the start date — the allowed set for the
          // order-placement cutoff. The windowed browse aligns to calendar
          // months, so rows from earlier in the start month come back too;
          // the >= filter below removes them.
          startMs !== null
            ? rw.browseAllByMonthWindows<RWOrderRow>(
                "order",
                "OrderDate",
                new Date(startMs),
                { pagesize: 2000 },
              )
            : Promise.resolve(null),
        ]);
        const allowedOrders: Set<string> | null =
          ordersRes && startMs !== null
            ? new Set(
                ordersRes.rows
                  .filter((r) => {
                    const ms = Date.parse(r.OrderDate);
                    return !Number.isNaN(ms) && ms >= startMs;
                  })
                  .map((r) => String(r.OrderNumber)),
              )
            : null;

        const warehouseKeywords: string[] =
          body.warehouseKeywords ?? DEFAULT_WAREHOUSE_KEYWORDS;

        interface CustomerAgg {
          rwCustomerId: string;
          customerName: string;
          invoiceCount: number;
          revenue: number;
          invoices: {
            invoiceNumber: string;
            invoiceDate: string;
            status: string;
            subtotal: number;
          }[];
        }
        const byCustomer = new Map<string, CustomerAgg>();
        let skippedCount = 0;
        let beforeStartCount = 0;

        // Contract effective date, applied to ORDER placement: an invoice
        // only earns fees if its order was placed on/after the start date,
        // regardless of when it was invoiced (mirrors the termination
        // clause, which keys entitlement to when bookings were placed).
        for (const inv of invoicesRes.rows) {
          // In-code month bound (upper end of the >= browse above).
          const invMs = Date.parse(inv.InvoiceDate);
          if (Number.isNaN(invMs) || invMs < periodStartMs || invMs >= nextMonthStartMs) {
            continue;
          }
          const locationText = inv.OfficeLocation ?? inv.Warehouse ?? "";
          const isVersatile = locationText
            ? matchesWarehouse(locationText, warehouseKeywords)
            : (inv.InvoiceNumber || "").toUpperCase().startsWith("V");
          if (!isVersatile) continue;

          if (startMs !== null && allowedOrders !== null) {
            const orderNo = String(inv.OrderNumber || "");
            // Invoices with no order (misc billing) fall back to invoice date.
            const earns = orderNo
              ? allowedOrders.has(orderNo)
              : invMs >= startMs;
            if (!earns) {
              beforeStartCount++;
              continue;
            }
          }

          const status = (inv.Status ?? "").toUpperCase();
          if (status === "VOID" || status === "VOIDED") {
            skippedCount++;
            continue;
          }
          const isNoCharge = String(inv.IsNoCharge ?? "").toLowerCase() === "true";
          const isNonBillable =
            String(inv.IsNonBillable ?? "").toLowerCase() === "true";
          if (isNoCharge || isNonBillable) {
            skippedCount++;
            continue;
          }

          const subtotal = parseFloat(inv.InvoiceSubTotal || "0") || 0;
          const key = String(inv.CustomerId || inv.Customer || "UNKNOWN");
          let agg = byCustomer.get(key);
          if (!agg) {
            agg = {
              rwCustomerId: key,
              customerName: inv.Customer || key,
              invoiceCount: 0,
              revenue: 0,
              invoices: [],
            };
            byCustomer.set(key, agg);
          }
          agg.invoiceCount++;
          agg.revenue += subtotal;
          agg.invoices.push({
            invoiceNumber: inv.InvoiceNumber,
            invoiceDate: inv.InvoiceDate,
            status: inv.Status,
            subtotal,
          });
        }

        const detail = Array.from(byCustomer.values())
          .map((agg) => {
            const assignment = assignmentByCustomer.get(agg.rwCustomerId);
            const rateType = assignment
              ? rateById.get(assignment.rate_type_id as string) ?? defaultRate
              : defaultRate;
            const ratePercent = Number(rateType.rate_percent);
            const revenue = Math.round(agg.revenue * 100) / 100;
            const commission =
              Math.round(revenue * (ratePercent / 100) * 100) / 100;
            return {
              rwCustomerId: agg.rwCustomerId,
              customerName: agg.customerName,
              invoiceCount: agg.invoiceCount,
              revenue,
              rateTypeName: rateType.name as string,
              ratePercent,
              commission,
              assigned: !!assignment,
              invoices: agg.invoices,
            };
          })
          .sort((a, b) => b.revenue - a.revenue);

        const totalRevenue =
          Math.round(detail.reduce((s, d) => s + d.revenue, 0) * 100) / 100;
        const totalCommission =
          Math.round(detail.reduce((s, d) => s + d.commission, 0) * 100) / 100;

        const { data: run, error: runError } = await admin
          .from("sales_commission_runs")
          .upsert(
            {
              plan_id: planId,
              period_year: periodYear,
              period_month: periodMonth,
              total_revenue: totalRevenue,
              total_commission: totalCommission,
              default_rate_percent: Number(defaultRate.rate_percent),
              detail: detail.map(({ invoices: _invoices, ...rest }) => rest),
              calculated_at: new Date().toISOString(),
            },
            { onConflict: "plan_id,period_year,period_month" },
          )
          .select()
          .single();
        if (runError) throw runError;

        return NextResponse.json({
          run,
          detail,
          totalRevenue,
          totalCommission,
          skippedCount,
          beforeStartCount,
          commissionStartDate: startDate,
          invoicesConsidered: invoicesRes.rows.length,
        });
      }

      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (err) {
    console.error("sales-commissions error:", err);
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
