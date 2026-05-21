import { Badge } from "@/components/ui/badge";

export const PRODUCTION_STATUS_ORDER = [
  "pre-prepping",
  "prepping",
  "shooting",
  "reshoots",
  "wrapping",
  "completed",
  "cancelled",
  "archived",
] as const;

export const PRODUCTION_STATUS_LABEL: Record<string, string> = {
  "pre-prepping": "Pre-prepping",
  prepping: "Prepping",
  shooting: "Shooting",
  reshoots: "Reshoots",
  wrapping: "Wrapping",
  completed: "Completed",
  cancelled: "Cancelled",
  archived: "Archived",
};

const PRODUCTION_STATUS_CLASS: Record<string, string> = {
  "pre-prepping": "bg-slate-100 text-slate-700",
  prepping: "bg-amber-100 text-amber-800",
  shooting: "bg-emerald-100 text-emerald-800",
  reshoots: "bg-sky-100 text-sky-800",
  wrapping: "bg-purple-100 text-purple-800",
  completed: "bg-slate-100 text-slate-600",
  cancelled: "bg-rose-100 text-rose-700",
  archived: "bg-slate-200 text-slate-500",
};

export function ProductionStatusBadge({ status }: { status: string }) {
  const cls = PRODUCTION_STATUS_CLASS[status] ?? "bg-slate-100 text-slate-700";
  const label = PRODUCTION_STATUS_LABEL[status] ?? status;
  return (
    <Badge className={`${cls} text-xs`} variant="secondary">
      {label}
    </Badge>
  );
}

export const OPPORTUNITY_STATUS_LABEL: Record<string, string> = {
  open: "Open",
  reservation_made: "Reservation Made",
  won: "Won",
  lost: "Lost",
};

const OPPORTUNITY_STATUS_CLASS: Record<string, string> = {
  open: "bg-sky-100 text-sky-800",
  reservation_made: "bg-amber-100 text-amber-800",
  won: "bg-emerald-100 text-emerald-800",
  lost: "bg-rose-100 text-rose-700",
};

export function OpportunityStatusBadge({ status }: { status: string }) {
  const cls = OPPORTUNITY_STATUS_CLASS[status] ?? "bg-slate-100";
  return (
    <Badge className={`${cls} text-xs`} variant="secondary">
      {OPPORTUNITY_STATUS_LABEL[status] ?? status}
    </Badge>
  );
}

const PRIORITY_CLASS: Record<string, string> = {
  high: "bg-rose-100 text-rose-700",
  medium: "bg-amber-100 text-amber-800",
  low: "bg-slate-100 text-slate-700",
};

export function PriorityBadge({ priority }: { priority: string }) {
  return (
    <Badge className={`${PRIORITY_CLASS[priority] ?? "bg-slate-100"} text-xs`} variant="secondary">
      {priority}
    </Badge>
  );
}

export const OPPORTUNITY_SEGMENTS = [
  "avon_trailers",
  "avon_vehicles",
  "location_services",
  "bathroom_trailers",
  "grip_and_lighting",
  "production_supplies_rental",
  "ac_equipment",
  "rental_vehicles",
  "rental_trailers",
  "bathroom_trailer",
] as const;

export function segmentLabel(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export function formatMoney(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents);
}

export const COMMUNICATION_TYPE_LABEL: Record<string, string> = {
  call: "Call",
  email: "Email",
  meeting: "Meeting",
  text: "Text",
  other: "Other",
};
