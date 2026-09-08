"use client";

// Synced ad-platform rows (Meta / Google Ads / ChatGPT Ads) + sync history +
// per-lead campaign attribution for the Ads tab. Mirrors use-ad-spend's dual
// data path: direct Supabase (RLS) with a session, or the key-authenticated
// embed route inside the admin-portal iframe.
//
// Tolerant of the tables not existing yet (migration 20260908 not applied):
// `unavailable` carries the reason and the page shows it instead of crashing.

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useEmbed } from "@/lib/inquiries/embed-context";
import { toast } from "sonner";

import { AD_DATA_START, AD_ROW_COLUMNS, AD_RUN_COLUMNS } from "@/lib/ads/columns";
export { AD_DATA_START, AD_ROW_COLUMNS, AD_RUN_COLUMNS };

export interface AdDailyRow {
  platform: "meta" | "google" | "chatgpt";
  date: string;
  campaign_id: string;
  campaign_name: string | null;
  adset_id: string;
  adset_name: string | null;
  ad_id: string;
  ad_name: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  reach: number | null;
  platform_conversions: number | null;
}

export interface AdSyncRun {
  platform: "meta" | "google" | "chatgpt";
  started_at: string;
  finished_at: string | null;
  ok: boolean;
  since: string | null;
  until: string | null;
  rows_upserted: number;
  error: string | null;
}

export interface LeadAttribution {
  id: string;
  utm_source: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
}

export interface UseAdPlatform {
  rows: AdDailyRow[];
  runs: AdSyncRun[];
  attribution: LeadAttribution[];
  loading: boolean;
  unavailable: string | null;
  syncing: boolean;
  /** In-app only (needs a session). Runs the platform pulls and reloads. */
  syncNow: (opts?: { since?: string }) => Promise<void>;
  canSync: boolean;
}


function missingTableMessage(msg: string | undefined): string | null {
  if (!msg) return null;
  if (/does not exist|schema cache|42P01|42703/i.test(msg)) {
    return "Ads tables are not in the database yet. Run supabase/migrations/20260908_ad_platform_reporting.sql in Supabase Studio, then reload.";
  }
  return msg;
}

export function useAdPlatform(entityId: string): UseAdPlatform {
  const embed = useEmbed();
  const isEmbed = !!embed?.embedKey;
  const embedKey = embed?.embedKey;
  const eid = entityId || embed?.entityId || "";

  const [rows, setRows] = useState<AdDailyRow[]>([]);
  const [runs, setRuns] = useState<AdSyncRun[]>([]);
  const [attribution, setAttribution] = useState<LeadAttribution[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const embedPost = useCallback(
    async (payload: Record<string, unknown>) => {
      const res = await fetch("/api/inquiries/embed", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(embedKey ? { "x-embed-key": embedKey } : {}),
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Request failed (HTTP ${res.status})`);
      }
      return res.json();
    },
    [embedKey]
  );

  const load = useCallback(async () => {
    try {
      if (isEmbed) {
        const data = await embedPost({ action: "list_ad_platform" });
        setRows(data.rows ?? []);
        setRuns(data.runs ?? []);
        setAttribution(data.attribution ?? []);
        setUnavailable(missingTableMessage(data.unavailable) ?? null);
      } else {
        const supabase = createClient();
        const [r, s, a] = await Promise.all([
          supabase
            .from("ad_platform_daily")
            .select(AD_ROW_COLUMNS)
            .eq("entity_id", eid)
            .gte("date", AD_DATA_START)
            .order("date", { ascending: true })
            .range(0, 9999),
          supabase
            .from("ad_platform_sync_runs")
            .select(AD_RUN_COLUMNS)
            .eq("entity_id", eid)
            .order("started_at", { ascending: false })
            .limit(30),
          supabase
            .from("rental_inquiries")
            .select("id, utm_source, utm_campaign, utm_content")
            .eq("entity_id", eid)
            .gte("created_at", AD_DATA_START)
            .range(0, 9999),
        ]);
        if (r.error) {
          setUnavailable(missingTableMessage(r.error.message));
        } else {
          setUnavailable(null);
          setRows((r.data as unknown as AdDailyRow[]) ?? []);
        }
        if (!s.error) setRuns((s.data as unknown as AdSyncRun[]) ?? []);
        // utm_* columns arrive with the same migration; until then leads are
        // matched at platform level only.
        if (!a.error) setAttribution((a.data as unknown as LeadAttribution[]) ?? []);
      }
    } catch (e) {
      setUnavailable(e instanceof Error ? e.message : "Couldn't load ad data");
    } finally {
      setLoading(false);
    }
  }, [isEmbed, eid, embedPost]);

  useEffect(() => {
    load();
  }, [load]);

  const syncNow = useCallback(
    async (opts?: { since?: string }) => {
      if (isEmbed) return;
      setSyncing(true);
      try {
        const res = await fetch("/api/ads/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entityId: eid, since: opts?.since }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || `Sync failed (HTTP ${res.status})`);
        const results = (json.results ?? []) as { platform: string; ok: boolean; rows: number; error?: string }[];
        const okCount = results.filter((x) => x.ok).length;
        const failed = results.filter((x) => !x.ok);
        if (failed.length) {
          toast.warning(
            `${okCount} of ${results.length} platforms synced. ${failed.map((f) => f.platform).join(", ")} failed; see Data sources below.`
          );
        } else {
          toast.success(`Synced ${results.reduce((s, x) => s + x.rows, 0)} rows from ${okCount} platforms`);
        }
        await load();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Sync failed");
      } finally {
        setSyncing(false);
      }
    },
    [isEmbed, eid, load]
  );

  return { rows, runs, attribution, loading, unavailable, syncing, syncNow, canSync: !isEmbed };
}
