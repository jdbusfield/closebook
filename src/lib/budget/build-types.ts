/** Shared shapes for build producers. */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { VersionOwner } from "./access";
import type { AssumptionSet } from "./assumption-keys";
import type { MasterInfo } from "./actuals";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Admin = SupabaseClient<any, any, any>;

export type BuildType = "headcount" | "schedule" | "driver" | "trend" | "manual" | "capex";

export interface BuildInsert {
  budget_version_id: string;
  reporting_entity_id: string | null;
  entity_id: string | null;
  master_account_id: string;
  qbo_class_id: string | null;
  build_type: BuildType;
  source_table: string | null;
  source_id: string | null;
  component: string | null;
  label: string;
  amounts: Record<string, number>;
  assumption_keys: string[];
  is_computed: boolean;
  meta: Record<string, unknown> | null;
  computed_at: string;
}

export interface BuildContext {
  admin: Admin;
  owner: VersionOwner;
  year: number;
  chartId: string;
  memberEntityIds: string[];
  assumptions: AssumptionSet;
  masters: MasterInfo[];
  /** entity account id -> master id (this chart) */
  accountToMaster: Map<string, string>;
  /** account_number -> master */
  masterByNumber: Map<string, MasterInfo>;
  now: string;
}

export function amountsFromArray(values: number[]): Record<string, number> {
  const o: Record<string, number> = {};
  for (let i = 0; i < 12; i++) o[String(i + 1)] = Math.round((values[i] ?? 0) * 100) / 100;
  return o;
}

export function zeros(): number[] {
  return new Array(12).fill(0);
}

export function isAllZero(values: number[]): boolean {
  return values.every((v) => Math.abs(v) < 0.005);
}

export function baseBuild(ctx: BuildContext, partial: Omit<BuildInsert, "budget_version_id" | "reporting_entity_id" | "entity_id" | "computed_at" | "is_computed">): BuildInsert {
  return {
    budget_version_id: ctx.owner.id,
    reporting_entity_id: ctx.owner.reportingEntityId,
    entity_id: ctx.owner.entityId,
    is_computed: true,
    computed_at: ctx.now,
    ...partial,
  };
}
