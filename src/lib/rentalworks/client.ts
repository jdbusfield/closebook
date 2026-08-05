/**
 * RentalWorks API Client
 *
 * Typed fetch-based client for the RentalWorks Web REST API.
 * Handles JWT authentication, browse (positional array) parsing, and CRUD operations.
 *
 * Usage:
 *   const rw = new RentalWorksClient(process.env.RW_BASE_URL!);
 *   await rw.login(process.env.RW_USERNAME!, process.env.RW_PASSWORD!);
 *   const customers = await rw.browse('customer', { pagesize: 50 });
 *
 * IMPORTANT: Browse responses return positional arrays. Use `parseRows()` or the
 * built-in parsing in `browse()` to convert to named objects.
 *
 * @see docs/rentalworks-api/ for SOPs on API patterns and gotchas
 */

// ─── Types ───────────────────────────────────────────────────────────

export interface BrowseRequest {
  miscfields?: Record<string, string>;
  module?: string;
  options?: Record<string, unknown>;
  orderby?: string;
  orderbydirection?: 'asc' | 'desc' | '';
  top?: number;
  pageno?: number;
  pagesize?: number;
  searchfields?: string[];
  searchfieldoperators?: string[];
  searchfieldvalues?: string[];
  searchfieldtypes?: string[];
  searchseparators?: string[];
  searchcondition?: string[];
  uniqueids?: Record<string, string>;
  activeviewfields?: string[];
}

/** Raw browse response from the RW API (positional arrays) */
export interface RawBrowseResponse {
  Rows: unknown[][];
  TotalRows: number;
  PageNo: number;
  PageSize: number;
  TotalPages: number;
  ColumnIndex: Record<string, number>;
}

/** Parsed browse response with named objects */
export interface BrowseResponse<T = Record<string, unknown>> {
  rows: T[];
  totalRows: number;
  pageNo: number;
  pageSize: number;
  totalPages: number;
  columnIndex: Record<string, number>;
}

export interface RWGLDistributionRow {
  Date: string;
  GlAccountNo: string;
  GlAccountDescription: string;
  GlAccountId: string;
  GroupHeading: string; // e.g. "INCOME"
  OrderBy: number;
  GroupHeadingOrder: number;
  Debit: number;
  Credit: number;
  CurrencyId: string;
  CurrencyCode: string;
  CurrencySymbol: string;
  OfficeLocationId: string;
  OfficeLocation: string;
}

export interface JwtResponse {
  statuscode: number;
  statusmessage: string;
  access_token: string;
  token_type: string;
  expires_in: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Convert positional array rows to named objects using ColumnIndex mapping.
 *
 * Browse endpoints return rows as arrays like [val0, val1, val2, ...] with
 * a ColumnIndex like { OrderNumber: 1, Customer: 23 }. This function
 * maps each row to { OrderNumber: val1, Customer: val23, ... }.
 */
export function parseRows<T = Record<string, unknown>>(
  raw: Pick<RawBrowseResponse, 'Rows' | 'ColumnIndex'>
): T[] {
  const { Rows, ColumnIndex } = raw;
  if (!Rows || !ColumnIndex) return [];
  return Rows.map(row => {
    const obj: Record<string, unknown> = {};
    for (const [field, idx] of Object.entries(ColumnIndex)) {
      obj[field] = row[idx];
    }
    return obj as T;
  });
}

// ─── Client ──────────────────────────────────────────────────────────

export class RentalWorksClient {
  private baseUrl: string;
  private apiUrl: string;
  private token: string | null = null;

  constructor(baseUrl: string, token?: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiUrl = `${this.baseUrl}/api/v1`;
    this.token = token ?? null;
  }

  // ─── Internal fetch wrapper ──────────────────────────────────────

