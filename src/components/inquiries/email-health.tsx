"use client";

// Email deliverability panel on the Ads tab: are the emails HDR sends
// authenticated, accepted, and read. Four cards plus a short action list,
// all fed by /api/inquiries/email-health (see lib/email-health/report.ts).

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, CheckCircle2, RefreshCw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useEmailHealth } from "@/lib/inquiries/use-email-health";
import type { DnsRecordCheck } from "@/lib/email-health/dns";
import type { EmailHealthReport } from "@/lib/email-health/report";
import type { PostmasterDay, Reputation } from "@/lib/email-health/postmaster";

function pct(n: number | null | undefined, digits = 0): string {
  if (n == null) return "–";
  return `${(n * 100).toFixed(digits)}%`;
}

function fmtDay(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function Stat({ label, value, foot, tone }: { label: string; value: React.ReactNode; foot?: React.ReactNode; tone?: "good" | "warn" | "bad" }) {
  const color = tone === "good" ? "text-emerald-700" : tone === "warn" ? "text-amber-700" : tone === "bad" ? "text-red-700" : "";
  return (
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-0.5 font-mono text-lg font-semibold tabular-nums ${color}`}>{value}</div>
      {foot && <div className="text-xs text-muted-foreground">{foot}</div>}
    </div>
  );
}

function StatusIcon({ ok, warn }: { ok: boolean; warn?: boolean }) {
  if (ok && !warn) return <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />;
  if (ok && warn) return <AlertTriangle className="size-4 shrink-0 text-amber-600" />;
  return <XCircle className="size-4 shrink-0 text-red-600" />;
}

function DnsRow({ c, warn }: { c: DnsRecordCheck; warn?: boolean }) {
  return (
    <li className="flex items-start gap-2 py-1.5">
      <StatusIcon ok={c.ok} warn={warn} />
      <div className="min-w-0">
        <div className="text-sm font-medium">{c.label}</div>
        <div className="text-xs text-muted-foreground">{c.detail}</div>
      </div>
    </li>
  );
}

const REP_LABEL: Record<Reputation, string> = {
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
  BAD: "Bad",
  REPUTATION_CATEGORY_UNSPECIFIED: "Not enough mail",
};

function repTone(r: Reputation | null): "good" | "warn" | "bad" | undefined {
  if (r === "HIGH") return "good";
  if (r === "MEDIUM") return "warn";
  if (r === "LOW" || r === "BAD") return "bad";
  return undefined;
}

function spamTone(ratio: number | null): "good" | "warn" | "bad" | undefined {
  if (ratio == null) return undefined;
  if (ratio < 0.001) return "good";
  if (ratio < 0.003) return "warn";
  return "bad";
}

function PostmasterCard({
  report,
  entityId,
  canConnect,
}: {
  report: EmailHealthReport;
  entityId: string;
  canConnect: boolean;
}) {
  const pm = report.postmaster;
  const connectHref = `/api/ads/postmaster-oauth/start?entityId=${encodeURIComponent(entityId)}`;
  const domain = report.domain ?? "";

  if (!pm || !pm.connected) {
    return (
      <div className="rounded-lg border bg-card p-4">
        <div className="text-sm font-semibold">Gmail&rsquo;s verdict (Postmaster Tools)</div>
        <p className="mt-1 text-xs text-muted-foreground">
          Google reports how much of {domain}&rsquo;s mail Gmail users mark as spam and how it rates the domain. Nothing else
          measures that. Connect it with the Google account that owns {domain} in postmaster.google.com.
        </p>
        <div className="mt-3">
          {canConnect ? (
            <Button asChild size="sm">
              <a href={connectHref}>Connect Postmaster Tools</a>
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">Connect it from the Closebook app, not the embedded view.</span>
          )}
        </div>
      </div>
    );
  }

  const latest: PostmasterDay | null = pm.latest;
  const withData = pm.days.filter((d) => d.spamRatio != null || d.domainReputation);
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold">Gmail&rsquo;s verdict (Postmaster Tools)</div>
        {canConnect && (
          <a href={connectHref} className="text-xs text-muted-foreground underline-offset-2 hover:underline">
            Reconnect
          </a>
        )}
      </div>
      {pm.error ? (
        <p className="mt-2 text-sm text-red-700">{pm.error}</p>
      ) : !latest ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Connected. Google has not published numbers yet. It reports only for days with enough mail to @gmail.com
          addresses, so a low-volume domain can show nothing for weeks. Compliance is still checked daily at
          postmaster.google.com.
        </p>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat
              label="Marked as spam"
              value={pct(latest.spamRatio, 2)}
              foot={`Google's limit is 0.30%. ${fmtDay(latest.date)}.`}
              tone={spamTone(latest.spamRatio)}
            />
            <Stat
              label="Domain reputation"
              value={latest.domainReputation ? REP_LABEL[latest.domainReputation] : "–"}
              foot="High means inbox by default."
              tone={repTone(latest.domainReputation)}
            />
            <Stat
              label="Passing DMARC"
              value={pct(latest.dmarcSuccessRatio)}
              foot={`SPF ${pct(latest.spfSuccessRatio)}, DKIM ${pct(latest.dkimSuccessRatio)}`}
              tone={latest.dmarcSuccessRatio == null ? undefined : latest.dmarcSuccessRatio >= 0.98 ? "good" : "warn"}
            />
            <Stat label="Days with data" value={withData.length} foot="Out of the last 30." />
          </div>
          {latest.deliveryErrors.length > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              Delivery errors on {fmtDay(latest.date)}:{" "}
              {latest.deliveryErrors.map((e) => `${e.errorType.toLowerCase().replace(/_/g, " ")} ${pct(e.errorRatio, 1)}`).join(", ")}.
            </p>
          )}
        </>
      )}
    </div>
  );
}

