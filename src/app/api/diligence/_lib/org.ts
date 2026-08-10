// Same caller-org resolution the CRM module uses; re-exported so diligence
// routes don't reach into the CRM route tree directly.
export { getCallerOrg } from "../../crm/_lib/org";