  private headers(): HeadersInit {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-requested-with': 'XMLHttpRequest',
    };
    if (this.token) {
      h['Authorization'] = `Bearer ${this.token}`;
    }
    return h;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${this.apiUrl}${path}`;
    const res = await fetch(url, {
      ...init,
      headers: { ...this.headers(), ...(init?.headers as Record<string, string> || {}) },
    });

    if (res.status === 401 || res.status === 403) {
      throw new RentalWorksAuthError('Session expired or unauthorized');
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new RentalWorksApiError(`RW API error ${res.status}: ${text}`, res.status);
    }

    return res.json() as Promise<T>;
  }

  // ─── Authentication ──────────────────────────────────────────────

  async login(username: string, password: string): Promise<JwtResponse> {
    const data = await this.request<JwtResponse>('/jwt', {
      method: 'POST',
      body: JSON.stringify({ UserName: username, Password: password }),
    });
    this.token = data.access_token;
    return data;
  }

  async checkSession(): Promise<unknown> {
    return this.request('/account/session');
  }

  getToken(): string | null {
    return this.token;
  }

  setToken(token: string) {
    this.token = token;
  }

  /**
   * Ensure the client is authenticated. Re-authenticates if no token is set.
   * Returns the current token.
   */
  async ensureAuth(username: string, password: string): Promise<string> {
    if (this.token) {
      try {
        await this.checkSession();
        return this.token;
      } catch {
        // Token expired, re-auth below
      }
    }
    await this.login(username, password);
    return this.token!;
  }

  // ─── Browse (with automatic row parsing) ─────────────────────────

  /**
   * Search/list records with filters. Returns parsed named objects.
   *
   * @param entity - API entity name (e.g., 'customer', 'order', 'Deal')
   *                 NOTE: 'Deal' is case-sensitive (capital D)!
   * @param params - Search filters, pagination, sorting
   * @returns Parsed rows as named objects + pagination info
   */
  async browse<T = Record<string, unknown>>(
    entity: string,
    params: BrowseRequest = {}
  ): Promise<BrowseResponse<T>> {
    const payload: BrowseRequest = {
      miscfields: {},
      module: '',
      options: {},
      orderby: '',
      orderbydirection: '',
      top: 0,
      pageno: 1,
      pagesize: 25,
      searchfields: [],
      searchfieldoperators: [],
      searchfieldvalues: [],
      searchfieldtypes: [],
      searchseparators: [],
      searchcondition: [],
      ...params,
    };

    const raw = await this.request<RawBrowseResponse>(`/${entity}/browse`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    return {
      rows: parseRows<T>(raw),
      totalRows: raw.TotalRows,
      pageNo: raw.PageNo,
      pageSize: raw.PageSize,
      totalPages: raw.TotalPages,
      columnIndex: raw.ColumnIndex,
    };
  }

  /**
   * Browse ALL pages of a query, concatenating rows. The browse endpoint caps
   * each response at `pagesize` rows (max 2000) and does NOT reliably honor the
   * requested sort when truncating, so any query that can exceed one page MUST
   * use this instead of browse() to avoid silently dropping rows.
   */
  async browseAll<T = Record<string, unknown>>(
    entity: string,
    params: BrowseRequest = {},
    maxPages = 50,
  ): Promise<BrowseResponse<T>> {
    const pagesize = params.pagesize ?? 2000;
    let page = await this.browse<T>(entity, { ...params, pagesize, pageno: 1 });
    const rows = [...page.rows];
    let pageno = 1;
    while (
      rows.length < page.totalRows &&
      page.rows.length > 0 &&
      pageno < maxPages
    ) {
      pageno++;
      page = await this.browse<T>(entity, { ...params, pagesize, pageno });
      rows.push(...page.rows);
    }
    return { ...page, rows, pageNo: 1 };
  }

  /**
   * Browse a date-filtered query as parallel calendar-month windows.
   *
   * Browse server time scales with row count (~2000 rows ≈ 48s on `order`),
   * so a single wide date range can blow past Vercel's 60s function cap.
   * Splitting into month windows keeps each call small and runs them
   * concurrently. Windows are [monthStart, nextMonthStart) except the
   * current month, which is open-ended to catch future-dated records.
   * Rows come back newest-window-first; pass orderbydirection 'desc' to
   * keep rows sorted desc overall like a single browse would return.
   */
  async browseAllByMonthWindows<T = Record<string, unknown>>(
    entity: string,
    dateField: string,
    fromDate: Date,
    params: BrowseRequest = {},
  ): Promise<BrowseResponse<T>> {
    const fmt = (d: Date) =>
      `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;

    const now = new Date();
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const starts: Date[] = [];
    const cursor = new Date(fromDate.getFullYear(), fromDate.getMonth(), 1);
    while (cursor <= currentMonthStart) {
      starts.push(new Date(cursor));
      cursor.setMonth(cursor.getMonth() + 1);
    }
    if (starts.length === 0) starts.push(currentMonthStart);

    // Run windows in batches of 5 — RW's observed safe concurrency. Wide
    // ranges (13+ months) would otherwise fire every window at once.
    const pages: BrowseResponse<T>[] = [];
    const BATCH = 5;
    for (let b = 0; b < starts.length; b += BATCH) {
      const batch = await Promise.all(
        starts.slice(b, b + BATCH).map((start, j) => {
          const i = b + j;
          const end = i < starts.length - 1 ? starts[i + 1] : null;
          return this.browseAll<T>(entity, {
            ...params,
            searchfields: end ? [dateField, dateField] : [dateField],
            searchfieldoperators: end ? ['>=', '<'] : ['>='],
            searchfieldvalues: end ? [fmt(start), fmt(end)] : [fmt(start)],
            searchfieldtypes: end ? ['date', 'date'] : ['date'],
            searchcondition: end ? ['and'] : [],
          });
        }),
      );
      pages.push(...batch);
    }

