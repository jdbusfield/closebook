"use client";

// Inquiries → Rate Card (Avon Trucks only). The day/week/month rate JD sets
// per vehicle here, plus a photo, is what trucks.avonrents.com actually shows
// — the site fetches this table live via /api/public/avon-rates (revalidated
// every few minutes) and merges it over the static spec sheet in fleet.json.
// Leave a rate blank and the site falls back to "Call for today's rate";
// leave a photo blank and it keeps its current placeholder image.

import { useRef, useState } from "react";
import Image from "next/image";
import { Loader2, Upload, ExternalLink, ImageOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useFleetRates } from "@/lib/inquiries/use-fleet-rates";
import { groupByClass, publicFleetPhotoUrl, type FleetRateRow } from "@/lib/inquiries/fleet-rates";

const SITE_URL = "https://trucks.avonrents.com";

function RateInput({
  value,
  onCommit,
}: {
  value: number | null;
  onCommit: (n: number | null) => void;
}) {
  const [draft, setDraft] = useState(value != null ? String(value) : "");
  return (
    <Input
      inputMode="decimal"
      placeholder="—"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const trimmed = draft.trim();
        const n = trimmed === "" ? null : Number(trimmed);
        if (n !== null && Number.isNaN(n)) {
          setDraft(value != null ? String(value) : "");
          return;
        }
        if (n !== value) onCommit(n);
      }}
      className="h-8 w-24 text-right font-mono text-sm"
    />
  );
}

function PhotoCell({
  row,
  uploading,
  onUpload,
}: {
  row: FleetRateRow;
  uploading: boolean;
  onUpload: (file: File) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const url = row.photo_path ? publicFleetPhotoUrl(row.photo_path) : null;
  return (
    <button
      type="button"
      onClick={() => fileRef.current?.click()}
      disabled={uploading}
      title={url ? "Replace photo" : "Upload photo"}
      className="group relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted"
    >
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onUpload(f);
          e.target.value = "";
        }}
      />
      {uploading ? (
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      ) : url ? (
        <Image src={url} alt={row.vehicle_name} fill sizes="56px" className="object-cover" unoptimized />
      ) : (
        <ImageOff className="size-4 text-muted-foreground" />
      )}
      <span className="absolute inset-0 hidden items-center justify-center bg-black/50 group-hover:flex">
        <Upload className="size-4 text-white" />
      </span>
    </button>
  );
}

export function FleetRateCard({ entityId }: { entityId: string }) {
  const rates = useFleetRates(entityId);
  const [uploadingId, setUploadingId] = useState<string | null>(null);

  if (rates.loading) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading rate card…
      </div>
    );
  }

  const groups = groupByClass(rates.rows);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border bg-card p-4">
        <div>
          <h2 className="text-base font-semibold">Fleet rate card</h2>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Day / week / month rates and a photo per vehicle. Everything here goes live on{" "}
            <span className="font-medium text-foreground">trucks.avonrents.com</span> within a
            few minutes — leave a field blank and that vehicle shows &ldquo;Call for
            today&apos;s rate&rdquo; (or its current placeholder photo) instead.
          </p>
        </div>
        <a
          href={SITE_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted"
        >
          Visit trucks.avonrents.com <ExternalLink className="size-3.5" />
        </a>
      </div>

      {groups.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No vehicles yet. Seed rows come from the fleet migration — ping engineering if this is
          empty.
        </p>
      )}

      {groups.map((g) => (
        <div key={g.slug} className="overflow-hidden rounded-lg border bg-card shadow-sm">
          <div className="border-b bg-muted/40 px-3 py-2">
            <h3 className="text-sm font-semibold">{g.name}</h3>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-[10.5px] uppercase tracking-wide text-muted-foreground">
                <th className="w-14 px-3 py-2" />
                <th className="px-3 py-2 text-left font-semibold">Vehicle</th>
                <th className="px-3 py-2 text-right font-semibold">Day</th>
                <th className="px-3 py-2 text-right font-semibold">Week</th>
                <th className="px-3 py-2 text-right font-semibold">Month</th>
              </tr>
            </thead>
            <tbody>
              {g.rows.map((row) => (
                <tr key={row.id} className="border-b last:border-b-0">
                  <td className="px-3 py-2">
                    <PhotoCell
                      row={row}
                      uploading={uploadingId === row.id}
                      onUpload={async (file) => {
                        setUploadingId(row.id);
                        try {
                          await rates.uploadPhoto(row.vehicle_id, row.id, file);
                        } finally {
                          setUploadingId(null);
                        }
                      }}
                    />
                  </td>
                  <td className="px-3 py-2 font-medium">{row.vehicle_name}</td>
                  <td className="px-3 py-2 text-right">
                    <RateInput value={row.day_rate} onCommit={(n) => rates.saveRate(row.id, { day_rate: n })} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <RateInput value={row.week_rate} onCommit={(n) => rates.saveRate(row.id, { week_rate: n })} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <RateInput
                      value={row.month_rate}
                      onCommit={(n) => rates.saveRate(row.id, { month_rate: n })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
