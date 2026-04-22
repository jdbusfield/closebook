"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
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
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Upload,
  Landmark,
  DollarSign,
  ArrowRight,
  TrendingDown,
  Percent,
  CreditCard,
  Plus,
  FileText,
} from "lucide-react";
import { DebtReconciliationTab } from "./reconciliation-tab";
import {
  formatCurrency,
  formatPercentage,
  getCurrentPeriod,
  getPeriodLabel,
} from "@/lib/utils/dates";
import type { DebtStatus } from "@/lib/types/database";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyInstrument = any;

interface AmortizationPeriod {
  debt_instrument_id: string;
  beginning_balance: number;
  payment: number;
  principal: number;
  interest: number;
  ending_balance: number;
  interest_rate: number | null;
}

interface GLBalance {
  account_id: string;
  ending_balance: number;
}

interface TransactionSummary {
  principal: number;
  interest: number;
  fees: number;
  payment: number;
}

const STATUS_LABELS: Record<DebtStatus, string> = {
  active: "Active",
  paid_off: "Paid Off",
  inactive: "Inactive",
};

const STATUS_VARIANTS: Record<DebtStatus, "default" | "secondary" | "outline"> = {
  active: "default",
  paid_off: "secondary",
  inactive: "outline",
};

const TYPE_LABELS: Record<string, string> = {
  term_loan: "Term Loan",
  line_of_credit: "Line of Credit",
  revolving_credit: "Revolving Credit",
  investor_loc: "Investor LOC",
  mortgage: "Mortgage",
  equipment_loan: "Equipment Loan",
  balloon_loan: "Balloon Loan",
  bridge_loan: "Bridge Loan",
  sba_loan: "SBA Loan",
  other: "Other",
};

const PAYMENT_STRUCTURE_LABELS: Record<string, string> = {
  principal_and_interest: "P&I",
  interest_only: "Interest Only",
  balloon: "Balloon",
  custom: "Custom",
  revolving: "Revolving",
};