export function EmailHealth({ entityId }: { entityId: string }) {
  const { report, loading, error, reload, canConnect } = useEmailHealth(entityId);
  const search = useSearchParams();

  // Result of the Postmaster connect round-trip.
  useEffect(() => {
    const flag = search.get("postmaster");
    if (!flag) return;
    if (flag === "connected") toast.success("Postmaster Tools connected.");
    else toast.error(`Postmaster Tools not connected: ${search.get("detail") || flag}`);
  }, [search]);

  if (!loading && report && !report.supported) return null;

  return (
    <section id="email-health" className="rounded-lg border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <div>
          <h2 className="text-base font-semibold">Email deliverability</h2>
          <p className="text-xs text-muted-foreground">
            Whether the emails sent as {report?.domain ?? "the sending domain"} are authenticated, accepted, and read.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => reload()} disabled={loading}>
          <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {loading && !report ? (
        <div className="py-10 text-center text-sm text-muted-foreground">Checking DNS, Resend and the CRM…</div>
      ) : error && !report ? (
        <div className="p-4 text-sm text-red-700">{error}</div>
      ) : report ? (
        <div className="space-y-4 p-4">
          {/* What to do */}
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/30">
            <div className="text-sm font-semibold">What needs attention</div>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
              {report.actions.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ol>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Authentication */}
            {report.dns && (
              <div className="rounded-lg border bg-card p-4">
                <div className="flex items-center gap-2">
                  <StatusIcon ok={report.dns.allGood} warn={report.dns.dmarc.policy === "none"} />
                  <div className="text-sm font-semibold">Authentication ({report.dns.domain})</div>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Live DNS. These records are what Gmail and Yahoo check before anything else.
                </p>
                <ul className="mt-2 divide-y">
                  <DnsRow c={report.dns.spf} />
                  <DnsRow c={report.dns.dkimGoogle} />
                  <DnsRow c={report.dns.dkimResend} />
                  <DnsRow c={report.dns.sendSpf} />
                  <DnsRow c={report.dns.dmarc} warn={report.dns.dmarc.policy === "none"} />
                </ul>
              </div>
            )}

            <PostmasterCard report={report} entityId={entityId} canConnect={canConnect} />

            {/* Delivery */}
            {report.delivery && (
              <div className="rounded-lg border bg-card p-4">
                <div className="text-sm font-semibold">Accepted by the receiving server (last {report.delivery.windowDays} days)</div>
                <p className="mt-1 text-xs text-muted-foreground">
                  From Resend&rsquo;s delivery events. Accepted means the customer&rsquo;s mail server took the message. It says
                  nothing about inbox versus spam folder.
                </p>
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Stat label="Sent" value={report.delivery.totals.total} />
                  <Stat
                    label="Accepted"
                    value={report.delivery.totals.total ? pct(report.delivery.totals.delivered / report.delivery.totals.total) : "–"}
                    tone={
                      report.delivery.totals.total === 0
                        ? undefined
                        : report.delivery.totals.delivered / report.delivery.totals.total >= 0.97
                          ? "good"
                          : "warn"
                    }
                  />
                  <Stat label="Bounced" value={report.delivery.totals.bounced} tone={report.delivery.totals.bounced ? "warn" : "good"} />
                  <Stat
                    label="Reported as spam"
                    value={report.delivery.totals.complained}
                    tone={report.delivery.totals.complained ? "bad" : "good"}
                  />
                </div>
                {report.delivery.kinds.length > 0 && (
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="text-left text-muted-foreground">
                        <tr>
                          <th className="py-1 font-normal">Email</th>
                          <th className="py-1 text-right font-normal">Sent</th>
                          <th className="py-1 text-right font-normal">Accepted</th>
                          <th className="py-1 text-right font-normal">Bounced</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.delivery.kinds.map((k) => (
                          <tr key={k.kind} className="border-t">
                            <td className="py-1">{k.label}</td>
                            <td className="py-1 text-right tabular-nums">{k.total}</td>
                            <td className="py-1 text-right tabular-nums">{k.delivered}</td>
                            <td className="py-1 text-right tabular-nums">{k.bounced}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {report.resend && report.resend.available && (
                  <div className="mt-3 text-xs text-muted-foreground">
                    Resend&rsquo;s last {report.resend.sampled} sends: {report.resend.delivered} accepted, {report.resend.suppressed}{" "}
                    suppressed, {report.resend.bounced} bounced.
                    {report.resend.problems.length > 0 && (
                      <ul className="mt-1 space-y-0.5">
                        {report.resend.problems.slice(0, 6).map((p, i) => (
                          <li key={i}>
                            {fmtDay(p.createdAt)}: {p.lastEvent} for {p.to}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Engagement */}
            {report.engagement && (
              <div className="rounded-lg border bg-card p-4">
                <div className="text-sm font-semibold">Did they write back? (last {report.engagement.windowDays} days)</div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Inquiries we emailed a quote or reply, and whether the customer answered afterwards. When business
                  addresses reply far more often than Gmail or Yahoo, the consumer inboxes are filtering us.
                </p>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <Stat label="Emailed" value={report.engagement.totalEmailed} />
                  <Stat
                    label="Wrote back"
                    value={report.engagement.totalEmailed ? pct(report.engagement.totalReplied / report.engagement.totalEmailed) : "–"}
                  />
                </div>
                <table className="mt-3 w-full text-xs">
                  <thead className="text-left text-muted-foreground">
                    <tr>
                      <th className="py-1 font-normal">Customer&rsquo;s provider</th>
                      <th className="py-1 text-right font-normal">Emailed</th>
                      <th className="py-1 text-right font-normal">Wrote back</th>
                      <th className="py-1 text-right font-normal">Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.engagement.rows.map((r) => (
                      <tr key={r.group} className="border-t">
                        <td className="py-1">{r.group}</td>
                        <td className="py-1 text-right tabular-nums">{r.emailed}</td>
                        <td className="py-1 text-right tabular-nums">{r.replied}</td>
                        <td className="py-1 text-right tabular-nums">{r.emailed < 5 ? "n/a" : pct(r.rate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <p className="text-[11px] text-muted-foreground">
            Checked {new Date(report.generatedAt).toLocaleString()}. DNS is cached for ten minutes.
          </p>
        </div>
      ) : null}
    </section>
  );
}
