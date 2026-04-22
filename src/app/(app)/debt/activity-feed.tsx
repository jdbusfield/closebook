"use client";

/**
 * Cross-entity activity feed — last N transactions within the window that
 * touch any instrument in scope. Each row links to the instrument detail.
 */

import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils/dates";
import {
  BUCKET_LABELS,
  TRANSACTION_TYPE_TO_BUCKET,
  type DebtInstrumentInput,
  type DebtTransactionInput,
  type DebtTransactionType,
  type EntityRef,
  type MethodologyBucket,
} from "@/lib/utils/debt-rollforward";

const TX_TYPE_LABEL: Record<string, string> = {
  advance: "Advance / Draw",
  principal_payment: "Principal Payment",
  interest_payment: "Interest Payment",
  fee_payment: "Fee Payment",
  late_fee: "Late Fee",
  misc_fee: "Misc Fee",
  origination_fee: "Origination Fee",
  annual_fee: "Annual Fee",
  payment_reversal: "Payment Reversal",
  note_renewal: "Note Renewal",
  vehicle_payoff: "Vehicle Payoff",
  payoff: "Payoff",
  adjustment: "Adjustment",
};

interface ActivityFeedProps {
  transactions: DebtTransactionInput[];
  instruments: DebtInstrumentInput[];
  entities: EntityRef[];
  startIso: string;
  endIso: string;
  bucketFilter?: MethodologyBucket | null;
  limit?: number;
}

export function ActivityFeed({
  transactions,
  instruments,
  entities,
  startIso,
  endIso,
  bucketFilter,
  limit = 20,
}: ActivityFeedProps) {
  const instrumentMap = new Map(instruments.map((i) => [i.id, i]));
  const entityMap = new Map(entities.map((e) => [e.id, e]));

  const filtered = transactions
    .filter((t) => {
      const d = t.effective_date.slice(0, 10);
      if (d < startIso || d > endIso) return false;
      if (!bucketFilter) return true;
      return (
        TRANSACTION_TYPE_TO_BUCKET[t.transaction_type as DebtTransactionType] ===
        bucketFilter
      );
    })
    .sort((a, b) => b.effective_date.localeCompare(a.effective_date))
    .slice(0, limit);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-base">
          Recent Activity
          {bucketFilter && (
            <Badge variant="outline" className="ml-2 font-normal">
              {BUCKET_LABELS[bucketFilter]}
            </Badge>
          )}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Most recent {limit} transactions in window
        </p>
      </CardHeader>
      <CardContent className="p-0">
        {filtered.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No transactions in the selected window.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead className="w-24">Date</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>Instrument</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Principal</TableHead>
                  <TableHead className="text-right">Interest</TableHead>
                  <TableHead className="text-right">Fees</TableHead>
                  <TableHead>Reference</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((t) => {
                  const instr = instrumentMap.get(t.debt_instrument_id);
                  const entity = instr ? entityMap.get(instr.entity_id) : null;
                  const bucket =
                    TRANSACTION_TYPE_TO_BUCKET[
                      t.transaction_type as DebtTransactionType
                    ];
                  const isDraw = bucket === "draws" || bucket === "reversals";
                  return (
                    <TableRow key={t.id}>
                      <TableCell className="text-xs tabular-nums">
                        {t.effective_date.slice(0, 10)}
                      </TableCell>
                      <TableCell className="text-sm">
                        {entity?.name ?? "—"}
                      </TableCell>
                      <TableCell>
                        {instr && entity ? (
                          <Link
                            href={`/${entity.id}/debt/${instr.id}`}
                            className="text-sm hover:underline"
                          >
                            {instr.instrument_name}
                          </Link>
                        ) : (
                          <span className="text-sm">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {TX_TYPE_LABEL[t.transaction_type] ?? t.transaction_type}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right tabular-nums",
                          isDraw && "text-rose-700 dark:text-rose-400",
                          !isDraw && "text-emerald-700 dark:text-emerald-400"
                        )}
                      >
                        {formatCurrency(t.amount)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs">
                        {Math.abs(t.to_principal) > 0.005
                          ? formatCurrency(t.to_principal)
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs">
                        {Math.abs(t.to_interest) > 0.005
                          ? formatCurrency(t.to_interest)
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs">
                        {Math.abs(t.to_fees) > 0.005
                          ? formatCurrency(t.to_fees)
                          : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {t.reference_number ?? t.description ?? ""}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
