"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { formatStatementAmount } from "./format-utils";
import type { LineItem } from "./types";

export interface DerivationCellInfo {
  line: LineItem;
  periodKey: string;
  periodLabel: string;
  columnType: "actual" | "budget";
}

interface DerivationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cellInfo: DerivationCellInfo | null;
}

export function DerivationDialog({
  open,
  onOpenChange,
  cellInfo,
}: DerivationDialogProps) {
  if (!cellInfo) return null;

  const { line, periodKey, periodLabel, columnType } = cellInfo;
  const derivation = line.derivation;
  const entry = derivation?.byPeriod[periodKey];
  const columnLabel = columnType === "budget" ? "Budget" : "Actual";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{line.label}</DialogTitle>
          <DialogDescription>
            {periodLabel} &middot; {columnLabel} &middot; how this line is derived
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0 space-y-4">
          {derivation?.description && (
            <p className="text-sm text-muted-foreground leading-relaxed">
              {derivation.description}
            </p>
          )}

          {!entry || entry.components.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-4">
              No build-up available for this period.
            </p>
          ) : (
            <div className="space-y-3">
              {entry.components.map((component, ci) => (
                <div key={ci}>
                  <div className="flex items-baseline justify-between gap-4 border-b pb-1">
                    <span className="text-sm font-medium">{component.label}</span>
                    <span className="font-mono tabular-nums text-sm shrink-0">
                      {formatStatementAmount(component.amount, false)}
                    </span>
                  </div>

                  {component.detail && component.detail.length > 0 && (
                    <table className="w-full text-sm mt-1">
                      <tbody>
                        {component.detail.map((row, ri) => (
                          <tr
                            key={ri}
                            className="border-b border-border/40 last:border-b-0"
                          >
                            <td className="py-1 pl-4 text-muted-foreground">
                              {row.label}
                            </td>
                            <td className="py-1 text-muted-foreground font-mono text-xs whitespace-nowrap">
                              {row.meta ?? ""}
                            </td>
                            <td className="py-1 text-right font-mono tabular-nums">
                              {formatStatementAmount(row.amount, false)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              ))}

              <div className="border-t-2 border-foreground pt-2 flex justify-between items-center">
                <span className="font-semibold text-sm">
                  {line.label}
                </span>
                <span className="font-semibold font-mono tabular-nums">
                  {formatStatementAmount(entry.total, true)}
                </span>
              </div>
            </div>
          )}
        </div>

        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  );
}
