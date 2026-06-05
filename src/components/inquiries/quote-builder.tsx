"use client";

// A simple line-item quote builder used inside the template picker when the
// selected email contains the {quote} token. The rep adds rows (description ×
// qty × rate), the total is computed live, and formatQuote() renders the plain-
// text block that drops into the email where {quote} sits. State is owned by the
// picker (controlled) so the email preview stays in sync without effects.

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, Trash2 } from "lucide-react";
import { type Inquiry, fmtMoney } from "@/lib/inquiries/shared";

export interface QuoteLine {
  id: string;
  description: string;
  qty: number;
  rate: number;
}

let _seq = 0;
function lineId(): string {
  _seq += 1;
  return `ql-${_seq}`;
}

// Pre-fill the builder with sensible rows from the inquiry; rates start blank.
export function seedQuoteLines(inq: Inquiry): QuoteLine[] {
  const unitLabel =
    inq.units != null ? ` (${inq.units} unit${inq.units === 1 ? "" : "s"})` : "";
  const dur = inq.duration ? ` — ${inq.duration}` : "";
  return [
    {
      id: lineId(),
      description: `Restroom trailer rental${unitLabel}${dur}`,
      qty: inq.units && inq.units > 0 ? inq.units : 1,
      rate: 0,
    },
    { id: lineId(), description: "Delivery & pickup", qty: 1, rate: 0 },
  ];
}

export function lineAmount(l: QuoteLine): number {
  return (Number(l.qty) || 0) * (Number(l.rate) || 0);
}

// Strip the client-only row id for persistence (matches QuoteLineItem in shared).
export function toLineItems(
  lines: QuoteLine[]
): { description: string; qty: number; rate: number }[] {
  return lines
    .filter((l) => l.description.trim() !== "" || Number(l.rate) > 0)
    .map((l) => ({
      description: l.description.trim() || "Item",
      qty: Number(l.qty) || 0,
      rate: Number(l.rate) || 0,
    }));
}

// Round to cents to avoid float drift in stored totals.
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Subtotal / tax / total for a set of lines and an optional tax percent.
export function computeQuoteTotals(
  lines: QuoteLine[],
  taxRate = 0
): { subtotal: number; tax: number; total: number } {
  const subtotal = round2(lines.reduce((s, l) => s + lineAmount(l), 0));
  const tax = round2(subtotal * ((Number(taxRate) || 0) / 100));
  return { subtotal, tax, total: round2(subtotal + tax) };
}

// Render the itemized quote as the plain-text block that fills {quote}.
export function formatQuote(lines: QuoteLine[]): { text: string; total: number } {
  const active = lines.filter(
    (l) => l.description.trim() !== "" || Number(l.rate) > 0
  );
  const rows = active.map((l) => {
    const amount = lineAmount(l);
    const qtyNote =
      Number(l.qty) && Number(l.qty) !== 1
        ? ` (${l.qty} × ${fmtMoney(Number(l.rate) || 0)})`
        : "";
    return `• ${l.description.trim() || "Item"}${qtyNote} — ${fmtMoney(amount)}`;
  });
  const total = active.reduce((s, l) => s + lineAmount(l), 0);
  const text = [...rows, `Total: ${fmtMoney(total)}`].join("\n");
  return { text, total };
}

export function QuoteBuilder({
  lines,
  setLines,
}: {
  lines: QuoteLine[];
  setLines: (lines: QuoteLine[]) => void;
}) {
  const update = (id: string, patch: Partial<QuoteLine>) =>
    setLines(lines.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const remove = (id: string) => setLines(lines.filter((l) => l.id !== id));
  const add = () =>
    setLines([...lines, { id: lineId(), description: "", qty: 1, rate: 0 }]);

  const total = lines.reduce((s, l) => s + lineAmount(l), 0);

  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <div className="mb-2 text-xs font-semibold text-foreground">Quote builder</div>

      {/* header */}
      <div className="mb-1 grid grid-cols-[1fr_46px_78px_72px_24px] gap-1.5 px-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        <span>Description</span>
        <span className="text-center">Qty</span>
        <span className="text-right">Rate</span>
        <span className="text-right">Amount</span>
        <span />
      </div>

      <div className="space-y-1.5">
        {lines.map((l) => (
          <div
            key={l.id}
            className="grid grid-cols-[1fr_46px_78px_72px_24px] items-center gap-1.5"
          >
            <Input
              value={l.description}
              onChange={(e) => update(l.id, { description: e.target.value })}
              placeholder="Line item…"
              className="h-8 text-sm"
            />
            <Input
              type="number"
              min={0}
              value={l.qty}
              onChange={(e) => update(l.id, { qty: Number(e.target.value) })}
              className="h-8 px-1 text-center text-sm"
            />
            <div className="flex items-center">
              <span className="text-xs text-muted-foreground">$</span>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={l.rate || ""}
                onChange={(e) => update(l.id, { rate: Number(e.target.value) })}
                placeholder="0"
                className="h-8 px-1 text-right text-sm"
              />
            </div>
            <span className="text-right font-mono text-xs tabular-nums">
              {fmtMoney(lineAmount(l))}
            </span>
            <button
              type="button"
              onClick={() => remove(l.id)}
              className="text-muted-foreground/60 hover:text-destructive"
              aria-label="Remove line"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}
      </div>

      <div className="mt-2 flex items-center">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={add}
          className="h-7 gap-1 px-2 text-xs text-muted-foreground"
        >
          <Plus className="size-3.5" /> Add line
        </Button>
        <span className="ml-auto text-sm font-semibold">
          Total: <span className="font-mono tabular-nums">{fmtMoney(total)}</span>
        </span>
      </div>
    </div>
  );
}
