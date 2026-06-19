"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Search } from "lucide-react";
import { useInquiries } from "@/lib/inquiries/use-inquiries";
import { SectionTabs } from "@/components/inquiries/section-tabs";
import { InquiryDrawer, type DrawerCallbacks } from "@/components/inquiries/detail-drawer";
import {
  InquiryAvatar,
  StagePill,
  DueBadge,
} from "@/components/inquiries/atoms";
import { Input } from "@/components/ui/input";
import { fmtMoney, fmtRange } from "@/lib/inquiries/shared";

export default function InquiriesCustomersPage() {
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
  };
  const selected = data.inquiries.find((i) => i.id === selectedId) ?? null;

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    let r = data.inquiries;
    if (q) {
      r = r.filter((i) =>
        [i.name, i.use_case, i.email, i.location, i.reference]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q)
      );
    }
    return [...r].sort((a, b) =>
      (a.start_date || "9999").localeCompare(b.start_date || "9999")
    );
  }, [data.inquiries, query]);

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Customers</h1>
          <p className="text-sm text-muted-foreground">Every contact &amp; rental on record</p>
        </div>
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, event, email, location…"
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
                <th className="px-3 py-2 text-left font-semibold">Stage</th>
                <th className="px-3 py-2 text-right font-semibold">Value</th>
                <th className="px-3 py-2 text-left font-semibold">Next action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((inq) => {
                const openTask = (inq.tasks || []).find((t) => !t.done);
                return (
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
                      <div className="text-xs text-muted-foreground">
                        {[inq.location, inq.guests ? `${inq.guests} guests` : null]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {inq.start_date ? fmtRange(inq.start_date, inq.end_date) : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <StagePill status={inq.status} />
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-semibold">
                      {inq.estimated_value != null ? fmtMoney(inq.estimated_value) : "—"}
                    </td>
                    <td className="px-3 py-2">
                      {openTask ? (
                        <div className="flex items-center gap-2">
                          <DueBadge due={openTask.due_date} />
                          <span className="max-w-[160px] truncate text-xs text-muted-foreground">
                            {openTask.title}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length === 0 && (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">
              {query ? `No records match “${query}”.` : "No inquiries yet."}
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
