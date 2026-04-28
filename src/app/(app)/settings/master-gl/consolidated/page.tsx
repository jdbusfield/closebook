"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  Card,
  CardContent,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCurrency, getPeriodLabel, getCurrentPeriod } from "@/lib/utils/dates";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
} from "lucide-react";
import type { AccountClassification } from "@/lib/types/database";

interface EntityBreakdown {
  entityId: string;
  entityName: string;
  entityCode: string;
  accountId: string;
  endingBalance: number;
  debitTotal: number;
  creditTotal: number;
  netChange: number;
  beginningBalance: number;
}

interface ConsolidatedAccount {
  masterAccountId: string;
  accountNumber: string;
  name: string;
  description: string | null;
  classification: string;
  accountType: string;
  normalBalance: string;
  mappedEntities: number;
  entityBreakdown: EntityBreakdown[];
  endingBalance: number;
  debitTotal: number;
  creditTotal: number;
  netChange: number;
  beginningBalance: number;
}

interface ConsolidatedTotals {
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  totalRevenue: number;
  totalExpenses: number;
}

interface UnmappedAccount {
  id: string;
  entityId: string;
  entityName: string;
  entityCode: string;
  name: string;
  accountNumber: string | null;
  classification: string;
  currentBalance: number;
}

const CLASSIFICATION_COLORS: Record<AccountClassification, string> = {
  Asset: "bg-blue-100 text-blue-800",
  Liability: "bg-red-100 text-red-800",
  Equity: "bg-purple-100 text-purple-800",
  Revenue: "bg-green-100 text-green-800",
  Expense: "bg-orange-100 text-orange-800",
};

const CLASSIFICATIONS: AccountClassification[] = [
  "Asset",
  "Liability",
  "Equity",
  "Revenue",
  "Expense",
];

