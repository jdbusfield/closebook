import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import {
  PDF_STATUS_TO_CRM,
  type ApplyDiffPayload,
} from "@/lib/crm/import-types";

export const maxDuration = 120;

interface ApplyResult {
  status_updates: number;
  aliases_created: number;
  productions_created: number;
  companies_created: number;
  studios_linked_or_created: number;
  contacts_created: number;
  marked_completed: number;
  manual_matches_applied: number;
  errors: string[];
}

/**
 * POST /api/crm/import-report/apply
 * Body is a JSON ApplyDiffPayload — the user-confirmed subset of the diff.
 * Runs each accepted change as a row-level write. RLS still applies via the user session.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = (await createClient()) as unknown as SupabaseClient;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", user.id)
    .maybeSingle();
  const organizationId = (membership as { organization_id: string } | null)?.organization_id;
  if (!organizationId) return NextResponse.json({ error: "No organization for user" }, { status: 403 });

  const payload = (await req.json()) as ApplyDiffPayload;
  const result: ApplyResult = {
    status_updates: 0,
    aliases_created: 0,
    productions_created: 0,
    companies_created: 0,
    studios_linked_or_created: 0,
    contacts_created: 0,
    marked_completed: 0,
    manual_matches_applied: 0,
    errors: [],
  };

  // ----- Helpers -----------------------------------------------------------
  const normalize = (s: string) => s.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();

  async function findOrCreateCompany(name: string, type: "production_company" | "studio"): Promise<string | null> {
    if (!name) return null;
    const { data: existing } = await supabase
      .from("crm_companies")
      .select("id, name, type")
      .ilike("name", name)
      .maybeSingle();
    if (existing) return (existing as { id: string }).id;
    const { data: created, error } = await supabase
      .from("crm_companies")
      .insert({ organization_id: organizationId, name, type })
      .select("id")
      .single();
    if (error) {
      result.errors.push(`createCompany(${name}): ${error.message}`);
      return null;
    }
    if (type === "studio") result.studios_linked_or_created++;
    else result.companies_created++;
    return (created as { id: string }).id;
  }

  async function findOrCreateContact(name: string | null, phone: string | null, role: string): Promise<string | null> {
    if (!name) return null;
    const cleaned = name.trim();
    if (!cleaned || cleaned.toUpperCase() === "N / A" || cleaned.toUpperCase() === "LOCAL HIRE" || cleaned.toUpperCase() === "TBD") {
      return null;
    }
    const { data: existing } = await supabase
      .from("crm_contacts")
      .select("id")
      .eq("organization_id", organizationId)
      .ilike("name", cleaned)
      .maybeSingle();
    if (existing) return (existing as { id: string }).id;
    const { data: created, error } = await supabase
      .from("crm_contacts")
      .insert({
        organization_id: organizationId,
        name: cleaned,
        role,
        phone: phone ?? null,
        status: "active",
      })
      .select("id")
      .single();
    if (error) {
      result.errors.push(`createContact(${cleaned}): ${error.message}`);
      return null;
    }
    result.contacts_created++;
    return (created as { id: string }).id;
  }

  // ----- 1) Status changes -------------------------------------------------
  for (const { production_id, new_status, from_status } of payload.accept_status_changes) {
    const { error } = await supabase
      .from("crm_productions")
      .update({ status: new_status, status_changed_at: new Date().toISOString() })
      .eq("id", production_id);
    if (error) {
      result.errors.push(`updateStatus(${production_id}): ${error.message}`);
      continue;
    }
    await supabase.from("crm_production_status_history").insert({
      organization_id: organizationId,
      production_id,
      old_status: from_status,
      new_status,
      notes: `Weekly report import (${payload.report_metadata.file_name})`,
    });
    result.status_updates++;
  }

  // ----- 2) Alias suggestions ---------------------------------------------
  for (const { pdf_row, matched_production_id } of payload.accept_alias_suggestions) {
    const aliasName = pdf_row.alias_name && pdf_row.alias_name.trim().length > 0
      ? pdf_row.alias_name
      : pdf_row.production_name;
    const { error } = await supabase.from("crm_production_aliases").insert({
      organization_id: organizationId,
      production_id: matched_production_id,
      alias_name: aliasName,
    });
    if (error) {
      result.errors.push(`createAlias(${aliasName}): ${error.message}`);
      continue;
    }
    result.aliases_created++;
  }

  // ----- 2b) Manual alias matches (user-resolved "this is actually X") ------
  // For each: alias the PDF name onto the existing production AND apply the
  // status change implied by the PDF row if it differs.
  for (const { pdf_row, matched_production_id } of payload.manual_alias_matches ?? []) {
    const aliasName = pdf_row.production_name;
    const { error: aliasErr } = await supabase.from("crm_production_aliases").insert({
      organization_id: organizationId,
      production_id: matched_production_id,
      alias_name: aliasName,
    });
    if (aliasErr) {
      result.errors.push(`manualMatchAlias(${aliasName}): ${aliasErr.message}`);
      continue;
    }
    result.aliases_created++;

    // Also apply the status from the PDF row if different
    const { data: prod } = await supabase
      .from("crm_productions")
      .select("status")
      .eq("id", matched_production_id)
      .maybeSingle();
    const currentStatus = (prod as { status: string } | null)?.status ?? null;
    const newStatus = PDF_STATUS_TO_CRM[pdf_row.status_label] ?? "shooting";
    if (currentStatus && currentStatus !== newStatus) {
      const { error: statusErr } = await supabase
        .from("crm_productions")
        .update({ status: newStatus, status_changed_at: new Date().toISOString() })
        .eq("id", matched_production_id);
      if (!statusErr) {
        await supabase.from("crm_production_status_history").insert({
          organization_id: organizationId,
          production_id: matched_production_id,
          old_status: currentStatus,
          new_status: newStatus,
          notes: `Manual match from weekly report (${payload.report_metadata.file_name})`,
        });
        result.status_updates++;
      }
    }
    result.manual_matches_applied++;
  }

  // ----- 3) New productions -----------------------------------------------
  for (const np of payload.accept_new_productions) {
    let companyId = np.company_id;
    if (!companyId && np.pdf_row.production_company) {
      companyId = await findOrCreateCompany(np.pdf_row.production_company, "production_company");
    }
    const newStatus = PDF_STATUS_TO_CRM[np.pdf_row.status_label] ?? "shooting";
    const stateNormalized = np.pdf_row.state === "CA" ? "California"
      : np.pdf_row.state === "NY" ? "New York"
      : np.pdf_row.state ?? null;

    // Determine production_type — use show_type verbatim if present
    const productionType = np.pdf_row.show_type ?? null;

    const { data: inserted, error } = await supabase
      .from("crm_productions")
      .insert({
        organization_id: organizationId,
        name: np.pdf_row.production_name,
        company_id: companyId,
        studio_id: np.studio_id,
        status: newStatus,
        start_date: np.start_date,
        end_date: np.end_date,
        state: stateNormalized,
        production_type: productionType,
        date_first_appearing_on_report: payload.report_metadata.parsed_at,
        status_changed_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error) {
      result.errors.push(`createProduction(${np.pdf_row.production_name}): ${error.message}`);
      continue;
    }
    const productionId = (inserted as { id: string }).id;
    result.productions_created++;

    // If alias was detected on the PDF row, store it
    if (np.pdf_row.alias_name && np.pdf_row.alias_name.trim().length > 0) {
      await supabase.from("crm_production_aliases").insert({
        organization_id: organizationId,
        production_id: productionId,
        alias_name: np.pdf_row.alias_name,
      });
      result.aliases_created++;
    }

    // First status history row
    await supabase.from("crm_production_status_history").insert({
      organization_id: organizationId,
      production_id: productionId,
      old_status: null,
      new_status: newStatus,
      notes: `Created from weekly report import (${payload.report_metadata.file_name})`,
    });

    // Coordinator + location manager contacts
    const coordId = await findOrCreateContact(np.pdf_row.coordinator_name, np.pdf_row.coordinator_phone, "Production Coordinator");
    if (coordId) {
      await supabase.from("crm_contact_productions").insert({
        organization_id: organizationId,
        contact_id: coordId,
        production_id: productionId,
      });
      await supabase.from("crm_productions")
        .update({ primary_transportation_contact_id: coordId })
        .eq("id", productionId);
    }
    const lmId = await findOrCreateContact(np.pdf_row.location_manager_name, null, "Location Manager");
    if (lmId) {
      await supabase.from("crm_contact_productions").insert({
        organization_id: organizationId,
        contact_id: lmId,
        production_id: productionId,
      });
      await supabase.from("crm_productions")
        .update({ primary_locations_contact_id: lmId })
        .eq("id", productionId);
    }
  }

  // ----- 4) Fell off: mark completed only if user explicitly chose --------
  for (const productionId of payload.mark_completed) {
    const { data: existing } = await supabase
      .from("crm_productions")
      .select("status")
      .eq("id", productionId)
      .maybeSingle();
    const fromStatus = (existing as { status: string } | null)?.status ?? null;
    const { error } = await supabase
      .from("crm_productions")
      .update({ status: "completed", status_changed_at: new Date().toISOString() })
      .eq("id", productionId);
    if (error) {
      result.errors.push(`markCompleted(${productionId}): ${error.message}`);
      continue;
    }
    await supabase.from("crm_production_status_history").insert({
      organization_id: organizationId,
      production_id: productionId,
      old_status: fromStatus,
      new_status: "completed",
      notes: `Marked completed (off weekly report — ${payload.report_metadata.file_name})`,
    });
    result.marked_completed++;
  }

  return NextResponse.json(result);
}
