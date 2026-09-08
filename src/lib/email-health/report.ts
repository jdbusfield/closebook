// Email deliverability report for the Ads tab: is HDR's outbound mail
// authenticated, is it being accepted, and is anyone reading it.
//
// Sources, in order of how much they prove:
//   1. Google Postmaster Tools (Gmail's own spam rate + reputation) when the
//      domain owner has connected it.
//   2. Live DNS (SPF / DKIM / DMARC) for every sender path.
//   3. Resend delivery events already recorded by /api/webhooks/resend
//      (delivered / bounced / complained) plus Resend's own last-100 list,
//      which is the only place suppressed sends show up.
//   4. Engagement: of the inquiries we emailed, how many wrote back, split by
//      the customer's mail provider. Business domains replying far more than
//      Gmail or Yahoo is the pattern that spam-foldering produces.
//
// Only entities with a mapped sending domain get a report; others return
// { supported: false } and the panel stays hidden.

import { createAdminClient } from "@/lib/supabase/admin";
import { HDR_ENTITY_ID } from "@/lib/inquiries/shared";
import { checkDomainDns, type DnsHealth } from "./dns";
import { readPostmaster, type PostmasterHealth } from "./postmaster";

export const EMAIL_DOMAIN_FOR_ENTITY: Record<string, string> = {
  [HDR_ENTITY_ID]: "hdrsiteservices.com",
};

export type ProviderGroup = "Gmail" | "Yahoo / AOL / AT&T" | "Outlook / Hotmail" | "iCloud" | "Business domains";

export interface KindDelivery {
  kind: string;
  label: string;
  total: number;
  delivered: number;
  bounced: number;
  complained: number;
  delayed: number;
  /** Sends with no delivery event at all (webhook missed or still in flight). */
  noEvent: number;
}

export interface ResendProblem {
  createdAt: string;
  lastEvent: string;
  to: string;
  subject: string;
}

export interface EngagementRow {
  group: ProviderGroup;
  emailed: number;
  replied: number;
  rate: number | null;
}

export interface EmailHealthReport {
  supported: boolean;
  domain: string | null;
  generatedAt: string;
  dns: DnsHealth | null;
  delivery: {
    windowDays: number;
    kinds: KindDelivery[];
    totals: Omit<KindDelivery, "kind" | "label">;
  } | null;
  resend: {
    available: boolean;
    sampled: number;
    delivered: number;
    suppressed: number;
    bounced: number;
    other: number;
    problems: ResendProblem[];
    error: string | null;
  } | null;
  engagement: {
    windowDays: number;
    rows: EngagementRow[];
    totalEmailed: number;
    totalReplied: number;
  } | null;
  postmaster: PostmasterHealth | null;
  /** Plain sentences, most important first. */
  actions: string[];
}

const KIND_LABEL: Record<string, string> = {
  customer_autoreply: "Site auto-reply to the customer",
  internal_notification: "New-lead notification to sales@",
  funnel: "Quotes and follow-ups from the CRM",
  reply: "Replies sent from Gmail",
};

function providerGroup(email: string): ProviderGroup {
  const d = email.split("@")[1]?.toLowerCase() ?? "";
  if (d === "gmail.com" || d === "googlemail.com") return "Gmail";
  if (["yahoo.com", "ymail.com", "aol.com", "sbcglobal.net", "att.net", "rocketmail.com", "bellsouth.net"].includes(d)) {
    return "Yahoo / AOL / AT&T";
  }
  if (["hotmail.com", "outlook.com", "live.com", "msn.com"].includes(d)) return "Outlook / Hotmail";
  if (["icloud.com", "me.com", "mac.com"].includes(d)) return "iCloud";
  return "Business domains";
}

const GROUP_ORDER: ProviderGroup[] = ["Business domains", "Gmail", "Yahoo / AOL / AT&T", "Outlook / Hotmail", "iCloud"];

type Admin = ReturnType<typeof createAdminClient>;

