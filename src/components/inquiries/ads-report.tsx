"use client";

// Ads tab: what every paid platform (Meta, Google Ads, ChatGPT Ads) cost and
// what it produced in the CRM. Spend / impressions / clicks come from the
// synced ad_platform_daily rows; leads, bookings and lost reasons come from
// rental_inquiries, classified by the click id the website captured
// (fbclid = Meta, gclid = Google, oppref = ChatGPT). Platform-reported
// conversions are shown for comparison but the CRM numbers are the truth.

import { useMemo, useState } from "react";
import { RefreshCw, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { StagePill, GoogleAdBadge, MetaAdBadge, ChatGPTAdBadge } from "@/components/inquiries/atoms";
import {
  type Inquiry,
  fmtMoney,
  fmtDate,
  isBookedStatus,
  isOpenStatus,
} from "@/lib/inquiries/shared";
import type { AdDailyRow, AdSyncRun, LeadAttribution, UseAdPlatform } from "@/lib/inquiries/use-ad-platform";

type Platform = "meta" | "google" | "chatgpt";
const PLATFORMS: Platform[] = ["meta", "google", "chatgpt"];
const PLATFORM_LABEL: Record<Platform, string> = {
  meta: "Meta",
  google: "Google Ads",
  chatgpt: "ChatGPT Ads",
};
// Same hues as the source badges in atoms.tsx.
const PLATFORM_COLOR: Record<Platform, string> = {
  meta: "#4f46e5",
  google: "#2563eb",
  chatgpt: "#0d9488",
};

const PRESETS = [
  { key: "7d", label: "Last 7 days" },
  { key: "14d", label: "Last 14 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "this", label: "This month" },
  { key: "last", label: "Last month" },
  { key: "all", label: "All time" },
] as const;
type PresetKey = (typeof PRESETS)[number]["key"];

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function windowFor(preset: PresetKey): { since: string; until: string } {
  const now = new Date();
  const until = iso(now);
  if (preset === "all") return { since: "2026-01-01", until };
  if (preset === "this") return { since: iso(new Date(now.getFullYear(), now.getMonth(), 1)), until };
  if (preset === "last") {
    return {
      since: iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
      until: iso(new Date(now.getFullYear(), now.getMonth(), 0)),
    };
  }
  const days = preset === "7d" ? 7 : preset === "14d" ? 14 : 30;
  const s = new Date(now);
  s.setDate(s.getDate() - (days - 1));
  return { since: iso(s), until };
}

export function paidSource(i: Pick<Inquiry, "gclid" | "fbclid" | "oppref">): Platform | null {
  if (i.fbclid) return "meta";
  if (i.gclid) return "google";
  if (i.oppref) return "chatgpt";
  return null;
}

function isTestRow(i: Inquiry): boolean {
  return (i.lost_reason || "").startsWith("Test");
}

function isOutOfArea(i: Inquiry): boolean {
  return i.status === "lost" && /outside/i.test(i.lost_reason || "");
}

function isWon(i: Inquiry): boolean {
  return isBookedStatus(i.status) || i.status === "completed";
}

function norm(s: string | null | undefined): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function per(spend: number, n: number): string {
  return n > 0 && spend > 0 ? fmtMoney(spend / n) : "—";
}

function pct(n: number, d: number): string {
  return d > 0 ? `${((n / d) * 100).toFixed(2)}%` : "—";
}

function fmtInt(n: number): string {
  return n.toLocaleString("en-US");
}

/* ------------------------------------------------------------------ */

interface PlatformStats {
  platform: Platform;
  spend: number;
  impressions: number;
  clicks: number;
  platformConv: number;
  hasPlatformConv: boolean;
  leads: Inquiry[];
  usable: number;
  outOfArea: number;
  lost: number;
  open: number;
  booked: number;
  bookedValue: number;
  hasSpend: boolean;
}

function statsFor(platform: Platform, rows: AdDailyRow[], leads: Inquiry[]): PlatformStats {
  const mine = rows.filter((r) => r.platform === platform);
  const spend = mine.reduce((s, r) => s + Number(r.spend || 0), 0);
  const platformConv = mine.reduce((s, r) => s + Number(r.platform_conversions || 0), 0);
  const l = leads.filter((i) => paidSource(i) === platform);
  const outOfArea = l.filter(isOutOfArea).length;
  const lost = l.filter((i) => i.status === "lost").length;
  const bookedRows = l.filter(isWon);
  return {
    platform,
    spend,
    impressions: mine.reduce((s, r) => s + Number(r.impressions || 0), 0),
    clicks: mine.reduce((s, r) => s + Number(r.clicks || 0), 0),
    platformConv,
    hasPlatformConv: mine.some((r) => r.platform_conversions != null),
    leads: l,
    usable: l.length - outOfArea,
    outOfArea,
    lost,
    open: l.filter((i) => isOpenStatus(i.status)).length,
    booked: bookedRows.length,
    bookedValue: bookedRows.reduce((s, i) => s + (i.estimated_value || 0), 0),
    hasSpend: mine.length > 0,
  };
}

/* ------------------------------------------------------------------ */

function Stat({ label, value, foot }: { label: string; value: React.ReactNode; foot?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-mono text-lg font-semibold tabular-nums">{value}</div>
      {foot && <div className="text-xs text-muted-foreground">{foot}</div>}
    </div>
  );
}

function PlatformCard({ s, total }: { s: PlatformStats; total?: boolean }) {
  const color = total ? "var(--foreground)" : PLATFORM_COLOR[s.platform];
  const title = total ? "All paid" : PLATFORM_LABEL[s.platform];
  const inactive = !total && !s.hasSpend && s.leads.length === 0;
  return (
    <div className={`rounded-lg border bg-card p-4 ${inactive ? "opacity-60" : ""}`}>
      <div className="mb-3 flex items-center gap-2">
        <span className="size-2.5 rounded-full" style={{ background: color }} />
        <div className="font-semibold">{title}</div>
        {inactive && <span className="text-xs text-muted-foreground">no data in this window</span>}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        <Stat label="Spend" value={fmtMoney(s.spend)} foot={s.hasSpend ? `${fmtInt(s.clicks)} clicks` : "not synced"} />
        <Stat
          label="Leads"
          value={s.leads.length}
          foot={
            s.hasPlatformConv ? `platform counts ${fmtInt(Math.round(s.platformConv))}` : "from the CRM"
          }
        />
        <Stat label="Cost / lead" value={per(s.spend, s.leads.length)} />
        <Stat
          label="Usable leads"
          value={s.usable}
          foot={s.outOfArea ? `${s.outOfArea} out of area` : "none out of area"}
        />
        <Stat label="Cost / usable" value={per(s.spend, s.usable)} />
        <Stat label="Open" value={s.open} foot={`${s.lost} lost`} />
        <Stat label="Booked" value={s.booked} foot={s.booked ? fmtMoney(s.bookedValue) : undefined} />
        <Stat label="Cost / booking" value={per(s.spend, s.booked)} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

interface AdLine {
  key: string;
  platform: Platform;
  campaign_id: string;
  campaign_name: string;
  ad_id: string;
  ad_name: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  platformConv: number;
  leads: number;
  booked: number;
}

function buildAdTable(rows: AdDailyRow[], leads: Inquiry[], attribution: Map<string, LeadAttribution>) {
  const ads = new Map<string, AdLine>();
  for (const r of rows) {
    const key = `${r.platform}|${r.campaign_id}|${r.ad_id}`;
    const line = ads.get(key) ?? {
      key,
      platform: r.platform,
      campaign_id: r.campaign_id,
      campaign_name: r.campaign_name || "(unnamed campaign)",
      ad_id: r.ad_id,
      ad_name: r.ad_name,
      spend: 0,
      impressions: 0,
      clicks: 0,
      platformConv: 0,
      leads: 0,
      booked: 0,
    };
    line.spend += Number(r.spend || 0);
    line.impressions += Number(r.impressions || 0);
    line.clicks += Number(r.clicks || 0);
    line.platformConv += Number(r.platform_conversions || 0);
    ads.set(key, line);
  }

  // Tie a lead to an ad by utm_content (ad id, or a slug contained in the ad
  // name), else to a campaign by utm_campaign (campaign id or name slug).
  const unmatched: Record<Platform, number> = { meta: 0, google: 0, chatgpt: 0 };
  const lines = [...ads.values()];
  for (const lead of leads) {
    const p = paidSource(lead);
    if (!p) continue;
    const attr = attribution.get(lead.id);
    const content = norm(attr?.utm_content);
    const campaign = norm(attr?.utm_campaign);
    const mine = lines.filter((l) => l.platform === p);
    let hit: AdLine | undefined;
    if (content) {
      hit = mine.find((l) => l.ad_id && norm(l.ad_id) === content);
      if (!hit) {
        const cands = mine.filter((l) => l.ad_name && norm(l.ad_name).includes(content));
        if (cands.length === 1) hit = cands[0];
      }
    }
    if (!hit && campaign) {
      const cands = mine.filter(
        (l) => norm(l.campaign_id) === campaign || norm(l.campaign_name).includes(campaign)
      );
      // Campaign-level platforms (Google) have one line per campaign.
      if (cands.length === 1) hit = cands[0];
    }
    if (hit) {
      hit.leads += 1;
      if (isWon(lead)) hit.booked += 1;
    } else {
      unmatched[p] += 1;
    }
  }
  lines.sort((a, b) =>
    a.platform !== b.platform
      ? PLATFORMS.indexOf(a.platform) - PLATFORMS.indexOf(b.platform)
      : a.campaign_name !== b.campaign_name
        ? a.campaign_name.localeCompare(b.campaign_name)
        : b.spend - a.spend
  );
  return { lines, unmatched };
}

/* ------------------------------------------------------------------ */

function RunLine({ platform, run }: { platform: Platform; run: AdSyncRun | undefined }) {
  return (
    <div className="flex items-start gap-2 text-xs">
      {!run ? (
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
      ) : run.ok ? (
        <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600" />
      ) : (
        <XCircle className="mt-0.5 size-3.5 shrink-0 text-red-600" />
      )}
      <div className="min-w-0">
        <span className="font-medium">{PLATFORM_LABEL[platform]}</span>{" "}
        {!run ? (
          <span className="text-muted-foreground">never synced</span>
        ) : run.ok ? (
          <span className="text-muted-foreground">
            {run.rows_upserted} rows, {run.since} to {run.until}, synced{" "}
            {new Date(run.finished_at || run.started_at).toLocaleString("en-US", {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </span>
        ) : (
          <span className="break-words text-red-700">{run.error}</span>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

export function AdsReport({ inquiries, ads }: { inquiries: Inquiry[]; ads: UseAdPlatform }) {
  const [preset, setPreset] = useState<PresetKey>("30d");
  const { since, until } = useMemo(() => windowFor(preset), [preset]);

  const rows = useMemo(() => ads.rows.filter((r) => r.date >= since && r.date <= until), [ads.rows, since, until]);
  const leads = useMemo(
    () =>
      inquiries.filter(
        (i) =>
          paidSource(i) !== null &&
          !isTestRow(i) &&
          i.created_at.slice(0, 10) >= since &&
          i.created_at.slice(0, 10) <= until
      ),
    [inquiries, since, until]
  );
  const attribution = useMemo(() => new Map(ads.attribution.map((a) => [a.id, a])), [ads.attribution]);

  const stats = useMemo(() => PLATFORMS.map((p) => statsFor(p, rows, leads)), [rows, leads]);
  const total = useMemo<PlatformStats>(() => {
    const bookedRows = leads.filter(isWon);
    const outOfArea = leads.filter(isOutOfArea).length;
    return {
      platform: "meta",
      spend: stats.reduce((s, x) => s + x.spend, 0),
      impressions: stats.reduce((s, x) => s + x.impressions, 0),
      clicks: stats.reduce((s, x) => s + x.clicks, 0),
      platformConv: stats.reduce((s, x) => s + x.platformConv, 0),
      hasPlatformConv: stats.some((x) => x.hasPlatformConv),
      leads,
      usable: leads.length - outOfArea,
      outOfArea,
      lost: leads.filter((i) => i.status === "lost").length,
      open: leads.filter((i) => isOpenStatus(i.status)).length,
      booked: bookedRows.length,
      bookedValue: bookedRows.reduce((s, i) => s + (i.estimated_value || 0), 0),
      hasSpend: rows.length > 0,
    };
  }, [stats, leads, rows]);

  const daily = useMemo(() => {
    const days: Record<string, { date: string; meta: number; google: number; chatgpt: number; leads: number }> = {};
    const ensure = (d: string) => (days[d] ??= { date: d, meta: 0, google: 0, chatgpt: 0, leads: 0 });
    for (const r of rows) ensure(r.date)[r.platform] += Number(r.spend || 0);
    for (const l of leads) ensure(l.created_at.slice(0, 10)).leads += 1;
    return Object.values(days).sort((a, b) => a.date.localeCompare(b.date));
  }, [rows, leads]);

  const { lines, unmatched } = useMemo(() => buildAdTable(rows, leads, attribution), [rows, leads, attribution]);
  const hasUtm = ads.attribution.some((a) => a.utm_content || a.utm_campaign);

  const lastRun = (p: Platform) => ads.runs.find((r) => r.platform === p);
  const recentLeads = useMemo(
    () => [...leads].sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [leads]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setPreset(p.key)}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                preset === p.key
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="text-xs text-muted-foreground">
          {since} to {until}
        </div>
        {ads.canSync && (
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="outline" disabled={ads.syncing} onClick={() => ads.syncNow()}>
              <RefreshCw className={`size-3.5 ${ads.syncing ? "animate-spin" : ""}`} />
              {ads.syncing ? "Syncing" : "Sync last 7 days"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={ads.syncing}
              onClick={() => ads.syncNow({ since: "2026-08-01" })}
              title="Re-pull every day since Aug 1, 2026 from all platforms"
            >
              Backfill since Aug 1
            </Button>
          </div>
        )}
      </div>

      {ads.unavailable && (
        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div>{ads.unavailable}</div>
        </div>
      )}

      <PlatformCard s={total} total />
      <div className="grid gap-4 lg:grid-cols-3">
        {stats.map((s) => (
          <PlatformCard key={s.platform} s={s} />
        ))}
      </div>

      <section className="rounded-lg border bg-card p-4">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="font-semibold">Spend by day and leads received</h2>
          <div className="text-xs text-muted-foreground">bars = spend by platform, line = paid leads in the CRM</div>
        </div>
        {daily.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">No spend or paid leads in this window.</div>
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={daily} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis
                  dataKey="date"
                  tickFormatter={(d: string) => d.slice(5)}
                  tick={{ fontSize: 11 }}
                  stroke="var(--muted-foreground)"
                />
                <YAxis
                  yAxisId="spend"
                  tick={{ fontSize: 11 }}
                  stroke="var(--muted-foreground)"
                  tickFormatter={(v: number) => `$${v}`}
                  width={48}
                />
                <YAxis
                  yAxisId="leads"
                  orientation="right"
                  allowDecimals={false}
                  tick={{ fontSize: 11 }}
                  stroke="var(--muted-foreground)"
                  width={28}
                />
                <Tooltip
                  formatter={(value, name) =>
                    name === "Leads" ? [value as number, name] : [fmtMoney(value as number), name]
                  }
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar yAxisId="spend" dataKey="meta" name="Meta" stackId="spend" fill={PLATFORM_COLOR.meta} />
                <Bar yAxisId="spend" dataKey="google" name="Google Ads" stackId="spend" fill={PLATFORM_COLOR.google} />
                <Bar yAxisId="spend" dataKey="chatgpt" name="ChatGPT Ads" stackId="spend" fill={PLATFORM_COLOR.chatgpt} />
                <Line
                  yAxisId="leads"
                  type="monotone"
                  dataKey="leads"
                  name="Leads"
                  stroke="var(--foreground)"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <section className="rounded-lg border bg-card">
        <div className="flex flex-wrap items-baseline justify-between gap-2 p-4 pb-2">
          <h2 className="font-semibold">Campaigns and ads</h2>
          <div className="text-xs text-muted-foreground">
            {hasUtm
              ? "Leads are tied to an ad by the utm_content the website captured."
              : "Leads show per platform only until the website forwards utm_campaign / utm_content."}
          </div>
        </div>
        {lines.length === 0 ? (
          <div className="px-4 pb-6 text-sm text-muted-foreground">No synced ad rows in this window.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-t">
                  <th className="px-4 py-2 text-left font-medium">Ad</th>
                  <th className="px-2 py-2 text-right font-medium">Spend</th>
                  <th className="px-2 py-2 text-right font-medium">Impr.</th>
                  <th className="px-2 py-2 text-right font-medium">Clicks</th>
                  <th className="px-2 py-2 text-right font-medium">CTR</th>
                  <th className="px-2 py-2 text-right font-medium">CPC</th>
                  <th className="px-2 py-2 text-right font-medium" title="What the platform reports">Platform conv.</th>
                  <th className="px-2 py-2 text-right font-medium" title="Leads in the CRM tied to this ad">CRM leads</th>
                  <th className="px-2 py-2 text-right font-medium">Cost / lead</th>
                  <th className="px-4 py-2 text-right font-medium">Booked</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, idx) => {
                  const newCampaign =
                    idx === 0 ||
                    lines[idx - 1].platform !== l.platform ||
                    lines[idx - 1].campaign_id !== l.campaign_id;
                  return (
                    <tr key={l.key} className="border-t">
                      <td className="px-4 py-2">
                        {newCampaign && (
                          <div className="mb-0.5 flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                            <span className="size-1.5 rounded-full" style={{ background: PLATFORM_COLOR[l.platform] }} />
                            {PLATFORM_LABEL[l.platform]} · {l.campaign_name}
                          </div>
                        )}
                        <div className="pl-3">{l.ad_name || (l.ad_id ? `Ad ${l.ad_id}` : "Campaign total")}</div>
                      </td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums">{fmtMoney(l.spend)}</td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums">{fmtInt(l.impressions)}</td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums">{fmtInt(l.clicks)}</td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums">{pct(l.clicks, l.impressions)}</td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums">{per(l.spend, l.clicks)}</td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums">{fmtInt(Math.round(l.platformConv))}</td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums">{hasUtm ? l.leads : "—"}</td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums">{hasUtm ? per(l.spend, l.leads) : "—"}</td>
                      <td className="px-4 py-2 text-right font-mono tabular-nums">{hasUtm ? l.booked : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {hasUtm && (unmatched.meta || unmatched.google || unmatched.chatgpt) ? (
              <div className="px-4 py-2 text-xs text-muted-foreground">
                Not tied to an ad:{" "}
                {PLATFORMS.filter((p) => unmatched[p])
                  .map((p) => `${PLATFORM_LABEL[p]} ${unmatched[p]}`)
                  .join(", ")}
                . These leads carried no usable utm_content.
              </div>
            ) : null}
          </div>
        )}
      </section>

      <section className="rounded-lg border bg-card">
        <div className="p-4 pb-2">
          <h2 className="font-semibold">Paid leads in this window</h2>
        </div>
        {recentLeads.length === 0 ? (
          <div className="px-4 pb-6 text-sm text-muted-foreground">No paid leads in this window.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-t">
                  <th className="px-4 py-2 text-left font-medium">Received</th>
                  <th className="px-2 py-2 text-left font-medium">Ref</th>
                  <th className="px-2 py-2 text-left font-medium">Source</th>
                  <th className="px-2 py-2 text-left font-medium">Use case</th>
                  <th className="px-2 py-2 text-left font-medium">Event</th>
                  <th className="px-2 py-2 text-left font-medium">Stage</th>
                  <th className="px-2 py-2 text-right font-medium">Est. value</th>
                  <th className="px-4 py-2 text-left font-medium">Note</th>
                </tr>
              </thead>
              <tbody>
                {recentLeads.map((i) => {
                  const attr = attribution.get(i.id);
                  return (
                    <tr key={i.id} className="border-t">
                      <td className="px-4 py-2 whitespace-nowrap">{fmtDate(i.created_at)}</td>
                      <td className="px-2 py-2 font-mono text-xs">{i.reference}</td>
                      <td className="px-2 py-2">
                        <MetaAdBadge fbclid={i.fbclid} />
                        <GoogleAdBadge gclid={i.fbclid ? null : i.gclid} />
                        <ChatGPTAdBadge oppref={i.fbclid || i.gclid ? null : i.oppref} />
                      </td>
                      <td className="px-2 py-2">{i.use_case || "—"}</td>
                      <td className="px-2 py-2 whitespace-nowrap">{i.start_date ? fmtDate(i.start_date) : "—"}</td>
                      <td className="px-2 py-2">
                        <StagePill status={i.status} />
                      </td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums">
                        {i.estimated_value ? fmtMoney(i.estimated_value) : "—"}
                      </td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">
                        {isOutOfArea(i)
                          ? "Out of area"
                          : i.status === "lost"
                            ? i.lost_reason || "Lost"
                            : attr?.utm_content || ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-lg border bg-card p-4">
        <h2 className="mb-2 font-semibold">Data sources</h2>
        <div className="space-y-1.5">
          {PLATFORMS.map((p) => (
            <RunLine key={p} platform={p} run={lastRun(p)} />
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Spend syncs every morning at 4:30 AM Pacific and re-pulls the last 7 days. Leads, stages and
          values come straight from the pipeline. A lead counts for a platform when the website captured
          that platform&apos;s click id.
        </p>
      </section>
    </div>
  );
}
