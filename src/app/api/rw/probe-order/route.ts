import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { RentalWorksClient } from "@/lib/rentalworks/client";

export const maxDuration = 60;

/**
 * GET /api/rw/probe-order?orderNumber=AC10005
 *
 * Diagnostic probe for discovering how RentalWorks exposes per-item GL data
 * on an order.  Tries, in order:
 *
 *   A. `/order/browse` with an OrderNumber filter to resolve OrderId
 *   B. `GET /order/{OrderId}` — the "named fields" detail endpoint
 *   C. `/orderitem/browse` with `uniqueids: { OrderId }` — the CLAUDE.md
 *      note says this returns 500; we want to confirm/refute
 *   D. `/gldistribution/browse` with `uniqueids: { OrderId }` — mirrors the
 *      invoice-side GL call, never tried with an order
 *
 * Returns raw responses so we can see exactly which fields are present and
 * decide which call to wire into rental-accruals-v2 for real per-I-code GL
 * mapping.  Not intended for production traffic — auth-gated to signed-in
 * users only.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const orderNumber = new URL(request.url).searchParams.get("orderNumber");
  if (!orderNumber) {
    return NextResponse.json(
      { error: "orderNumber query param is required" },
      { status: 400 },
    );
  }

  if (
    !process.env.RW_BASE_URL ||
    !process.env.RW_USERNAME ||
    !process.env.RW_PASSWORD
  ) {
    return NextResponse.json(
      { error: "RentalWorks credentials not configured" },
      { status: 500 },
    );
  }

  const rw = new RentalWorksClient(process.env.RW_BASE_URL);
  await rw.ensureAuth(process.env.RW_USERNAME, process.env.RW_PASSWORD);

  // A. Resolve OrderId from OrderNumber
  const orderBrowse = await tryCall(() =>
    rw.browse<{ OrderId: string; OrderNumber: string }>("order", {
      pagesize: 5,
      searchfields: ["OrderNumber"],
      searchfieldoperators: ["="],
      searchfieldvalues: [orderNumber],
      searchfieldtypes: [""],
    }),
  );

  let orderId: string | null = null;
  if (orderBrowse.ok) {
    const rows = orderBrowse.data?.rows ?? [];
    if (rows.length > 0) orderId = rows[0].OrderId ?? null;
  }

  if (!orderId) {
    return NextResponse.json({
      orderNumber,
      error: "Could not resolve OrderId from OrderNumber",
      orderBrowse,
    });
  }

  // B. GET /order/{OrderId}
  const orderDetail = await tryCall(() => rw.getOrder(orderId!));

  // C. /orderitem/browse with uniqueids
  const orderItemsBrowse = await tryCall(() =>
    rw.browse("orderitem", {
      pagesize: 500,
      uniqueids: { OrderId: orderId! },
    }),
  );

  // D. /gldistribution/browse with OrderId uniqueids
  const glByOrder = await tryCall(() =>
    rw.browse("gldistribution", {
      pagesize: 500,
      uniqueids: { OrderId: orderId! },
    }),
  );

  // E. /gldistribution/browse with OrderNumber as a search field
  const glByOrderNumber = await tryCall(() =>
    rw.browse("gldistribution", {
      pagesize: 500,
      searchfields: ["OrderNumber"],
      searchfieldoperators: ["="],
      searchfieldvalues: [orderNumber],
      searchfieldtypes: [""],
    }),
  );

  return NextResponse.json({
    orderNumber,
    orderId,
    orderBrowse: summarize(orderBrowse),
    orderDetail: summarize(orderDetail),
    orderItemsBrowse: summarize(orderItemsBrowse),
    glByOrder: summarize(glByOrder),
    glByOrderNumber: summarize(glByOrderNumber),
  });
}

interface CallResult<T = unknown> {
  ok: boolean;
  status?: number;
  error?: string;
  data?: T;
}

async function tryCall<T>(fn: () => Promise<T>): Promise<CallResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data };
  } catch (err) {
    if (err instanceof Error) {
      // RentalWorksClient errors include HTTP status in message
      const statusMatch = err.message.match(/\b(\d{3})\b/);
      return {
        ok: false,
        status: statusMatch ? Number(statusMatch[1]) : undefined,
        error: err.message,
      };
    }
    return { ok: false, error: String(err) };
  }
}

/**
 * Shrink a call result to what's useful for diagnosis: for a browse response,
 * keep the column names + the first few rows; for a getById, keep all keys +
 * a preview of values.  Raw data blobs can be tens of MB, we don't want to
 * dump them all.
 */
function summarize(result: CallResult): unknown {
  if (!result.ok) return result;
  const d = result.data as Record<string, unknown> | undefined;
  if (!d) return result;
  // Browse response
  if (Array.isArray((d as { rows?: unknown[] }).rows)) {
    const rows = (d as { rows: Record<string, unknown>[] }).rows;
    const columnIndex = (d as { columnIndex?: Record<string, number> }).columnIndex;
    const columns = columnIndex ? Object.keys(columnIndex) : [];
    return {
      ok: true,
      shape: "browse",
      totalRows: (d as { totalRows?: number }).totalRows ?? rows.length,
      columns,
      firstRow: rows[0] ?? null,
      secondRow: rows[1] ?? null,
    };
  }
  // GetById response — keys + sample
  const keys = Object.keys(d);
  // Flag keys that might hold child item arrays
  const arrayKeys: Record<string, unknown> = {};
  for (const k of keys) {
    const v = (d as Record<string, unknown>)[k];
    if (Array.isArray(v)) {
      arrayKeys[k] = {
        length: v.length,
        firstElement: v[0] ?? null,
      };
    }
  }
  return {
    ok: true,
    shape: "named",
    keys,
    arrayFields: arrayKeys,
    sample: sampleFields(d),
  };
}

function sampleFields(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (Array.isArray(v)) continue; // handled by arrayFields
    if (typeof v === "object" && v !== null) continue;
    out[k] = v;
  }
  return out;
}