export default function DebtPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const supabase = createClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const current = getCurrentPeriod();
  const [periodYear, setPeriodYear] = useState(current.year);
  const [periodMonth, setPeriodMonth] = useState(current.month);
  const [instruments, setInstruments] = useState<AnyInstrument[]>([]);
  const [amortization, setAmortization] = useState<
    Record<string, AmortizationPeriod>
  >({});
  const [glBalances, setGLBalances] = useState<GLBalance[]>([]);
  const [txnSummary, setTxnSummary] = useState<Record<string, TransactionSummary>>({});
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    instrument_name: "",
    lender_name: "",
    loan_number: "",
    debt_type: "term_loan",
    payment_structure: "principal_and_interest",
    original_amount: "",
    interest_rate: "",
    rate_type: "fixed",
    index_rate_name: "",
    spread_margin: "",
    term_months: "",
    start_date: "",
    maturity_date: "",
    payment_amount: "",
    credit_limit: "",
    current_draw: "",
    day_count_convention: "30/360",
    balloon_amount: "",
    is_secured: false,
    collateral_description: "",
    notes: "",
  });

  function resetForm() {
    setForm({
      instrument_name: "",
      lender_name: "",
      loan_number: "",
      debt_type: "term_loan",
      payment_structure: "principal_and_interest",
      original_amount: "",
      interest_rate: "",
      rate_type: "fixed",
      index_rate_name: "",
      spread_margin: "",
      term_months: "",
      start_date: "",
      maturity_date: "",
      payment_amount: "",
      credit_limit: "",
      current_draw: "",
      day_count_convention: "30/360",
      balloon_amount: "",
      is_secured: false,
      collateral_description: "",
      notes: "",
    });
  }

  async function handleCreate() {
    if (!form.instrument_name || !form.original_amount || !form.start_date) {
      toast.error("Name, original amount, and start date are required");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/debt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity_id: entityId,
          instrument_name: form.instrument_name,
          lender_name: form.lender_name || null,
          loan_number: form.loan_number || null,
          debt_type: form.debt_type,
          payment_structure: form.payment_structure,
          original_amount: parseFloat(form.original_amount),
          interest_rate: parseFloat(form.interest_rate) || 0,
          rate_type: form.rate_type,
          index_rate_name: form.index_rate_name || null,
          spread_margin: form.spread_margin ? parseFloat(form.spread_margin) : null,
          term_months: form.term_months ? parseInt(form.term_months) : null,
          start_date: form.start_date,
          maturity_date: form.maturity_date || null,
          payment_amount: form.payment_amount ? parseFloat(form.payment_amount) : null,
          credit_limit: form.credit_limit ? parseFloat(form.credit_limit) : null,
          current_draw: form.current_draw ? parseFloat(form.current_draw) : null,
          day_count_convention: form.day_count_convention,
          balloon_amount: form.balloon_amount ? parseFloat(form.balloon_amount) : null,
          is_secured: form.is_secured,
          collateral_description: form.collateral_description || null,
          notes: form.notes || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || "Failed to create instrument");
      } else {
        toast.success("Instrument created");
        setAddOpen(false);
        resetForm();
        loadData();
      }
    } catch {
      toast.error("Network error");
    }
    setSaving(false);
  }

  const loadData = useCallback(async () => {
    setLoading(true);

    const { data: instrData } = await supabase
      .from("debt_instruments")
      .select("*")
      .eq("entity_id", entityId)
      .order("instrument_name");

    const instr = (instrData ?? []) as AnyInstrument[];
    setInstruments(instr);

    if (instr.length > 0) {
      const instrIds = instr.map((i: AnyInstrument) => i.id);
      const { data: amortData } = await supabase
        .from("debt_amortization")
        .select(
          "debt_instrument_id, beginning_balance, payment, principal, interest, ending_balance, interest_rate"
        )
        .in("debt_instrument_id", instrIds)
        .eq("period_year", periodYear)
        .eq("period_month", periodMonth);

      const amortMap: Record<string, AmortizationPeriod> = {};
      if (amortData) {
        for (const row of amortData as unknown as AmortizationPeriod[]) {
          amortMap[row.debt_instrument_id] = row;
        }
      }
      setAmortization(amortMap);

      // Fetch transactions for the selected period to derive actual principal/interest/fees
      const periodStart = `${periodYear}-${String(periodMonth).padStart(2, "0")}-01`;
      const periodEnd = periodMonth === 12
        ? `${periodYear + 1}-01-01`
        : `${periodYear}-${String(periodMonth + 1).padStart(2, "0")}-01`;

      const { data: txnData } = await supabase
        .from("debt_transactions")
        .select("debt_instrument_id, transaction_type, amount, to_principal, to_interest, to_fees")
        .in("debt_instrument_id", instrIds)
        .gte("transaction_date", periodStart)
        .lt("transaction_date", periodEnd);

      const txnMap: Record<string, TransactionSummary> = {};
      if (txnData) {
        for (const t of txnData as unknown as { debt_instrument_id: string; transaction_type: string; amount: number; to_principal: number; to_interest: number; to_fees: number }[]) {
          if (!txnMap[t.debt_instrument_id]) {
            txnMap[t.debt_instrument_id] = { principal: 0, interest: 0, fees: 0, payment: 0 };
          }
          const s = txnMap[t.debt_instrument_id];
          const hasBreakdown = (t.to_principal ?? 0) !== 0 || (t.to_interest ?? 0) !== 0 || (t.to_fees ?? 0) !== 0;
          if (hasBreakdown) {
            s.principal += t.to_principal ?? 0;
            s.interest += t.to_interest ?? 0;
            s.fees += t.to_fees ?? 0;
            s.payment += (t.to_principal ?? 0) + (t.to_interest ?? 0) + (t.to_fees ?? 0);
          } else {
            // Infer allocation from transaction type when breakdown fields are empty
            const amt = t.amount ?? 0;
            const principalTypes = ["principal_payment", "vehicle_payoff", "payoff", "advance"];
            const interestTypes = ["interest_payment"];
            const feeTypes = ["fee_payment", "late_fee", "misc_fee", "origination_fee", "annual_fee"];
            if (principalTypes.includes(t.transaction_type)) {
              s.principal += amt;
            } else if (interestTypes.includes(t.transaction_type)) {
              s.interest += amt;
            } else if (feeTypes.includes(t.transaction_type)) {
              s.fees += amt;
            }
            s.payment += amt;
          }
        }
      }
      setTxnSummary(txnMap);

      const liabilityAccountIds = instr
        .map((i: AnyInstrument) => i.liability_account_id)
        .filter((id: string | null): id is string => id !== null);

      if (liabilityAccountIds.length > 0) {
        const { data: glData } = await supabase
          .from("gl_balances")
          .select("account_id, ending_balance")
          .eq("entity_id", entityId)
          .eq("period_year", periodYear)
          .eq("period_month", periodMonth)
          .in("account_id", liabilityAccountIds);

        setGLBalances((glData as unknown as GLBalance[]) ?? []);
      } else {
        setGLBalances([]);
      }
    } else {
      setAmortization({});
      setGLBalances([]);
      setTxnSummary({});
    }

    setLoading(false);
  }, [supabase, entityId, periodYear, periodMonth]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("entityId", entityId);

    try {
      const res = await fetch("/api/debt/upload", {
        method: "POST",
        body: formData,
      });

      const json = await res.json();

      if (!res.ok) {
        toast.error(json.error || "Upload failed");
        if (json.errors?.length > 0) {
          json.errors.slice(0, 5).forEach((err: string) => toast.warning(err));
        }
      } else {
        toast.success(
          `Imported ${json.imported} instrument${json.imported !== 1 ? "s" : ""}${
            json.skipped > 0 ? ` (${json.skipped} skipped)` : ""
          }`
        );
        if (json.errors?.length > 0) {
          json.errors.slice(0, 5).forEach((err: string) => toast.warning(err));
        }
        loadData();
      }
    } catch {
      toast.error("Upload failed — network error");
    }

    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // Compute summary totals — derived from transactions (actual), not amortization (projected)
  const activeInstruments = instruments.filter((i: AnyInstrument) => i.status === "active");
  const totalOutstanding = activeInstruments.reduce(
    (sum: number, i: AnyInstrument) => sum + (i.current_draw ?? i.original_amount ?? 0),
    0
  );
  const totalPrincipal = Object.values(txnSummary).reduce(
    (sum, s) => sum + s.principal,
    0
  );
  const totalInterest = Object.values(txnSummary).reduce(
    (sum, s) => sum + s.interest,
    0
  );
  const totalPayment = Object.values(txnSummary).reduce(
    (sum, s) => sum + s.payment,
    0
  );

  // Current / Long-term split
  const totalCurrentPortion = instruments.reduce(
    (sum: number, i: AnyInstrument) => sum + (i.current_portion ?? 0),
    0
  );
  const totalLongTermPortion = instruments.reduce(
    (sum: number, i: AnyInstrument) => sum + (i.long_term_portion ?? 0),
    0
  );

  // Credit utilization for LOCs
  const locTypes = ["line_of_credit", "revolving_credit", "investor_loc"];
  const totalCreditLimit = instruments
    .filter((i: AnyInstrument) => locTypes.includes(i.debt_type))
    .reduce((sum: number, i: AnyInstrument) => sum + (i.credit_limit ?? 0), 0);
  const totalCreditUsed = instruments
    .filter((i: AnyInstrument) => locTypes.includes(i.debt_type))
    .reduce((sum: number, i: AnyInstrument) => sum + (i.current_draw ?? 0), 0);
  const creditUtilization =
    totalCreditLimit > 0 ? (totalCreditUsed / totalCreditLimit) * 100 : 0;

  // Weighted average interest rate
  const totalWeightedRate = instruments
    .filter((i: AnyInstrument) => i.status === "active")
    .reduce((sum: number, i: AnyInstrument) => {
      const balance = i.current_draw ?? i.original_amount;
      return sum + i.interest_rate * balance;
    }, 0);
  const weightedAvgRate =
    totalOutstanding > 0 ? totalWeightedRate / totalOutstanding : 0;

  // GL comparison
  const glTotal = glBalances.reduce(
    (sum, gl) => sum + Math.abs(gl.ending_balance),
    0
  );
  const glVariance = totalOutstanding - glTotal;
  const hasGLData = glBalances.length > 0;

  const years = Array.from({ length: 5 }, (_, i) => current.year - 2 + i);
  const months = Array.from({ length: 12 }, (_, i) => i + 1);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Debt Schedule
          </h1>
          <p className="text-muted-foreground">
            Track loans, lines of credit, and amortization schedules
          </p>
        </div>
      </div>

      <Tabs defaultValue="schedule" className="space-y-6">
        <TabsList>
          <TabsTrigger value="schedule">Schedule</TabsTrigger>
          <TabsTrigger value="reconciliation">Reconciliation</TabsTrigger>
        </TabsList>

        <TabsContent value="schedule" className="space-y-6">
      <div className="flex items-center justify-end">
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={handleUpload}
          />
          <Link href={`/${entityId}/debt/accrued-interest`}>
            <Button variant="outline">
              <FileText className="mr-2 h-4 w-4" />
              Accrued Interest Report
            </Button>
          </Link>
          <Button
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            <Upload className="mr-2 h-4 w-4" />
            {uploading ? "Importing..." : "Import Spreadsheet"}
          </Button>
          <Dialog open={addOpen} onOpenChange={(open) => { setAddOpen(open); if (!open) resetForm(); }}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Add Instrument
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>New Debt Instrument</DialogTitle>
              </DialogHeader>
              <div className="grid gap-4 py-2">
                {/* Row 1: Name & Lender */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="instrument_name">Instrument Name *</Label>
                    <Input id="instrument_name" value={form.instrument_name} onChange={(e) => setForm({ ...form, instrument_name: e.target.value })} placeholder="e.g. ALT Revolving LOC" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="lender_name">Lender</Label>
                    <Input id="lender_name" value={form.lender_name} onChange={(e) => setForm({ ...form, lender_name: e.target.value })} placeholder="e.g. Auto & Light Truck" />
                  </div>
                </div>
                {/* Row 2: Loan #, Type, Structure */}
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="loan_number">Loan / Account #</Label>
                    <Input id="loan_number" value={form.loan_number} onChange={(e) => setForm({ ...form, loan_number: e.target.value })} placeholder="992210108992" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="debt_type">Debt Type</Label>
                    <Select value={form.debt_type} onValueChange={(v) => setForm({ ...form, debt_type: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(TYPE_LABELS).map(([k, v]) => (
                          <SelectItem key={k} value={k}>{v}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="payment_structure">Payment Structure</Label>
                    <Select value={form.payment_structure} onValueChange={(v) => setForm({ ...form, payment_structure: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(PAYMENT_STRUCTURE_LABELS).map(([k, v]) => (
                          <SelectItem key={k} value={k}>{v}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {/* Row 3: Amount, Rate, Rate Type */}
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="original_amount">Original Amount *</Label>
                    <Input id="original_amount" type="number" step="0.01" value={form.original_amount} onChange={(e) => setForm({ ...form, original_amount: e.target.value })} placeholder="500000" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="interest_rate">Interest Rate (%)</Label>
                    <Input id="interest_rate" type="number" step="0.01" value={form.interest_rate} onChange={(e) => setForm({ ...form, interest_rate: e.target.value })} placeholder="9.25" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="rate_type">Rate Type</Label>
                    <Select value={form.rate_type} onValueChange={(v) => setForm({ ...form, rate_type: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="fixed">Fixed</SelectItem>
                        <SelectItem value="variable">Variable</SelectItem>
                        <SelectItem value="adjustable">Adjustable</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {/* Conditional: Variable rate fields */}
                {form.rate_type !== "fixed" && (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="index_rate_name">Index / Benchmark</Label>
                      <Input id="index_rate_name" value={form.index_rate_name} onChange={(e) => setForm({ ...form, index_rate_name: e.target.value })} placeholder="e.g. Prime, SOFR" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="spread_margin">Spread / Margin (%)</Label>
                      <Input id="spread_margin" type="number" step="0.01" value={form.spread_margin} onChange={(e) => setForm({ ...form, spread_margin: e.target.value })} placeholder="1.75" />
                    </div>
                  </div>
                )}
                {/* Row 4: Dates & Term */}
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="start_date">Start Date *</Label>
                    <Input id="start_date" type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="maturity_date">Maturity Date</Label>
                    <Input id="maturity_date" type="date" value={form.maturity_date} onChange={(e) => setForm({ ...form, maturity_date: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="term_months">Term (months)</Label>
                    <Input id="term_months" type="number" value={form.term_months} onChange={(e) => setForm({ ...form, term_months: e.target.value })} placeholder="60" />
                  </div>
                </div>
                {/* Row 5: Payment, Credit Limit, Current Draw */}
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="payment_amount">Monthly Payment</Label>
                    <Input id="payment_amount" type="number" step="0.01" value={form.payment_amount} onChange={(e) => setForm({ ...form, payment_amount: e.target.value })} placeholder="5000" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="credit_limit">Credit Limit</Label>
                    <Input id="credit_limit" type="number" step="0.01" value={form.credit_limit} onChange={(e) => setForm({ ...form, credit_limit: e.target.value })} placeholder="For LOCs" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="current_draw">Current Draw / Balance</Label>
                    <Input id="current_draw" type="number" step="0.01" value={form.current_draw} onChange={(e) => setForm({ ...form, current_draw: e.target.value })} placeholder="Outstanding balance" />
                  </div>
                </div>
                {/* Row 6: Day count, Balloon */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="day_count_convention">Day Count Convention</Label>
                    <Select value={form.day_count_convention} onValueChange={(v) => setForm({ ...form, day_count_convention: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="30/360">30/360</SelectItem>
                        <SelectItem value="actual/360">Actual/360</SelectItem>
                        <SelectItem value="actual/365">Actual/365</SelectItem>
                        <SelectItem value="actual/actual">Actual/Actual</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {form.payment_structure === "balloon" && (
                    <div className="space-y-2">
                      <Label htmlFor="balloon_amount">Balloon Amount</Label>
                      <Input id="balloon_amount" type="number" step="0.01" value={form.balloon_amount} onChange={(e) => setForm({ ...form, balloon_amount: e.target.value })} />
                    </div>
                  )}
                </div>
                {/* Row 7: Collateral & Notes */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="collateral_description">Collateral Description</Label>
                    <Input id="collateral_description" value={form.collateral_description} onChange={(e) => setForm({ ...form, collateral_description: e.target.value, is_secured: !!e.target.value })} placeholder="e.g. Vehicle fleet" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="notes">Notes</Label>
                    <Input id="notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                  </div>
                </div>
                {/* Submit */}
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
                  <Button onClick={handleCreate} disabled={saving}>
                    {saving ? "Creating..." : "Create Instrument"}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Period Selector */}
      <div className="flex items-center gap-4">
        <Select
          value={String(periodYear)}
          onValueChange={(v) => setPeriodYear(Number(v))}
        >
          <SelectTrigger className="w-[120px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {years.map((y) => (
              <SelectItem key={y} value={String(y)}>
                {y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={String(periodMonth)}
          onValueChange={(v) => setPeriodMonth(Number(v))}
        >
          <SelectTrigger className="w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {months.map((m) => (
              <SelectItem key={m} value={String(m)}>
                {getPeriodLabel(current.year, m).split(" ")[0]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">
          {getPeriodLabel(periodYear, periodMonth)}
        </span>
      </div>

      {/* Summary Cards — Row 1: Core Metrics */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Total Outstanding
              </p>
            </div>
            <p className="text-2xl font-semibold tabular-nums mt-1">
              {formatCurrency(totalOutstanding)}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {activeInstruments.length} active instrument
              {activeInstruments.length !== 1 ? "s" : ""}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <TrendingDown className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Monthly Payment</p>
            </div>
            <p className="text-2xl font-semibold tabular-nums mt-1">
              {formatCurrency(totalPayment)}
            </p>
            <div className="flex gap-4 text-xs text-muted-foreground mt-1">
              <span>P: {formatCurrency(totalPrincipal)}</span>
              <span>I: {formatCurrency(totalInterest)}</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Percent className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Wtd Avg Rate</p>
            </div>
            <p className="text-2xl font-semibold tabular-nums mt-1">
              {formatPercentage(weightedAvgRate, 2)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Credit Utilization</p>
            </div>
            <p className="text-2xl font-semibold tabular-nums mt-1">
              {totalCreditLimit > 0
                ? `${creditUtilization.toFixed(1)}%`
                : "N/A"}
            </p>
            {totalCreditLimit > 0 && (
              <p className="text-xs text-muted-foreground mt-1">
                {formatCurrency(totalCreditUsed)} / {formatCurrency(totalCreditLimit)}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Summary Cards — Row 2: Classification */}
      {(totalCurrentPortion > 0 || totalLongTermPortion > 0) && (
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">
                Current Portion ({"<"}12 mo)
              </p>
              <p className="text-xl font-semibold tabular-nums mt-1">
                {formatCurrency(totalCurrentPortion)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">
                Long-Term Portion
              </p>
              <p className="text-xl font-semibold tabular-nums mt-1">
                {formatCurrency(totalLongTermPortion)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">
                Total Debt
              </p>
              <p className="text-xl font-semibold tabular-nums mt-1">
                {formatCurrency(totalCurrentPortion + totalLongTermPortion)}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* GL Comparison */}
      {hasGLData && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">
                  GL Comparison — {getPeriodLabel(periodYear, periodMonth)}
                </p>
                <div className="flex items-center gap-6 mt-2">
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Schedule Total
                    </p>
                    <p className="text-lg font-semibold tabular-nums">
                      {formatCurrency(totalOutstanding)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">GL Balance</p>
                    <p className="text-lg font-semibold tabular-nums">
                      {formatCurrency(glTotal)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Variance</p>
                    <p
                      className={`text-lg font-semibold tabular-nums ${
                        glVariance === 0 ? "text-green-600" : "text-red-600"
                      }`}
                    >
                      {formatCurrency(glVariance)}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Instruments Table */}
      <Card>
        <CardHeader>
          <CardTitle>Debt Instruments</CardTitle>
          <CardDescription>
            {instruments.length} instrument
            {instruments.length !== 1 ? "s" : ""} for{" "}
            {getPeriodLabel(periodYear, periodMonth)}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : instruments.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Landmark className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">No Debt Instruments</h3>
              <p className="text-muted-foreground text-center mb-4">
                Upload a spreadsheet with your loan and line of credit data to
                start tracking debt.
              </p>
              <Button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                <Upload className="mr-2 h-4 w-4" />
                Import Spreadsheet
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Instrument</TableHead>
                    <TableHead>Lender</TableHead>
                    <TableHead>Loan #</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Structure</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    <TableHead className="text-right">Original / Limit</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead className="text-right">Payment</TableHead>
                    <TableHead className="text-right">Principal</TableHead>
                    <TableHead className="text-right">Interest</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {instruments.map((instr: AnyInstrument) => {
                    const amort = amortization[instr.id];
                    const txn = txnSummary[instr.id];
                    const isLOC = locTypes.includes(instr.debt_type);
                    return (
                      <TableRow key={instr.id}>
                        <TableCell className="font-medium">
                          {instr.instrument_name}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {instr.lender_name ?? "---"}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-xs font-mono">
                          {instr.loan_number ?? "---"}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {TYPE_LABELS[instr.debt_type] ?? instr.debt_type}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <span className="text-xs text-muted-foreground">
                            {PAYMENT_STRUCTURE_LABELS[instr.payment_structure] ??
                              instr.payment_structure ?? "P&I"}
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          <div>
                            {amort?.interest_rate != null
                              ? formatPercentage(amort.interest_rate, 2)
                              : formatPercentage(instr.interest_rate, 2)}
                          </div>
                          {instr.rate_type && instr.rate_type !== "fixed" && (
                            <span className="text-xs text-muted-foreground">
                              {instr.rate_type}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {isLOC && instr.credit_limit
                            ? formatCurrency(instr.credit_limit)
                            : formatCurrency(instr.original_amount)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-medium">
                          {formatCurrency(instr.current_draw ?? instr.original_amount ?? 0)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {txn ? formatCurrency(txn.payment) : formatCurrency(0)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {txn ? formatCurrency(txn.principal) : formatCurrency(0)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {txn ? formatCurrency(txn.interest) : formatCurrency(0)}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              STATUS_VARIANTS[instr.status as DebtStatus] ?? "outline"
                            }
                          >
                            {STATUS_LABELS[instr.status as DebtStatus] ?? instr.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Link href={`/${entityId}/debt/${instr.id}`}>
                            <Button variant="ghost" size="sm">
                              <ArrowRight className="h-4 w-4" />
                            </Button>
                          </Link>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {/* Totals Row */}
                  <TableRow className="font-semibold border-t-2">
                    <TableCell colSpan={7}>Totals</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(totalOutstanding)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(totalPayment)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(totalPrincipal)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(totalInterest)}
                    </TableCell>
                    <TableCell colSpan={2} />
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
        </TabsContent>

        <TabsContent value="reconciliation">
          <DebtReconciliationTab entityId={entityId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
