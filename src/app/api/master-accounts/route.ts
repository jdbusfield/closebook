import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaginated } from "@/lib/utils/paginated-fetch";
import { resolveChartIdOrDefault } from "@/lib/master-charts/resolve";

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", user.id)
    .single();

  if (!membership) {
    return NextResponse.json(
      { error: "No organization found" },
      { status: 404 }
    );
  }

  const { searchParams } = new URL(request.url);
  const chartIdParam = searchParams.get("chartId");

  let chartId: string;
  try {
    chartId = await resolveChartIdOrDefault(
      supabase,
      membership.organization_id,
      chartIdParam,
    );
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 400 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const accounts = await fetchAllPaginated<any>((offset, limit) =>
    supabase
      .from("master_accounts")
      .select("*")
      .eq("organization_id", membership.organization_id)
      .eq("chart_id", chartId)
      .order("classification")
      .order("display_order")
      .order("account_number")
      .range(offset, offset + limit - 1)
  );

  return NextResponse.json({ accounts, chartId });
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
  const {
    organizationId,
    chartId: chartIdInput,
    accountNumber,
    name,
    description,
    classification,
    accountType,
    accountSubType,
    parentAccountId,
    normalBalance,
    displayOrder,
    isIntercompany,
  } = body;

  if (!organizationId || !accountNumber || !name || !classification || !accountType) {
    return NextResponse.json(
      { error: "organizationId, accountNumber, name, classification, and accountType are required" },
      { status: 400 }
    );
  }

  let chartId: string;
  try {
    chartId = await resolveChartIdOrDefault(supabase, organizationId, chartIdInput);
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 400 },
    );
  }

  const { data: account, error } = await supabase
    .from("master_accounts")
    .insert({
      organization_id: organizationId,
      chart_id: chartId,
      account_number: accountNumber,
      name,
      description: description || null,
      classification,
      account_type: accountType,
      account_sub_type: accountSubType || null,
      parent_account_id: parentAccountId || null,
      normal_balance: normalBalance || (["Asset", "Expense"].includes(classification) ? "debit" : "credit"),
      display_order: displayOrder ?? 0,
      is_intercompany: isIntercompany ?? false,
      created_by: user.id,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ account }, { status: 201 });
}

export async function PUT(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { id, ...updates } = body;

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  // Map camelCase to snake_case for the update fields
  const updateData: Record<string, unknown> = {};
  if (updates.accountNumber !== undefined) updateData.account_number = updates.accountNumber;
  if (updates.name !== undefined) updateData.name = updates.name;
  if (updates.description !== undefined) updateData.description = updates.description;
  if (updates.classification !== undefined) updateData.classification = updates.classification;
  if (updates.accountType !== undefined) updateData.account_type = updates.accountType;
  if (updates.accountSubType !== undefined) updateData.account_sub_type = updates.accountSubType;
  if (updates.parentAccountId !== undefined) updateData.parent_account_id = updates.parentAccountId || null;
  if (updates.isActive !== undefined) updateData.is_active = updates.isActive;
  if (updates.isIntercompany !== undefined) updateData.is_intercompany = updates.isIntercompany;
  if (updates.normalBalance !== undefined) updateData.normal_balance = updates.normalBalance;
  if (updates.displayOrder !== undefined) updateData.display_order = updates.displayOrder;

  const { data: account, error } = await supabase
    .from("master_accounts")
    .update(updateData)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ account });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await request.json();

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("master_accounts")
    .delete()
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
