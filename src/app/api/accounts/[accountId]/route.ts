import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// PATCH /api/accounts/:accountId — update the editable fields on an entity
// account. Supports account_number, name, classification, and account_type.
// Scoped through RLS: the user must be a member of the organization that
// owns the account's entity; the admin client is used for the write but
// only after verifying the caller's session and organization membership.

const VALID_CLASSIFICATIONS = new Set([
  "Asset",
  "Liability",
  "Equity",
  "Revenue",
  "Expense",
]);

interface PatchBody {
  accountNumber?: string | null;
  name?: string;
  classification?: string;
  accountType?: string;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ accountId: string }> }
) {
  const { accountId } = await params;
  if (!accountId) {
    return NextResponse.json({ error: "accountId is required" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Verify the account exists and belongs to an entity the caller can access.
  const { data: account, error: accountErr } = await admin
    .from("accounts")
    .select("id, entity_id, entities(organization_id)")
    .eq("id", accountId)
    .single();

  if (accountErr || !account) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  const organizationId = (
    account as unknown as { entities: { organization_id: string } | null }
  ).entities?.organization_id;
  if (!organizationId) {
    return NextResponse.json(
      { error: "Account is missing an organization" },
      { status: 500 }
    );
  }

  const { data: membership } = await admin
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Build the update payload from the fields the caller actually supplied.
  const update: {
    account_number?: string | null;
    name?: string;
    classification?: string;
    account_type?: string;
  } = {};

  if (Object.prototype.hasOwnProperty.call(body, "accountNumber")) {
    const v = body.accountNumber;
    if (v === null || v === undefined) {
      update.account_number = null;
    } else {
      const trimmed = String(v).trim();
      update.account_number = trimmed.length > 0 ? trimmed : null;
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, "name")) {
    const v = (body.name ?? "").trim();
    if (v.length === 0) {
      return NextResponse.json(
        { error: "Account name cannot be blank" },
        { status: 400 }
      );
    }
    update.name = v;
  }

  if (Object.prototype.hasOwnProperty.call(body, "classification")) {
    const v = (body.classification ?? "").trim();
    if (!VALID_CLASSIFICATIONS.has(v)) {
      return NextResponse.json(
        {
          error:
            "classification must be one of Asset, Liability, Equity, Revenue, Expense",
        },
        { status: 400 }
      );
    }
    update.classification = v;
  }

  if (Object.prototype.hasOwnProperty.call(body, "accountType")) {
    const trimmed = String(body.accountType ?? "").trim();
    if (trimmed.length === 0) {
      return NextResponse.json(
        { error: "accountType cannot be blank" },
        { status: 400 }
      );
    }
    update.account_type = trimmed;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json(
      { error: "No editable fields supplied" },
      { status: 400 }
    );
  }

  const { data: updated, error: updateErr } = await admin
    .from("accounts")
    .update(update)
    .eq("id", accountId)
    .select("id, account_number, name, classification, account_type")
    .single();

  if (updateErr || !updated) {
    return NextResponse.json(
      { error: updateErr?.message ?? "Failed to update account" },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, account: updated });
}
