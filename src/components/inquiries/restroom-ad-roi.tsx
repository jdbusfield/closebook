"use client";

// Restroom ad ROI (Ads tab, session only). Two parts:
// 1. Month by month: restroom ad spend (QuickBooks lines tagged Restroom
//    Trailer Ads, times their share) next to ad-platform spend, the paid leads
//    and bookings the CRM credits to ads, and all restroom revenue in QBO.
// 2. Every advertising line in every QuickBooks company the user can see,
//    with a tag picker, so restroom spend can be split out of shared accounts.

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { type Inquiry, fmtMoney, isBookedStatus } from "@/lib/inquiries/shared";
import { lastTouch } from "@/lib/inquiries/paid-touch";
import {
  AD_EXPENSE_TAGS,
  AD_EXPENSE_TAG_LABEL,
  type AdExpenseTag,
  type AdExpenseTagRow,
  type QboAdExpenseLine,
  restroomAmount,
  tagKey,
} from "@/lib/ads/qbo-ad-expenses";

interface Payload {
  from: string;
  to: string;
  lines: QboAdExpenseLine[];
  scanned: { entityId: string; name: string; ok: boolean; error?: string; lines: number }[];
  tags: AdExpenseTagRow[];
  tagsReady: boolean;
  platformSpend: Record<string, Record<string, number>>;
  manualSpend: Record<string, number>;
  restroomRevenue: Record<string, number>;
}

type Basis = "qbo" | "platform";

function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.slice(0, 7).split("-").map(Number);
  const end = to.slice(0, 7);
  for (;;) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    if (key > end) break;
    out.push(key);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

function monthLabel(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  return new Date(y, mo - 1, 1).toLocaleString("en-US", { month: "short", year: "numeric" });
}

function whole(n: number): string {
  return n ? fmtMoney(Math.round(n)) : "—";
}

function roas(value: number, spend: number): string {
  return spend > 0 ? `${(value / spend).toFixed(2)}x` : "—";
}