export default function ConsolidatedPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();

  const chartIdParam = searchParams.get("chartId");

  const currentPeriod = getCurrentPeriod();
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [periodYear, setPeriodYear] = useState(currentPeriod.year);
  const [periodMonth, setPeriodMonth] = useState(currentPeriod.month);
  const [consolidated, setConsolidated] = useState<ConsolidatedAccount[]>([]);
  const [totals, setTotals] = useState<ConsolidatedTotals>({
    totalAssets: 0,
    totalLiabilities: 0,
    totalEquity: 0,
    totalRevenue: 0,
    totalExpenses: 0,
  });
  const [unmappedAccounts, setUnmappedAccounts] = useState<UnmappedAccount[]>(
    []
  );
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const loadOrganization = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data: membership } = await supabase
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", user.id)
      .single();

    if (membership) {
      setOrganizationId(membership.organization_id);
    }
  }, [supabase]);

  const loadConsolidated = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);

    const chartParam = chartIdParam ? `&chartId=${chartIdParam}` : "";
    const response = await fetch(
      `/api/master-accounts/consolidated?organizationId=${organizationId}&periodYear=${periodYear}&periodMonth=${periodMonth}${chartParam}`
    );
    const data = await response.json();

    if (data.consolidated) {
      setConsolidated(data.consolidated);
    }
    if (data.totals) {
      setTotals(data.totals);
    }
    if (data.unmappedAccounts) {
      setUnmappedAccounts(data.unmappedAccounts);
    }

    setLoading(false);
  }, [organizationId, periodYear, periodMonth, chartIdParam]);

  useEffect(() => {
    loadOrganization();
  }, [loadOrganization]);

  useEffect(() => {
    if (organizationId) {
      loadConsolidated();
    }
  }, [organizationId, loadConsolidated]);

  function toggleCollapse(classification: string) {
    setCollapsed((prev) => ({
      ...prev,
      [classification]: !prev[classification],
    }));
  }

  function toggleRowExpand(masterAccountId: string) {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(masterAccountId)) {
        next.delete(masterAccountId);
      } else {
        next.add(masterAccountId);
      }
      return next;
    });
  }

  // Group consolidated accounts by classification
  const grouped = consolidated.reduce<Record<string, ConsolidatedAccount[]>>(
    (acc, account) => {
      const key = account.classification;
      if (!acc[key]) acc[key] = [];
      acc[key].push(account);
      return acc;
    },
    {}
  );

  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  const netIncome = totals.totalRevenue - totals.totalExpenses;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Button
            variant="ghost"
            size="sm"
            className="mb-2"
            onClick={() => router.push("/settings/master-gl")}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Master GL
          </Button>
          <h1 className="text-2xl font-semibold tracking-tight">
            Consolidated Trial Balance
          </h1>
          <p className="text-muted-foreground">
            {getPeriodLabel(periodYear, periodMonth)} &mdash; Balances across all
            entities mapped to the master chart of accounts
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={String(periodMonth)}
            onValueChange={(v) => setPeriodMonth(parseInt(v))}
          >
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {months.map((month, i) => (
                <SelectItem key={i + 1} value={String(i + 1)}>
                  {month}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={String(periodYear)}
            onValueChange={(v) => setPeriodYear(parseInt(v))}
          >
            <SelectTrigger className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[currentPeriod.year - 2, currentPeriod.year - 1, currentPeriod.year, currentPeriod.year + 1].map(
                (year) => (
                  <SelectItem key={year} value={String(year)}>
                    {year}
                  </SelectItem>
                )
              )}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-5">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Assets
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-semibold tabular-nums">
              {formatCurrency(totals.totalAssets)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Liabilities
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-semibold tabular-nums">
              {formatCurrency(totals.totalLiabilities)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Equity
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-semibold tabular-nums">
              {formatCurrency(totals.totalEquity)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Revenue
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-semibold tabular-nums">
              {formatCurrency(totals.totalRevenue)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Net Income
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className={`text-xl font-semibold tabular-nums ${
                netIncome >= 0 ? "text-green-600" : "text-red-600"
              }`}
            >
              {formatCurrency(netIncome)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Consolidated Trial Balance */}
      <Card>
        <CardHeader>
          <CardTitle>Account Balances</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading consolidated balances...</p>
          ) : consolidated.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground">
                No master accounts with data for this period. Define master
                accounts and map entity accounts to see consolidated balances.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {CLASSIFICATIONS.map((classification) => {
                const classAccounts = grouped[classification];
                if (!classAccounts || classAccounts.length === 0) return null;
                const isCollapsed = collapsed[classification];

                const classTotal = classAccounts.reduce(
                  (sum, a) => sum + a.endingBalance,
                  0
                );

                return (
                  <div key={classification}>
                    <button
                      onClick={() => toggleCollapse(classification)}
                      className="flex items-center gap-2 w-full py-2 px-1 hover:bg-muted/50 rounded-md transition-colors"
                    >
                      {isCollapsed ? (
                        <ChevronRight className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                      <Badge
                        variant="outline"
                        className={CLASSIFICATION_COLORS[classification]}
                      >
                        {classification}
                      </Badge>
                      <span className="text-sm text-muted-foreground">
                        {classAccounts.length} account
                        {classAccounts.length !== 1 ? "s" : ""}
                      </span>
                      <span className="ml-auto text-sm font-semibold tabular-nums">
                        {formatCurrency(classTotal)}
                      </span>
                    </button>

                    {!isCollapsed && (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-8"></TableHead>
                            <TableHead className="w-24">Number</TableHead>
                            <TableHead>Account Name</TableHead>
                            <TableHead className="text-right">
                              Beginning
                            </TableHead>
                            <TableHead className="text-right">
                              Debits
                            </TableHead>
                            <TableHead className="text-right">
                              Credits
                            </TableHead>
                            <TableHead className="text-right">
                              Ending Balance
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {classAccounts.map((account) => {
                            const isExpanded = expandedRows.has(
                              account.masterAccountId
                            );
                            const hasBreakdown =
                              account.entityBreakdown.length > 0;
                            return (
                              <>
                                <TableRow
                                  key={account.masterAccountId}
                                  className={
                                    hasBreakdown
                                      ? "cursor-pointer hover:bg-muted/50"
                                      : ""
                                  }
                                  onClick={() =>
                                    hasBreakdown &&
                                    toggleRowExpand(account.masterAccountId)
                                  }
                                >
                                  <TableCell>
                                    {hasBreakdown &&
                                      (isExpanded ? (
                                        <ChevronDown className="h-3 w-3" />
                                      ) : (
                                        <ChevronRight className="h-3 w-3" />
                                      ))}
                                  </TableCell>
                                  <TableCell className="font-mono text-sm font-medium">
                                    {account.accountNumber}
                                  </TableCell>
                                  <TableCell>
                                    <span className="font-medium">
                                      {account.name}
                                    </span>
                                    {account.mappedEntities > 0 && (
                                      <Badge
                                        variant="secondary"
                                        className="ml-2 text-xs"
                                      >
                                        {account.mappedEntities} entit
                                        {account.mappedEntities !== 1
                                          ? "ies"
                                          : "y"}
                                      </Badge>
                                    )}
                                  </TableCell>
                                  <TableCell className="text-right tabular-nums">
                                    {formatCurrency(account.beginningBalance)}
                                  </TableCell>
                                  <TableCell className="text-right tabular-nums">
                                    {formatCurrency(account.debitTotal)}
                                  </TableCell>
                                  <TableCell className="text-right tabular-nums">
                                    {formatCurrency(account.creditTotal)}
                                  </TableCell>
                                  <TableCell className="text-right tabular-nums font-medium">
                                    {formatCurrency(account.endingBalance)}
                                  </TableCell>
                                </TableRow>
                                {isExpanded &&
                                  account.entityBreakdown.map((eb) => (
                                    <TableRow
                                      key={`${account.masterAccountId}-${eb.entityId}`}
                                      className="bg-muted/30"
                                    >
                                      <TableCell></TableCell>
                                      <TableCell></TableCell>
                                      <TableCell className="text-sm text-muted-foreground pl-8">
                                        <Badge
                                          variant="outline"
                                          className="text-xs mr-2"
                                        >
                                          {eb.entityCode}
                                        </Badge>
                                        {eb.entityName}
                                      </TableCell>
                                      <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                                        {formatCurrency(eb.beginningBalance)}
                                      </TableCell>
                                      <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                                        {formatCurrency(eb.debitTotal)}
                                      </TableCell>
                                      <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                                        {formatCurrency(eb.creditTotal)}
                                      </TableCell>
                                      <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                                        {formatCurrency(eb.endingBalance)}
                                      </TableCell>
                                    </TableRow>
                                  ))}
                              </>
                            );
                          })}
                        </TableBody>
                      </Table>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Unmapped Accounts Warning */}
      {unmappedAccounts.length > 0 && (
        <Card className="border-amber-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-amber-700">
              <AlertTriangle className="h-5 w-5" />
              Unmapped Entity Accounts ({unmappedAccounts.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              The following entity accounts are not mapped to any master account
              and are excluded from the consolidated view. Map them in the Master
              GL settings to include their balances.
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Entity</TableHead>
                  <TableHead className="w-24">Number</TableHead>
                  <TableHead>Account Name</TableHead>
                  <TableHead>Classification</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {unmappedAccounts.slice(0, 50).map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {a.entityCode}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {a.accountNumber ?? "---"}
                    </TableCell>
                    <TableCell>{a.name}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          CLASSIFICATION_COLORS[
                            a.classification as AccountClassification
                          ] ?? ""
                        }
                      >
                        {a.classification}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(a.currentBalance)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {unmappedAccounts.length > 50 && (
              <p className="text-sm text-muted-foreground mt-2">
                ...and {unmappedAccounts.length - 50} more unmapped accounts.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
