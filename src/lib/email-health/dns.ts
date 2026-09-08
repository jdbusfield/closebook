// Live DNS checks for the records receiving mail servers look at when they
// decide whether an @domain message is authentic: SPF, the two DKIM keys
// (Google Workspace for human replies, Resend for the site + CRM sends), the
// Resend return-path subdomain, and DMARC. Results are cached in-process for
// ten minutes so the Ads tab can poll without hammering the resolver.

import { resolveTxt } from "node:dns/promises";

export interface DnsRecordCheck {
  /** Short label shown in the UI. */
  label: string;
  /** Hostname that was queried. */
  host: string;
  ok: boolean;
  /** The matching TXT record, trimmed for display. Null when absent. */
  value: string | null;
  /** One plain sentence on what the result means. */
  detail: string;
}

export interface DmarcCheck extends DnsRecordCheck {
  policy: "none" | "quarantine" | "reject" | null;
  /** Aggregate-report address, when one is published. */
  rua: string | null;
}

export interface DnsHealth {
  domain: string;
  checkedAt: string;
  spf: DnsRecordCheck;
  dkimGoogle: DnsRecordCheck;
  dkimResend: DnsRecordCheck;
  sendSpf: DnsRecordCheck;
  dmarc: DmarcCheck;
  /** True when every sender path is authenticated and DMARC is published. */
  allGood: boolean;
}

const CACHE_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; data: DnsHealth }>();

async function txt(host: string): Promise<string[]> {
  try {
    const rows = await resolveTxt(host);
    return rows.map((chunks) => chunks.join(""));
  } catch {
    // ENOTFOUND / ENODATA both mean "no such record" for our purposes.
    return [];
  }
}

function shorten(v: string | null, max = 90): string | null {
  if (!v) return null;
  return v.length > max ? `${v.slice(0, max)}…` : v;
}

export async function checkDomainDns(domain: string): Promise<DnsHealth> {
  const hit = cache.get(domain);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;

  const [root, google, resend, send, dmarcRows] = await Promise.all([
    txt(domain),
    txt(`google._domainkey.${domain}`),
    txt(`resend._domainkey.${domain}`),
    txt(`send.${domain}`),
    txt(`_dmarc.${domain}`),
  ]);

  const spfRec = root.find((r) => r.toLowerCase().startsWith("v=spf1")) ?? null;
  const spf: DnsRecordCheck = {
    label: "SPF (Google Workspace)",
    host: domain,
    ok: !!spfRec && /include:_spf\.google\.com/i.test(spfRec),
    value: shorten(spfRec),
    detail: spfRec
      ? /include:_spf\.google\.com/i.test(spfRec)
        ? "Google Workspace is authorized to send for the domain."
        : "An SPF record exists but it does not include Google Workspace."
      : "No SPF record. Receiving servers cannot confirm which servers may send for the domain.",
  };

  const gRec = google.find((r) => /v=DKIM1/i.test(r)) ?? null;
  const dkimGoogle: DnsRecordCheck = {
    label: "DKIM (Google Workspace)",
    host: `google._domainkey.${domain}`,
    ok: !!gRec,
    value: shorten(gRec, 60),
    detail: gRec
      ? "Replies sent from Gmail carry a valid signature."
      : "No Google DKIM key. Replies sent from Gmail are unsigned.",
  };

  const rRec = resend.find((r) => /p=/i.test(r)) ?? null;
  const dkimResend: DnsRecordCheck = {
    label: "DKIM (Resend)",
    host: `resend._domainkey.${domain}`,
    ok: !!rRec,
    value: shorten(rRec, 60),
    detail: rRec
      ? "Site auto-replies, lead notifications and quotes carry a valid signature."
      : "No Resend DKIM key. Site and CRM emails are unsigned.",
  };

  const sRec = send.find((r) => r.toLowerCase().startsWith("v=spf1")) ?? null;
  const sendSpf: DnsRecordCheck = {
    label: "SPF (Resend return path)",
    host: `send.${domain}`,
    ok: !!sRec && /amazonses\.com/i.test(sRec),
    value: shorten(sRec),
    detail: sRec
      ? "Bounces for site and CRM emails route back through Resend."
      : "No SPF on the Resend return-path subdomain.",
  };

  const dRec = dmarcRows.find((r) => /v=DMARC1/i.test(r)) ?? null;
  const policyMatch = dRec?.match(/\bp=(none|quarantine|reject)\b/i);
  const ruaMatch = dRec?.match(/\brua=mailto:([^;\s]+)/i);
  const policy = (policyMatch?.[1]?.toLowerCase() as DmarcCheck["policy"]) ?? null;
  const dmarc: DmarcCheck = {
    label: "DMARC",
    host: `_dmarc.${domain}`,
    ok: !!dRec,
    value: shorten(dRec, 120),
    policy,
    rua: ruaMatch?.[1] ?? null,
    detail: !dRec
      ? "No DMARC record. Google and Yahoo treat the domain as lower trust and send no reports."
      : policy === "none"
        ? "Published in monitor-only mode. Reports arrive, nothing is blocked. Move to quarantine once reports show every source passing."
        : policy === "quarantine"
          ? "Messages that fail authentication go to spam. Reports keep arriving."
          : "Messages that fail authentication are rejected outright.",
  };

  const data: DnsHealth = {
    domain,
    checkedAt: new Date().toISOString(),
    spf,
    dkimGoogle,
    dkimResend,
    sendSpf,
    dmarc,
    allGood: spf.ok && dkimGoogle.ok && dkimResend.ok && sendSpf.ok && dmarc.ok,
  };
  cache.set(domain, { at: Date.now(), data });
  return data;
}
