/**
 * Module registry for member access scopes.
 *
 * A member row carries `modules text[]` (NULL = everything). Each sidebar item
 * is tagged with one of these keys, and the middleware maps every app URL back
 * to a key so a member who lacks it is redirected.
 *
 * Keep this file free of server-only imports: it is used by the middleware
 * (edge), server layouts, and client components alike.
 */

export type ModuleScope = "org" | "entity";

export interface ModuleDef {
  key: string;
  label: string;
  scope: ModuleScope;
  /** Org-level URL prefixes (scope "org") that belong to this module. */
  orgPaths?: string[];
  /** Sub-paths under /[entityId] that belong to this module. */
  entityPaths?: string[];
  /** Shown under the label in the picker. */
  hint?: string;
}

export const MODULES: ModuleDef[] = [
  // ---- Organization (consolidated) ----
  { key: "org_dashboard", label: "Dashboard", scope: "org", orgPaths: ["/dashboard"], hint: "Org landing page and close status" },
  { key: "close_dashboard", label: "Close Dashboard", scope: "org", orgPaths: ["/close-dashboard"] },
  { key: "financial_model", label: "Financial Model", scope: "org", orgPaths: ["/reports/financial-model", "/reports"] },
  { key: "monthly_summary", label: "Monthly Summary", scope: "org", orgPaths: ["/monthly-summary"] },
  { key: "debt_dashboard", label: "Debt Dashboard", scope: "org", orgPaths: ["/debt"], hint: "Consolidated debt across entities" },
  { key: "rental_assets_dashboard", label: "Rental Assets Dashboard", scope: "org", orgPaths: ["/rental-assets"], hint: "Consolidated fleet KPIs" },
  { key: "tb_variance", label: "TB Variance", scope: "org", orgPaths: ["/tb-variance"] },
  { key: "ic_eliminations", label: "IC Eliminations", scope: "org", orgPaths: ["/ic-eliminations"] },
  { key: "payroll", label: "Payroll & Employees", scope: "org", orgPaths: ["/payroll"], entityPaths: ["/employees"], hint: "Org payroll plus entity rosters and accruals" },
  { key: "real_estate", label: "Real Estate", scope: "org", orgPaths: ["/real-estate"], entityPaths: ["/real-estate"] },
  { key: "qbo_sync", label: "QBO Sync", scope: "org", orgPaths: ["/sync"] },
  { key: "diligence", label: "Diligence", scope: "org", orgPaths: ["/diligence"] },
  { key: "crm", label: "CRM", scope: "org", orgPaths: ["/crm"] },
  { key: "administration", label: "Administration", scope: "org", orgPaths: ["/settings"], hint: "Master GL, reporting entities, close templates, members, audit log, wiki" },

  // ---- Entity ----
  { key: "entity_dashboard", label: "Entity Dashboard", scope: "entity", entityPaths: ["/dashboard", "/"] },
  { key: "close", label: "Close Management", scope: "entity", entityPaths: ["/close"] },
  { key: "reports", label: "Reports, KPIs & Budget", scope: "entity", entityPaths: ["/reports"] },
  { key: "accounts", label: "Chart of Accounts", scope: "entity", entityPaths: ["/accounts"] },
  { key: "trial_balance", label: "Trial Balance", scope: "entity", entityPaths: ["/trial-balance"] },
  { key: "schedules", label: "Schedules", scope: "entity", entityPaths: ["/schedules"] },
  { key: "inquiries", label: "Inquiries & Cold Outreach", scope: "entity", entityPaths: ["/inquiries", "/cold-outreach"] },
  { key: "assets", label: "Rental Assets (fixed asset schedule)", scope: "entity", entityPaths: ["/assets"] },
  { key: "debt", label: "Debt Schedule", scope: "entity", entityPaths: ["/debt"] },
  { key: "insurance", label: "Insurance", scope: "entity", entityPaths: ["/insurance"] },
  { key: "revenue_accruals", label: "Revenue Accruals", scope: "entity", entityPaths: ["/revenue"] },
  { key: "commissions", label: "Commissions", scope: "entity", entityPaths: ["/commissions"] },
  { key: "rebates", label: "Rebate Tracker", scope: "entity", entityPaths: ["/rebates"] },
  { key: "revenue_projection", label: "Revenue Projection", scope: "entity", entityPaths: ["/revenue-projection"] },
  { key: "entity_settings", label: "Entity Settings", scope: "entity", entityPaths: ["/settings"] },
];

export type ModuleKey = (typeof MODULES)[number]["key"];

const MODULE_KEYS = new Set(MODULES.map((m) => m.key));

export function isModuleKey(value: unknown): value is ModuleKey {
  return typeof value === "string" && MODULE_KEYS.has(value);
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function startsWithPath(pathname: string, prefix: string): boolean {
  if (prefix === "/") return pathname === "/" || pathname === "";
  return pathname === prefix || pathname.startsWith(prefix + "/");
}

/**
 * Map an app pathname to the module that owns it. Returns null for paths that
 * are not part of any module (auth, api, unknown), which are always allowed.
 */
export function moduleForPath(pathname: string): ModuleKey | null {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length >= 1 && UUID_PATTERN.test(segments[0])) {
    const sub = "/" + segments.slice(1).join("/");
    // Longest prefix wins so "/reports/budget" resolves to reports, not dashboard.
    let best: { key: ModuleKey; len: number } | null = null;
    for (const m of MODULES) {
      for (const p of m.entityPaths ?? []) {
        if (startsWithPath(sub, p) && (!best || p.length > best.len)) {
          best = { key: m.key, len: p.length };
        }
      }
    }
    return best?.key ?? null;
  }

  let best: { key: ModuleKey; len: number } | null = null;
  for (const m of MODULES) {
    for (const p of m.orgPaths ?? []) {
      if (startsWithPath(pathname, p) && (!best || p.length > best.len)) {
        best = { key: m.key, len: p.length };
      }
    }
  }
  return best?.key ?? null;
}

export interface MemberAccess {
  role: string;
  /** null = every module */
  modules: ModuleKey[] | null;
  /** null = every entity */
  entityIds: string[] | null;
}

export function canOpenModule(access: MemberAccess | null | undefined, key: ModuleKey | null | undefined): boolean {
  if (!key) return true;
  if (!access || access.modules === null) return true;
  return access.modules.includes(key);
}

export function isRestricted(access: MemberAccess | null | undefined): boolean {
  return !!access && (access.modules !== null || access.entityIds !== null);
}

/** First href the member is allowed to land on. */
export function defaultHrefFor(access: MemberAccess | null | undefined, entityIds: string[]): string {
  if (!access || access.modules === null) return "/dashboard";
  const orgModule = MODULES.find(
    (m) => m.scope === "org" && m.orgPaths?.length && access.modules!.includes(m.key)
  );
  if (orgModule) return orgModule.orgPaths![0];
  const entityId = entityIds[0];
  if (entityId) {
    const entityModule = MODULES.find(
      (m) => m.entityPaths?.length && access.modules!.includes(m.key)
    );
    if (entityModule) {
      const p = entityModule.entityPaths![0];
      return `/${entityId}${p === "/" ? "/dashboard" : p}`;
    }
  }
  return "/dashboard";
}
