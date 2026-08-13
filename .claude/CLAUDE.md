# Accounting App — RentalWorks API Integration Reference

## RentalWorks System Overview
- **System**: Database Works RentalWorks Web (HDR instance)
- **API Base URL**: `https://hdr.rentalworks.cloud/api/v1`
- **Authentication**: JWT via `POST /api/v1/jwt` with `{ UserName, Password }`
- **Token Usage**: `Authorization: Bearer <token>` header on all requests
- **Required Header**: `x-requested-with: XMLHttpRequest` (must be on every request)
- **Environment**: Avon Rents — 5 warehouses (AVON - SATICOY, VERSATILE - CAHUENGA, etc.)
- **Client Library**: `src/lib/rentalworks/client.ts` — typed fetch-based client

## Authentication Flow
```
POST /api/v1/jwt
Body: { "UserName": "...", "Password": "..." }
Response: { statuscode, statusmessage, access_token, token_type, expires_in }
```
- Token expires — check for 401/403 and re-authenticate
- Session validation: `GET /api/v1/account/session`

## CRITICAL: Browse Response Format (Positional Arrays)
Browse endpoints return **positional arrays**, NOT named objects. You MUST use `ColumnIndex` to map field names to array indices.

```typescript
// Response structure:
{
  Rows: [
    [val0, val1, val2, ...],  // Each row is a positional array
    [val0, val1, val2, ...]
  ],
  TotalRows: 150,
  PageNo: 1,
  PageSize: 25,
  TotalPages: 6,
  ColumnIndex: {
    "OrderNumber": 1,    // Row[1] = OrderNumber
    "Customer": 23,      // Row[23] = Customer
    "Status": 34,        // Row[34] = Status
    "Total": 44          // Row[44] = Total
  }
}
```

**Always use `parseRows()` helper** (in `src/lib/rentalworks/client.ts`) to convert positional arrays to named objects.

## Standard Browse Request Payload
```typescript
{
  miscfields: {},
  module: "",
  options: {},
  orderby: "FieldName",         // Sort field
  orderbydirection: "desc",     // "asc" or "desc"
  top: 0,                       // 0 = return all
  pageno: 1,
  pagesize: 25,                 // Max observed: 2000
  searchfields: ["Field1"],     // Field names to filter
  searchfieldoperators: ["="],  // Operators: =, like, >, <, >=, <=
  searchfieldvalues: ["value"], // Filter values
  searchfieldtypes: [""],       // Type hints ("date", "")
  searchseparators: [""],       // AND/OR between conditions
  searchcondition: [""],        // Additional conditions
  uniqueids: { OrderId: "123" } // For child record filtering (e.g., order items)
}
```

## Browse Search Gotcha: One Date Condition Only
Dual-condition date searches (e.g. InvoiceDate >= X AND InvoiceDate <= Y in the same request) are NOT honored — RW returns an unbounded set, which times out serverless functions. Use a single `>=` filter and apply the upper bound in code (see rental-accruals-v2 and sales-commissions).

## Working Browse Endpoints
| Entity | Endpoint | Notes |
|--------|----------|-------|
| `customer` | `/customer/browse` | Search by Customer, CustomerId |
| `order` | `/order/browse` | OrderNumber, Customer, Total, Status, OrderDate |
| `quote` | `/quote/browse` | QuoteNumber, Customer, Total, Status |
| `Deal` | `/Deal/browse` | **Case-sensitive capital D!** |
| `warehouse` | `/warehouse/browse` | 5 locations |
| `contract` | `/contract/browse` | ContractType: OUT (check-out) / IN (check-in) |
| `purchaseorder` | `/purchaseorder/browse` | Vendor, Status, Total, ReceivedCost, PoType |
| `transferorder` | `/transferorder/browse` | Warehouse transfers |
| `invoice` | `/invoice/browse` | InvoiceId, InvoiceListTotal, InvoiceTax, InvoiceSubTotal, InvoiceGrossTotal |
| `invoiceitem` | `/invoiceitem/browse` | Requires `uniqueids: { InvoiceId }` |
| `activitytype` | `/activitytype/browse` | System reference data |
| `activitystatus` | `/activitystatus/browse` | System reference data |
| `company` | `/company/browse` | Company reference data |

## Broken Browse Endpoints (Return 500)
- `/rentalinventory/browse` — Server error
- `/item/browse` — Server error
- `/physicalinventory/browse` — Server error
- `/container/browse` — Server error
- `/orderitem/browse` — Server error

