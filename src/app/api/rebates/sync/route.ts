import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { classifyEquipmentType, getQuarter } from "@/lib/utils/rebate-calculations";

export const maxDuration = 120; // Allow up to 2 minutes for large syncs

interface RWInvoice {
  InvoiceId: string;
  InvoiceNumber: string;
  InvoiceDate: string;
  BillingStartDate: string;
  BillingEndDate: string;
  Status: string;
  Customer: string;
  CustomerId: string;
  Deal: string;
  OrderNumber: string;
  OrderDescription: string;
  InvoiceDescription: string;
  PurchaseOrderNumber: string;
  InvoiceListTotal: string;
  InvoiceGrossTotal: string;
  InvoiceSubTotal: string;
  InvoiceTax: string;
  InvoiceDiscountTotal: string;
  IsNoCharge: string | boolean;
  IsNonBillable: string | boolean;
}

interface RWInvoiceItem {
  InvoiceItemId: string;
  ICode: string;
  Description: string;
  Quantity: string;
  Extended: string;
  DiscountAmount: string;
  RecType: string;
  AvailableFor: string;
}

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
    case "sync_customer": {
      const { entityId, customerId } = body;

      // Load customer config
      const { data: customer, error: custErr } = await admin
        .from("rebate_customers")
        .select("*")
        .eq("id", customerId)
        .single();

      if (custErr || !customer) {
        return NextResponse.json(
          { error: "Customer not found" },
          { status: 404 },
        );
      }

      // Freelancer customers don't have an RW customer ID to sync
      if (customer.agreement_type === "freelancer") {
        return NextResponse.json(
          { error: "Freelancer agreements use manual invoice entry, not sync" },
          { status: 400 },
        );
      }

      try {
        const stats = await syncCustomerInvoices(admin, entityId, customer);
        return NextResponse.json({ success: true, ...stats });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Sync failed";
        return NextResponse.json({ error: msg }, { status: 500 });
      }
    }

    case "sync_all": {
      const { entityId } = body;

      // Only sync commercial customers (freelancers add invoices manually)
      const { data: customers } = await admin
        .from("rebate_customers")
        .select("*")
        .eq("entity_id", entityId)
        .eq("status", "active")
        .eq("agreement_type", "commercial");

      if (!customers || customers.length === 0) {
        return NextResponse.json({
          success: true,
          message: "No active customers to sync",
        });
      }

      const results = [];
      for (const customer of customers) {
        try {
          const stats = await syncCustomerInvoices(
            admin,
            entityId,
            customer,
          );
          results.push({
            customerId: customer.id,
            customerName: customer.customer_name,
            ...stats,
          });
        } catch (err) {
          results.push({
            customerId: customer.id,
            customerName: customer.customer_name,
            error: err instanceof Error ? err.message : "Sync failed",
          });
        }
      }

      return NextResponse.json({ success: true, results });
    }

    case "add_invoice": {
      // Manually add a single invoice by invoice number (for freelancer agreements)
      const { entityId, customerId, invoiceNumber } = body;

      if (!entityId || !customerId || !invoiceNumber) {
        return NextResponse.json(
          { error: "entityId, customerId, and invoiceNumber are required" },
          { status: 400 },
        );
      }

      // Load customer
      const { data: addCust, error: addCustErr } = await admin
        .from("rebate_customers")
        .select("*")
        .eq("id", customerId)
        .single();

      if (addCustErr || !addCust) {
        return NextResponse.json({ error: "Customer not found" }, { status: 404 });
      }

      try {
        const { RentalWorksClient } = await import("@/lib/rentalworks/client");
        const rw = new RentalWorksClient(process.env.RW_BASE_URL!);
        await rw.ensureAuth(process.env.RW_USERNAME!, process.env.RW_PASSWORD!);

        // Search for the invoice by number
        const invoiceResult = await rw.browseAll<RWInvoice>("invoice", {
          pagesize: 10,
          searchfields: ["InvoiceNumber"],
          searchfieldoperators: ["="],
          searchfieldvalues: [invoiceNumber.trim()],
        });

        if (invoiceResult.rows.length === 0) {
          return NextResponse.json(
            { error: `Invoice "${invoiceNumber}" not found in RentalWorks` },
            { status: 404 },
          );
        }

        const inv = invoiceResult.rows[0];

        const allowedStatuses = new Set(["CLOSED", "PROCESSED", "APPROVED"]);
        if (!allowedStatuses.has((inv.Status || "").toUpperCase())) {
          return NextResponse.json(
            { error: `Invoice "${invoiceNumber}" must be CLOSED, PROCESSED, or APPROVED (status: ${inv.Status})` },
            { status: 400 },
          );
        }

        // Check if invoice already exists for this customer
        const { data: existing } = await admin
          .from("rebate_invoices")
          .select("id")
          .eq("rebate_customer_id", customerId)
          .eq("rw_invoice_id", inv.InvoiceId);

        if (existing && existing.length > 0) {
          return NextResponse.json(
            { error: `Invoice "${invoiceNumber}" has already been added` },
            { status: 400 },
          );
        }

        const equipType = classifyEquipmentType(
          inv.OrderDescription || inv.InvoiceDescription || "",
        );
        const quarter = getQuarter(inv.BillingEndDate || inv.InvoiceDate);

        const invoiceRow = {
          entity_id: entityId,
          rebate_customer_id: customerId,
          rw_invoice_id: inv.InvoiceId,
          invoice_number: inv.InvoiceNumber,
          invoice_date: inv.InvoiceDate || null,
          billing_start_date: inv.BillingStartDate || null,
          billing_end_date: inv.BillingEndDate || null,
          status: inv.Status,
          customer_name: inv.Customer,
          deal: inv.Deal || null,
          order_number: inv.OrderNumber || null,
          order_description: inv.OrderDescription || inv.InvoiceDescription || null,
          purchase_order_number: inv.PurchaseOrderNumber || null,
          list_total: Number(inv.InvoiceListTotal) || 0,
          gross_total: Number(inv.InvoiceGrossTotal) || 0,
          sub_total: Number(inv.InvoiceSubTotal) || 0,
          tax_amount: Number(inv.InvoiceTax) || 0,
          discount_amount: Number(inv.InvoiceDiscountTotal) || 0,
          equipment_type: equipType,
          quarter,
          synced_at: new Date().toISOString(),
        };

        const { data: upserted, error: upsertErr } = await admin
          .from("rebate_invoices")
          .insert(invoiceRow)
          .select("id")
          .single();

        if (upsertErr || !upserted) {
          return NextResponse.json(
            { error: upsertErr?.message || "Failed to save invoice" },
            { status: 500 },
          );
        }

        // Fetch and store invoice items
        let itemsSynced = 0;
        try {
          const itemResult = await rw.browseAll<RWInvoiceItem>("invoiceitem", {
            pagesize: 500,
            uniqueids: { InvoiceId: inv.InvoiceId },
          });

          if (itemResult.rows.length > 0) {
            const itemRows = itemResult.rows.map((item) => ({
              rebate_invoice_id: upserted.id,
              rw_item_id: item.InvoiceItemId || null,
              i_code: item.ICode || null,
              description: item.Description || null,
              quantity: Number(item.Quantity) || 0,
              extended: Number(item.Extended) || 0,
              discount_amount: Number(item.DiscountAmount) || 0,
              is_excluded: false,
              record_type: item.RecType === "F" ? "F" : (item.AvailableFor || item.RecType || null),
            }));

            await admin.from("rebate_invoice_items").insert(itemRows);
            itemsSynced = itemRows.length;
          }
        } catch {
          // Continue even if item fetch fails
        }

        return NextResponse.json({
          success: true,
          invoice: {
            id: upserted.id,
            invoice_number: inv.InvoiceNumber,
            invoice_date: inv.InvoiceDate,
            customer_name: inv.Customer,
            list_total: Number(inv.InvoiceListTotal) || 0,
            sub_total: Number(inv.InvoiceSubTotal) || 0,
            equipment_type: equipType,
          },
          itemsSynced,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to add invoice";
        return NextResponse.json({ error: msg }, { status: 500 });
      }
    }

    case "fetch_active_orders": {
      const { customerId } = body;

      // Load customer config
      const { data: customer, error: custErr } = await admin
        .from("rebate_customers")
        .select("*")
        .eq("id", customerId)
        .single();

      if (custErr || !customer) {
        return NextResponse.json(
          { error: "Customer not found" },
          { status: 404 },
        );
      }

      if (!customer.rw_customer_id) {
        return NextResponse.json({ success: true, orders: [] });
      }

      try {
        const { RentalWorksClient } = await import(
          "@/lib/rentalworks/client"
        );
        const rw = new RentalWorksClient(process.env.RW_BASE_URL!);
        await rw.ensureAuth(process.env.RW_USERNAME!, process.env.RW_PASSWORD!);

        // Fetch orders for this customer
        // Note: order browse doesn't support CustomerId as searchfield,
        // so we search by Customer name instead
        const orderResult = await rw.browseAll<{
          OrderId: string;
          OrderNumber: string;
          OrderDate: string;
          EstimatedStartDate: string;
          EstimatedStopDate: string;
          Status: string;
          Customer: string;
          Deal: string;
          Description: string;
          Total: string;
          RentalTotal: string;
          PurchaseOrderNumber: string;
        }>("order", {
          pagesize: 500,
          searchfields: ["Customer"],
          searchfieldoperators: ["="],
          searchfieldvalues: [customer.customer_name],
          orderby: "OrderDate",
          orderbydirection: "desc",
        });

        // Filter to active orders (OPEN, CONFIRMED, ACTIVE, COMPLETE, etc. — exclude CLOSED, CANCELLED)
        const inactiveStatuses = new Set(["CLOSED", "CANCELLED", "SNAPSHOT", "VOID"]);
        const activeOrders = orderResult.rows.filter((o) => {
          const status = (o.Status || "").toUpperCase();
          return !inactiveStatuses.has(status);
        });

        // Classify equipment type and estimate rebate for each order
        const orders = activeOrders.map((o) => ({
          orderId: o.OrderId,
          orderNumber: o.OrderNumber,
          orderDate: o.OrderDate || null,
          estimatedStartDate: o.EstimatedStartDate || null,
          estimatedStopDate: o.EstimatedStopDate || null,
          status: o.Status,
          deal: o.Deal || null,
          description: o.Description || null,
          total: Number(o.Total) || 0,
          rentalTotal: Number(o.RentalTotal) || 0,
          purchaseOrderNumber: o.PurchaseOrderNumber || null,
          equipmentType: classifyEquipmentType(o.Description || ""),
        }));

        return NextResponse.json({ success: true, orders });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to fetch orders";
        return NextResponse.json({ error: msg }, { status: 500 });
      }
    }

    default:
      return NextResponse.json(
        { error: `Unknown action: ${action}` },
        { status: 400 },
      );
  }
}

