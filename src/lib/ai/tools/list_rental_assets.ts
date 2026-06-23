import type { AiTool } from "./types";

interface FixedAsset {
  id: string;
  entity_id: string;
  asset_name: string;
  asset_tag: string | null;
  vehicle_year: number | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_class: string | null;
  vin: string | null;
  acquisition_date: string;
  acquisition_cost: number;
  in_service_date: string;
  book_accumulated_depreciation: number;
  book_net_value: number;
  status: string;
}

export const listRentalAssets: AiTool = {
  name: "list_rental_assets",
  description:
    "List rental / fixed assets with optional filters. If entity_id is omitted, searches across every entity the user can access (use this when the user gives an asset tag or name without naming a company). Returns book net value (acquisition cost minus accumulated depreciation) per asset. vehicle_class is a fleet code like '13', '15L', '8MU' — these are class codes, not free-text types.",
  inputSchema: {
    type: "object",
    properties: {
      entity_id: {
        type: "string",
        description: "Optional UUID. Omit to search across all accessible entities.",
      },
      status: {
        type: "string",
        enum: ["active", "disposed", "fully_depreciated", "inactive"],
        description: "Defaults to active.",
      },
      vehicle_class: {
        type: "string",
        description: "Exact fleet class code, e.g. '13', '15L', '8MU'.",
      },
      asset_tag: {
        type: "string",
        description:
          "Exact asset tag / number, e.g. '986150'. Use this when the user references an asset by its number.",
      },
      name_contains: {
        type: "string",
        description:
          "Case-insensitive substring matched against asset_name AND asset_tag.",
      },
      limit: { type: "integer", description: "Max rows. Default 50, max 200." },
    },
  },
  async run(
    input: {
      entity_id?: string;
      status?: string;
      vehicle_class?: string;
      asset_tag?: string;
      name_contains?: string;
      limit?: number;
    },
    ctx,
  ) {
    const limit = Math.min(input.limit ?? 50, 200);
    const entityId = input.entity_id ?? ctx.currentEntityId;

    let q = ctx.supabase
      .from("fixed_assets")
      .select(
        "id, entity_id, asset_name, asset_tag, vehicle_year, vehicle_make, vehicle_model, vehicle_class, vin, acquisition_date, acquisition_cost, in_service_date, book_accumulated_depreciation, book_net_value, status",
      )
      .eq("status", input.status ?? "active")
      .order("acquisition_date", { ascending: false })
      .limit(limit);

    if (entityId) q = q.eq("entity_id", entityId);
    if (input.vehicle_class) q = q.eq("vehicle_class", input.vehicle_class);
    if (input.asset_tag) q = q.eq("asset_tag", input.asset_tag);
    if (input.name_contains) {
      const safe = input.name_contains.replace(/[%_]/g, "");
      q = q.or(`asset_name.ilike.%${safe}%,asset_tag.ilike.%${safe}%`);
    }

    const { data, error } = await q;
    if (error) return { error: error.message };
    const assetsTyped = (data ?? []) as unknown as FixedAsset[];

    const totalCost = assetsTyped.reduce((s, a) => s + Number(a.acquisition_cost), 0);
    const totalNetValue = assetsTyped.reduce((s, a) => s + Number(a.book_net_value), 0);
    const totalAccumDep = assetsTyped.reduce(
      (s, a) => s + Number(a.book_accumulated_depreciation),
      0,
    );

    return {
      entity_id: entityId ?? null,
      asset_count: assetsTyped.length,
      total_acquisition_cost: totalCost,
      total_book_net_value: totalNetValue,
      total_accumulated_depreciation: totalAccumDep,
      assets: assetsTyped,
      truncated: assetsTyped.length === limit,
    };
  },
};
