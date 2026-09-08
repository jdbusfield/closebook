"use client";

// Email deliverability report for the Ads tab. Same dual data path as the
// other inquiry hooks: the in-app route with a session, or the
// key-authenticated embed route inside the admin-portal iframe.

import { useCallback, useEffect, useState } from "react";
import { useEmbed } from "@/lib/inquiries/embed-context";
import type { EmailHealthReport } from "@/lib/email-health/report";

export interface UseEmailHealth {
  report: EmailHealthReport | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  /** Connecting Postmaster needs a session, so the embed only reads. */
  canConnect: boolean;
}

export function useEmailHealth(entityId: string): UseEmailHealth {
  const embed = useEmbed();
  const isEmbed = !!embed?.embedKey;
  const embedKey = embed?.embedKey;
  const eid = entityId || embed?.entityId || "";

  const [report, setReport] = useState<EmailHealthReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = isEmbed
        ? await fetch("/api/inquiries/embed", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(embedKey ? { "x-embed-key": embedKey } : {}) },
            body: JSON.stringify({ action: "email_health" }),
          })
        : await fetch(`/api/inquiries/email-health?entityId=${encodeURIComponent(eid)}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Request failed (HTTP ${res.status})`);
      setReport(json as EmailHealthReport);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load the email report");
    } finally {
      setLoading(false);
    }
  }, [isEmbed, embedKey, eid]);

  useEffect(() => {
    if (eid) load();
  }, [eid, load]);

  return { report, loading, error, reload: load, canConnect: !isEmbed };
}
