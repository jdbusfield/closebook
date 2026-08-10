import { Badge } from "@/components/ui/badge";

export const DEAL_STAGE_ORDER = [
  "target",
  "nda",
  "data_request",
  "diligence",
  "proposal",
  "loi",
  "closing",
  "closed",
  "passed",
  "on_hold",
] as const;

export const DEAL_STAGE_LABEL: Record<string, string> = {
  target: "Target",
  nda: "NDA",
  data_request: "Data Request",
  diligence: "Diligence",
  proposal: "Proposal",
  loi: "LOI",
  closing: "Closing",
  closed: "Closed",
  passed: "Passed",
  on_hold: "On Hold",
};

const DEAL_STAGE_CLASS: Record<string, string> = {
  target: "bg-slate-100 text-slate-700",
  nda: "bg-sky-100 text-sky-800",
  data_request: "bg-amber-100 text-amber-800",
  diligence: "bg-purple-100 text-purple-800",
  proposal: "bg-indigo-100 text-indigo-800",
  loi: "bg-cyan-100 text-cyan-800",
  closing: "bg-emerald-100 text-emerald-800",
  closed: "bg-emerald-100 text-emerald-800",
  passed: "bg-rose-100 text-rose-700",
  on_hold: "bg-slate-200 text-slate-500",
};

export function DealStageBadge({ stage }: { stage: string }) {
  const cls = DEAL_STAGE_CLASS[stage] ?? "bg-slate-100 text-slate-700";
  return (
    <Badge className={`${cls} text-xs`} variant="secondary">
      {DEAL_STAGE_LABEL[stage] ?? stage}
    </Badge>
  );
}

export const ITEM_STATUS_ORDER = [
  "not_requested",
  "requested",
  "received",
  "in_review",
  "follow_up",
  "complete",
  "not_applicable",
] as const;

export const ITEM_STATUS_LABEL: Record<string, string> = {
  not_requested: "Not Requested",
  requested: "Requested",
  received: "Received",
  in_review: "In Review",
  follow_up: "Follow-up",
  complete: "Complete",
  not_applicable: "N/A",
};

export const ITEM_STATUS_CLASS: Record<string, string> = {
  not_requested: "bg-slate-100 text-slate-700",
  requested: "bg-amber-100 text-amber-800",
  received: "bg-sky-100 text-sky-800",
  in_review: "bg-purple-100 text-purple-800",
  follow_up: "bg-rose-100 text-rose-700",
  complete: "bg-emerald-100 text-emerald-800",
  not_applicable: "bg-slate-200 text-slate-500",
};

export function ItemStatusBadge({ status }: { status: string }) {
  const cls = ITEM_STATUS_CLASS[status] ?? "bg-slate-100 text-slate-700";
  return (
    <Badge className={`${cls} text-xs`} variant="secondary">
      {ITEM_STATUS_LABEL[status] ?? status}
    </Badge>
  );
}

export const PRIORITY_LABEL: Record<string, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

const PRIORITY_CLASS: Record<string, string> = {
  high: "bg-rose-100 text-rose-700",
  medium: "bg-amber-100 text-amber-800",
  low: "bg-slate-100 text-slate-700",
};

export function PriorityBadge({ priority }: { priority: string }) {
  return (
    <Badge className={`${PRIORITY_CLASS[priority] ?? "bg-slate-100"} text-xs`} variant="secondary">
      {PRIORITY_LABEL[priority] ?? priority}
    </Badge>
  );
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