/** Supabase caps a select at 1000 rows; page until short. */
async function pageAll<T>(
  run: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await run(from, from + 999);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

async function deliveryStats(admin: Admin, entityId: string, windowDays: number) {
  const since = new Date(Date.now() - windowDays * 86400_000).toISOString();
  const msgs = await pageAll<{ id: string; kind: string | null; resend_email_id: string | null }>((a, b) =>
    admin
      .from("rental_inquiry_messages")
      .select("id, kind, resend_email_id")
      .eq("entity_id", entityId)
      .eq("direction", "outbound")
      .gte("created_at", since)
      .range(a, b)
  );
  const events = await pageAll<{ message_id: string | null; resend_email_id: string | null; event_type: string }>((a, b) =>
    admin
      .from("rental_inquiry_email_events")
      .select("message_id, resend_email_id, event_type")
      .gte("created_at", since)
      .range(a, b)
  );
  const byKey = new Map<string, Set<string>>();
  for (const e of events) {
    for (const k of [e.resend_email_id, e.message_id]) {
      if (!k) continue;
      if (!byKey.has(k)) byKey.set(k, new Set());
      byKey.get(k)!.add(e.event_type);
    }
  }
  const acc = new Map<string, KindDelivery>();
  for (const m of msgs) {
    // Gmail replies are captured after the fact and never go through Resend,
    // so there are no delivery events to count for them.
    const kind = m.kind ?? "unknown";
    if (kind === "reply") continue;
    const row =
      acc.get(kind) ??
      ({ kind, label: KIND_LABEL[kind] ?? kind, total: 0, delivered: 0, bounced: 0, complained: 0, delayed: 0, noEvent: 0 } as KindDelivery);
    const evs = (m.resend_email_id && byKey.get(m.resend_email_id)) || byKey.get(m.id) || new Set<string>();
    row.total += 1;
    if (evs.has("delivered")) row.delivered += 1;
    if (evs.has("bounced")) row.bounced += 1;
    if (evs.has("complained")) row.complained += 1;
    if (evs.has("delivery_delayed")) row.delayed += 1;
    if (evs.size === 0) row.noEvent += 1;
    acc.set(kind, row);
  }
  const order = ["customer_autoreply", "funnel", "internal_notification"];
  const kinds = [...acc.values()].sort((x, y) => order.indexOf(x.kind) - order.indexOf(y.kind));
  const totals = kinds.reduce(
    (t, k) => ({
      total: t.total + k.total,
      delivered: t.delivered + k.delivered,
      bounced: t.bounced + k.bounced,
      complained: t.complained + k.complained,
      delayed: t.delayed + k.delayed,
      noEvent: t.noEvent + k.noEvent,
    }),
    { total: 0, delivered: 0, bounced: 0, complained: 0, delayed: 0, noEvent: 0 }
  );
  return { windowDays, kinds, totals };
}

async function engagementStats(admin: Admin, entityId: string, windowDays: number) {
  const since = new Date(Date.now() - windowDays * 86400_000).toISOString();
  const msgs = await pageAll<{ inquiry_id: string | null; direction: string; kind: string | null; created_at: string }>((a, b) =>
    admin
      .from("rental_inquiry_messages")
      .select("inquiry_id, direction, kind, created_at")
      .eq("entity_id", entityId)
      .gte("created_at", since)
      .order("created_at", { ascending: true })
      .range(a, b)
  );
  const byInquiry = new Map<string, typeof msgs>();
  for (const m of msgs) {
    if (!m.inquiry_id) continue;
    if (!byInquiry.has(m.inquiry_id)) byInquiry.set(m.inquiry_id, []);
    byInquiry.get(m.inquiry_id)!.push(m);
  }
  const ids = [...byInquiry.keys()];
  const emails = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await admin
      .from("rental_inquiries")
      .select("id, email, lane")
      .in("id", ids.slice(i, i + 200));
    for (const r of data ?? []) {
      // Cold-outreach cards are unsolicited mail; keep them out of a metric
      // meant to describe people who asked for a quote.
      if ((r as { lane?: string | null }).lane === "cold") continue;
      if (r.email) emails.set(r.id, r.email);
    }
  }
  const tot = new Map<ProviderGroup, number>();
  const rep = new Map<ProviderGroup, number>();
  for (const [iid, list] of byInquiry) {
    const email = emails.get(iid);
    if (!email) continue;
    const outs = list.filter((m) => m.direction === "outbound" && (m.kind === "funnel" || m.kind === "reply"));
    if (outs.length === 0) continue;
    const first = outs[0].created_at;
    const replied = list.some((m) => m.direction === "inbound" && m.created_at > first);
    const g = providerGroup(email);
    tot.set(g, (tot.get(g) ?? 0) + 1);
    rep.set(g, (rep.get(g) ?? 0) + (replied ? 1 : 0));
  }
  const rows: EngagementRow[] = GROUP_ORDER.filter((g) => tot.has(g)).map((g) => {
    const emailed = tot.get(g) ?? 0;
    const replied = rep.get(g) ?? 0;
    return { group: g, emailed, replied, rate: emailed ? replied / emailed : null };
  });
  return {
    windowDays,
    rows,
    totalEmailed: rows.reduce((s, r) => s + r.emailed, 0),
    totalReplied: rows.reduce((s, r) => s + r.replied, 0),
  };
}