## GET by ID (Named Fields)
`GET /api/v1/{entity}/{id}` returns a **named object** (not positional arrays). Use this when you need full field names for a specific record.

## Key Entity Relationships
```
Customer → Deal → Quote/Order → Contract → Invoice
                                    ↓
                              InvoiceItem (line items)
```

## Invoice Field Gotchas
- `InvoiceListTotal` = Rental + Sales items at **list price only** (excludes labor, misc charges)
- `InvoiceGrossTotal` = Final amount including ALL charges (labor, misc, etc.)
- `InvoiceSubTotal` = Total before tax
- **For rebate/revenue calculations, use `InvoiceListTotal`** — GrossTotal inflates the base with non-rental charges
- Tax back-calculation: `taxableSales = InvoiceTax / (taxRate / 100)` to recover the taxable sales base
- Invoice statuses: NEW, APPROVED, CLOSED, VOID — typically only CLOSED invoices are final

## Equipment Type Classification (from Order Descriptions)
```
"VEHICLE", "CARGO VAN", "PROMASTER", "3 TON", "3-TON",
  "LOADED CUBE", "PROD CUBE", "CAMERA CUBE", "WARDROBE CUBE" → vehicle
"GRIP", "G&L", "G & L", "G+L"                                → grip_lighting
"STUDIO"                                                     → studio
Default                                                      → pro_supplies
```
All "CUBE" variants are cube trucks — they roll up to vehicle, not studio.
Precedence is Vehicle → G&L → Studio → Pro Supplies (first match wins).

## API Integration SOPs
Reference documentation in `docs/rentalworks-api/`:
- `SOP-09.01` — API Overview & Authentication
- `SOP-09.02` — Browse Endpoint Usage (MOST IMPORTANT — read this first)
- `SOP-09.03` — CRUD Operations
- `SOP-09.06` — Summary Reporting
- `SOP-09.07` — Error Handling & Session Management
- `SOP-09.08` — Building Automated Workflows
- `SOP-09.09` — Building Custom Reports
- `SOP-09.10` — Rate Limits & Best Practices

## Environment Variables (add to .env.local)
```
RW_BASE_URL=https://hdr.rentalworks.cloud
RW_USERNAME=<username>
RW_PASSWORD=<password>
```

## Concurrency & Performance Notes
- Batch API calls in groups of 5 (observed safe concurrency)
- Invoice items require N+1 pattern (fetch per invoice)
- Browse pagesize up to 2000 works reliably
- Cache headers: 5min for today's data, 1hr for historical
- Token refresh: check for 401/403, re-auth, retry

## Existing RentalWorks Integrations (in RentalWorks API project)
The separate `RentalWorks API` project at `../RentalWorks API/` contains:
- Rebate tracker (6 commercial customers with tiered rebate calculations)
- SOP wiki (133 SOPs across 10 operational categories)
- Daily reservation report (cron job + PDF + email)
- Dispatch board
- All deployed at `https://rentalworks-dashboard.vercel.app/`

## Deployment
- Production is Vercel at `closebook.vercel.app`
- Deploy = `git add <files> && git commit && git push origin main`
- Vercel auto-deploys from main branch
- Always confirm deployment URL after pushing
- NEVER deploy to wrong remote or wrong branch

## Financial Model Rules
- Balance sheet MUST balance (Assets = Liabilities + Equity)
- Pro forma adjustments must flow through ALL THREE statements
- Cash flow statement must reconcile to balance sheet cash change
- Consolidated view = sum of all entity views
- Print: 8.5x11, portrait for <=6 columns, landscape for >6
- Each financial statement must fit on exactly one page
- EBITDA toggle must work on all views (consolidated, entity, reporting entity)

## Supabase Queries
- ALWAYS paginate or use .range() - never assume <1000 rows
- After any query change, verify row counts match expected totals
- New tables must be added to database.types.ts

## User Testing Workflow  
- User tests exclusively in production (Vercel), not localhost
- After deploying, user will share screenshots of issues
- When user shares a screenshot, treat it as a bug report

## Common Gotchas
- Intercompany eliminations: ARH and Silverco are DIFFERENT entities
- Master GL mappings must be entity-scoped
- Pro forma adjustments are period-specific, not cumulative
- Budget data uses Master GL structure, not entity-specific accounts

