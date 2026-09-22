/**
 * How a shared payroll row is split across entities (companies).
 *
 * manual   the row's own entity_allocations, seeded from the HR allocation and
 *          editable on the plan (75/25 or 50/50 splits, per the cheat sheet)
 * revenue  the plan's revenue shares: each entity's part of the organization's
 *          trailing twelve months of revenue
 *
 * A row with no effective allocation belongs to nobody: every group prices it
 * at zero and the plan counts it as unallocated.
 */

export interface EntityAllocation {
  entity_id: string;
  pct: number;
  /** Set on revenue shares: the share belongs to this reporting group, carried on its principal entity. */
  reporting_entity_id?: string;
}

export type AllocationMode = "manual" | "revenue";

export function readEntityAllocations(raw: unknown): EntityAllocation[] {
  if (!Array.isArray(raw)) return [];
  const out: EntityAllocation[] = [];
  for (const item of raw as Array<Record<string, unknown>>) {
    if (!item || typeof item !== "object") continue;
    const id = String(item.entity_id ?? "").trim();
    const pct = Number(item.pct ?? 0);
    if (!id || !(pct > 0)) continue;
    out.push({ entity_id: id, pct });
  }
  return out;
}

export function effectiveAllocations(
  row: { allocation_mode?: string | null; entity_allocations?: unknown },
  revenueShares: EntityAllocation[],
): EntityAllocation[] {
  if (row.allocation_mode === "revenue") return revenueShares;
  return readEntityAllocations(row.entity_allocations);
}

/** Share (0-1) of a row that belongs to a set of entities. Zero when unallocated. */
export function shareForEntities(allocs: EntityAllocation[], entityIds: Set<string>): number {
  const total = allocs.reduce((t, a) => t + a.pct, 0);
  if (total <= 0) return 0;
  const mine = allocs.filter((a) => entityIds.has(a.entity_id)).reduce((t, a) => t + a.pct, 0);
  return mine / total;
}