    const rows = pages.slice().reverse().flatMap((p) => p.rows);
    const last = pages[pages.length - 1];
    return {
      rows,
      totalRows: rows.length,
      pageNo: 1,
      pageSize: rows.length,
      totalPages: 1,
      columnIndex: last.columnIndex,
    };
  }

  /**
   * Browse returning raw positional arrays (for performance-critical paths
   * where you want to avoid object creation overhead).
   */
  async browseRaw(entity: string, params: BrowseRequest = {}): Promise<RawBrowseResponse> {
    const payload: BrowseRequest = {
      miscfields: {},
      module: '',
      options: {},
      orderby: '',
      orderbydirection: '',
      top: 0,
      pageno: 1,
      pagesize: 25,
      searchfields: [],
      searchfieldoperators: [],
      searchfieldvalues: [],
      searchfieldtypes: [],
      searchseparators: [],
      searchcondition: [],
      ...params,
    };

    return this.request<RawBrowseResponse>(`/${entity}/browse`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  // ─── CRUD Operations ─────────────────────────────────────────────

  /** Get a single record by ID. Returns named fields (not positional). */
  async get<T = Record<string, unknown>>(entity: string, id: string): Promise<T> {
    return this.request<T>(`/${entity}/${id}`);
  }

  /** Create a new record. */
  async create<T = Record<string, unknown>>(entity: string, data: Record<string, unknown>): Promise<T> {
    return this.request<T>(`/${entity}`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /** Update an existing record. */
  async update<T = Record<string, unknown>>(entity: string, id: string, data: Record<string, unknown>): Promise<T> {
    return this.request<T>(`/${entity}/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  /** Delete a record. */
  async delete(entity: string, id: string): Promise<void> {
    await this.request<void>(`/${entity}/${id}`, { method: 'DELETE' });
  }

  // ─── Convenience Methods ──────────────────────────────────────────

  // Customers
  async getCustomers(params?: BrowseRequest) { return this.browse('customer', params); }
  async getCustomer(id: string) { return this.get('customer', id); }

  // Orders
  async getOrders(params?: BrowseRequest) { return this.browse('order', params); }
  async getOrder(id: string) { return this.get('order', id); }

  // Quotes
  async getQuotes(params?: BrowseRequest) { return this.browse('quote', params); }

  // Invoices
  async getInvoices(params?: BrowseRequest) { return this.browse('invoice', params); }
  async getInvoice(id: string) { return this.get('invoice', id); }

  // Invoice Items (requires uniqueids filter)
  async getInvoiceItems(invoiceId: string, params?: BrowseRequest) {
    return this.browse('invoiceitem', {
      ...params,
      uniqueids: { InvoiceId: invoiceId, ...(params?.uniqueids ?? {}) },
    });
  }

  // GL Distribution (requires uniqueids: { InvoiceId }). Returns the per-account JE
  // that RW posts for the invoice — AR debit + revenue credits, already mapped to GL numbers.
  async getGLDistribution(invoiceId: string, params?: BrowseRequest) {
    return this.browse<RWGLDistributionRow>('gldistribution', {
      pagesize: 500,
      ...params,
      uniqueids: { InvoiceId: invoiceId, ...(params?.uniqueids ?? {}) },
    });
  }

  // Contracts (check-out / check-in records)
  async getContracts(params?: BrowseRequest) { return this.browse('contract', params); }

  // Deals (NOTE: case-sensitive capital D)
  async getDeals(params?: BrowseRequest) { return this.browse('Deal', params); }

  // Purchase Orders
  async getPurchaseOrders(params?: BrowseRequest) { return this.browse('purchaseorder', params); }

  // Warehouses
  async getWarehouses(params?: BrowseRequest) { return this.browse('warehouse', params); }

  // Transfer Orders
  async getTransferOrders(params?: BrowseRequest) { return this.browse('transferorder', params); }

  // Activity Types & Statuses
  async getActivityTypes(params?: BrowseRequest) { return this.browse('activitytype', params); }
  async getActivityStatuses(params?: BrowseRequest) { return this.browse('activitystatus', params); }

  // Companies
  async getCompanies(params?: BrowseRequest) { return this.browse('company', params); }
}

// ─── Error Classes ───────────────────────────────────────────────────

export class RentalWorksAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RentalWorksAuthError';
  }
}

export class RentalWorksApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'RentalWorksApiError';
    this.status = status;
  }
}
