/**
 * Server-side access checks for budget routes.
 *
 * Budget routes write through the service-role client, which bypasses RLS,
 * so every route must confirm the signed-in user belongs to the organization
 * that owns the version (or entity / reporting entity) it touches.
 */
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const EDITOR_ROLES = new Set(["admin", "controller", "preparer"]);
/** Roles that may reseed a payroll plan, recompute its revenue shares, remove rows or change its status. */
export const MANAGER_ROLES = new Set(["admin", "controller"]);

export interface BudgetActor {
  userId: string;
  /** organization_id -> role */
  orgRoles: Map<string, string>;
}

export class BudgetAccessError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** Signed-in user plus every org membership. Throws 401 when signed out. */
export async function getBudgetActor(): Promise<BudgetActor> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new BudgetAccessError("Unauthorized", 401);

  const admin = createAdminClient();
  const { data: memberships } = await admin
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", user.id);

  const orgRoles = new Map<string, string>();
  for (const m of memberships ?? []) orgRoles.set(m.organization_id, m.role);
  if (orgRoles.size === 0) throw new BudgetAccessError("No organization membership", 403);
  return { userId: user.id, orgRoles };
}

export function assertOrgMember(actor: BudgetActor, organizationId: string | null | undefined) {
  if (!organizationId || !actor.orgRoles.has(organizationId)) {
    throw new BudgetAccessError("Access denied", 403);
  }
}

export function assertOrgEditor(actor: BudgetActor, organizationId: string | null | undefined) {
  assertOrgMember(actor, organizationId);
  const role = actor.orgRoles.get(organizationId!) ?? "";
  if (!EDITOR_ROLES.has(role)) {
    throw new BudgetAccessError("Editor role required", 403);
  }
}

/**
 * Preparers restricted to the Payroll Plan module are the managers who submit
 * pay changes: they adjust, tag, allocate and add positions, and nothing more.
 */
export function assertOrgManager(actor: BudgetActor, organizationId: string | null | undefined) {
  assertOrgMember(actor, organizationId);
  const role = actor.orgRoles.get(organizationId!) ?? "";
  if (!MANAGER_ROLES.has(role)) {
    throw new BudgetAccessError("Admin or controller role required", 403);
  }
}

export function canManageOrg(actor: BudgetActor, organizationId: string | null | undefined): boolean {
  return !!organizationId && MANAGER_ROLES.has(actor.orgRoles.get(organizationId) ?? "");
}

/** Organization that owns an entity. */
export async function organizationForEntity(
  admin: ReturnType<typeof createAdminClient>,
  entityId: string,
): Promise<string | null> {
  const { data } = await admin
    .from("entities")
    .select("organization_id")
    .eq("id", entityId)
    .maybeSingle();
  return data?.organization_id ?? null;
}

/** Organization that owns a reporting entity. */
export async function organizationForReportingEntity(
  admin: ReturnType<typeof createAdminClient>,
  reportingEntityId: string,
): Promise<string | null> {
  const { data } = await admin
    .from("reporting_entities")
    .select("organization_id")
    .eq("id", reportingEntityId)
    .maybeSingle();
  return data?.organization_id ?? null;
}

export interface VersionOwner {
  id: string;
  organizationId: string | null;
  entityId: string | null;
  reportingEntityId: string | null;
  fiscalYear: number;
  kind: string;
  lockedAt: string | null;
  chartId: string | null;
}

/** Version row with its owning organization resolved. Null when missing. */
export async function loadVersionOwner(
  admin: ReturnType<typeof createAdminClient>,
  versionId: string,
): Promise<VersionOwner | null> {
  const { data: v } = await admin
    .from("budget_versions")
    .select("id, organization_id, entity_id, reporting_entity_id, fiscal_year, kind, locked_at, chart_id")
    .eq("id", versionId)
    .maybeSingle();
  if (!v) return null;
  let organizationId = v.organization_id ?? null;
  if (!organizationId && v.entity_id) organizationId = await organizationForEntity(admin, v.entity_id);
  if (!organizationId && v.reporting_entity_id) {
    organizationId = await organizationForReportingEntity(admin, v.reporting_entity_id);
  }
  return {
    id: v.id,
    organizationId,
    entityId: v.entity_id ?? null,
    reportingEntityId: v.reporting_entity_id ?? null,
    fiscalYear: v.fiscal_year,
    kind: v.kind ?? "budget",
    lockedAt: v.locked_at ?? null,
    chartId: v.chart_id ?? null,
  };
}

