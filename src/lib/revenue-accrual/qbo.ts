import type { createAdminClient } from "@/lib/supabase/admin";
import type { BookedJournal, Doc, DocLine, DocType, IsoDate } from "./types";
import { parseRentalPeriod } from "./dates";

type Admin = ReturnType<typeof createAdminClient>;

interface Connection {
  id: string;
  realm_id: string;
  access_token: string;
  refresh_token: string;
  access_token_expires_at: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

async function accessToken(admin: Admin, c: Connection): Promise<string> {
  if (new Date(c.access_token_expires_at).getTime() - Date.now() > 5 * 60 * 1000) return c.access_token;
  const basic = Buffer.from(`${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`).toString("base64");
  const res = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${basic}`, Accept: "application/json" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: c.refresh_token }),
  });
  if (!res.ok) throw new Error(`QuickBooks token refresh failed (HTTP ${res.status}). Reconnect QuickBooks on the Sync page.`);
  const t = await res.json();
  await admin
    .from("qbo_connections")
    .update({
      access_token: t.access_token,
      refresh_token: t.refresh_token,
      access_token_expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(),
    })
    .eq("id", c.id);
  return t.access_token as string;
}

class Qbo {
  constructor(private realm: string, private token: string) {}

  async queryAll(entity: string, where = ""): Promise<any[]> {
    const out: any[] = [];
    for (let start = 1; ; start += 1000) {
      const sql = `SELECT * FROM ${entity}${where ? ` WHERE ${where}` : ""} STARTPOSITION ${start} MAXRESULTS 1000`;
      const res = await fetch(
        `https://quickbooks.api.intuit.com/v3/company/${this.realm}/query?query=${encodeURIComponent(sql)}&minorversion=75`,
        { headers: { Authorization: `Bearer ${this.token}`, Accept: "application/json" } },
      );
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`QuickBooks ${entity} query failed (HTTP ${res.status}): ${body.slice(0, 300)}`);
      }
      const json = await res.json();
      const rows: any[] = json.QueryResponse?.[entity] ?? [];
      out.push(...rows);
      if (rows.length < 1000) break;
    }
    return out;
  }
}

export interface QboPull {
  pulledAt: string;
  from: IsoDate;
  to: IsoDate;
  companyName: string | null;
  docs: Doc[];
  journals: BookedJournal[];
}

const DOC_TYPES: { entity: DocType; sign: 1 | -1 }[] = [
  { entity: "Invoice", sign: 1 },
  { entity: "SalesReceipt", sign: 1 },
  { entity: "CreditMemo", sign: -1 },
  { entity: "RefundReceipt", sign: -1 },
];

