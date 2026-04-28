import { SupabaseClient } from "@supabase/supabase-js";

export type ChartKind = "management" | "accountant";

export interface MasterChartRow {
  id: string;
  organization_id: string;
  name: string;
  kind: ChartKind;
  is_default: boolean;
}

/**
 * Resolve a master_charts row for an organization.
 *
 * - If kind is provided, returns that chart.
 * - Otherwise returns the default chart (always Management for now).
 *
 * Throws if the chart is missing — every org should have at least the
 * Management chart seeded by migration 20260428_master_charts.sql.
 */
export async function resolveChart(
  supabase: SupabaseClient,
  organizationId: string,
  kind: ChartKind = "management",
): Promise<MasterChartRow> {
  const { data, error } = await supabase
    .from("master_charts")
    .select("id, organization_id, name, kind, is_default")
    .eq("organization_id", organizationId)
    .eq("kind", kind)
    .single();

  if (error || !data) {
    throw new Error(
      `Could not resolve ${kind} chart for organization ${organizationId}: ${error?.message ?? "not found"}`,
    );
  }

  return data as MasterChartRow;
}

/**
 * Resolve a chart by id when supplied, otherwise default to the management
 * chart. Validates that the chart belongs to the given org.
 */
export async function resolveChartIdOrDefault(
  supabase: SupabaseClient,
  organizationId: string,
  chartId: string | null | undefined,
): Promise<string> {
  if (!chartId) {
    const chart = await resolveChart(supabase, organizationId, "management");
    return chart.id;
  }
  const { data, error } = await supabase
    .from("master_charts")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("id", chartId)
    .single();

  if (error || !data) {
    throw new Error(
      `Chart ${chartId} not found in organization ${organizationId}`,
    );
  }
  return data.id;
}
