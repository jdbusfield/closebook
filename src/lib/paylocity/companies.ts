/**
 * The two Paylocity companies and the entity that books each one's payroll
 * in the general ledger. Silverco runs payroll for every Avon and Versatile
 * person; Hollywood Depot Rentals runs its own. The plan allocates those
 * people to other entities, so anything comparing the plan to booked cost
 * has to move the ledger figure the same way.
 */

/** Employing entity id -> Paylocity company id */
export const PAYLOCITY_COMPANY_BY_ENTITY: Record<string, string> = {
  "b664a9c1-3817-4df4-9261-f51b3403a5de": "132427", // Silverco Enterprises (Avon)
  "7529580d-3b44-4a9b-91f4-bc2db25f5211": "316791", // Hollywood Depot Rentals
};

/** Paylocity company id -> the entity whose ledger carries that payroll */
export const ENTITY_BY_PAYLOCITY_COMPANY: Record<string, string> = Object.fromEntries(
  Object.entries(PAYLOCITY_COMPANY_BY_ENTITY).map(([entityId, companyId]) => [companyId, entityId]),
);

export function employerEntityId(paylocityCompanyId: string | null | undefined): string | null {
  if (!paylocityCompanyId) return null;
  return ENTITY_BY_PAYLOCITY_COMPANY[paylocityCompanyId] ?? null;
}