export function RestroomAdRoi({ entityId, inquiries }: { entityId: string; inquiries: Inquiry[] }) {
  const [year, setYear] = useState(new Date().getFullYear());
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [basis, setBasis] = useState<Basis>("qbo");
  const [monthFilter, setMonthFilter] = useState("all");
  const [tagFilter, setTagFilter] = useState<"all" | "untagged" | AdExpenseTag>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const to = year === new Date().getFullYear() ? today : `${year}-12-31`;
      const res = await fetch(`/api/ads/qbo-expenses?entityId=${entityId}&from=${year}-01-01&to=${to}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setData(json as Payload);
      setSelected(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [entityId, year]);

  useEffect(() => {
    load();
  }, [load]);

  const tagMap = useMemo(() => new Map((data?.tags ?? []).map((t) => [tagKey(t), t])), [data]);

  const saveTags = useCallback(
    async (lines: QboAdExpenseLine[], tag: AdExpenseTag | null, restroomShare?: number) => {
      const res = await fetch("/api/ads/qbo-expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tags: lines.map((l) => ({
            entityId: l.entityId,
            txnType: l.txnType,
            txnId: l.txnId,
            lineId: l.lineId,
            tag,
            restroomShare: restroomShare ?? tagMap.get(tagKey(l))?.restroom_share ?? 1,
            note: tagMap.get(tagKey(l))?.note ?? null,
          })),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error || "Couldn't save the tag");
        return;
      }
      // Patch local state so the tables update without re-pulling QuickBooks.
      setData((d) => {
        if (!d) return d;
        const keys = new Set(lines.map(tagKey));
        const kept = d.tags.filter((t) => !keys.has(tagKey(t)));
        const added: AdExpenseTagRow[] =
          tag === null
            ? []
            : lines.map((l) => ({
                entity_id: l.entityId,
                txn_type: l.txnType,
                txn_id: l.txnId,
                line_id: l.lineId,
                tag,
                restroom_share: tag === "restroom_ads" ? restroomShare ?? tagMap.get(tagKey(l))?.restroom_share ?? 1 : 0,
                note: tagMap.get(tagKey(l))?.note ?? null,
              }));
        return { ...d, tags: [...kept, ...added] };
      });
      toast.success(lines.length === 1 ? "Tag saved" : `${lines.length} lines tagged`);
    },
    [tagMap],
  );

  const months = useMemo(() => (data ? monthsBetween(data.from, data.to) : []), [data]);

  const monthly = useMemo(() => {
    if (!data) return [];
    return months.map((m) => {
      const inMonth = data.lines.filter((l) => l.date.slice(0, 7) === m);
      const qbo = inMonth.reduce((s, l) => s + restroomAmount(l.amount, tagMap.get(tagKey(l))), 0);
      const untagged = inMonth.filter((l) => !tagMap.has(tagKey(l))).reduce((s, l) => s + l.amount, 0);
      const p = data.platformSpend[m] ?? {};
      // Google ran alone before the sync existed: the hand-entered monthly
      // figure stands in for Google when a month has no synced Google rows.
      const google = p.google ?? data.manualSpend[m] ?? 0;
      const platform = google + (p.meta ?? 0) + (p.chatgpt ?? 0);
      const leads = inquiries.filter(
        (i) =>
          i.created_at.slice(0, 7) === m &&
          lastTouch(i) !== null &&
          !(i.lost_reason || "").startsWith("Test"),
      );
      const won = leads.filter((i) => isBookedStatus(i.status) || i.status === "completed");
      const bookedValue = won.reduce((s, i) => s + (i.estimated_value || 0), 0);
      const revenue = data.restroomRevenue[m] ?? 0;
      return { m, qbo, untagged, platform, leads: leads.length, booked: won.length, bookedValue, revenue };
    });
  }, [data, months, tagMap, inquiries]);

  const total = useMemo(
    () =>
      monthly.reduce(
        (t, r) => ({
          qbo: t.qbo + r.qbo,
          untagged: t.untagged + r.untagged,
          platform: t.platform + r.platform,
          leads: t.leads + r.leads,
          booked: t.booked + r.booked,
          bookedValue: t.bookedValue + r.bookedValue,
          revenue: t.revenue + r.revenue,
        }),
        { qbo: 0, untagged: 0, platform: 0, leads: 0, booked: 0, bookedValue: 0, revenue: 0 },
      ),
    [monthly],
  );

  const visibleLines = useMemo(() => {
    if (!data) return [];
    return data.lines.filter((l) => {
      if (monthFilter !== "all" && l.date.slice(0, 7) !== monthFilter) return false;
      const t = tagMap.get(tagKey(l));
      if (tagFilter === "untagged") return !t;
      if (tagFilter !== "all") return t?.tag === tagFilter;
      return true;
    });
  }, [data, monthFilter, tagFilter, tagMap]);

  const selectedLines = visibleLines.filter((l) => selected.has(tagKey(l)));
  const allChecked = visibleLines.length > 0 && selectedLines.length === visibleLines.length;

  const yearNow = new Date().getFullYear();

  return (
    <section className="space-y-4 rounded-lg border p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold">Restroom Ad ROI</h2>
          <p className="text-sm text-muted-foreground">
            Restroom ad spend from QuickBooks (lines you tag below) against the leads and bookings ads brought in, by
            month. Restroom revenue is everything QuickBooks posts to a Bathroom class.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="h-8 rounded-md border bg-background px-2 text-sm"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
          >
            {[yearNow, yearNow - 1].map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <Button size="sm" variant="outline" disabled={loading} onClick={load}>
            <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
            {loading ? "Pulling QuickBooks" : "Refresh"}
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          {error}
        </div>
      )}
      {data && !data.tagsReady && (
        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          Tags can&apos;t be saved yet: run supabase/migrations/20261012_qbo_ad_expense_tags.sql in Supabase.
        </div>
      )}
      {data?.scanned.some((s) => !s.ok) && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          {data.scanned
            .filter((s) => !s.ok)
            .map((s) => (
              <div key={s.entityId}>
                {s.name}: {s.error}
              </div>
            ))}
        </div>
      )}

      {loading && !data && <div className="py-8 text-center text-sm text-muted-foreground">Pulling QuickBooks…</div>}

      {data && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">ROAS and cost per booking use</span>
            {(["qbo", "platform"] as Basis[]).map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => setBasis(b)}
                className={`rounded-full border px-3 py-1 transition-colors ${
                  basis === b
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {b === "qbo" ? "QuickBooks Restroom Spend" : "Ad Platform Spend"}
              </button>
            ))}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm tabular-nums">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Month</th>
                  <th className="py-2 pr-3 text-right font-medium">QuickBooks Restroom Ads</th>
                  <th className="py-2 pr-3 text-right font-medium">Untagged Ad Lines</th>
                  <th className="py-2 pr-3 text-right font-medium">Ad Platform Spend</th>
                  <th className="py-2 pr-3 text-right font-medium">Paid Leads</th>
                  <th className="py-2 pr-3 text-right font-medium">Booked</th>
                  <th className="py-2 pr-3 text-right font-medium">Booked $</th>
                  <th className="py-2 pr-3 text-right font-medium">ROAS</th>
                  <th className="py-2 pr-3 text-right font-medium">Cost per Booking</th>
                  <th className="py-2 pr-3 text-right font-medium">Restroom Revenue</th>
                  <th className="py-2 text-right font-medium">Ads % of Revenue</th>
                </tr>
              </thead>
              <tbody>
                {[...monthly, { m: "total", ...total }].map((r) => {
                  const spend = basis === "qbo" ? r.qbo : r.platform;
                  const isTotal = r.m === "total";
                  return (
                    <tr key={r.m} className={isTotal ? "border-t font-semibold" : "border-b border-border/50"}>
                      <td className="py-1.5 pr-3 whitespace-nowrap">{isTotal ? "Total" : monthLabel(r.m)}</td>
                      <td className="py-1.5 pr-3 text-right">{whole(r.qbo)}</td>
                      <td className={`py-1.5 pr-3 text-right ${r.untagged ? "text-amber-700" : ""}`}>{whole(r.untagged)}</td>
                      <td className="py-1.5 pr-3 text-right">{whole(r.platform)}</td>
                      <td className="py-1.5 pr-3 text-right">{r.leads || "—"}</td>
                      <td className="py-1.5 pr-3 text-right">{r.booked || "—"}</td>
                      <td className="py-1.5 pr-3 text-right">{whole(r.bookedValue)}</td>
                      <td className="py-1.5 pr-3 text-right">{roas(r.bookedValue, spend)}</td>
                      <td className="py-1.5 pr-3 text-right">{r.booked && spend ? whole(spend / r.booked) : "—"}</td>
                      <td className="py-1.5 pr-3 text-right">{whole(r.revenue)}</td>
                      <td className="py-1.5 text-right">
                        {r.revenue > 0 && spend > 0 ? `${((spend / r.revenue) * 100).toFixed(1)}%` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            Leads and bookings count in the month the lead came in, credited to its last ad click. Booked $ is the
            quoted value on the booked lead. QuickBooks spend counts in the month of the charge.
          </p>

          <div className="space-y-2 pt-2">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="mr-auto text-base font-semibold">
                QuickBooks Advertising Lines{" "}
                <span className="text-sm font-normal text-muted-foreground">
                  ({visibleLines.length} of {data.lines.length})
                </span>
              </h3>
              <select
                className="h-8 rounded-md border bg-background px-2 text-sm"
                value={monthFilter}
                onChange={(e) => setMonthFilter(e.target.value)}
              >
                <option value="all">All Months</option>
                {months.map((m) => (
                  <option key={m} value={m}>
                    {monthLabel(m)}
                  </option>
                ))}
              </select>
              <select
                className="h-8 rounded-md border bg-background px-2 text-sm"
                value={tagFilter}
                onChange={(e) => setTagFilter(e.target.value as typeof tagFilter)}
              >
                <option value="all">All Tags</option>
                <option value="untagged">Untagged</option>
                {AD_EXPENSE_TAGS.map((t) => (
                  <option key={t} value={t}>
                    {AD_EXPENSE_TAG_LABEL[t]}
                  </option>
                ))}
              </select>
            </div>

            {selectedLines.length > 0 && data.tagsReady && (
              <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 p-2 text-sm">
                <span>{selectedLines.length} selected</span>
                {AD_EXPENSE_TAGS.map((t) => (
                  <Button key={t} size="sm" variant="outline" onClick={() => saveTags(selectedLines, t)}>
                    Tag {AD_EXPENSE_TAG_LABEL[t]}
                  </Button>
                ))}
                <Button size="sm" variant="ghost" onClick={() => saveTags(selectedLines, null)}>
                  Clear Tag
                </Button>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="w-8 py-2">
                      <input
                        type="checkbox"
                        aria-label="Select all"
                        checked={allChecked}
                        onChange={() =>
                          setSelected(allChecked ? new Set() : new Set(visibleLines.map(tagKey)))
                        }
                      />
                    </th>
                    <th className="py-2 pr-3 font-medium">Date</th>
                    <th className="py-2 pr-3 font-medium">Company</th>
                    <th className="py-2 pr-3 font-medium">Type / No.</th>
                    <th className="py-2 pr-3 font-medium">Vendor</th>
                    <th className="py-2 pr-3 font-medium">Memo</th>
                    <th className="py-2 pr-3 font-medium">Account / Class</th>
                    <th className="py-2 pr-3 text-right font-medium">Amount</th>
                    <th className="py-2 pr-3 font-medium">Tag</th>
                    <th className="py-2 text-right font-medium">Restroom Share</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleLines.map((l) => {
                    const k = tagKey(l);
                    const t = tagMap.get(k);
                    return (
                      <tr key={k} className="border-b border-border/50 align-top">
                        <td className="py-1.5">
                          <input
                            type="checkbox"
                            aria-label="Select line"
                            checked={selected.has(k)}
                            onChange={() =>
                              setSelected((s) => {
                                const n = new Set(s);
                                if (n.has(k)) n.delete(k);
                                else n.add(k);
                                return n;
                              })
                            }
                          />
                        </td>
                        <td className="py-1.5 pr-3 whitespace-nowrap tabular-nums">{l.date}</td>
                        <td className="py-1.5 pr-3">{l.entityName}</td>
                        <td className="py-1.5 pr-3 whitespace-nowrap">
                          {l.txnType}
                          {l.docNumber ? ` ${l.docNumber}` : ""}
                        </td>
                        <td className="py-1.5 pr-3">{l.vendor ?? "—"}</td>
                        <td className="py-1.5 pr-3 text-muted-foreground">{l.memo ?? ""}</td>
                        <td className="py-1.5 pr-3 text-xs">
                          {l.account}
                          {l.className ? <div className="text-muted-foreground">{l.className}</div> : null}
                        </td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{fmtMoney(l.amount)}</td>
                        <td className="py-1.5 pr-3">
                          <select
                            className="h-7 rounded-md border bg-background px-1.5 text-xs"
                            disabled={!data.tagsReady}
                            value={t?.tag ?? ""}
                            onChange={(e) => saveTags([l], (e.target.value || null) as AdExpenseTag | null)}
                          >
                            <option value="">Untagged</option>
                            {AD_EXPENSE_TAGS.map((tag) => (
                              <option key={tag} value={tag}>
                                {AD_EXPENSE_TAG_LABEL[tag]}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="py-1.5 text-right">
                          {t?.tag === "restroom_ads" ? (
                            <input
                              key={`${k}-${t.restroom_share}`}
                              type="number"
                              min={0}
                              max={100}
                              step={1}
                              defaultValue={Math.round(Number(t.restroom_share) * 100)}
                              className="h-7 w-16 rounded-md border bg-background px-1.5 text-right text-xs tabular-nums"
                              onBlur={(e) => {
                                const pct = Math.min(100, Math.max(0, Number(e.target.value)));
                                if (pct / 100 !== Number(t.restroom_share)) saveTags([l], "restroom_ads", pct / 100);
                              }}
                            />
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                          {t?.tag === "restroom_ads" && <span className="ml-1 text-xs">%</span>}
                        </td>
                      </tr>
                    );
                  })}
                  {visibleLines.length === 0 && (
                    <tr>
                      <td colSpan={10} className="py-6 text-center text-sm text-muted-foreground">
                        No advertising lines match.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">
              Lines come from every QuickBooks company you can see, from expense accounts named Advertising,
              Marketing or Promotion. Companies scanned:{" "}
              {data.scanned.map((s) => `${s.name} (${s.ok ? s.lines : "error"})`).join(", ")}.
            </p>
          </div>
        </>
      )}
    </section>
  );
}
