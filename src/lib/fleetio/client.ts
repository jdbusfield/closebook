/**
 * Fleetio API Client (READ-ONLY).
 *
 * Per product directive, this client exposes ONLY GET surface — no POST,
 * PATCH, or DELETE methods. If a future requirement calls for writing to
 * Fleetio, add it deliberately on a separate branch with review.
 *
 * Auth: two headers required on every request — `Authorization: Token <key>`
 * AND `Account-Token: <slug>`.
 *
 * Rate limit: ~20 RPM (no public number; `Retry-After` returned on 429).
 * The client throttles via a concurrency gate and exponential backoff.
 *
 * Pagination: v1 endpoints use cursor pagination — request with
 * `start_cursor`, response envelope carries `next_cursor`.
 *
 * Incremental sync: `q[updated_at_gteq]=<ISO>` on v1; filter operators are
 * AND-only, no OR.
 */

// ──────────────── Types ────────────────

export interface FleetioCredentials {
  apiKey: string;
  accountToken: string;
  apiVersion?: string;
  baseUrl?: string;
}

export interface FleetioVehicle {
  id: number;
  account_id: number;
  name: string | null;
  vin: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  color: string | null;
  license_plate: string | null;
  ownership: string | null;
  archived_at: string | null;
  group_id: number | null;
  group_name: string | null;
  group_ancestry: string | null;
  vehicle_type_id: number | null;
  vehicle_type_name: string | null;
  vehicle_status_id: number | null;
  vehicle_status_name: string | null;
  vehicle_status_color: string | null;
  fuel_type_id: number | null;
  fuel_type_name: string | null;
  fuel_volume_units: string | null;
  primary_meter_unit: string | null;
  primary_meter_value: string | null;
  primary_meter_date: string | null;
  primary_meter_usage_per_day: string | null;
  secondary_meter_unit: string | null;
  secondary_meter_value: string | null;
  in_service_meter_value: string | null;
  in_service_date: string | null;
  out_of_service_meter_value: string | null;
  out_of_service_date: string | null;
  service_entries_count: number;
  work_orders_count: number;
  issues_count: number;
  fuel_entries_count: number;
  created_at: string;
  updated_at: string;
  external_ids?: { unit_number?: string | null } | null;
  custom_fields?: Record<string, string> | null;
  is_sample: boolean;
}

export interface FleetioServiceEntry {
  id: number;
  vehicle_id: number;
  vendor_id: number | null;
  work_order_id: number | null;
  reference: string | null;
  status: string | null;
  general_notes: string | null;
  started_at: string | null;
  completed_at: string | null;
  total_amount_cents?: number | null;
  total_amount?: string | null;
  labor_subtotal?: string | null;
  parts_subtotal?: string | null;
  tax_subtotal?: string | null;
  meter_entry?: { value?: number | string | null; meter_type?: string | null } | null;
  primary_meter_entry?: { value?: number | string | null; meter_type?: string | null } | null;
  is_sample: boolean;
  created_at: string;
  updated_at: string;
}

export interface FleetioWorkOrder {
  id: number;
  vehicle_id: number;
  status: string | null;
  reference?: string | null;
  started_at: string | null;
  completed_at: string | null;
  total_amount?: string | null;
  created_at: string;
  updated_at: string;
}

export interface FleetioMeterEntry {
  id: number;
  vehicle_id: number;
  value: string | number;
  meter_type?: string | null;
  meter_unit?: string | null;
  meter_date: string;
  category?: string | null;
  source?: string | null;
  void?: boolean;
  created_at: string;
  updated_at: string;
}

export interface FleetioIssue {
  id: number;
  vehicle_id: number;
  summary: string | null;
  description: string | null;
  state: string | null;
  resolved_at: string | null;
  reported_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface FleetioGroup {
  id: number;
  name: string;
  ancestry: string | null;
  parent_id: number | null;
}

/** Cursor-paginated envelope returned by v1 list endpoints */
export interface Paged<T> {
  current_cursor: string | null;
  next_cursor: string | null;
  per_page: number;
  estimated_remaining_count: number;
  records: T[];
}

// ──────────────── Client ────────────────

export class FleetioClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly maxConcurrency: number;
  private activeRequests = 0;
  private queue: Array<() => void> = [];

  constructor(creds: FleetioCredentials, opts?: { maxConcurrency?: number }) {
    if (!creds.apiKey || !creds.accountToken) {
      throw new Error("FleetioClient requires apiKey and accountToken");
    }
    this.baseUrl = creds.baseUrl ?? "https://secure.fleetio.com/api";
    this.headers = {
      Authorization: `Token ${creds.apiKey}`,
      "Account-Token": creds.accountToken,
      "X-Api-Version": creds.apiVersion ?? "2025-05-05",
      Accept: "application/json",
    };
    this.maxConcurrency = opts?.maxConcurrency ?? 3;
  }

  // ──────────── public read methods ────────────

