/**
 * Member portal emails, sent through Resend from the Versatile domain:
 * sign-in link, welcome invite and monthly statement. Markup is inline-styled
 * tables so it renders the same in Gmail, Outlook and phone mail apps.
 */

import { Resend } from "resend";

const FROM = () => process.env.REWARDS_EMAIL_FROM ?? "Versatile Rewards <rentals@versatilestudios.com>";
const REPLY_TO = "rentals@versatilestudios.com";
const ADDRESS = "Versatile Studios · 1000 N Cahuenga Blvd, Los Angeles, CA 90038 · 213.935.8124";

function client(): Resend | null {
  // Strip anything that isn't plain ASCII (a pasted BOM breaks the header).
  const key = (process.env.RESEND_API_KEY ?? "").replace(/[^\x21-\x7e]/g, "");
  return key ? new Resend(key) : null;
}

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const FONT = "Arial, Helvetica, sans-serif";

function shell(assetBase: string, body: string, footerExtra = ""): string {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f2f2f2">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f2f2"><tr><td align="center" style="padding:16px 8px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:8px;overflow:hidden;font-family:${FONT};color:#121212">
<tr><td style="background:#000000;padding:18px 24px"><img src="${assetBase}/rewards-portal-assets/vs-wordmark-white.png" alt="Versatile Studios" height="18" style="display:block;height:18px;border:0"></td></tr>
<tr><td style="padding:22px 24px">${body}</td></tr>
<tr><td style="padding:14px 24px;border-top:1px solid #e4e4e4;font-size:12px;line-height:1.5;color:#6b6b6b">${ADDRESS}${footerExtra}</td></tr>
</table></td></tr></table></body></html>`;
}

function rows(pairs: [string, string][]): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:15px">${pairs
    .map(
      ([k, v], i) =>
        `<tr><td style="padding:8px 0;color:#6b6b6b;${i < pairs.length - 1 ? "border-bottom:1px solid #e4e4e4;" : ""}">${esc(k)}</td><td align="right" style="padding:8px 0;${i < pairs.length - 1 ? "border-bottom:1px solid #e4e4e4;" : ""}">${esc(v)}</td></tr>`,
    )
    .join("")}</table>`;
}

function button(url: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:18px"><tr><td style="background:#d2232a;border-radius:999px"><a href="${esc(url)}" style="display:inline-block;padding:13px 28px;color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px;font-family:${FONT}">${esc(label)}</a></td></tr></table>`;
}

const label = (s: string) => `<div style="font-size:13px;font-weight:bold;color:#d2232a;margin:18px 0 4px">${esc(s)}</div>`;

export interface SendResult {
  ok: boolean;
  error?: string;
}

async function send(to: string, subject: string, html: string, text: string): Promise<SendResult> {
  const resend = client();
  if (!resend) return { ok: false, error: "RESEND_API_KEY is not configured" };
  const { error } = await resend.emails.send({ from: FROM(), to, subject, html, text, replyTo: REPLY_TO });
  return error ? { ok: false, error: error.message } : { ok: true };
}

// ── Sign-in link ──────────────────────────────────────────────────────────

export async function sendSignInEmail(input: {
  to: string;
  links: { memberName: string; url: string }[];
  assetBase: string;
  minutes: number;
}): Promise<SendResult> {
  const many = input.links.length > 1;
  const body =
    `<div style="font-size:22px;font-weight:bold;margin-bottom:12px">Versatile Rewards Sign In</div>` +
    rows([["Link Valid For", `${input.minutes} Minutes`], ["Works", "Once"]]) +
    input.links.map((l) => button(l.url, many ? `Sign In: ${l.memberName}` : "Sign In")).join("") +
    `<div style="font-size:13px;color:#6b6b6b;margin-top:18px">Not You? Ignore This Email. No Changes Were Made.</div>`;
  const text = [
    "Versatile Rewards Sign In",
    `Link valid for ${input.minutes} minutes, works once.`,
    ...input.links.map((l) => `${many ? l.memberName + ": " : ""}${l.url}`),
  ].join("\n");
  return send(input.to, "Your Versatile Rewards Sign-In Link", shell(input.assetBase, body), text);
}

// ── Welcome invite ──────────────────────────────────────────────────────────

