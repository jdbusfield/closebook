// Shared UI atoms for the HDR Sales CRM — ported from the design's
// components.jsx (Avatar, StagePill, UnitTag, DueBadge, ActivityIcon) plus a KPI
// card. Presentational only; safe to use from server or client components.
import * as React from "react";
import {
  Phone,
  Mail,
  StickyNote,
  FileText,
  DollarSign,
  Truck,
  Sparkles,
  Clock,
  ArrowUpRight,
  ArrowDownLeft,
  MousePointerClick,
  Clapperboard,
  type LucideIcon,
} from "lucide-react";
import {
  type Inquiry,
  STAGE_BY_KEY,
  FLEET_BY_ID,
  avatarColor,
  initials,
  relDays,
  relTime,
  daysBetween,
  parseDate,
  today,
  normalizeStatus,
  needsOutreachStatus,
  lastContactedAt,
  contactOverdue,
  lastCorrespondence,
} from "@/lib/inquiries/shared";

// Tint a hex color to a low-alpha background (e.g. "#2845F0" + 0.1).
export function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export function InquiryAvatar({
  name,
  size = 30,
}: {
  name: string | null | undefined;
  size?: number;
}) {
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{
        width: size,
        height: size,
        background: avatarColor(name),
        fontSize: Math.round(size * 0.4),
      }}
    >
      {initials(name)}
    </div>
  );
}

export function StagePill({ status }: { status: string }) {
  const s = STAGE_BY_KEY[normalizeStatus(status)];
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ background: hexA(s.color, 0.1), color: s.color }}
    >
      <span className="size-1.5 rounded-full" style={{ background: s.color }} />
      {s.label}
    </span>
  );
}

// Which marketing site a lead came from. Hollywood Depot (production equipment)
// leads share the HDR board with Site Services (bathroom trailer) leads, so the
// production ones get a loud amber chip to keep the two businesses unmistakable.
export function BrandBadge({
  source,
  className = "",
}: {
  source: string | null | undefined;
  className?: string;
}) {
  if (source !== "hollywooddepot") return null;
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-300 ${className}`}
      title="This lead came from hollywooddepot.com (production equipment rentals)."
    >
      <Clapperboard className="size-3" /> Hollywood Depot
    </span>
  );
}

// Marks a lead that arrived via a Google ad click (we captured a gclid on the
// site). Drives Google Ads conversion attribution for won rentals; surfacing it
// here lets a rep see at a glance which leads are paid-search sourced.
export function GoogleAdBadge({
  gclid,
  className = "",
}: {
  gclid: string | null | undefined;
  className?: string;
}) {
  if (!gclid) return null;
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-300 ${className}`}
      title="This lead arrived from a Google ad click — won bookings are attributed back to Google Ads."
    >
      <MousePointerClick className="size-3" /> Google Ad
    </span>
  );
}

export function UnitTag({ unitId }: { unitId: string | null | undefined }) {
  if (!unitId || !FLEET_BY_ID[unitId]) {
    return (
      <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
        Unassigned
      </span>
    );
  }
  const u = FLEET_BY_ID[unitId];
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold"
      style={{ background: hexA(u.color, 0.1), color: u.color }}
    >
      <span className="size-1.5 rounded-full" style={{ background: u.color }} />
      {u.name}
    </span>
  );
}

// Due badge: overdue → red, today → amber, future → neutral.
export function DueBadge({ due }: { due: string | null | undefined }) {
  const d = parseDate(due ?? null);
  if (!d) return null;
  const n = daysBetween(today(), d);
  const cls =
    n < 0
      ? "bg-red-100 text-red-700"
      : n === 0
        ? "bg-amber-100 text-amber-800"
        : "bg-slate-100 text-slate-600";
  return (
    <span
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}
    >
      {relDays(d)}
    </span>
  );
}

const ACT_ICON: Record<string, LucideIcon> = {
  inquiry: Sparkles,
  call: Phone,
  email: Mail,
  note: StickyNote,
  quote: FileText,
  payment: DollarSign,
  logistics: Truck,
};
const ACT_COLOR: Record<string, string> = {
  inquiry: "#2845F0",
  call: "#0f7b6c",
  email: "#0369a1",
  note: "#828b9c",
  quote: "#7c3aed",
  payment: "#0f7b6c",
  logistics: "#c2410c",
};
export function ActivityIcon({ type, size = 12 }: { type: string; size?: number }) {
  const Icon = ACT_ICON[type] || StickyNote;
  const color = ACT_COLOR[type] || "#828b9c";
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full text-white"
      style={{ width: size + 12, height: size + 12, background: color }}
    >
      <Icon size={size} />
    </div>
  );
}

export const ACTIVITY_COLOR = ACT_COLOR;

// "When did WE last contact them" — outbound emails (CRM-sent or Gmail-captured)
// and logged calls/emails only. Turns red on open deals once the last outreach
// is more than three days old (or was never made), so the board shows exactly
// who is overdue for a follow-up.
export function LastContacted({
  inq,
  className = "",
}: {
  inq: Inquiry;
  className?: string;
}) {
  const t = lastContactedAt(inq);
  const open = needsOutreachStatus(normalizeStatus(inq.status));
  const overdue = open && contactOverdue(inq);
  if (!t && !open) return null;
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${
        overdue
          ? "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-400"
          : "text-muted-foreground"
      } ${className}`}
      title={
        t
          ? `We last contacted them ${t.toLocaleString()}`
          : "We haven't contacted them yet"
      }
    >
      <Clock className="size-3" />
      {t ? relTime(t) : "no contact yet"}
    </span>
  );
}

// "Who had the last word" — us (we replied, awaiting customer) vs the customer
// (they replied, ball's in our court). Amber draws the eye when it's on us.
export function CorrespondenceBadge({
  inq,
  withTime = false,
}: {
  inq: Inquiry;
  withTime?: boolean;
}) {
  const corr = lastCorrespondence(inq);
  if (!corr) return null;
  const customer = corr.by === "customer";
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${
        customer ? "bg-amber-100 text-amber-800" : "bg-sky-100 text-sky-800"
      }`}
      title={
        customer
          ? "The ball's in our court — they're waiting on us"
          : "We sent the last message — awaiting the customer"
      }
    >
      {customer ? (
        <ArrowDownLeft className="size-3" />
      ) : (
        <ArrowUpRight className="size-3" />
      )}
      {customer ? "Awaiting your reply" : "You replied"}
      {withTime ? ` · ${relTime(corr.at)}` : ""}
    </span>
  );
}

// Dashboard KPI card.
export function KPI({
  label,
  value,
  foot,
  footTone = "muted",
  icon: Icon,
  flag = false,
}: {
  label: string;
  value: React.ReactNode;
  foot?: React.ReactNode;
  footTone?: "muted" | "warn" | "ok" | "danger";
  icon: LucideIcon;
  flag?: boolean;
}) {
  const footCls =
    footTone === "danger"
      ? "text-red-600"
      : footTone === "warn"
        ? "text-amber-600"
        : footTone === "ok"
          ? "text-emerald-600"
          : "text-muted-foreground";
  return (
    <div
      className={`rounded-lg border bg-card p-4 shadow-sm ${
        flag ? "border-red-200 bg-red-50/50" : ""
      }`}
    >
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Icon size={14} />
        {label}
      </div>
      <div
        className={`mt-1.5 text-3xl font-bold tabular-nums ${flag ? "text-red-600" : ""}`}
      >
        {value}
      </div>
      {foot && <div className={`mt-1 text-xs ${footCls}`}>{foot}</div>}
    </div>
  );
}
