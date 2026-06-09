"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AccountCombobox } from "@/components/ui/account-combobox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Textarea } from "@/components/ui/textarea";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Plus,
  X,
  Pencil,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils/dates";
import { DEBT_GL_ACCOUNT_GROUPS } from "@/lib/utils/debt-gl-groups";
import {
  computeInterestScheduleAtPeriod,
  type AccruedInterestTransaction,
  type AccruedInterestRateChange,
} from "@/lib/utils/debt-accrued-interest";
import { toast } from "sonner";

interface DebtReconciliationTabProps {
  entityId: string;
}

interface EntityAccount {
  id: string;
  account_number: string | null;
  name: string;
  classification: string;
  account_type: string;
}

interface InstrumentSummary {
  id: string;
  instrument_name: string;
  lender_name: string | null;
  debt_type: string;
  current_draw: number | null;
  original_amount: number;
  current_portion: number | null;
  long_term_portion: number | null;
  ending_balance: number | null;
  status: string;
}

interface ReconciliationRecord {
  id: string;
  gl_account_group: string;
  gl_balance: number | null;
  subledger_balance: number | null;
  variance: number | null;
  is_reconciled: boolean;
  reconciled_at: string | null;
  notes: string | null;
  prior_period_adjustment: number | null;
  prior_period_adjustment_note: string | null;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const LOC_TYPES = new Set(["line_of_credit", "revolving_credit", "investor_loc"]);

// A variance (or GL drift since reconciliation) within this dollar amount is
// treated as reconciled — immaterial sub-dollar rounding shouldn't block a
// clean reconcile or flag an account as changed.
const RECONCILE_TOLERANCE = 1;

export function DebtReconciliationTab({ entityId }: DebtReconciliationTabProps) {
  const supabase = createClient();
  const now = new Date();
  const [periodYear, setPeriodYear] = useState(now.getFullYear());
  const [periodMonth, setPeriodMonth] = useState(now.getMonth() + 1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [ppaAmount, setPpaAmount] = useState<Record<string, string>>({});
  const [ppaNote, setPpaNote] = useState<Record<string, string>>({});
  const [ppaOpen, setPpaOpen] = useState<Set<string>>(new Set());
  // Most recent PPA from any STRICTLY prior period per group, used as the
  // default that carries forward until a new value is set in a later period.
  const [carryForwardPpa, setCarryForwardPpa] = useState<
    Record<
      string,
      { amount: number; note: string | null; year: number; month: number }
    >
  >({});

  // Data
  const [entityAccounts, setEntityAccounts] = useState<EntityAccount[]>([]);
  const [mappedAccounts, setMappedAccounts] = useState<
    Record<string, { id: string; account_id: string }[]>
  >({});
  const [glBalances, setGlBalances] = useState<Record<string, number>>({});
  const [subledgerBalances, setSubledgerBalances] = useState<
    Record<string, { total: number; instruments: InstrumentSummary[] }>
  >({});
  const [reconciliations, setReconciliations] = useState<
    Record<string, ReconciliationRecord>
  >({});
  const [unlinkedInstruments, setUnlinkedInstruments] = useState<InstrumentSummary[]>([]);
  const [yearSchedule, setYearSchedule] = useState<Record<string, "reconciled" | "stale" | "pending" | null>>({});

  // Account picker state
  const [addingToGroup, setAddingToGroup] = useState<string | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");

  const loadData = useCallback(async () => {
    setLoading(true);

    // 1. Fetch all entity accounts (for the picker)
    const { data: acctData } = await supabase
      .from("accounts")
      .select("id, account_number, name, classification, account_type")
      .eq("entity_id", entityId)
      .eq("is_active", true)
      .order("account_number");

    setEntityAccounts((acctData ?? []) as EntityAccount[]);

    // 2. Fetch configured account mappings for this entity
    const { data: mappingData } = await supabase
      .from("debt_reconciliation_accounts")
      .select("id, gl_account_group, account_id")
      .eq("entity_id", entityId);

    const mapped: Record<string, { id: string; account_id: string }[]> = {};
    for (const group of DEBT_GL_ACCOUNT_GROUPS) {
      mapped[group.key] = [];
    }
    for (const m of (mappingData ?? []) as { id: string; gl_account_group: string; account_id: string }[]) {
      if (!mapped[m.gl_account_group]) mapped[m.gl_account_group] = [];
      mapped[m.gl_account_group].push({ id: m.id, account_id: m.account_id });
    }
    setMappedAccounts(mapped);

    // 3. Fetch GL balances for all mapped accounts
    const allAccountIds = Object.values(mapped).flat().map((m) => m.account_id);
    const balances: Record<string, number> = {};

    if (allAccountIds.length > 0) {
      const { data: glData } = await supabase
        .from("gl_balances")
        .select("account_id, ending_balance")
        .eq("entity_id", entityId)
        .eq("period_year", periodYear)
        .eq("period_month", periodMonth)
        .in("account_id", allAccountIds);

      const glMap: Record<string, number> = {};
      for (const row of (glData ?? []) as { account_id: string; ending_balance: number }[]) {
        glMap[row.account_id] = Number(row.ending_balance ?? 0);
      }

      for (const group of DEBT_GL_ACCOUNT_GROUPS) {
        const groupAcctIds = mapped[group.key]?.map((m) => m.account_id) ?? [];
        // Liability accounts typically have credit (negative) balances in the GL.
        // We take the absolute value so the comparison with the subledger is intuitive.
        balances[group.key] = groupAcctIds.reduce(
          (sum, id) => sum + Math.abs(glMap[id] ?? 0),
          0
        );
      }
    }
    setGlBalances(balances);

    // 4. Fetch debt instruments and compute subledger balances per group
    // Subledger = original_amount + actual transactions through end of selected period
    const { data: instrData } = await supabase
      .from("debt_instruments")
      .select("*")
      .eq("entity_id", entityId);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const instruments = (instrData ?? []) as any[];
    const instrIds = instruments.map((i) => i.id);

    // Fetch ALL transactions for these instruments up through end of selected period
    // Use actual last day of month (not hardcoded 31, which is invalid for Feb/Apr/Jun/Sep/Nov)
    const lastDay = new Date(periodYear, periodMonth, 0).getDate();
    const periodEnd = `${periodYear}-${String(periodMonth).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    let txnsByInstrument: Record<string, { transaction_type: string; amount: number; to_principal: number }[]> = {};

    if (instrIds.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: txnData } = await (supabase as any)
        .from("debt_transactions")
        .select("debt_instrument_id, transaction_type, amount, to_principal")
        .in("debt_instrument_id", instrIds)
        .lte("effective_date", periodEnd)
        .order("effective_date", { ascending: true })
        .order("created_at", { ascending: true })
        .limit(5000);

      for (const txn of (txnData ?? []) as { debt_instrument_id: string; transaction_type: string; amount: number; to_principal: number }[]) {
        if (!txnsByInstrument[txn.debt_instrument_id]) txnsByInstrument[txn.debt_instrument_id] = [];
        txnsByInstrument[txn.debt_instrument_id].push(txn);
      }
    }

    // Replay transactions from original_amount to get ending balance per instrument
    function computeEndingBalance(instr: { id: string; original_amount: number }) {
      let balance = instr.original_amount ?? 0;
      const txns = txnsByInstrument[instr.id] ?? [];
      for (const txn of txns) {
        if (txn.transaction_type === "advance") {
          balance += Math.abs(txn.amount);
        } else if (txn.transaction_type === "principal_payment" || txn.transaction_type === "vehicle_payoff") {
          balance -= Math.abs(txn.to_principal ?? txn.amount);
        } else if (txn.transaction_type === "payoff") {
          balance = 0;
        }
        balance = Math.max(0, balance);
      }
      return Math.round(balance * 100) / 100;
    }

    // Build subledger totals per group
    const grouped: Record<string, { total: number; instruments: InstrumentSummary[] }> = {};
    for (const group of DEBT_GL_ACCOUNT_GROUPS) {
      grouped[group.key] = { total: 0, instruments: [] };
    }

    const unlinked: InstrumentSummary[] = [];

    for (const instr of instruments) {
      if (instr.status === "inactive") continue;

      const endingBal = computeEndingBalance(instr);
      const instrWithBal = { ...instr, ending_balance: endingBal };

      // Determine which group this instrument belongs to based on debt type
      const groupKey = LOC_TYPES.has(instr.debt_type)
        ? "loc_payable"
        : "notes_payable_long_term";

      grouped[groupKey].total += endingBal;
      grouped[groupKey].instruments.push(instrWithBal);

      // Track unlinked instruments (no liability_account_id set)
      if (!instr.liability_account_id && instr.status === "active") {
        unlinked.push(instrWithBal);
      }
    }

    // Interest payable & expense come from the SAME shared engine the debt
    // summary subledger uses (computeInterestScheduleAtPeriod), so the
    // reconciliation numbers can never drift from the Interest Payable section
    // on the debt page. Per instrument: unpaid (accrued-but-unpaid) interest
    // and year-to-date accrued interest expense, both as of the selected period.
    if (instrIds.length > 0) {
      // Rate history per instrument (shape matches AccruedInterestRateChange).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: rateData } = await (supabase as any)
        .from("debt_rate_history")
        .select("debt_instrument_id, effective_date, interest_rate")
        .in("debt_instrument_id", instrIds)
        .order("effective_date", { ascending: true });

      const ratesByInstrument: Record<string, AccruedInterestRateChange[]> = {};
      for (const r of (rateData ?? []) as { debt_instrument_id: string; effective_date: string; interest_rate: number }[]) {
        if (!ratesByInstrument[r.debt_instrument_id]) ratesByInstrument[r.debt_instrument_id] = [];
        ratesByInstrument[r.debt_instrument_id].push({
          effective_date: r.effective_date,
          interest_rate: r.interest_rate,
        });
      }

      // All transactions through end of selected period, grouped per instrument.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: allTxnData } = await (supabase as any)
        .from("debt_transactions")
        .select("debt_instrument_id, transaction_type, amount, to_principal, to_interest, effective_date")
        .in("debt_instrument_id", instrIds)
        .lte("effective_date", periodEnd)
        .order("effective_date", { ascending: true })
        .order("created_at", { ascending: true })
        .limit(5000);

      const interestTxnsByInstr: Record<string, AccruedInterestTransaction[]> = {};
      for (const t of (allTxnData ?? []) as { debt_instrument_id: string; transaction_type: string; amount: number; to_principal: number | null; to_interest: number | null; effective_date: string }[]) {
        if (!interestTxnsByInstr[t.debt_instrument_id]) interestTxnsByInstr[t.debt_instrument_id] = [];
        interestTxnsByInstr[t.debt_instrument_id].push({
          effective_date: t.effective_date,
          transaction_type: t.transaction_type,
          amount: t.amount,
          to_principal: t.to_principal,
          to_interest: t.to_interest,
        });
      }

      const round2 = (n: number) => Math.round(n * 100) / 100;
      let totalUnpaid = 0;
      let ytdTotal = 0;
      const unpaidInstruments: InstrumentSummary[] = [];
      const ytdInstruments: InstrumentSummary[] = [];

      for (const instr of instruments) {
        if (instr.status === "inactive") continue;

        const { unpaidInterest, ytdInterestExpense } =
          computeInterestScheduleAtPeriod({
            instrument: {
              start_date: instr.start_date,
              interest_rate: instr.interest_rate ?? 0,
              debt_type: instr.debt_type,
              day_count_convention: instr.day_count_convention,
              current_draw: instr.current_draw,
              original_amount: instr.original_amount,
              opening_accrued_interest: instr.opening_accrued_interest,
              is_pik: instr.is_pik,
            },
            transactions: interestTxnsByInstr[instr.id] ?? [],
            rateHistory: ratesByInstrument[instr.id] ?? [],
            targetYear: periodYear,
            targetMonth: periodMonth,
          });

        const unpaid = round2(unpaidInterest);
        if (unpaid > 0.005) {
          totalUnpaid += unpaid;
          unpaidInstruments.push({ ...instr, ending_balance: unpaid });
        }

        const ytd = round2(ytdInterestExpense);
        if (ytd > 0) {
          ytdTotal += ytd;
          ytdInstruments.push({ ...instr, ending_balance: ytd });
        }
      }

      grouped["interest_payable"] = { total: round2(totalUnpaid), instruments: unpaidInstruments };
      grouped["interest_expense"] = { total: round2(ytdTotal), instruments: ytdInstruments };
    }

    setSubledgerBalances(grouped);
    setUnlinkedInstruments(unlinked);

    // 5. Fetch existing reconciliation records
    const { data: reconData } = await supabase
      .from("debt_reconciliations")
      .select("*")
      .eq("entity_id", entityId)
      .eq("period_year", periodYear)
      .eq("period_month", periodMonth);

    const reconMap: Record<string, ReconciliationRecord> = {};
    const notesMap: Record<string, string> = {};
    const ppaAmountMap: Record<string, string> = {};
    const ppaNoteMap: Record<string, string> = {};
    const ppaOpenSet = new Set<string>();
    for (const r of (reconData ?? []) as ReconciliationRecord[]) {
      reconMap[r.gl_account_group] = r;
      notesMap[r.gl_account_group] = r.notes ?? "";
      const ppa = Number(r.prior_period_adjustment ?? 0);
      ppaAmountMap[r.gl_account_group] = ppa !== 0 ? String(ppa) : "";
      ppaNoteMap[r.gl_account_group] = r.prior_period_adjustment_note ?? "";
      if (ppa !== 0 || (r.prior_period_adjustment_note ?? "").length > 0) {
        ppaOpenSet.add(r.gl_account_group);
      }
    }

    // 5b. Fetch the most recent PPA from a strictly prior period per group,
    // so it carries forward into the current period until explicitly changed.
    const { data: priorPpaRows } = await supabase
      .from("debt_reconciliations")
      .select(
        "gl_account_group, period_year, period_month, prior_period_adjustment, prior_period_adjustment_note"
      )
      .eq("entity_id", entityId)
      .or(
        `period_year.lt.${periodYear},and(period_year.eq.${periodYear},period_month.lt.${periodMonth})`
      )
      .order("period_year", { ascending: false })
      .order("period_month", { ascending: false })
      .limit(1000);

    const carryForwardMap: Record<
      string,
      { amount: number; note: string | null; year: number; month: number }
    > = {};
    for (const r of (priorPpaRows ?? []) as {
      gl_account_group: string;
      period_year: number;
      period_month: number;
      prior_period_adjustment: number | null;
      prior_period_adjustment_note: string | null;
    }[]) {
      if (!carryForwardMap[r.gl_account_group]) {
        carryForwardMap[r.gl_account_group] = {
          amount: Number(r.prior_period_adjustment ?? 0),
          note: r.prior_period_adjustment_note,
          year: r.period_year,
          month: r.period_month,
        };
      }
    }

    // Seed the PPA input from the carried-forward adjustment when this period
    // hasn't set its own. A period only "owns" its adjustment if its
    // reconciliation row carries an explicit PPA — a reconciled row with no PPA
    // of its own (e.g. an older reconciliation done before this adjustment
    // existed) should still inherit the carry-forward. A dollar adjustment is
    // only seeded when it actually offsets this period's variance, so periods
    // whose variance has already resolved aren't disturbed.
    for (const group of DEBT_GL_ACCOUNT_GROUPS) {
      const existing = reconMap[group.key];
      const existingPpa = Number(existing?.prior_period_adjustment ?? 0);
      const existingNote = existing?.prior_period_adjustment_note ?? "";
      if (existing && (Math.abs(existingPpa) > 0.005 || existingNote.length > 0)) {
        continue;
      }

      const cf = carryForwardMap[group.key];
      if (!cf) continue;
      const hasAmount = Math.abs(cf.amount) > 0.005;
      const hasNote = (cf.note ?? "").length > 0;
      if (!hasAmount && !hasNote) continue;

      // Only require the offset check for an actual dollar adjustment; a
      // note-only carry-forward is informational and always carries.
      if (hasAmount) {
        const groupVariance =
          (balances[group.key] ?? 0) - (grouped[group.key]?.total ?? 0);
        if (Math.abs(groupVariance - cf.amount) >= Math.abs(groupVariance)) {
          continue;
        }
      }

      ppaAmountMap[group.key] = hasAmount ? String(cf.amount) : "";
      ppaNoteMap[group.key] = cf.note ?? "";
      ppaOpenSet.add(group.key);
    }

    setReconciliations(reconMap);
    setNotes(notesMap);
    setPpaAmount(ppaAmountMap);
    setPpaNote(ppaNoteMap);
    setPpaOpen(ppaOpenSet);
    setCarryForwardPpa(carryForwardMap);

    // 6. Fetch year-wide reconciliation status + GL data for schedule overview
    const { data: yearReconData } = await supabase
      .from("debt_reconciliations")
      .select("period_month, gl_account_group, is_reconciled, gl_balance")
      .eq("entity_id", entityId)
      .eq("period_year", periodYear);

    interface YearReconEntry { is_reconciled: boolean; gl_balance: number | null; }
    const yearReconByKey: Record<string, YearReconEntry> = {};
    for (const r of (yearReconData ?? []) as { period_month: number; gl_account_group: string; is_reconciled: boolean; gl_balance: number | null }[]) {
      yearReconByKey[`${r.period_month}_${r.gl_account_group}`] = {
        is_reconciled: r.is_reconciled,
        gl_balance: r.gl_balance,
      };
    }

    // Fetch GL balances for all months of the year to detect data and check for stale reconciliations
    const yearGlTotals: Record<string, number> = {};
    const yearHasData: Record<string, boolean> = {};
    if (allAccountIds.length > 0) {
      const { data: yearGlData } = await supabase
        .from("gl_balances")
        .select("account_id, period_month, ending_balance")
        .eq("entity_id", entityId)
        .eq("period_year", periodYear)
        .in("account_id", allAccountIds);

      for (const row of (yearGlData ?? []) as { account_id: string; period_month: number; ending_balance: number }[]) {
        for (const group of DEBT_GL_ACCOUNT_GROUPS) {
          const groupAcctIds = mapped[group.key]?.map((m) => m.account_id) ?? [];
          if (groupAcctIds.includes(row.account_id)) {
            const key = `${row.period_month}_${group.key}`;
            yearHasData[key] = true;
            yearGlTotals[key] = (yearGlTotals[key] ?? 0) + Math.abs(Number(row.ending_balance ?? 0));
          }
        }
      }
    }

    // Build schedule: reconciled / stale / pending / blank
    const scheduleMap: Record<string, "reconciled" | "stale" | "pending" | null> = {};
    for (let m = 1; m <= 12; m++) {
      for (const group of DEBT_GL_ACCOUNT_GROUPS) {
        const key = `${m}_${group.key}`;
        const recon = yearReconByKey[key];

        if (recon?.is_reconciled) {
          // Check if GL balance has changed since reconciliation was recorded
          const storedGl = recon.gl_balance ?? 0;
          const currentGl = yearGlTotals[key] ?? 0;
          if (Math.abs(storedGl - currentGl) > RECONCILE_TOLERANCE) {
            scheduleMap[key] = "stale";
          } else {
            scheduleMap[key] = "reconciled";
          }
        } else if (yearHasData[key] || recon?.is_reconciled === false) {
          scheduleMap[key] = "pending";
        }
        // else: no data → leave undefined (blank)
      }
    }
    setYearSchedule(scheduleMap);

    setLoading(false);
  }, [supabase, entityId, periodYear, periodMonth]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleAddAccount = async (groupKey: string) => {
    if (!selectedAccountId) return;
    setSaving(groupKey);

    const { error } = await supabase.from("debt_reconciliation_accounts").insert({
      entity_id: entityId,
      gl_account_group: groupKey,
      account_id: selectedAccountId,
    });

    if (error) {
      toast.error(error.message.includes("duplicate")
        ? "Account already mapped to this group"
        : error.message
      );
    } else {
      toast.success("Account linked");
      setAddingToGroup(null);
      setSelectedAccountId("");
      loadData();
    }
    setSaving(null);
  };

  const handleRemoveAccount = async (mappingId: string, groupKey: string) => {
    setSaving(groupKey);
    await supabase.from("debt_reconciliation_accounts").delete().eq("id", mappingId);
    loadData();
    setSaving(null);
  };

  const handleReconcile = async (groupKey: string) => {
    setSaving(groupKey);
    const glBal = glBalances[groupKey] ?? 0;
    const subBal = subledgerBalances[groupKey]?.total ?? 0;
    const variance = glBal - subBal;
    const ppa = parseFloat(ppaAmount[groupKey] ?? "") || 0;
    const ppaText = (ppaNote[groupKey] ?? "").trim();

    const { data: userData } = await supabase.auth.getUser();

    await supabase.from("debt_reconciliations").upsert(
      {
        entity_id: entityId,
        period_year: periodYear,
        period_month: periodMonth,
        gl_account_group: groupKey,
        gl_balance: glBal,
        subledger_balance: subBal,
        variance,
        is_reconciled: true,
        reconciled_by: userData?.user?.id ?? null,
        reconciled_at: new Date().toISOString(),
        notes: notes[groupKey] || null,
        prior_period_adjustment: ppa,
        prior_period_adjustment_note: ppaText.length > 0 ? ppaText : null,
      },
      { onConflict: "entity_id,period_year,period_month,gl_account_group" }
    );

    setSaving(null);
    loadData();
  };

  const handleSavePpa = async (groupKey: string) => {
    setSaving(groupKey);
    const glBal = glBalances[groupKey] ?? 0;
    const subBal = subledgerBalances[groupKey]?.total ?? 0;
    const variance = glBal - subBal;
    const ppa = parseFloat(ppaAmount[groupKey] ?? "") || 0;
    const ppaText = (ppaNote[groupKey] ?? "").trim();
    const recon = reconciliations[groupKey];

    if (recon) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any)
        .from("debt_reconciliations")
        .update({
          prior_period_adjustment: ppa,
          prior_period_adjustment_note: ppaText.length > 0 ? ppaText : null,
        })
        .eq("id", recon.id);
    } else {
      await supabase.from("debt_reconciliations").upsert(
        {
          entity_id: entityId,
          period_year: periodYear,
          period_month: periodMonth,
          gl_account_group: groupKey,
          gl_balance: glBal,
          subledger_balance: subBal,
          variance,
          is_reconciled: false,
          notes: notes[groupKey] || null,
          prior_period_adjustment: ppa,
          prior_period_adjustment_note: ppaText.length > 0 ? ppaText : null,
        },
        { onConflict: "entity_id,period_year,period_month,gl_account_group" }
      );
    }

    toast.success("Prior period adjustment saved");
    setSaving(null);
    loadData();
  };

  const handleClearPpa = async (groupKey: string) => {
    setSaving(groupKey);
    setPpaAmount((prev) => ({ ...prev, [groupKey]: "" }));
    setPpaNote((prev) => ({ ...prev, [groupKey]: "" }));
    setPpaOpen((prev) => {
      const next = new Set(prev);
      next.delete(groupKey);
      return next;
    });

    const recon = reconciliations[groupKey];
    const cf = carryForwardPpa[groupKey];
    const hasCarryForward = cf != null && Math.abs(cf.amount) > 0.005;

    if (recon) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any)
        .from("debt_reconciliations")
        .update({
          prior_period_adjustment: 0,
          prior_period_adjustment_note: null,
        })
        .eq("id", recon.id);
      loadData();
    } else if (hasCarryForward) {
      // No current-period record yet, but a prior period would carry a PPA
      // forward. Persist a zero override here so the carry-forward stops at
      // this period and doesn't reappear in future periods.
      const glBal = glBalances[groupKey] ?? 0;
      const subBal = subledgerBalances[groupKey]?.total ?? 0;
      const variance = glBal - subBal;
      await supabase.from("debt_reconciliations").upsert(
        {
          entity_id: entityId,
          period_year: periodYear,
          period_month: periodMonth,
          gl_account_group: groupKey,
          gl_balance: glBal,
          subledger_balance: subBal,
          variance,
          is_reconciled: false,
          notes: notes[groupKey] || null,
          prior_period_adjustment: 0,
          prior_period_adjustment_note: null,
        },
        { onConflict: "entity_id,period_year,period_month,gl_account_group" }
      );
      loadData();
    }
    setSaving(null);
  };

  const togglePpaOpen = (key: string) => {
    setPpaOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleUnreconcile = async (groupKey: string) => {
    setSaving(groupKey);
    const recon = reconciliations[groupKey];
    if (recon) {
      await supabase
        .from("debt_reconciliations")
        .update({ is_reconciled: false, reconciled_at: null, reconciled_by: null })
        .eq("id", recon.id);
    }
    setSaving(null);
    loadData();
  };

  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Build a lookup for entity accounts by ID
  const accountsById = Object.fromEntries(entityAccounts.map((a) => [a.id, a]));

  // Accounts already mapped (to exclude from picker)
  const allMappedAccountIds = new Set(
    Object.values(mappedAccounts).flat().map((m) => m.account_id)
  );

  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i);

  return (
    <div className="space-y-6">
      {/* Period Selector */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Period:</span>
          <Select
            value={String(periodMonth)}
            onValueChange={(v) => setPeriodMonth(Number(v))}
          >
            <SelectTrigger className="w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MONTHS.map((m, i) => (
                <SelectItem key={i + 1} value={String(i + 1)}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={String(periodYear)}
            onValueChange={(v) => setPeriodYear(Number(v))}
          >
            <SelectTrigger className="w-[100px]">
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
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading reconciliation data...</p>
      ) : (
        <div className="space-y-6">
          {/* Year-at-a-Glance Reconciliation Schedule */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">
                {periodYear} Reconciliation Schedule
              </CardTitle>
            </CardHeader>
            <CardContent>
              <TooltipProvider>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[120px]">Month</TableHead>
                      {DEBT_GL_ACCOUNT_GROUPS.map((group) => (
                        <TableHead key={group.key} className="text-center">
                          {group.displayName}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {MONTHS.map((monthName, idx) => {
                      const month = idx + 1;
                      const isSelected = month === periodMonth;
                      return (
                        <TableRow
                          key={month}
                          className={`cursor-pointer hover:bg-muted/50 ${
                            isSelected ? "bg-muted" : ""
                          }`}
                          onClick={() => setPeriodMonth(month)}
                        >
                          <TableCell className="font-medium text-sm">
                            {monthName}
                          </TableCell>
                          {DEBT_GL_ACCOUNT_GROUPS.map((group) => {
                            const key = `${month}_${group.key}`;
                            const status = yearSchedule[key];
                            return (
                              <TableCell key={group.key} className="text-center">
                                {status === "reconciled" ? (
                                  <CheckCircle2 className="h-5 w-5 text-green-600 inline-block" />
                                ) : status === "stale" ? (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <AlertTriangle className="h-5 w-5 text-amber-500 inline-block" />
                                    </TooltipTrigger>
                                    <TooltipContent side="top" className="max-w-[240px]">
                                      GL balance has changed since this was reconciled. Click to review and re-reconcile.
                                    </TooltipContent>
                                  </Tooltip>
                                ) : status === "pending" ? (
                                  <X className="h-5 w-5 text-red-500 inline-block" />
                                ) : null}
                              </TableCell>
                            );
                          })}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TooltipProvider>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {DEBT_GL_ACCOUNT_GROUPS.map((group) => {
              const glBal = glBalances[group.key] ?? 0;
              const subBal = subledgerBalances[group.key]?.total ?? 0;
              const variance = glBal - subBal;
              const recon = reconciliations[group.key];
              const isReconciled = recon?.is_reconciled ?? false;
              const isStale = isReconciled && recon?.gl_balance != null
                && Math.abs((recon.gl_balance ?? 0) - glBal) > RECONCILE_TOLERANCE;
              const instrumentList = subledgerBalances[group.key]?.instruments ?? [];
              const isExpanded = expandedGroups.has(group.key);
              const groupMappings = mappedAccounts[group.key] ?? [];
              const isAdding = addingToGroup === group.key;
              const ppa = parseFloat(ppaAmount[group.key] ?? "") || 0;
              const adjustedVariance = variance - ppa;
              const hasPpa = Math.abs(ppa) > 0.005;
              const isPpaOpen = ppaOpen.has(group.key) || hasPpa;
              const savedPpa = Number(recon?.prior_period_adjustment ?? 0);
              const ppaDirty =
                Math.abs(ppa - savedPpa) > 0.005 ||
                (ppaNote[group.key] ?? "") !==
                  (recon?.prior_period_adjustment_note ?? "");
              const carryForward = carryForwardPpa[group.key];
              // A period "owns" its adjustment only if its row carries an
              // explicit PPA; a reconciled row with no PPA of its own still
              // inherits the carry-forward.
              const reconOwnsPpa =
                !!recon &&
                (Math.abs(savedPpa) > 0.005 ||
                  (recon?.prior_period_adjustment_note ?? "").length > 0);
              // Carry-forward note shows when the displayed PPA matches a prior
              // period's value AND this period hasn't set its own adjustment.
              const showCarryForwardNote =
                !reconOwnsPpa &&
                carryForward != null &&
                Math.abs(ppa - carryForward.amount) < 0.005 &&
                Math.abs(carryForward.amount) > 0.005;

              return (
                <Card key={group.key} className={isStale ? "border-amber-400" : ""}>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-lg">{group.displayName}</CardTitle>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {group.description}
                        </p>
                      </div>
                      {isStale ? (
                        <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">
                          <AlertTriangle className="mr-1 h-3.5 w-3.5" />
                          Balance Changed
                        </Badge>
                      ) : isReconciled ? (
                        <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
                          <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                          Reconciled
                          {Math.abs(savedPpa) > 0.005 && " (w/ PPA)"}
                        </Badge>
                      ) : hasPpa && Math.abs(adjustedVariance) <= RECONCILE_TOLERANCE ? (
                        <Badge variant="outline" className="border-amber-400 text-amber-700">
                          <AlertTriangle className="mr-1 h-3.5 w-3.5" />
                          PPA Pending
                        </Badge>
                      ) : Math.abs(adjustedVariance) > RECONCILE_TOLERANCE && groupMappings.length > 0 ? (
                        <Badge variant="destructive">
                          <AlertTriangle className="mr-1 h-3.5 w-3.5" />
                          Variance
                        </Badge>
                      ) : (
                        <Badge variant="outline">
                          {groupMappings.length === 0 ? "No Accounts" : "Pending"}
                        </Badge>
                      )}
                    </div>
                    {isStale && (
                      <p className="text-sm text-amber-700 mt-2">
                        The GL balance has changed since this was marked reconciled.
                        Please review and re-reconcile.
                      </p>
                    )}
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Mapped GL Accounts */}
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        GL Accounts
                      </p>
                      {groupMappings.length === 0 ? (
                        <p className="text-sm text-muted-foreground italic">
                          No GL accounts linked yet
                        </p>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {groupMappings.map((mapping) => {
                            const acct = accountsById[mapping.account_id];
                            return (
                              <Badge
                                key={mapping.id}
                                variant="secondary"
                                className="text-xs font-mono gap-1"
                              >
                                {acct
                                  ? `${acct.account_number ?? ""} ${acct.name}`.trim()
                                  : mapping.account_id.slice(0, 8)}
                                <button
                                  onClick={() => handleRemoveAccount(mapping.id, group.key)}
                                  className="ml-1 hover:text-destructive"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </Badge>
                            );
                          })}
                        </div>
                      )}

                      {/* Add account picker */}
                      {isAdding ? (
                        <div className="flex items-center gap-2">
                          <AccountCombobox
                            accounts={entityAccounts
                              .filter((a) => !allMappedAccountIds.has(a.id))
                              .map((a) => ({
                                id: a.id,
                                account_number: a.account_number,
                                name: a.name,
                                account_type: a.account_type,
                              }))}
                            value={selectedAccountId}
                            onValueChange={setSelectedAccountId}
                            className="flex-1 min-w-0"
                          />
                          <Button
                            size="sm"
                            onClick={() => handleAddAccount(group.key)}
                            disabled={!selectedAccountId || saving === group.key}
                          >
                            Add
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setAddingToGroup(null);
                              setSelectedAccountId("");
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setAddingToGroup(group.key);
                            setSelectedAccountId("");
                          }}
                        >
                          <Plus className="mr-1 h-3.5 w-3.5" />
                          Link Account
                        </Button>
                      )}
                    </div>

                    {/* Summary - only show if accounts are mapped */}
                    {groupMappings.length > 0 && (
                      <div className="grid grid-cols-3 gap-4">
                        <div>
                          <p className="text-xs text-muted-foreground uppercase tracking-wider">
                            GL Balance
                          </p>
                          <p className="text-lg font-semibold tabular-nums">
                            {formatCurrency(glBal)}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground uppercase tracking-wider">
                            Subledger
                          </p>
                          <p className="text-lg font-semibold tabular-nums">
                            {formatCurrency(subBal)}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground uppercase tracking-wider">
                            Variance
                          </p>
                          {/* Headline reflects the prior-period adjustment, so a
                              fully-adjusted account reads $0.00 (reconciled)
                              rather than the raw gross variance. */}
                          <p
                            className={`text-lg font-semibold tabular-nums ${
                              Math.abs(adjustedVariance) > RECONCILE_TOLERANCE
                                ? "text-red-600"
                                : "text-green-600"
                            }`}
                          >
                            {formatCurrency(adjustedVariance)}
                          </p>
                          {hasPpa && (
                            <p className="text-[11px] text-muted-foreground mt-0.5">
                              {formatCurrency(variance)} gross, net of{" "}
                              {formatCurrency(ppa)} PPA
                            </p>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Prior Period Adjustment */}
                    {groupMappings.length > 0 && (
                      <div className="border-t pt-3">
                        {!isPpaOpen ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => togglePpaOpen(group.key)}
                            className="text-xs text-muted-foreground hover:text-foreground"
                          >
                            <Plus className="mr-1 h-3.5 w-3.5" />
                            Apply prior period adjustment
                          </Button>
                        ) : (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                                Prior Period Adjustment
                                {showCarryForwardNote && (
                                  <span className="ml-2 normal-case font-normal text-muted-foreground italic">
                                    Carried forward from{" "}
                                    {MONTHS[carryForward!.month - 1].slice(0, 3)}{" "}
                                    {carryForward!.year}
                                  </span>
                                )}
                              </p>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleClearPpa(group.key)}
                                disabled={saving === group.key}
                                className="h-7 text-xs text-muted-foreground hover:text-destructive"
                              >
                                <X className="mr-1 h-3 w-3" />
                                Clear
                              </Button>
                            </div>
                            <div className="grid grid-cols-2 gap-2 items-end">
                              <div>
                                <label className="text-xs text-muted-foreground">
                                  Adjustment Amount
                                </label>
                                <div className="flex gap-1">
                                  <CurrencyInput
                                    value={ppaAmount[group.key] ?? ""}
                                    onValueChange={(v) =>
                                      setPpaAmount((prev) => ({
                                        ...prev,
                                        [group.key]: v,
                                      }))
                                    }
                                    placeholder="$0.00"
                                    className="h-9 text-sm"
                                  />
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() =>
                                      setPpaAmount((prev) => ({
                                        ...prev,
                                        [group.key]: String(variance),
                                      }))
                                    }
                                    title="Set adjustment equal to current variance"
                                    className="h-9 shrink-0 text-xs"
                                  >
                                    Use Variance
                                  </Button>
                                </div>
                              </div>
                              <div>
                                <label className="text-xs text-muted-foreground">
                                  Adjusted Variance
                                </label>
                                <p
                                  className={`text-base font-semibold tabular-nums h-9 flex items-center ${
                                    Math.abs(adjustedVariance) > RECONCILE_TOLERANCE
                                      ? "text-red-600"
                                      : "text-green-600"
                                  }`}
                                >
                                  {formatCurrency(adjustedVariance)}
                                </p>
                              </div>
                            </div>
                            <div>
                              <label className="text-xs text-muted-foreground">
                                Reason (e.g. &quot;2025 books closed; adjusting JE booked
                                in 2026&quot;)
                              </label>
                              <Input
                                value={ppaNote[group.key] ?? ""}
                                onChange={(e) =>
                                  setPpaNote((prev) => ({
                                    ...prev,
                                    [group.key]: e.target.value,
                                  }))
                                }
                                placeholder="Why this variance is being ignored..."
                                className="h-9 text-sm"
                              />
                            </div>
                            {ppaDirty && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleSavePpa(group.key)}
                                disabled={saving === group.key}
                                className="h-8 text-xs"
                              >
                                <Pencil className="mr-1 h-3 w-3" />
                                {saving === group.key ? "Saving..." : "Save adjustment"}
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Instrument Detail Expandable */}
                    {instrumentList.length > 0 && (
                      <Collapsible
                        open={isExpanded}
                        onOpenChange={() => toggleGroup(group.key)}
                      >
                        <CollapsibleTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="w-full justify-start"
                          >
                            {isExpanded ? (
                              <ChevronDown className="mr-2 h-4 w-4" />
                            ) : (
                              <ChevronRight className="mr-2 h-4 w-4" />
                            )}
                            {instrumentList.length} instrument
                            {instrumentList.length !== 1 ? "s" : ""} in group
                          </Button>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <div className="mt-2 max-h-60 overflow-auto">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Instrument</TableHead>
                                  <TableHead>Lender</TableHead>
                                  <TableHead className="text-right">
                                    Balance
                                  </TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {instrumentList.map((instr) => (
                                  <TableRow key={`${group.key}-${instr.id}`}>
                                    <TableCell className="text-sm">
                                      {instr.instrument_name}
                                    </TableCell>
                                    <TableCell className="text-sm text-muted-foreground">
                                      {instr.lender_name ?? "---"}
                                    </TableCell>
                                    <TableCell className="text-right tabular-nums text-sm">
                                      {formatCurrency(instr.ending_balance ?? 0)}
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    )}

                    {/* Notes */}
                    <Textarea
                      placeholder="Reconciliation notes..."
                      value={notes[group.key] ?? ""}
                      onChange={(e) =>
                        setNotes((prev) => ({
                          ...prev,
                          [group.key]: e.target.value,
                        }))
                      }
                      className="text-sm"
                      rows={2}
                    />

                    {/* Actions */}
                    <div className="flex items-center justify-between">
                      {recon?.reconciled_at && (
                        <p className="text-xs text-muted-foreground">
                          Reconciled{" "}
                          {new Date(recon.reconciled_at).toLocaleDateString()}
                        </p>
                      )}
                      <div className="ml-auto flex gap-2">
                        {isReconciled ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleUnreconcile(group.key)}
                            disabled={saving === group.key}
                          >
                            {saving === group.key ? "Saving..." : "Unreconcile"}
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            onClick={() => handleReconcile(group.key)}
                            disabled={
                              saving === group.key || groupMappings.length === 0
                            }
                          >
                            {saving === group.key
                              ? "Saving..."
                              : "Mark Reconciled"}
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Unlinked Instruments Warning */}
          {unlinkedInstruments.length > 0 && (
            <Card className="border-amber-300 bg-amber-50/40">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">
                    Unlinked Instruments
                  </CardTitle>
                  <Badge
                    variant="outline"
                    className="border-amber-500 text-amber-700 bg-amber-100"
                  >
                    <AlertTriangle className="mr-1 h-3.5 w-3.5" />
                    Needs GL Account
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  These active instruments have no liability GL account assigned.
                  Edit each instrument to link it to a GL account.
                </p>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Instrument</TableHead>
                      <TableHead>Lender</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {unlinkedInstruments.map((instr) => (
                      <TableRow key={instr.id}>
                        <TableCell className="text-sm">
                          {instr.instrument_name}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {instr.lender_name ?? "---"}
                        </TableCell>
                        <TableCell className="text-sm">
                          {instr.debt_type}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sm">
                          {formatCurrency(
                            instr.ending_balance ??
                              instr.current_draw ??
                              instr.original_amount ??
                              0
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