async function resendRecent(domain: string) {
  const key = (process.env.RESEND_API_KEY ?? "").replace(/[^\x21-\x7e]/g, "");
  const base = { available: false, sampled: 0, delivered: 0, suppressed: 0, bounced: 0, other: 0, problems: [] as ResendProblem[], error: null as string | null };
  if (!key) return base;
  try {
    const resp = await fetch("https://api.resend.com/emails?limit=100", {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      cache: "no-store",
    });
    if (!resp.ok) return { ...base, error: `Resend HTTP ${resp.status}` };
    const json = (await resp.json()) as {
      data?: { created_at: string; last_event: string; from: string; to: string[]; subject: string }[];
    };
    const rows = (json.data ?? []).filter((e) => (e.from ?? "").toLowerCase().includes(`@${domain}`));
    const out = { ...base, available: true, sampled: rows.length };
    for (const e of rows) {
      if (e.last_event === "delivered") out.delivered += 1;
      else if (e.last_event === "suppressed") out.suppressed += 1;
      else if (e.last_event === "bounced") out.bounced += 1;
      else out.other += 1;
      if (e.last_event === "suppressed" || e.last_event === "bounced" || e.last_event === "complained") {
        out.problems.push({
          createdAt: e.created_at,
          lastEvent: e.last_event,
          to: (e.to ?? []).join(", "),
          subject: e.subject ?? "",
        });
      }
    }
    return out;
  } catch (e) {
    return { ...base, error: e instanceof Error ? e.message : String(e) };
  }
}

function buildActions(r: EmailHealthReport): string[] {
  const out: string[] = [];
  const dns = r.dns;
  if (dns) {
    if (!dns.dmarc.ok) out.push("Publish a DMARC record. Without it Gmail and Yahoo treat the domain as lower trust.");
    else if (dns.dmarc.policy === "none") {
      out.push("DMARC is monitor-only. After two to four weeks of reports showing only Google and Resend as sources, change the policy to quarantine.");
    }
    if (!dns.dkimGoogle.ok) out.push("Turn on DKIM for Google Workspace so replies from Gmail are signed.");
    if (!dns.dkimResend.ok) out.push("Add the Resend DKIM record so site and CRM emails are signed.");
    if (!dns.spf.ok) out.push("Fix the SPF record so it includes Google Workspace.");
  }
  if (r.postmaster) {
    if (!r.postmaster.connected) {
      out.push("Connect Google Postmaster Tools with the Google account that owns the domain there. It is the only source of Gmail's spam rate for the domain.");
    } else if (r.postmaster.latest) {
      const l = r.postmaster.latest;
      if (l.spamRatio != null && l.spamRatio >= 0.003) {
        out.push(`Gmail users marked ${(l.spamRatio * 100).toFixed(2)}% of mail as spam on ${l.date}. Google's limit is 0.3%. Stop any outreach sends until this drops.`);
      }
      if (l.domainReputation === "LOW" || l.domainReputation === "BAD") {
        out.push(`Gmail rates the domain's reputation ${l.domainReputation.toLowerCase()}. Expect spam placement until it recovers. Send only to people who asked to hear from you.`);
      }
    }
  }
  if (r.resend?.problems.length) {
    out.push(`${r.resend.problems.length} recent send${r.resend.problems.length === 1 ? "" : "s"} bounced or was suppressed. Call those customers for a working address; do not resend to the same one.`);
  }
  if (r.delivery && r.delivery.totals.complained > 0) {
    out.push(`${r.delivery.totals.complained} recipient${r.delivery.totals.complained === 1 ? "" : "s"} reported a CRM email as spam in the last ${r.delivery.windowDays} days.`);
  }
  if (r.engagement) {
    const biz = r.engagement.rows.find((x) => x.group === "Business domains");
    const consumer = r.engagement.rows.filter((x) => x.group !== "Business domains");
    const cEmailed = consumer.reduce((s, x) => s + x.emailed, 0);
    const cReplied = consumer.reduce((s, x) => s + x.replied, 0);
    if (biz?.rate != null && cEmailed >= 10 && biz.emailed >= 5) {
      const cRate = cReplied / cEmailed;
      if (biz.rate >= 2 * cRate) {
        out.push(
          `Business-domain customers reply ${Math.round(biz.rate * 100)}% of the time; Gmail, Yahoo and Outlook customers ${Math.round(cRate * 100)}%. A gap that wide usually means consumer inboxes are filtering the mail. Watch it narrow as DMARC and Postmaster data build up.`
        );
      }
    }
  }
  if (out.length === 0) out.push("Nothing needs attention. Keep sending at a steady pace and check back weekly.");
  return out;
}

export async function buildEmailHealth(entityId: string): Promise<EmailHealthReport> {
  const domain = EMAIL_DOMAIN_FOR_ENTITY[entityId] ?? null;
  const base: EmailHealthReport = {
    supported: !!domain,
    domain,
    generatedAt: new Date().toISOString(),
    dns: null,
    delivery: null,
    resend: null,
    engagement: null,
    postmaster: null,
    actions: [],
  };
  if (!domain) return base;
  const admin = createAdminClient();
  const [dns, delivery, engagement, resend, postmaster] = await Promise.all([
    checkDomainDns(domain),
    deliveryStats(admin, entityId, 30),
    engagementStats(admin, entityId, 60),
    resendRecent(domain),
    readPostmaster(domain, 30),
  ]);
  const report = { ...base, dns, delivery, engagement, resend, postmaster };
  report.actions = buildActions(report);
  return report;
}