async function syncCustomerInvoices(
  admin: ReturnType<typeof createAdminClient>,
  entityId: string,
  customer: {
    id: string;
    rw_customer_id: string | null;
    customer_name: string;
  },
) {
  if (!customer.rw_customer_id) {
    throw new Error("Cannot sync invoices for a customer without an RW Customer ID");
  }

  // Import RentalWorks client
  const { RentalWorksClient } = await import(
    "@/lib/rentalworks/client"
  );
  const rw = new RentalWorksClient(process.env.RW_BASE_URL!);
  await rw.ensureAuth(process.env.RW_USERNAME!, process.env.RW_PASSWORD!);

  // Fetch invoices for this customer
  const invoiceResult = await rw.browseAll<RWInvoice>("invoice", {
    pagesize: 2000,
    searchfields: ["CustomerId"],
    searchfieldoperators: ["="],
    searchfieldvalues: [customer.rw_customer_id],
    orderby: "BillingEndDate",
    orderbydirection: "asc",
  });

  const invoices = invoiceResult.rows;

  // Filter to CLOSED, PROCESSED, or APPROVED non-zero invoices
  const closedInvoices = invoices.filter((inv) => {
    const status = (inv.Status || "").toUpperCase();
    if (status !== "CLOSED" && status !== "PROCESSED" && status !== "APPROVED") return false;
    // RW browse returns these as JSON booleans, not strings — coerce before comparing
    if (String(inv.IsNoCharge).toLowerCase() === "true") return false;
    if (String(inv.IsNonBillable).toLowerCase() === "true") return false;
    return true;
  });

  let synced = 0;
  let itemsSynced = 0;

  // Process invoices in batches
  for (const inv of closedInvoices) {
    const equipType = classifyEquipmentType(
      inv.OrderDescription || inv.InvoiceDescription || "",
    );
    const quarter = getQuarter(inv.BillingEndDate || inv.InvoiceDate);

    // Upsert invoice
    const invoiceRow = {
      entity_id: entityId,
      rebate_customer_id: customer.id,
      rw_invoice_id: inv.InvoiceId,
      invoice_number: inv.InvoiceNumber,
      invoice_date: inv.InvoiceDate || null,
      billing_start_date: inv.BillingStartDate || null,
      billing_end_date: inv.BillingEndDate || null,
      status: inv.Status,
      customer_name: inv.Customer,
      deal: inv.Deal || null,
      order_number: inv.OrderNumber || null,
      order_description:
        inv.OrderDescription || inv.InvoiceDescription || null,
      purchase_order_number: inv.PurchaseOrderNumber || null,
      list_total: Number(inv.InvoiceListTotal) || 0,
      gross_total: Number(inv.InvoiceGrossTotal) || 0,
      sub_total: Number(inv.InvoiceSubTotal) || 0,
      tax_amount: Number(inv.InvoiceTax) || 0,
      discount_amount: Number(inv.InvoiceDiscountTotal) || 0,
      equipment_type: equipType,
      quarter,
      synced_at: new Date().toISOString(),
    };

    const { data: upserted, error: upsertErr } = await admin
      .from("rebate_invoices")
      .upsert(invoiceRow, { onConflict: "entity_id,rw_invoice_id" })
      .select("id")
      .single();

    if (upsertErr || !upserted) continue;
    synced++;

    // Fetch invoice items (batched 5 at a time)
    try {
      const itemResult = await rw.browseAll<RWInvoiceItem>("invoiceitem", {
        pagesize: 500,
        uniqueids: { InvoiceId: inv.InvoiceId },
      });

      // Delete old items and insert fresh
      await admin
        .from("rebate_invoice_items")
        .delete()
        .eq("rebate_invoice_id", upserted.id);

      if (itemResult.rows.length > 0) {
        const itemRows = itemResult.rows.map((item) => ({
          rebate_invoice_id: upserted.id,
          rw_item_id: item.InvoiceItemId || null,
          i_code: item.ICode || null,
          description: item.Description || null,
          quantity: Number(item.Quantity) || 0,
          extended: Number(item.Extended) || 0,
          discount_amount: Number(item.DiscountAmount) || 0,
          is_excluded: false,
          record_type: item.RecType === "F" ? "F" : (item.AvailableFor || item.RecType || null),
        }));

        await admin.from("rebate_invoice_items").insert(itemRows);
        itemsSynced += itemRows.length;
      }
    } catch {
      // Continue even if item fetch fails for one invoice
    }
  }

  return {
    totalInvoices: invoices.length,
    closedInvoices: closedInvoices.length,
    synced,
    itemsSynced,
  };
}