/**
 * Loads a version, confirms membership (and editor role when `write`), and
 * refuses writes to a locked version. Throws BudgetAccessError.
 */
export async function requireVersionAccess(
  admin: ReturnType<typeof createAdminClient>,
  actor: BudgetActor,
  versionId: string,
  write: boolean,
): Promise<VersionOwner> {
  const owner = await loadVersionOwner(admin, versionId);
  if (!owner) throw new BudgetAccessError("Budget version not found", 404);
  if (write) assertOrgEditor(actor, owner.organizationId);
  else assertOrgMember(actor, owner.organizationId);
  if (write && owner.lockedAt) {
    throw new BudgetAccessError("This version is approved and locked. Create a new version to change it.", 409);
  }
  return owner;
}

export interface PlanOwner {
  id: string;
  organizationId: string;
  fiscalYear: number;
  status: string;
  revenueShares: Array<{ entity_id: string; pct: number }>;
  revenueSharesAsOf: string | null;
}

function toPlanOwner(p: {
  id: string;
  organization_id: string;
  fiscal_year: number;
  status: string;
  revenue_shares: unknown;
  revenue_shares_as_of: string | null;
}): PlanOwner {
  return {
    id: p.id,
    organizationId: p.organization_id,
    fiscalYear: p.fiscal_year,
    status: p.status,
    revenueShares: Array.isArray(p.revenue_shares) ? (p.revenue_shares as Array<{ entity_id: string; pct: number }>) : [],
    revenueSharesAsOf: p.revenue_shares_as_of ?? null,
  };
}

/** The shared payroll plan for an organization and year, or null. */
export async function loadPlanForYear(
  admin: ReturnType<typeof createAdminClient>,
  organizationId: string,
  fiscalYear: number,
): Promise<PlanOwner | null> {
  const { data } = await admin
    .from("budget_payroll_plans")
    .select("id, organization_id, fiscal_year, status, revenue_shares, revenue_shares_as_of")
    .eq("organization_id", organizationId)
    .eq("fiscal_year", fiscalYear)
    .maybeSingle();
  return data ? toPlanOwner(data) : null;
}

/** The plan a version prices its personnel from (same organization and year). */
export async function loadPlanForVersion(
  admin: ReturnType<typeof createAdminClient>,
  owner: VersionOwner,
): Promise<PlanOwner | null> {
  if (!owner.organizationId) return null;
  return loadPlanForYear(admin, owner.organizationId, owner.fiscalYear);
}

/** Loads a plan and confirms membership (editor role when `write`). */
export async function requirePlanAccess(
  admin: ReturnType<typeof createAdminClient>,
  actor: BudgetActor,
  planId: string,
  write: boolean,
): Promise<PlanOwner> {
  const { data } = await admin
    .from("budget_payroll_plans")
    .select("id, organization_id, fiscal_year, status, revenue_shares, revenue_shares_as_of")
    .eq("id", planId)
    .maybeSingle();
  if (!data) throw new BudgetAccessError("Payroll plan not found", 404);
  if (write) assertOrgEditor(actor, data.organization_id);
  else assertOrgMember(actor, data.organization_id);
  return toPlanOwner(data);
}

/** Finds the plan for the year, creating it when an editor asks and none exists. */
export async function getOrCreatePlan(
  admin: ReturnType<typeof createAdminClient>,
  actor: BudgetActor,
  organizationId: string,
  fiscalYear: number,
): Promise<PlanOwner> {
  assertOrgMember(actor, organizationId);
  const existing = await loadPlanForYear(admin, organizationId, fiscalYear);
  if (existing) return existing;
  assertOrgEditor(actor, organizationId);
  const { data, error } = await admin
    .from("budget_payroll_plans")
    .insert({ organization_id: organizationId, fiscal_year: fiscalYear })
    .select("id, organization_id, fiscal_year, status, revenue_shares, revenue_shares_as_of")
    .single();
  if (error || !data) throw new BudgetAccessError(error?.message ?? "Could not create the payroll plan", 500);
  return toPlanOwner(data);
}

/** Turns a BudgetAccessError (or anything else) into `{ error }` + status. */
export function accessErrorResponse(err: unknown): { body: { error: string }; status: number } {
  if (err instanceof BudgetAccessError) return { body: { error: err.message }, status: err.status };
  return {
    body: { error: err instanceof Error ? err.message : "Internal server error" },
    status: 500,
  };
}
