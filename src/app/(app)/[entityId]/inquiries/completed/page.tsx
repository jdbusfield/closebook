"use client";

// Completed view — every order that's been closed out (status "completed"),
// with the revenue realized and when it was completed. Reuses the shared inquiry
// data (already loaded for the board) and the detail drawer, so a completed order
// can be reopened or reviewed in place. Positive counterpart to the Lost view.

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Search, CheckCircle2 } from "lucide-react";
import { useInquiries } from "@/lib/inquiries/use-inquiries";
import { SectionTabs } from "@/components/inquiries/section-tabs";
import { InquiryDrawer, type DrawerCallbacks } from "@/components/inquiries/detail-drawer";
import { InquiryAvatar } from "@/components/inquiries/atoms";
import { Input } from "@/components/ui/input";
import { fmtMoney, fmtRange, fmtDate } from "@/lib/inquiries/shared";

export default function InquiriesCompletedPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const data = useInquiries(entityId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const callbacks: DrawerCallbacks = {
    onMove: data.moveStage,
    onSetValue: data.setEstimatedValue,
    onSaveBilling: (id, billingName, billingAddress) =>
      data.updateTriage(
        id,
        { billing_name: billingName, billing_address: billingAddress },
        "Bill-to saved"
      ),
    onSaveDetails: (id, patch) => data.updateTriage(id, patch, "Details saved"),
    onAddTask: data.addTask,
    onToggleTask: data.toggleTask,
    onAddActivity: data.addActivity,
    onDeleteActivity: data.deleteActivity,
    onAddQuote: data.addQuote,
    onUpdateQuoteStatus: data.updateQuoteStatus,
    onDeleteQuote: data.deleteQuote,
    onDelete: (id) => {
      setSelectedId(null);
      data.deleteInquiry(id);
    },
  };
  const selected = data.inquiries.find((i) => i.id === selectedId) ?? null;

  const { rows, total } = useMemo(() => {
    const q = query.trim().toLowerCase();
    let r = data.inquiries.filter((i) => i.status === "completed");
    const total = r.reduce((s, i) => s + (i.estimated_value || 0), 0);
    if (q) {
      r = r.filter((i) =>
        [i.name, i.use_case, i.email, i.location, i.reference]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q)
      );
    }
    // Most recently completed first.
    const rows = [...r].sort((a, b) =>
      (b.last_activity_at || "").localeCompare(a.last_activity_at || "")
    );
    return { rows, total };
  }, [data.inquiries, query]);

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Completed</h1>
          <p className="text-sm text-muted-foreground">
            Closed-out orders — click one to review or reopen ·{" "}
            <span className="font-semibold text-foreground">{fmtMoney(total)}</span> earned
          </p>
        </div>
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, event, location…"
            className="pl-8"
          />
        </div>
      </div>
      <SectionTabs entityId={entityId} />

      {data.loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-[10.5px] uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 text-left font-semibold">Customer</th>
                <th className="px-3 py-2 text-left font-semibold">Event</th>
                <th className="px-3 py-2 text-left font-semibold">Dates</th>
                <th className="px-3 py-2 text-right font-semibold">Value</th>
                <th className="px-3 py-2 text-left font-semibold">Completed</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((inq) => (
                <tr
                  key={inq.id}
                  onClick={() => setSelectedId(inq.id)}
                  className="cursor-pointer border-b last:border-b-0 hover:bg-muted/40"
                >
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2.5">
                      <InquiryAvatar name={inq.name} size={28} />
                      <div className="min-w-0">
                        <div className="truncate font-medium">{inq.name || "—"}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {inq.reference}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div>{inq.use_case || "—"}</div>
                    <div className="text-xs text-muted-foreground">{inq.location || ""}</div>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {inq.start_date ? fmtRange(inq.start_date, inq.end_date) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-semibold">
                    {inq.estimated_value != null ? fmtMoney(inq.estimated_value) : "—"}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <CheckCircle2 className="size-3.5 text-green-600" />
                      {inq.last_activity_at ? fmtDate(inq.last_activity_at) : "—"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">
              {query ? `No completed orders match “${query}”.` : "No completed orders yet."}
            </div>
          )}
        </div>
      )}

      <InquiryDrawer
        inquiry={selected}
        entityId={entityId}
        onClose={() => setSelectedId(null)}
        callbacks={callbacks}
        actor={data.actor}
      />
    </div>
  );
}
