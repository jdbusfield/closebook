"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { formatCurrency, getCurrentPeriod } from "@/lib/utils/dates";

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Year × month payment grid shared by the entity-level and consolidated
 * real-estate views. Renders the total lease cost per month and per year
 * (with a column-total row), plus sublease income and net grids when
 * sublease data is present.
 */
export function PaymentScheduleGrids({
  leasePayments,
  subleasePayments,
}: {
  leasePayments: Array<{ lease_id: string; period_year: number; period_month: number; scheduled_amount: number }>;
  subleasePayments: Array<{ sublease_id: string; lease_id: string; period_year: number; period_month: number; scheduled_amount: number }>;
}) {
  const current = getCurrentPeriod();

  // Build lease payment grid: year → month → total
  const leaseGrid: Record<number, Record<number, number>> = {};
  for (const p of leasePayments) {
    if (!leaseGrid[p.period_year]) leaseGrid[p.period_year] = {};
    leaseGrid[p.period_year][p.period_month] =
      (leaseGrid[p.period_year][p.period_month] || 0) + p.scheduled_amount;
  }

  // Build sublease income grid: year → month → total
  const subleaseGrid: Record<number, Record<number, number>> = {};
  for (const p of subleasePayments) {
    if (!subleaseGrid[p.period_year]) subleaseGrid[p.period_year] = {};
    subleaseGrid[p.period_year][p.period_month] =
      (subleaseGrid[p.period_year][p.period_month] || 0) + p.scheduled_amount;
  }

  // Combine years
  const allYears = new Set([
    ...Object.keys(leaseGrid).map(Number),
    ...Object.keys(subleaseGrid).map(Number),
  ]);
  const sortedYears = [...allYears].sort((a, b) => a - b);

  const hasSubleaseData = subleasePayments.length > 0;

  const totalLeasePayments = leasePayments.reduce((s, p) => s + p.scheduled_amount, 0);
  const totalSubleasePayments = subleasePayments.reduce((s, p) => s + p.scheduled_amount, 0);

  return (
    <div className="space-y-6 mt-6">
      {/* Lease Payments Grid */}
      <Card>
        <CardHeader>
          <CardTitle>Lease Payment Schedule — All Leases</CardTitle>
          <CardDescription>
            Monthly lease obligations across all leases
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="sticky left-0 bg-background z-10 w-16">Year</TableHead>
                  {MONTH_SHORT.map((m) => (
                    <TableHead key={m} className="text-right text-xs min-w-[90px]">
                      {m}
                    </TableHead>
                  ))}
                  <TableHead className="text-right text-xs font-semibold min-w-[100px]">
                    Annual
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedYears.map((year) => {
                  const monthData = leaseGrid[year] || {};
                  const annualTotal = Object.values(monthData).reduce((s, v) => s + v, 0);
                  return (
                    <TableRow key={year}>
                      <TableCell className="sticky left-0 bg-background z-10 font-medium tabular-nums">
                        {year}
                      </TableCell>
                      {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => {
                        const amt = monthData[month];
                        const isCurrentMonth = year === current.year && month === current.month;
                        return (
                          <TableCell
                            key={month}
                            className={cn(
                              "text-right tabular-nums text-sm",
                              isCurrentMonth && "bg-primary/10 font-medium ring-1 ring-primary/30 rounded"
                            )}
                          >
                            {amt != null
                              ? formatCurrency(amt)
                              : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                        );
                      })}
                      <TableCell className="text-right tabular-nums font-semibold text-sm">
                        {formatCurrency(annualTotal)}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {sortedYears.length > 1 && (
                  <TableRow className="border-t-2 font-semibold">
                    <TableCell className="sticky left-0 bg-background z-10">Total</TableCell>
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => {
                      const colTotal = sortedYears.reduce((s, y) => s + (leaseGrid[y]?.[month] || 0), 0);
                      return (
                        <TableCell key={month} className="text-right tabular-nums text-sm">
                          {colTotal > 0 ? formatCurrency(colTotal) : "—"}
                        </TableCell>
                      );
                    })}
                    <TableCell className="text-right tabular-nums text-sm">
                      {formatCurrency(totalLeasePayments)}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Sublease Income Grid */}
      {hasSubleaseData && (
        <Card>
          <CardHeader>
            <CardTitle>Sublease Income Schedule — All Subleases</CardTitle>
            <CardDescription>
              Monthly sublease income across all subleases
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="sticky left-0 bg-background z-10 w-16">Year</TableHead>
                    {MONTH_SHORT.map((m) => (
                      <TableHead key={m} className="text-right text-xs min-w-[90px]">
                        {m}
                      </TableHead>
                    ))}
                    <TableHead className="text-right text-xs font-semibold min-w-[100px]">
                      Annual
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedYears.map((year) => {
                    const monthData = subleaseGrid[year] || {};
                    const annualTotal = Object.values(monthData).reduce((s, v) => s + v, 0);
                    if (annualTotal === 0 && !subleaseGrid[year]) return null;
                    return (
                      <TableRow key={year}>
                        <TableCell className="sticky left-0 bg-background z-10 font-medium tabular-nums">
                          {year}
                        </TableCell>
                        {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => {
                          const amt = monthData[month];
                          const isCurrentMonth = year === current.year && month === current.month;
                          return (
                            <TableCell
                              key={month}
                              className={cn(
                                "text-right tabular-nums text-sm text-green-600",
                                isCurrentMonth && "bg-green-50 dark:bg-green-950/30 font-medium ring-1 ring-green-400/40 rounded"
                              )}
                            >
                              {amt != null
                                ? formatCurrency(amt)
                                : <span className="text-muted-foreground">—</span>}
                            </TableCell>
                          );
                        })}
                        <TableCell className="text-right tabular-nums font-semibold text-sm text-green-600">
                          {formatCurrency(annualTotal)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {sortedYears.length > 1 && (
                    <TableRow className="border-t-2 font-semibold">
                      <TableCell className="sticky left-0 bg-background z-10">Total</TableCell>
                      {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => {
                        const colTotal = sortedYears.reduce((s, y) => s + (subleaseGrid[y]?.[month] || 0), 0);
                        return (
                          <TableCell key={month} className="text-right tabular-nums text-sm text-green-600">
                            {colTotal > 0 ? formatCurrency(colTotal) : "—"}
                          </TableCell>
                        );
                      })}
                      <TableCell className="text-right tabular-nums text-sm text-green-600">
                        {formatCurrency(totalSubleasePayments)}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Net Cost Grid */}
      {hasSubleaseData && (
        <Card>
          <CardHeader>
            <CardTitle>Net Payment Schedule</CardTitle>
            <CardDescription>
              Lease costs minus sublease income recoveries
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="sticky left-0 bg-background z-10 w-16">Year</TableHead>
                    {MONTH_SHORT.map((m) => (
                      <TableHead key={m} className="text-right text-xs min-w-[90px]">
                        {m}
                      </TableHead>
                    ))}
                    <TableHead className="text-right text-xs font-semibold min-w-[100px]">
                      Annual
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedYears.map((year) => {
                    const leaseData = leaseGrid[year] || {};
                    const subData = subleaseGrid[year] || {};
                    const annualNet = Object.keys({ ...leaseData, ...subData }).reduce(
                      (s, k) => s + (leaseData[Number(k)] || 0) - (subData[Number(k)] || 0),
                      0
                    );
                    return (
                      <TableRow key={year}>
                        <TableCell className="sticky left-0 bg-background z-10 font-medium tabular-nums">
                          {year}
                        </TableCell>
                        {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => {
                          const leaseAmt = leaseGrid[year]?.[month] || 0;
                          const subAmt = subleaseGrid[year]?.[month] || 0;
                          const net = leaseAmt - subAmt;
                          const hasData = leaseAmt > 0 || subAmt > 0;
                          const isCurrentMonth = year === current.year && month === current.month;
                          return (
                            <TableCell
                              key={month}
                              className={cn(
                                "text-right tabular-nums text-sm",
                                net < 0 && "text-green-600",
                                isCurrentMonth && "bg-primary/10 font-medium ring-1 ring-primary/30 rounded"
                              )}
                            >
                              {hasData
                                ? formatCurrency(net)
                                : <span className="text-muted-foreground">—</span>}
                            </TableCell>
                          );
                        })}
                        <TableCell className="text-right tabular-nums font-semibold text-sm">
                          {formatCurrency(annualNet)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {sortedYears.length > 1 && (
                    <TableRow className="border-t-2 font-semibold">
                      <TableCell className="sticky left-0 bg-background z-10">Total</TableCell>
                      {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => {
                        const leaseTotal = sortedYears.reduce((s, y) => s + (leaseGrid[y]?.[month] || 0), 0);
                        const subTotal = sortedYears.reduce((s, y) => s + (subleaseGrid[y]?.[month] || 0), 0);
                        const net = leaseTotal - subTotal;
                        return (
                          <TableCell key={month} className="text-right tabular-nums text-sm">
                            {net !== 0 ? formatCurrency(net) : "—"}
                          </TableCell>
                        );
                      })}
                      <TableCell className="text-right tabular-nums text-sm">
                        {formatCurrency(totalLeasePayments - totalSubleasePayments)}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
