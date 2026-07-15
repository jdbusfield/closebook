// Client-safe types + helpers for the automated email funnels. The server-side
// send machinery lives in funnel-send.ts; this is what the editor UI, the
// enroll dialog, and the drawer status chip share.

export interface Funnel {
  id: string;
  name: string;
  description: string | null;
  archived: boolean;
  sort_order: number;
}

export interface FunnelStep {
  id: string;
  funnel_id: string;
  day_offset: number;
  subject: string;
  body: string;
  resource_ids: string[];
  sort_order: number;
}

export type EnrollmentStatus = "active" | "paused_replied" | "stopped" | "completed";

export interface FunnelEnrollment {
  id: string;
  inquiry_id: string;
  funnel_id: string;
  status: EnrollmentStatus;
  enrolled_at: string;
  enrolled_by: string | null;
  steps_sent: number;
  next_send_at: string | null;
  replied_at: string | null;
  stopped_reason: string | null;
}

export const ENROLLMENT_STATUS_LABEL: Record<EnrollmentStatus, string> = {
  active: "Funnel running",
  paused_replied: "Paused — customer replied",
  stopped: "Funnel stopped",
  completed: "Funnel completed",
};

// Tailwind classes for the status chip, tuned to read at a glance: green =
// machine is working, amber = human needs to take over.
export const ENROLLMENT_STATUS_CLASS: Record<EnrollmentStatus, string> = {
  active: "bg-emerald-100 text-emerald-700",
  paused_replied: "bg-amber-100 text-amber-800",
  stopped: "bg-slate-100 text-slate-600",
  completed: "bg-blue-100 text-blue-700",
};

export function dayLabel(offset: number): string {
  if (offset === 0) return "Immediately";
  if (offset === 1) return "Day 1 (next day)";
  return `Day ${offset}`;
}

// Concrete calendar preview of a funnel's sends, anchored at `from` (enrollment
// time). Powers the "here's exactly what will go out and when" confirm UI.
export function schedulePreview(
  steps: FunnelStep[],
  from: Date = new Date()
): { step: FunnelStep; at: Date }[] {
  return [...steps]
    .sort((a, b) => a.day_offset - b.day_offset || a.sort_order - b.sort_order)
    .map((step) => ({
      step,
      at: new Date(from.getTime() + step.day_offset * 24 * 60 * 60 * 1000),
    }));
}
