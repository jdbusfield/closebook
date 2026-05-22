import type { SupabaseClient } from "@supabase/supabase-js";
import {
  PDF_STATUS_TO_CRM,
  type ParsedReportRow,
  type ImportDiff,
  type StatusChangeItem,
  type AliasSuggestionItem,
  type NewProductionItem,
  type FellOffItem,
  type UnchangedItem,
} from "./import-types";

/** Normalize a production name for fuzzy comparison. */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\b(season|s)\s*(\d+)/gi, "s$2")  // "Season 4" / "S 4" → "s4"
    .replace(/\s+/g, " ")
    .trim();
}

interface ExistingProduction {
  id: string;
  name: string;
  status: string;
  company_id: string | null;
  studio_id: string | null;
}

interface ExistingAlias {
  production_id: string;
  alias_name: string;
}

interface ExistingCompany {
  id: string;
  name: string;
  type: string;
}

/**
 * Diff PDF rows against existing CRM data.
 * Returns the four buckets (status_changes, alias_suggestions, new_productions, fell_off)
 * plus an unchanged list.
 */
export async function diffPdfRows(
  supabase: SupabaseClient,
  organizationId: string,
  rows: ParsedReportRow[],
  reportMetadata: ImportDiff["report_metadata"],
): Promise<ImportDiff> {
  // Pull existing productions, aliases, companies
  const [{ data: productionsData }, { data: aliasesData }, { data: companiesData }] = await Promise.all([
    supabase.from("crm_productions")
      .select("id, name, status, company_id, studio_id")
      .eq("organization_id", organizationId),
    supabase.from("crm_production_aliases")
      .select("production_id, alias_name")
      .eq("organization_id", organizationId),
    supabase.from("crm_companies")
      .select("id, name, type")
      .eq("organization_id", organizationId),
  ]);

  const productions = (productionsData ?? []) as ExistingProduction[];
  const aliases = (aliasesData ?? []) as ExistingAlias[];
  const companies = (companiesData ?? []) as ExistingCompany[];

  // Build lookup indexes
  const prodByNormalizedName = new Map<string, ExistingProduction>();
  for (const p of productions) {
    prodByNormalizedName.set(normalizeName(p.name), p);
  }
  for (const a of aliases) {
    const prod = productions.find(p => p.id === a.production_id);
    if (prod) prodByNormalizedName.set(normalizeName(a.alias_name), prod);
  }

  const companyByNormalizedName = new Map<string, ExistingCompany>();
  for (const c of companies) {
    companyByNormalizedName.set(normalizeName(c.name), c);
  }

  const status_changes: StatusChangeItem[] = [];
  const alias_suggestions: AliasSuggestionItem[] = [];
  const new_productions: NewProductionItem[] = [];
  const unchanged: UnchangedItem[] = [];
  const seenProductionIds = new Set<string>();

  for (const row of rows) {
    const newStatus = PDF_STATUS_TO_CRM[row.status_label] ?? "shooting";
    const normName = normalizeName(row.production_name);
    const normAlias = row.alias_name ? normalizeName(row.alias_name) : null;

    // Try primary name first
    let matched: ExistingProduction | undefined = prodByNormalizedName.get(normName);
    // If not found and there's an alias, try alias
    let matchedViaAlias = false;
    if (!matched && normAlias) {
      const aliasMatch = prodByNormalizedName.get(normAlias);
      if (aliasMatch) {
        matched = aliasMatch;
        matchedViaAlias = true;
      }
    }

    if (matched) {
      seenProductionIds.add(matched.id);
      if (matched.status !== newStatus) {
        status_changes.push({
          production_id: matched.id,
          production_name: matched.name,
          current_status: matched.status,
          new_status: newStatus,
          pdf_row: row,
          notes: matchedViaAlias ? `Matched via alias "${row.alias_name}"` : undefined,
        });
      } else {
        unchanged.push({
          production_id: matched.id,
          production_name: matched.name,
          status: matched.status,
        });
      }
      continue;
    }

    // No primary name match. If there's an alias that matches, this is an alias suggestion
    // (the PDF is using a different name for an existing production).
    if (normAlias) {
      const aliasMatch = prodByNormalizedName.get(normAlias);
      if (aliasMatch) {
        alias_suggestions.push({
          pdf_row: row,
          matched_production_id: aliasMatch.id,
          matched_production_name: aliasMatch.name,
          reason: `PDF row "${row.production_name}" doesn't match an existing production by name, but its alias "${row.alias_name}" does.`,
        });
        seenProductionIds.add(aliasMatch.id);
        continue;
      }
    }

    // Brand new production
    let suggestedCompany: ExistingCompany | null = null;
    if (row.production_company) {
      suggestedCompany = companyByNormalizedName.get(normalizeName(row.production_company)) ?? null;
    }
    new_productions.push({
      pdf_row: row,
      suggested_company_id: suggestedCompany?.id ?? null,
      suggested_company_name: suggestedCompany?.name ?? null,
    });
  }

  // Productions in CRM that are currently active but did NOT appear on this report
  const ACTIVE_STATUSES = ["pre-prepping", "prepping", "shooting", "reshoots", "wrapping"];
  const fell_off: FellOffItem[] = productions
    .filter(p => ACTIVE_STATUSES.includes(p.status) && !seenProductionIds.has(p.id))
    .map(p => ({
      production_id: p.id,
      production_name: p.name,
      current_status: p.status,
      weeks_active: null,
    }));

  // Active candidates for the manual-match combobox (everything in an active status)
  const aliasesByProductionId = new Map<string, string[]>();
  for (const a of aliases) {
    const arr = aliasesByProductionId.get(a.production_id) ?? [];
    arr.push(a.alias_name);
    aliasesByProductionId.set(a.production_id, arr);
  }
  const companyById = new Map<string, ExistingCompany>(companies.map(c => [c.id, c]));
  const active_candidates = productions
    .filter(p => ACTIVE_STATUSES.includes(p.status))
    .map(p => ({
      id: p.id,
      name: p.name,
      status: p.status,
      company_name: p.company_id ? (companyById.get(p.company_id)?.name ?? null) : null,
      aliases: aliasesByProductionId.get(p.id) ?? [],
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    report_metadata: reportMetadata,
    status_changes,
    alias_suggestions,
    new_productions,
    fell_off,
    unchanged,
    active_candidates,
  };
}
