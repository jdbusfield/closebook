// Request headers that carry "who is doing this" from the Next.js request
// down to Postgres, where the audit_row_change trigger reads them via
// current_setting('request.headers'). Set by middleware, forwarded by the
// service-role client (src/lib/supabase/admin.ts).
//
// Keep this file free of Next.js imports: middleware runs on the edge.

export const ACTOR_HEADER = "x-closebook-actor";
export const ACTOR_IP_HEADER = "x-closebook-actor-ip";
export const ACTOR_UA_HEADER = "x-closebook-actor-ua";

export const ACTOR_HEADERS = [ACTOR_HEADER, ACTOR_IP_HEADER, ACTOR_UA_HEADER] as const;
