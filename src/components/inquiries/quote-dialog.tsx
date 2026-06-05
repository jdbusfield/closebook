"use client";

// "Draft a Quote" — a standalone quote builder for a deal. The rep adjusts the
// line items (pre-seeded from the customer's original request), sets an optional
// tax rate, validity date, and terms, then saves. Saving persists the quote to
// the inquiry (so any rep can pick it back up), logs it on the timeline, pushes
// the total onto the deal's estimated value, and downloads the branded PDF the
// rep attaches to their email. The saved quote also re-downloads on demand from
// the Quotes list — see quotes-list.tsx.

import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FileText, Download, Save } from "lucide-react";
import {
  QuoteBuilder,
  seedQuoteLines,
  computeQuoteTotals,
  toLineItems,
  type QuoteLine,
} from "@/components/inquiries/quote-builder";
import { downloadQuotePdf } from "@/lib/inquiries/quote-pdf";
import { type QuoteDraft } from "@/lib/inquiries/use-inquiries";
import { type Inquiry, type InquiryQuote, fmtMoney, toISODate } from "@/lib/inquiries/shared";

// Default validity: 14 days out (matches the quote copy's "good for 14 days").
function defaultValidUntil(): string {
  const d = new Date();
  d.setDate(d.getDate() + 14);
  return toISODate(d);
}

export function QuoteDialog({
  inquiry,
  onSave,
  onSetValue,
  open: openProp,
  onOpenChange,
  trigger,
}: {
  inquiry: Inquiry;
  onSave: (id: string, draft: QuoteDraft) => Promise<InquiryQuote | null>;
  onSetValue?: (id: string, value: number | null) => void;
  /** Controlled open state. Omit to let the built-in trigger manage it. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Custom trigger; omit for the default button, pass null to render none. */
  trigger?: ReactNode | null;
}) {
  const [openState, setOpenState] = useState(false);
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : openState;
  const setOpen = (o: boolean) => {
    if (!isControlled) setOpenState(o);
    onOpenChange?.(o);
  };

  const [lines, setLines] = useState<QuoteLine[]>(() => seedQuoteLines(inquiry));
  const [taxRate, setTaxRate] = useState(0);
  const [validUntil, setValidUntil] = useState<string>(defaultValidUntil());
  const [terms, setTerms] = useState("");
  const [saving, setSaving] = useState(false);

  const totals = useMemo(() => computeQuoteTotals(lines, taxRate), [lines, taxRate]);

  const buildDraft = (): QuoteDraft => ({
    lines: toLineItems(lines),
    subtotal: totals.subtotal,
    tax_rate: Number(taxRate) || 0,
    tax: totals.tax,
    total: totals.total,
    valid_until: validUntil || null,
    terms: terms.trim() || null,
  });

  const save = async (alsoDownload: boolean) => {
    const draft = buildDraft();
    if (draft.lines.length === 0) {
      toast.error("Add at least one line item");
      return;
    }
    setSaving(true);
    try {
      const created = await onSave(inquiry.id, draft);
      if (!created) return; // onSave already toasted the failure
      if (onSetValue && totals.total > 0) onSetValue(inquiry.id, totals.total);
      toast.success(`Quote ${created.quote_number} saved`);
      if (alsoDownload) {
        await downloadQuotePdf(created, inquiry);
      }
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger !== null && (
        <DialogTrigger asChild>
          {trigger ?? (
            <Button variant="outline" size="sm" className="gap-1.5">
              <FileText className="size-4" /> Draft a Quote
            </Button>
          )}
        </DialogTrigger>
      )}
      <DialogContent className="max-w-[calc(100%-2rem)] gap-0 p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-5 py-3.5">
          <DialogTitle className="flex items-center gap-2 text-base">
            Draft a Quote
            <span className="font-mono text-xs font-normal text-muted-foreground">
              {inquiry.reference}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-4 overflow-y-auto px-5 py-4">
          <QuoteBuilder lines={lines} setLines={setLines} />

          {/* Quote settings */}
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Tax rate (%)</span>
              <Input
                type="number"
                min={0}
                step="0.1"
                value={taxRate || ""}
                onChange={(e) => setTaxRate(Number(e.target.value))}
                placeholder="0"
                className="h-9"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Valid until</span>
              <Input
                type="date"
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
                className="h-9"
              />
            </label>
          </div>

          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">
              Terms / notes (optional)
            </span>
            <Textarea
              value={terms}
              onChange={(e) => setTerms(e.target.value)}
              placeholder="Includes delivery, setup, and servicing. Held for 14 days."
              rows={2}
              className="resize-none text-sm"
            />
          </label>

          {/* Totals summary */}
          <div className="rounded-lg border bg-muted/20 px-3 py-2 text-sm">
            <div className="flex justify-between text-muted-foreground">
              <span>Subtotal</span>
              <span className="font-mono tabular-nums">{fmtMoney(totals.subtotal)}</span>
            </div>
            {totals.tax > 0 && (
              <div className="flex justify-between text-muted-foreground">
                <span>Tax ({Number(taxRate) || 0}%)</span>
                <span className="font-mono tabular-nums">{fmtMoney(totals.tax)}</span>
              </div>
            )}
            <div className="mt-1 flex justify-between border-t pt-1 font-semibold">
              <span>Total</span>
              <span className="font-mono tabular-nums">{fmtMoney(totals.total)}</span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t px-5 py-3">
          <span className="text-xs text-muted-foreground">
            A quote number is assigned on save.
          </span>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto gap-1.5"
            disabled={saving}
            onClick={() => save(false)}
          >
            <Save className="size-4" /> Save
          </Button>
          <Button size="sm" className="gap-1.5" disabled={saving} onClick={() => save(true)}>
            <Download className="size-4" /> Save &amp; download PDF
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