  listVehicles(params?: {
    cursor?: string | null;
    perPage?: number;
    updatedAfter?: string;
  }): Promise<Paged<FleetioVehicle>> {
    return this.getPaged<FleetioVehicle>("/v1/vehicles", params);
  }

  listServiceEntries(params?: {
    cursor?: string | null;
    perPage?: number;
    updatedAfter?: string;
    vehicleId?: number;
  }): Promise<Paged<FleetioServiceEntry>> {
    return this.getPaged<FleetioServiceEntry>("/v2/service_entries", params);
  }

  listWorkOrders(params?: {
    cursor?: string | null;
    perPage?: number;
    updatedAfter?: string;
    vehicleId?: number;
  }): Promise<Paged<FleetioWorkOrder>> {
    return this.getPaged<FleetioWorkOrder>("/v2/work_orders", params);
  }

  listMeterEntries(params?: {
    cursor?: string | null;
    perPage?: number;
    updatedAfter?: string;
    vehicleId?: number;
  }): Promise<Paged<FleetioMeterEntry>> {
    return this.getPaged<FleetioMeterEntry>("/v1/meter_entries", params);
  }

  listIssues(params?: {
    cursor?: string | null;
    perPage?: number;
    updatedAfter?: string;
    vehicleId?: number;
  }): Promise<Paged<FleetioIssue>> {
    return this.getPaged<FleetioIssue>("/v2/issues", params);
  }

  async listGroups(): Promise<FleetioGroup[]> {
    const res = await this.get<FleetioGroup[]>("/v1/groups");
    return Array.isArray(res) ? res : (res as { records?: FleetioGroup[] }).records ?? [];
  }

  /** Convenience: iterate every page of a list endpoint, yielding records. */
  async *paginateAll<T>(
    fetcher: (cursor: string | null) => Promise<Paged<T>>
  ): AsyncGenerator<T, void, void> {
    let cursor: string | null = null;
    while (true) {
      const page = await fetcher(cursor);
      for (const rec of page.records) yield rec;
      if (!page.next_cursor || page.records.length === 0) break;
      cursor = page.next_cursor;
    }
  }

  // ──────────── internals ────────────

  private async getPaged<T>(
    pathname: string,
    params?: {
      cursor?: string | null;
      perPage?: number;
      updatedAfter?: string;
      vehicleId?: number;
    }
  ): Promise<Paged<T>> {
    const url = new URL(`${this.baseUrl}${pathname}`);
    url.searchParams.set("per_page", String(params?.perPage ?? 100));
    if (params?.cursor) url.searchParams.set("start_cursor", params.cursor);
    if (params?.updatedAfter) {
      // legacy-style filter works on both v1 and v2 for most endpoints
      url.searchParams.set("q[updated_at_gteq]", params.updatedAfter);
    }
    if (params?.vehicleId != null) {
      url.searchParams.set("q[vehicle_id_eq]", String(params.vehicleId));
    }
    return this.get<Paged<T>>(url.toString());
  }

  private async get<T>(pathOrUrl: string): Promise<T> {
    const url = pathOrUrl.startsWith("http")
      ? pathOrUrl
      : `${this.baseUrl}${pathOrUrl}`;

    await this.acquire();
    try {
      for (let attempt = 0; attempt < 6; attempt++) {
        const res = await fetch(url, { method: "GET", headers: this.headers });

        if (res.status === 429) {
          const retryAfter = Number(res.headers.get("retry-after") ?? 10);
          await sleep(retryAfter * 1000);
          continue;
        }
        if (res.status >= 500 && attempt < 5) {
          await sleep(Math.min(1000 * 2 ** attempt, 30_000));
          continue;
        }
        if (!res.ok) {
          const body = await res.text();
          throw new FleetioHttpError(res.status, res.statusText, body);
        }
        return (await res.json()) as T;
      }
      throw new Error(`GET ${url} exhausted retries`);
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.activeRequests < this.maxConcurrency) {
      this.activeRequests++;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.activeRequests++;
        resolve();
      });
    });
  }

  private release() {
    this.activeRequests--;
    const next = this.queue.shift();
    if (next) next();
  }
}

export class FleetioHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly statusText: string,
    public readonly body: string
  ) {
    super(`Fleetio ${status} ${statusText}: ${body.slice(0, 200)}`);
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ──────────────── env loader ────────────────

/**
 * Build a client from process.env. Use only in server-side code (API routes,
 * scripts). Never import this from a client component.
 */
export function getFleetioClientFromEnv(): FleetioClient {
  const apiKey = process.env.FLEETIO_API_KEY;
  const accountToken = process.env.FLEETIO_ACCOUNT_TOKEN;
  if (!apiKey || !accountToken) {
    throw new Error(
      "FLEETIO_API_KEY and FLEETIO_ACCOUNT_TOKEN must be set in env"
    );
  }
  return new FleetioClient({
    apiKey,
    accountToken,
    apiVersion: process.env.FLEETIO_API_VERSION || "2025-05-05",
    baseUrl: process.env.FLEETIO_BASE_URL || "https://secure.fleetio.com/api",
  });
}
