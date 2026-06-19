"use client";

// The saved quotes on a deal. This is the "harvest" surface: when one rep has
// already drafted a quote for a customer, any other rep who opens the deal sees
// it here and can re-download the identical PDF (regenerated from the saved
// data), flip its status, or remove it. Rendered in both the side drawer and the
// full inquiry page.

import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CheckCircle2, Download, FileText, Trash2 } from "lucide-react";
import { downloadQuotePdf, downloadInvoicePdf } from "@/lib/inquiries/quote-pdf";
import {
  type Inquiry,
  type InquiryQuote,
  fmtMoney,
  fmtDate,
  fmtDateTime,
} from "@/lib/inquiries/shared";

const STATUS_OPTIONS: InquiryQuote["status"][] = [
  "draft",
  "sent",
  "accepted",
  "declined",
  "expired",
];

const STATUS_STYLE: Record<InquiryQuote["status"], string> = {
  draft: "bg-slate-100 text-slate-600",
  sent: "bg-blue-100 text-blue-700",
  accepted: "bg-emerald-100 text-emerald-700",
  declined: "bg-red-100 text-red-700",
  expired: "bg-amber-100 text-amber-700",
};

export function QuotesList({
  inquiry,
  onUpdateStatus,
  onDelete,
}: {
  inquiry: Inquiry;
  onUpdateStatus: (quoteId: string, status: InquiryQuote["status"]) => void;
  onDelete: (quoteId: string) => void;
}) {
  const quotes = inquiry.quotes ?? [];

  if (quotes.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No quotes yet. Use <span className="font-medium">Draft a Quote</span> to build one.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {quotes.map((q) => {
        const isAccepted = q.status === "accepted";
        return (
          <div
            key={q.id}
            className={`rounded-lg border bg-card p-3 ${
              isAccepted ? "border-emerald-300" : ""
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-semibold">{q.quote_number}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[q.status]}`}
              >
                {isAccepted && q.accepted_at
                  ? `accepted ${fmtDate(q.accepted_at, { month: "short", day: "numeric" })}`
                  : q.status}
              </span>
              <span className="ml-auto font-mono text-sm font-semibold tabular-nums">
                {fmtMoney(q.total)}
              </span>
            </div>

            <div className="mt-1 text-[11px] text-muted-foreground">
              {q.lines.length} line{q.lines.length === 1 ? "" : "s"}
              {q.created_by ? ` · ${q.created_by}` : ""}
              {` · ${fmtDateTime(q.created_at)}`}
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              {isAccepted ? (
                <>
                  <Button
                    size="sm"
                    className="h-8 gap-1.5 bg-emerald-600 text-xs text-white hover:bg-emerald-700"
                    onClick={async () => {
                      try {
                        await downloadQuotePdf(q, inquiry);
                      } catch {
                        toast.error("Couldn't generate the PDF");
                      }
                    }}
                  >
                    <Download className="size-3.5" /> Download accepted quote
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5 border-emerald-300 text-xs text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
                    onClick={async () => {
                      try {
                        await downloadInvoicePdf(q, inquiry);
                      } catch {
                        toast.error("Couldn't generate the invoice");
                      }
                    }}
                  >
                    <FileText className="size-3.5" /> Download invoice
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5 text-xs"
                    onClick={async () => {
                      try {
                        await downloadQuotePdf(q, inquiry);
                      } catch {
                        toast.error("Couldn't generate the PDF");
                      }
                    }}
                  >
                    <Download className="size-3.5" /> Download PDF
                  </Button>
                  <Button
                    size="sm"
                    className="h-8 gap-1.5 bg-emerald-600 text-xs text-white hover:bg-emerald-700"
                    onClick={() => {
                      onUpdateStatus(q.id, "accepted");
                      toast.success(
                        `${q.quote_number} marked accepted — download the accepted copy to send to the customer`
                      );
                    }}
                  >
                    <CheckCircle2 className="size-3.5" /> Confirm accepted
                  </Button>
                </>
              )}

              <Select
                value={q.status}
                onValueChange={(v) => onUpdateStatus(q.id, v as InquiryQuote["status"])}
              >
                <SelectTrigger size="sm" className="h-8 w-[120px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s} value={s} className="text-xs capitalize">
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <button
                type="button"
                onClick={() => onDelete(q.id)}
                className="ml-auto grid size-8 place-items-center rounded text-muted-foreground/60 hover:bg-muted hover:text-destructive"
                aria-label="Delete quote"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
