"use client";

// Inquiries → AI Price Table (HDR only). The rates the AI callback agent
// quotes restroom-trailer callers from. Edits save on blur straight to
// rental_inquiry_ai_pricing; the agent's /api/inquiries/ai-price route reads
// the same row on every call, so a change here is live on the next call.
// The shortcut grid and the calculator run the same quoteTrailers() the
// agent's route runs.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import {
  DEFAULT_AI_PRICING,
  guestBands,
  normalizePricing,
  quoteTrailers,
  type AiPricing,
  type EventCategory,
} from "@/lib/inquiries/ai-pricing";

const GRID_DAYS = [1, 2, 3, 4, 5];

const fmt = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

function NumberField({
  label,
  value,
  prefix,
  suffix,
  onCommit,
}: {
  label: string;
  value: number;
  prefix?: string;
  suffix?: string;
  onCommit: (n: number) => void;
}) {
  // Parent keys this field by its value, so a reload remounts it with the new draft.
  const [draft, setDraft] = useState(String(value));
  return (
    <label className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <span>{label}</span>
      <span className="flex items-center gap-1">
        {prefix && <span className="text-muted-foreground">{prefix}</span>}
        <Input
          inputMode="decimal"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            const n = Number(draft.trim());
            if (draft.trim() === "" || !Number.isFinite(n) || n < 0) {
              setDraft(String(value));
              return;
            }
            if (n !== value) onCommit(n);
          }}
          className="h-8 w-24 text-right tabular-nums"
        />
        {suffix && <span className="w-14 text-muted-foreground">{suffix}</span>}
      </span>
    </label>
  );
}

