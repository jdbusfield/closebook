import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllMappings } from "@/lib/utils/paginated-fetch";
import { resolveChartIdOrDefault } from "@/lib/master-charts/resolve";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RawGLBalance {
  account_id: string;
  entity_id: string;
  ending_balance: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseGLBalance(row: any): RawGLBalance {
  return {
    account_id: row.account_id,
    entity_id: row.entity_id,
    ending_balance: Number(row.ending_balance),
  };
}

interface EntityAccountDetail {
  id: string;
  name: string;
  account_number: string | null;
}

// ---------------------------------------------------------------------------
// Paginated GL balance fetcher
// ---------------------------------------------------------------------------

const GL_PAGE_SIZE = 1000;

async function fetchGLBalancesForAccounts(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  accountIds: string[],
  entityIds: string[],
  year: number,
  month: number
): Promise<RawGLBalance[]> {
  if (accountIds.length === 0 || entityIds.length === 0) return [];

  const allRows: RawGLBalance[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await admin
      .from("gl_balances")
      .select("account_id, entity_id, ending_balance")
      .in("account_id", accountIds)
      .in("entity_id", entityIds)
      .eq("period_year", year)
      .eq("period_month", month)
      .range(offset, offset + GL_PAGE_SIZE - 1);

    if (error) {
      console.error("GL balance pagination error:", error);
      break;
    }

    const rows = (data ?? []).map(parseGLBalance);
    allRows.push(...rows);

    if (rows.length < GL_PAGE_SIZE) {
      hasMore = false;
    } else {
      offset += GL_PAGE_SIZE;
    }
  }

  return allRows;
}

// ---------------------------------------------------------------------------
// Counterparty extraction from account name
// ---------------------------------------------------------------------------

function extractCounterparty(name: string): string | null {
  const lower = name.toLowerCase();
  if (lower.startsWith("due from ")) return name.slice(9).trim();
  if (lower.startsWith("due to ")) return name.slice(7).trim();
  return null;
}

/** Determine if the account is a "Due From" (receivable) or "Due To" (payable) */
function classifyDirection(name: string): "due_from" | "due_to" | null {
  const lower = name.toLowerCase();
  if (lower.startsWith("due from")) return "due_from";
  if (lower.startsWith("due to")) return "due_to";
  return null;
}

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const organizationId = searchParams.get("organizationId");
  const endYear = parseInt(searchParams.get("endYear") ?? "0");
  const endMonth = parseInt(searchParams.get("endMonth") ?? "0");
  const chartIdParam = searchParams.get("chartId");

  if (!organizationId) {
    return NextResponse.json(
      { error: "organizationId is required" },
      { status: 400 }
    );
  }

  if (!endYear || !endMonth) {
    return NextResponse.json(
      { error: "endYear and endMonth are required" },
      { status: 400 }
    );
  }

  // Auth
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", user.id)
    .eq("organization_id", organizationId)
    .single();

  if (!membership) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const admin = createAdminClient();

  // Get org info
  const { data: org } = await admin
    .from("organizations")
    .select("name")
    .eq("id", organizationId)
    .single();

  // Get all entities
  const { data: orgEntities } = await admin
    .from("entities")
    .select("id, name, code")
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .order("name");

  const entities = orgEntities ?? [];
  const entityMap = new Map(entities.map((e) => [e.id, e]));

  const emptyResponse = {
    entityDetails: [],
    eliminationPairs: [],
    metadata: {
      organizationName: org?.name,
      generatedAt: new Date().toISOString(),
      periodLabel: "",
    },
  };

  if (entities.length === 0) {
    return NextResponse.json(emptyResponse);
  }

  let chartId: string;
  try {
    chartId = await resolveChartIdOrDefault(admin, organizationId, chartIdParam);
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 400 },
    );
  }

  // Fetch intercompany master accounts by name pattern, scoped to active chart
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: icMasterAccounts } = await (admin as any)
    .from("master_accounts")
    .select("id, account_number, name, classification")
    .eq("organization_id", organizationId)
    .eq("chart_id", chartId)
    .eq("is_active", true)
    .or("name.ilike.Due from%,name.ilike.Due to%")
    .order("account_number");

  if (!icMasterAccounts || icMasterAccounts.length === 0) {
    return NextResponse.json(emptyResponse);
  }

  const icMasterIds = icMasterAccounts.map((a: { id: string }) => a.id);

  // Get all mappings for IC master accounts
  const mappings = await fetchAllMappings(admin, icMasterIds);

  // Collect all mapped entity account IDs
  const allMappedAccountIds = new Set<string>();
  for (const m of mappings ?? []) {
    allMappedAccountIds.add(m.account_id);
  }

  if (allMappedAccountIds.size === 0) {
    return NextResponse.json(emptyResponse);
  }

  // Fetch entity-level account details (name, account_number) for
  // all mapped accounts. This tells us the counterparty for each account
  // (e.g., entity account named "Due from Two Family" → counterparty "Two Family").
  const accountIds = [...allMappedAccountIds];
  const entityAccountDetails = new Map<string, EntityAccountDetail>();

  // Paginate account detail fetch
  const ACCT_PAGE_SIZE = 1000;
  let acctOffset = 0;
  let acctHasMore = true;
  while (acctHasMore) {
    const batch = accountIds.slice(acctOffset, acctOffset + ACCT_PAGE_SIZE);
    if (batch.length === 0) break;

    const { data: acctRows } = await admin
      .from("accounts")
      .select("id, name, account_number")
      .in("id", batch);

    for (const row of acctRows ?? []) {
      entityAccountDetails.set(row.id, {
        id: row.id,
        name: row.name,
        account_number: row.account_number,
      });
    }

    if (batch.length < ACCT_PAGE_SIZE) {
      acctHasMore = false;
    } else {
      acctOffset += ACCT_PAGE_SIZE;
    }
  }

  // Build mapping index: (entity_id, master_account_id) → entity account_ids
  const mappingIndex = new Map<string, string[]>();
  for (const m of mappings ?? []) {
    const key = `${m.entity_id}::${m.master_account_id}`;
    const list = mappingIndex.get(key) ?? [];
    list.push(m.account_id);
    mappingIndex.set(key, list);
  }

  // Fetch GL balances
  const entityIds = entities.map((e) => e.id);
  const glBalances = await fetchGLBalancesForAccounts(
    admin,
    accountIds,
    entityIds,
    endYear,
    endMonth
  );

  // Index GL balances by (account_id, entity_id)
  const glIndex = new Map<string, number>();
  for (const gl of glBalances) {
    const key = `${gl.account_id}::${gl.entity_id}`;
    glIndex.set(key, (glIndex.get(key) ?? 0) + gl.ending_balance);
  }

  // ---------------------------------------------------------------------------
  // Counterparty → Entity resolution (defined before map building so we can
  // resolve EARLY and merge accounts that reference the same entity under
  // different names, e.g. "Two Family" vs "Two Family Enterprises")
  // ---------------------------------------------------------------------------

  function resolveCounterpartyEntity(
    counterpartyName: string,
    excludeEntityId?: string
  ): { id: string; code: string; name: string } | null {
    const lower = counterpartyName.toLowerCase();

    // Score-based matching: prefer exact and more-specific matches so that
    // e.g. counterparty "Avon Rental Holdings" resolves to entity
    // "Avon Rental Holdings" rather than a shorter entity like "Avon".
    let bestMatch: { id: string; code: string; name: string } | null = null;
    let bestScore = 0;

    for (const ent of entities) {
      if (excludeEntityId && ent.id === excludeEntityId) continue;

      const entName = ent.name.toLowerCase();
      const entCode = ent.code.toLowerCase();
      let score = 0;

      // Exact name match — highest priority
      if (entName === lower) {
        score = 1000;
      }
      // Exact code match
      else if (entCode === lower) {
        score = 900;
      }
      // Entity name fully contains the counterparty name
      // (e.g. entity "Two Family Enterprises" contains counterparty "Two Family")
      // Prefer shorter entity names (closer to exact match)
      else if (entName.includes(lower)) {
        score = 800 - entName.length;
      }
      // Counterparty fully contains the entity name
      // (e.g. counterparty "Avon Rental Holdings" contains entity "Avon")
      // Prefer LONGER entity names (more specific match)
      else if (lower.includes(entName)) {
        score = 500 + entName.length;
      }
      // Counterparty contains entity code (min 3 chars to avoid false positives)
      else if (entCode.length >= 3 && lower.includes(entCode)) {
        score = 300 + entCode.length;
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = { id: ent.id, code: ent.code, name: ent.name };
      }
    }

    return bestMatch;
  }

  // ---------------------------------------------------------------------------
  // Build per-entity, per-counterparty breakdown
  // ---------------------------------------------------------------------------
  //
  // KEY FIX 1 — Counterparty merging:
  //   Account names like "Due From Two Family" and "Due To Two Family
  //   Enterprises" both reference the same entity. We resolve the counterparty
  //   to an entity ID *during* accumulation and use that ID as the map key
  //   so all balances merge into a single counterparty entry.
  //
  // KEY FIX 2 — Sign normalisation:
  //   GL balances are stored in debit-positive convention:
  //     - "Due From" (asset, debit-normal): positive = normal
  //     - "Due To" (liability, credit-normal): negative = normal credit balance
  //   For display, we negate the "Due To" GL balance so a normal liability
  //   reads as a positive number.  A reversed (debit) balance on a "Due To"
  //   account will correctly display as negative.
  //
  //   Net position = dueFrom − dueTo  (where dueTo = −glBalance)
  //               = dueFrom + glBalance  (sum of raw GL values)
  //
  //   This matches the Excel "Intercompany Review" net-zero formula:
  //     A.due_from_B + A.due_to_B + B.due_from_A + B.due_to_A = 0

  interface CpEntry {
    dueFrom: number;
    dueTo: number;
    displayName: string;
    resolvedEntityId?: string;
    resolvedCode?: string;
  }

  // Structure: entityId → cpKey → CpEntry
  const entityCounterpartyMap = new Map<string, Map<string, CpEntry>>();

  for (const masterAcct of icMasterAccounts) {
    const masterDirection = classifyDirection(masterAcct.name);
    if (!masterDirection) continue;

    for (const entity of entities) {
      const key = `${entity.id}::${masterAcct.id}`;
      const mappedAcctIds = mappingIndex.get(key) ?? [];

      for (const acctId of mappedAcctIds) {
        const glKey = `${acctId}::${entity.id}`;
        const balance = glIndex.get(glKey) ?? 0;
        if (Math.abs(balance) < 0.01) continue;

        // Extract counterparty name & direction from entity-level account
        const entityAcct = entityAccountDetails.get(acctId);
        let counterparty: string | null = null;
        let direction = masterDirection;

        if (entityAcct) {
          const acctCounterparty = extractCounterparty(entityAcct.name);
          const acctDirection = classifyDirection(entityAcct.name);
          if (acctCounterparty) counterparty = acctCounterparty;
          if (acctDirection) direction = acctDirection;
        }

        // Fallback: master account name
        if (!counterparty) {
          counterparty =
            extractCounterparty(masterAcct.name) ??
            masterAcct.name ??
            "Unknown";
        }
        counterparty = (counterparty ?? "Unknown").trim();

        // Resolve counterparty to a known entity (exclude self)
        const resolved = resolveCounterpartyEntity(counterparty, entity.id);

        // Use resolved entity ID as the merge key, else lowercase name
        const cpKey = resolved ? resolved.id : counterparty.toLowerCase();

        // Initialise maps
        if (!entityCounterpartyMap.has(entity.id)) {
          entityCounterpartyMap.set(entity.id, new Map());
        }
        const cpMap = entityCounterpartyMap.get(entity.id)!;

        if (!cpMap.has(cpKey)) {
          cpMap.set(cpKey, {
            dueFrom: 0,
            dueTo: 0,
            displayName: resolved ? resolved.name : counterparty,
            resolvedEntityId: resolved?.id,
            resolvedCode: resolved?.code,
          });
        }
        const entry = cpMap.get(cpKey)!;

        if (direction === "due_from") {
          entry.dueFrom += balance;
        } else {
          // Negate GL balance: credit-normal liabilities are negative in GL,
          // so negating gives a positive display value.  Reversed (debit)
          // balances become negative, correctly indicating the counterparty
          // owes on this account.  Using -balance instead of Math.abs()
          // preserves sign information needed for net-zero elimination.
          entry.dueTo += -balance;
        }
      }
    }
  }

  // Build entityDetails response
  const entityDetails = entities
    .map((entity) => {
      const cpMap = entityCounterpartyMap.get(entity.id);
      if (!cpMap || cpMap.size === 0) return null;

      const counterparties = [...cpMap.values()]
        .map((data) => ({
          counterpartyName: data.displayName,
          counterpartyEntityId: data.resolvedEntityId,
          counterpartyCode: data.resolvedCode,
          dueFromBalance: data.dueFrom,
          dueToBalance: data.dueTo,
          netPosition: data.dueFrom - data.dueTo,
        }))
        .sort((a, b) => a.counterpartyName.localeCompare(b.counterpartyName));

      const totalDueFrom = counterparties.reduce(
        (s, c) => s + c.dueFromBalance,
        0
      );
      const totalDueTo = counterparties.reduce(
        (s, c) => s + c.dueToBalance,
        0
      );

      return {
        entityId: entity.id,
        entityCode: entity.code,
        entityName: entity.name,
        counterparties,
        totalDueFrom,
        totalDueTo,
        totalNet: totalDueFrom - totalDueTo,
      };
    })
    .filter(Boolean);

  // ---------------------------------------------------------------------------
  // Build elimination pairs for net-zero cross-checking
  // ---------------------------------------------------------------------------
  // For any two entities A and B, the SUM of all raw GL IC balances must cancel:
  //   A.due_from_B + A.due_to_B + B.due_from_A + B.due_to_A = 0
  //
  // In display terms (dueTo = −glBalance):
  //   (A.dueFrom − A.dueTo) + (B.dueFrom − B.dueTo) = 0

  const eliminationPairs: Array<{
    entityAId: string;
    entityACode: string;
    entityAName: string;
    entityBId: string;
    entityBCode: string;
    entityBName: string;
    aDueFromB: number;
    aDueToB: number;
    aNetWithB: number;
    bDueFromA: number;
    bDueToA: number;
    bNetWithA: number;
    netEffect: number;
  }> = [];

  const seenPairs = new Set<string>();

  for (const ed of entityDetails) {
    if (!ed) continue;
    for (const cp of ed.counterparties) {
      if (!cp.counterpartyEntityId) continue;

      // Canonical key — only process each entity pair once
      const ids = [ed.entityId, cp.counterpartyEntityId].sort();
      const pairKey = `${ids[0]}::${ids[1]}`;
      if (seenPairs.has(pairKey)) continue;
      seenPairs.add(pairKey);

      const entityAId = ed.entityId;
      const entityBId = cp.counterpartyEntityId;

      // A's balances with B (already merged & sign-normalised)
      const aDueFromB = cp.dueFromBalance;
      const aDueToB = cp.dueToBalance;
      const aNetWithB = aDueFromB - aDueToB;

      // B's balances with A
      const entityBDetail = entityDetails.find(
        (d) => d && d.entityId === entityBId
      );
      const entityBCp = entityBDetail?.counterparties.find(
        (c) => c.counterpartyEntityId === entityAId
      );

      const bDueFromA = entityBCp?.dueFromBalance ?? 0;
      const bDueToA = entityBCp?.dueToBalance ?? 0;
      const bNetWithA = bDueFromA - bDueToA;

      // Net effect: should be zero when balanced
      const netEffect = aNetWithB + bNetWithA;

      // Skip pairs with no activity
      if (
        Math.abs(aDueFromB) < 0.01 &&
        Math.abs(aDueToB) < 0.01 &&
        Math.abs(bDueFromA) < 0.01 &&
        Math.abs(bDueToA) < 0.01
      ) {
        continue;
      }

      eliminationPairs.push({
        entityAId,
        entityACode: ed.entityCode,
        entityAName: ed.entityName,
        entityBId,
        entityBCode:
          entityBDetail?.entityCode ??
          cp.counterpartyCode ??
          cp.counterpartyName,
        entityBName:
          entityBDetail?.entityName ?? cp.counterpartyName,
        aDueFromB,
        aDueToB,
        aNetWithB,
        bDueFromA,
        bDueToA,
        bNetWithA,
        netEffect,
      });
    }
  }

  // Build month label
  const monthNames = [
    "",
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const periodLabel = `${monthNames[endMonth]} ${endYear}`;

  return NextResponse.json({
    entityDetails,
    eliminationPairs,
    metadata: {
      organizationName: org?.name,
      generatedAt: new Date().toISOString(),
      periodLabel,
    },
  });
}