export async function sendInviteEmail(input: {
  to: string;
  memberName: string;
  memberNumber: string;
  tierName: string;
  rate: string;
  programStart: string;
  signInUrl: string;
  assetBase: string;
}): Promise<SendResult> {
  const body =
    `<div style="font-size:22px;font-weight:bold;margin-bottom:12px">${esc(input.memberName)}</div>` +
    rows([
      ["Member Number", input.memberNumber],
      ["Tier", input.tierName],
      ["Earn Rate", input.rate],
      ["Points Start", input.programStart],
    ]) +
    label("How It Works") +
    `<ul style="margin:0;padding-left:18px;font-size:14px;line-height:1.7;color:#333333">
<li>Points on Rental Spend, After Discounts, Before Tax</li>
<li>Tier Based on Calendar-Year Spend</li>
<li>Points Spendable Once an Invoice Is Paid</li>
<li>Points Expire 12 Months After the Invoice Date</li></ul>` +
    button(input.signInUrl, "View My Points");
  const text = [
    "Your Versatile Rewards Account Is Active",
    input.memberName,
    `Member Number: ${input.memberNumber}`,
    `Tier: ${input.tierName}`,
    `Earn Rate: ${input.rate}`,
    `Points Start: ${input.programStart}`,
    `View your points: ${input.signInUrl}`,
  ].join("\n");
  return send(input.to, "Your Versatile Rewards Account Is Active", shell(input.assetBase, body), text);
}

// ── Monthly statement ───────────────────────────────────────────────────────

export interface StatementInput {
  to: string;
  memberName: string;
  monthLabel: string; // "March 2027"
  asOfLabel: string; // "Mar 31, 2027"
  pointsToSpend: string;
  earnedInMonth: string;
  pending: string;
  tierName: string;
  nextTier: { name: string; spendToGo: string } | null;
  invoices: { number: string; date: string; points: string; paid: boolean }[];
  expiringSoon: string; // "None" or "7,500"
  url: string;
  accountUrl: string;
  assetBase: string;
}

export async function sendStatementEmail(input: StatementInput): Promise<SendResult> {
  const grid = (cells: [string, string][]) =>
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${cells
      .map(
        ([k, v]) =>
          `<td width="50%" style="padding:4px"><div style="background:#f6f6f6;border-radius:6px;padding:10px 12px"><div style="font-size:12px;color:#6b6b6b">${esc(k)}</div><div style="font-size:18px;font-weight:bold">${esc(v)}</div></div></td>`,
      )
      .join("")}</tr></table>`;
  const invoiceRows = input.invoices.length
    ? rows(input.invoices.map((i) => [`${i.number} · ${i.date}`, `${i.points} · ${i.paid ? "Paid" : "Pending"}`]))
    : `<div style="font-size:14px;color:#6b6b6b">No Invoices This Month</div>`;
  const body =
    label("Points to Spend").replace("margin:18px 0 4px", "margin:0 0 2px") +
    `<div style="font-size:40px;font-weight:bold;line-height:1.1">${esc(input.pointsToSpend)}</div>` +
    `<div style="font-size:13px;color:#6b6b6b;margin-bottom:12px">As of ${esc(input.asOfLabel)} · ${esc(input.memberName)}</div>` +
    grid([["Earned in " + input.monthLabel.split(" ")[0], input.earnedInMonth], ["Pending Payment", input.pending]]) +
    grid([["Tier", input.tierName], input.nextTier ? [`To ${input.nextTier.name}`, input.nextTier.spendToGo] : ["Next Tier", "Top Tier"]]) +
    label(`${input.monthLabel.split(" ")[0]} Invoices`) +
    invoiceRows +
    rows([["Expiring in Next 60 Days", input.expiringSoon]]) +
    button(input.url, "View My Points");
  const text = [
    `Your ${input.monthLabel} Rewards Statement`,
    `${input.memberName}`,
    `Points to Spend: ${input.pointsToSpend} (as of ${input.asOfLabel})`,
    `Earned This Month: ${input.earnedInMonth}`,
    `Pending Payment: ${input.pending}`,
    `Tier: ${input.tierName}`,
    input.nextTier ? `To ${input.nextTier.name}: ${input.nextTier.spendToGo}` : "",
    `Expiring in Next 60 Days: ${input.expiringSoon}`,
    `View your points: ${input.url}`,
    `Statement emails can be turned off on the Account page: ${input.accountUrl}`,
  ]
    .filter(Boolean)
    .join("\n");
  const footer = ` · <a href="${esc(input.accountUrl)}" style="color:#6b6b6b">Turn Off Statement Emails</a>`;
  return send(input.to, `Your ${input.monthLabel} Rewards Statement`, shell(input.assetBase, body, footer), text);
}