function ShortcutGrid({ title, category, pricing }: { title: string; category: EventCategory; pricing: AiPricing }) {
  const bands = guestBands(pricing);
  return (
    <div className="overflow-x-auto rounded-lg border bg-card shadow-sm">
      <div className="border-b bg-muted/40 px-3 py-2">
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="px-3 py-2 font-medium">Guests</th>
            <th className="px-3 py-2 font-medium">Trailers</th>
            {GRID_DAYS.map((d) => (
              <th key={d} className="px-3 py-2 text-right font-medium">
                {d === 1 ? "1 Day" : `${d} Days`}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {bands.map((b) => (
            <tr key={b.label} className="border-b last:border-0">
              <td className="px-3 py-2 tabular-nums">{b.label}</td>
              <td className="px-3 py-2 tabular-nums">
                {b.trailers}
                {b.trailers > 1 && (
                  <span className="ml-1 text-xs text-muted-foreground">
                    (−{quoteTrailers({ category, guests: b.guests, days: 1 }, pricing).discount_pct}%)
                  </span>
                )}
              </td>
              {GRID_DAYS.map((d) => {
                const q = quoteTrailers({ category, guests: b.guests, days: d }, pricing);
                return (
                  <td key={d} className="px-3 py-2 text-right tabular-nums" title={`Exact: ${fmt(q.total)}`}>
                    {fmt(q.say_total)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TryAQuote({ pricing }: { pricing: AiPricing }) {
  const [category, setCategory] = useState<EventCategory>("event");
  const [guests, setGuests] = useState("150");
  const [days, setDays] = useState("1");
  const [attendant, setAttendant] = useState("");
  const q = useMemo(() => {
    const g = Number(guests);
    const d = Number(days);
    if (!(g > 0) || !(d > 0)) return null;
    return quoteTrailers({ category, guests: g, days: d, attendantHours: Number(attendant) || null }, pricing);
  }, [category, guests, days, attendant, pricing]);

  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <h3 className="text-sm font-semibold">Try A Quote</h3>
      <div className="mt-3 flex flex-wrap items-end gap-3 text-sm">
        <label className="space-y-1">
          <span className="block text-xs text-muted-foreground">Event Type</span>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as EventCategory)}
            className="h-8 rounded-md border bg-background px-2 text-sm"
          >
            <option value="event">Wedding / Other Event</option>
            <option value="private">Backyard / Private Party</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="block text-xs text-muted-foreground">Guests</span>
          <Input value={guests} onChange={(e) => setGuests(e.target.value)} inputMode="numeric" className="h-8 w-24 tabular-nums" />
        </label>
        <label className="space-y-1">
          <span className="block text-xs text-muted-foreground">Days</span>
          <Input value={days} onChange={(e) => setDays(e.target.value)} inputMode="numeric" className="h-8 w-20 tabular-nums" />
        </label>
        <label className="space-y-1">
          <span className="block text-xs text-muted-foreground">Attendant Hours</span>
          <Input value={attendant} onChange={(e) => setAttendant(e.target.value)} inputMode="numeric" placeholder="None" className="h-8 w-24 tabular-nums" />
        </label>
      </div>
      {q && (
        <div className="mt-4 space-y-1 text-sm">
          <p>
            <span className="font-semibold">{q.trailers}</span> trailer{q.trailers === 1 ? "" : "s"} ×{" "}
            {fmt(q.per_trailer_list)}
            {q.discount_pct > 0 && <> − {q.discount_pct}% = {fmt(q.per_trailer)} each</>}
            {q.attendant_total > 0 && <> + attendant {q.attendant_hours}h = {fmt(q.attendant_total)}</>}
          </p>
          <p>
            Total <span className="font-semibold tabular-nums">{fmt(q.total)}</span>
            {q.say_total !== q.total && (
              <span className="text-muted-foreground"> · the AI says &ldquo;around {fmt(q.say_total)}&rdquo;</span>
            )}
          </p>
        </div>
      )}
    </div>
  );
}

export function AiPriceTable({ entityId }: { entityId: string }) {
  const [pricing, setPricing] = useState<AiPricing>(DEFAULT_AI_PRICING);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const fetchPricing = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("rental_inquiry_ai_pricing")
      .select("*")
      .eq("entity_id", entityId)
      .maybeSingle();
    return data;
  }, [entityId]);

  const load = useCallback(async () => {
    const data = await fetchPricing();
    setPricing(normalizePricing(data));
    setUpdatedAt(data?.updated_at ?? null);
    setLoading(false);
  }, [fetchPricing]);

  useEffect(() => {
    let live = true;
    fetchPricing().then((data) => {
      if (!live) return;
      setPricing(normalizePricing(data));
      setUpdatedAt(data?.updated_at ?? null);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [fetchPricing]);

  const save = useCallback(
    async (field: keyof AiPricing, value: number) => {
      const next = { ...pricing, [field]: value };
      setPricing(next);
      const supabase = createClient();
      const { data, error } = await supabase
        .from("rental_inquiry_ai_pricing")
        .upsert({ entity_id: entityId, ...next }, { onConflict: "entity_id" })
        .select("updated_at")
        .single();
      if (error) {
        toast.error(`Couldn't save: ${error.message}`);
        await load();
        return;
      }
      setUpdatedAt(data?.updated_at ?? null);
      toast.success("Saved. The AI quotes this on its next call.");
    },
    [pricing, entityId, load]
  );

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading price table…
      </div>
    );
  }

  const field = (k: keyof AiPricing, label: string, opts: { prefix?: string; suffix?: string } = {}) => (
    <NumberField key={`${k}:${pricing[k]}`} label={label} value={pricing[k]} onCommit={(n) => save(k, n)} {...opts} />
  );

  return (
    <div className="space-y-6">
      <div className="rounded-lg border bg-card p-4">
        <h2 className="text-base font-semibold">AI Price Table</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          The AI callback agent quotes 4-stall restroom trailers from these numbers. It never works out a price
          on its own; it asks Closebook, and Closebook uses this table. Changes save when you click away and
          apply to the next call.
          {updatedAt && <> Last changed {new Date(updatedAt).toLocaleString()}.</>}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border bg-card p-4 shadow-sm">
          <h3 className="mb-2 text-sm font-semibold">Backyard / Private Party</h3>
          {field("private_first_day", "First day, per trailer", { prefix: "$" })}
          {field("private_extra_day", "Each extra day", { prefix: "$" })}
        </div>
        <div className="rounded-lg border bg-card p-4 shadow-sm">
          <h3 className="mb-2 text-sm font-semibold">Wedding / All Other Events</h3>
          {field("event_first_day", "First day, per trailer", { prefix: "$" })}
          {field("event_extra_day", "Each extra day", { prefix: "$" })}
        </div>
        <div className="rounded-lg border bg-card p-4 shadow-sm">
          <h3 className="mb-2 text-sm font-semibold">Attendant</h3>
          {field("attendant_hourly", "Hourly rate", { prefix: "$" })}
          {field("attendant_min_hours", "Minimum", { suffix: "hours" })}
        </div>
      </div>

      <div className="rounded-lg border bg-card p-4 shadow-sm md:max-w-md">
        <h3 className="mb-2 text-sm font-semibold">Trailers And Discounts</h3>
        {field("guests_per_trailer", "Guests per 4-stall trailer", { suffix: "guests" })}
        {field("discount_2_pct", "2 trailers, off each", { suffix: "%" })}
        {field("discount_3_pct", "3 trailers, off each", { suffix: "%" })}
        {field("discount_4_plus_pct", "4+ trailers, off each", { suffix: "%" })}
      </div>

      <div className="space-y-2">
        <h2 className="text-base font-semibold">Shortcut Table</h2>
        <p className="text-sm text-muted-foreground">
          Totals for the whole rental, exactly as the AI quotes them (discounted totals rounded to the nearest $10;
          hover a cell for the exact amount).
        </p>
        <div className="grid gap-4 xl:grid-cols-2">
          <ShortcutGrid title="Wedding / All Other Events" category="event" pricing={pricing} />
          <ShortcutGrid title="Backyard / Private Party" category="private" pricing={pricing} />
        </div>
      </div>

      <TryAQuote pricing={pricing} />
    </div>
  );
}
