import { createClient } from "@supabase/supabase-js";
import { headers } from "next/headers";
import type { Database } from "@/lib/types/database.types";
import { ACTOR_HEADERS } from "@/lib/audit/headers";

// Service-role client for server-only operations (bypasses RLS)
// NEVER expose this client to the browser
//
// Every request it sends carries the x-closebook-actor headers that the
// middleware stamped on the incoming request, so the audit_row_change
// trigger in Postgres can attribute service-role writes to the signed-in
// user. Outside a request (crons, webhooks) the headers are absent and the
// audit log records "System".
export function createAdminClient(actorId?: string | null) {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      global: {
        fetch: async (input, init) => {
          const forwarded = await actorHeaders(actorId);
          if (!forwarded) return fetch(input, init);
          const merged = new Headers(init?.headers);
          for (const [name, value] of forwarded) merged.set(name, value);
          return fetch(input, { ...init, headers: merged });
        },
      },
    }
  );
}

async function actorHeaders(
  actorId?: string | null
): Promise<Array<[string, string]> | null> {
  const out: Array<[string, string]> = [];
  let incoming: Headers | null = null;
  try {
    incoming = await headers();
  } catch {
    incoming = null; // not inside a request
  }
  for (const name of ACTOR_HEADERS) {
    const value = incoming?.get(name);
    if (value) out.push([name, value]);
  }
  if (actorId) {
    const idx = out.findIndex(([name]) => name === ACTOR_HEADERS[0]);
    if (idx >= 0) out[idx] = [ACTOR_HEADERS[0], actorId];
    else out.push([ACTOR_HEADERS[0], actorId]);
  }
  return out.length ? out : null;
}
