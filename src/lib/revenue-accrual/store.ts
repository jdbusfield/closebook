import type { createAdminClient } from "@/lib/supabase/admin";
import type { AccrualSettings, MonthRef, Quote } from "./types";
import type { QboPull } from "./qbo";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Month-end accrual inputs and review decisions live as JSON files in the
 * private `uploaded-reports` bucket, under {entityId}/revenue-accrual/.
 */
const BUCKET = "uploaded-reports";
const base = (entityId: string) => `${entityId}/revenue-accrual`;

export interface QuotesFile {
  uploadedAt: string;
  uploadedBy: string | null;
  fileName: string;
  sheet: string;
  quotes: Quote[];
}

export interface RunFile {
  decisions: Record<string, boolean>;
  updatedAt: string;
  updatedBy: string | null;
}

async function readJson<T>(admin: Admin, path: string): Promise<T | null> {
  const { data, error } = await admin.storage.from(BUCKET).download(path);
  if (error || !data) return null;
  try {
    return JSON.parse(await data.text()) as T;
  } catch {
    return null;
  }
}

async function writeJson(admin: Admin, path: string, value: unknown): Promise<void> {
  const body = new Blob([JSON.stringify(value)], { type: "application/json" });
  const { error } = await admin.storage.from(BUCKET).upload(path, body, { upsert: true, contentType: "application/json" });
  if (error) throw new Error(`Could not save ${path}: ${error.message}`);
}

const monthKey = (p: MonthRef) => `${p.year}-${String(p.month).padStart(2, "0")}`;

export const store = {
  quotes: (a: Admin, e: string) => readJson<QuotesFile>(a, `${base(e)}/quotes.json`),
  saveQuotes: (a: Admin, e: string, v: QuotesFile) => writeJson(a, `${base(e)}/quotes.json`, v),
  qbo: (a: Admin, e: string) => readJson<QboPull>(a, `${base(e)}/qbo.json`),
  saveQbo: (a: Admin, e: string, v: QboPull) => writeJson(a, `${base(e)}/qbo.json`, v),
  settings: (a: Admin, e: string) => readJson<Partial<AccrualSettings>>(a, `${base(e)}/settings.json`),
  saveSettings: (a: Admin, e: string, v: Partial<AccrualSettings>) => writeJson(a, `${base(e)}/settings.json`, v),
  run: (a: Admin, e: string, p: MonthRef) => readJson<RunFile>(a, `${base(e)}/runs/${monthKey(p)}.json`),
  saveRun: (a: Admin, e: string, p: MonthRef, v: RunFile) => writeJson(a, `${base(e)}/runs/${monthKey(p)}.json`, v),
};