export async function pullFromQuickBooks(
  admin: Admin,
  entityId: string,
  from: IsoDate,
  to: IsoDate,
  journalsFrom: IsoDate,
): Promise<QboPull> {
  const { data: conn, error } = await admin
    .from("qbo_connections")
    .select("id, realm_id, access_token, refresh_token, access_token_expires_at, company_name")
    .eq("entity_id", entityId)
    .maybeSingle();
  if (error || !conn) throw new Error("This entity has no QuickBooks connection.");
  const token = await accessToken(admin, conn as Connection);
  const qbo = new Qbo((conn as Connection).realm_id, token);

  const [accounts, items, customers, classes] = await Promise.all([
    qbo.queryAll("Account", "Active IN (true, false)"),
    qbo.queryAll("Item", "Active IN (true, false)"),
    qbo.queryAll("Customer", "Active IN (true, false)"),
    qbo.queryAll("Class", "Active IN (true, false)"),
  ]);
  const acct = new Map<string, { number: string | null; name: string; income: boolean }>();
  for (const a of accounts) {
    acct.set(String(a.Id), {
      number: a.AcctNum ? String(a.AcctNum) : null,
      name: a.FullyQualifiedName ?? a.Name,
      income: a.Classification === "Revenue" || a.AccountType === "Income" || a.AccountType === "Other Income",
    });
  }
  const itemIncome = new Map<string, string>();
  for (const it of items) if (it.IncomeAccountRef?.value) itemIncome.set(String(it.Id), String(it.IncomeAccountRef.value));
  const custName = new Map<string, string>();
  for (const c of customers) custName.set(String(c.Id), c.FullyQualifiedName ?? c.DisplayName);
  const className = new Map<string, string>();
  for (const c of classes) className.set(String(c.Id), c.FullyQualifiedName ?? c.Name);

  const clsOf = (ref: any, fallback: string | null) =>
    ref?.value ? (className.get(String(ref.value)) ?? ref.name ?? fallback) : fallback;

  const docs: Doc[] = [];
  const dateWhere = `TxnDate >= '${from}' AND TxnDate <= '${to}'`;
  const pulled = await Promise.all(DOC_TYPES.map((t) => qbo.queryAll(t.entity, dateWhere)));
  DOC_TYPES.forEach((t, ti) => {
    for (const d of pulled[ti]) {
      const headerClass = clsOf(d.ClassRef, null);
      const lines: DocLine[] = [];
      const pushSales = (l: any) => {
        const det = l.SalesItemLineDetail;
        const accId = det?.ItemAccountRef?.value ?? (det?.ItemRef?.value ? itemIncome.get(String(det.ItemRef.value)) : undefined);
        const a = accId ? acct.get(String(accId)) : undefined;
        lines.push({
          amount: t.sign * Number(l.Amount ?? 0),
          description: String(l.Description ?? det?.ItemRef?.name ?? ""),
          accountNumber: a?.number ?? null,
          accountName: a?.name ?? det?.ItemRef?.name ?? "Unknown",
          className: clsOf(det?.ClassRef, headerClass),
        });
      };
      for (const l of d.Line ?? []) {
        if (l.DetailType === "SalesItemLineDetail") pushSales(l);
        else if (l.DetailType === "GroupLineDetail") for (const g of l.GroupLineDetail?.Line ?? []) pushSales(g);
        else if (l.DetailType === "DiscountLineDetail") {
          const det = l.DiscountLineDetail;
          const a = det?.DiscountAccountRef?.value ? acct.get(String(det.DiscountAccountRef.value)) : undefined;
          lines.push({
            amount: -t.sign * Number(l.Amount ?? 0),
            description: "Discount",
            accountNumber: a?.number ?? null,
            accountName: a?.name ?? "Discounts",
            className: clsOf(det?.ClassRef, headerClass),
          });
        }
      }
      const rp = (d.CustomField ?? []).find((cf: any) => /rental\s*(period|dates)/i.test(cf.Name ?? ""));
      docs.push({
        key: `${t.entity}:${d.Id}`,
        num: String(d.DocNumber ?? d.Id),
        type: t.entity,
        date: d.TxnDate,
        created: d.MetaData?.CreateTime ?? null,
        customer: d.CustomerRef?.value ? (custName.get(String(d.CustomerRef.value)) ?? d.CustomerRef.name ?? "(none)") : "(none)",
        lines,
        rentalPeriod: rp?.StringValue ? parseRentalPeriod(rp.StringValue, d.TxnDate) : null,
      });
    }
  });

  const jes = await qbo.queryAll("JournalEntry", `TxnDate >= '${journalsFrom}' AND TxnDate <= '${to}'`);
  const journals: BookedJournal[] = jes.map((j) => {
    let credit = 0;
    for (const l of j.Line ?? []) {
      const det = l.JournalEntryLineDetail;
      const a = det?.AccountRef?.value ? acct.get(String(det.AccountRef.value)) : undefined;
      if (!a?.income) continue;
      credit += (det.PostingType === "Credit" ? 1 : -1) * Number(l.Amount ?? 0);
    }
    return {
      num: String(j.DocNumber ?? j.Id),
      date: j.TxnDate,
      created: j.MetaData?.CreateTime ?? null,
      revenueCredit: Math.round(credit * 100) / 100,
    };
  });

  return {
    pulledAt: new Date().toISOString(),
    from,
    to,
    companyName: (conn as { company_name?: string | null }).company_name ?? null,
    docs,
    journals,
  };
}
