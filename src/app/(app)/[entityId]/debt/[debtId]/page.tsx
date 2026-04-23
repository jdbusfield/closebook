"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AccountCombobox } from "@/components/ui/account-combobox";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  ArrowLeft,
  Save,
  Link as LinkIcon,
  Calculator,
  ArrowUpDown,
  History,
  FileText,
  Pencil,
  Plus,
  DollarSign,
  Trash2,
  Download,
  Paperclip,
  Upload,
  X,
} from "lucide-react";
import {
  formatCurrency,
  formatPercentage,
  getPeriodShortLabel,
} from "@/lib/utils/dates";
import {
  generateWhatIfSchedule,
  summarizeSchedule,
  interestFactor,
} from "@/lib/utils/amortization";
import * as XLSX from "xlsx";
import type { DebtStatus } from "@/lib/types/database";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRow = any;

interface Account {
  id: string;
  name: string;
  account_number: string | null;
  classification: string;
}

interface FixedAssetRef {
  id: string;
  asset_name: string;
  asset_tag: string | null;
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
  mortgage: "Mortgage",
  equipment_loan: "Equipment Loan",
  balloon_loan: "Balloon Loan",
  bridge_loan: "Bridge Loan",
  sba_loan: "SBA Loan",
  other: "Other",
};

const PAYMENT_STRUCTURE_LABELS: Record<string, string> = {
  principal_and_interest: "Principal & Interest",
  interest_only: "Interest Only",
  balloon: "Balloon",
  custom: "Custom",
  revolving: "Revolving",
};

const TRANSACTION_TYPE_LABELS: Record<string, string> = {
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

const TRANSACTION_TYPE_COLORS: Record<string, string> = {
  advance: "text-red-600",
  principal_payment: "text-green-600",
  interest_payment: "text-amber-600",
  fee_payment: "text-amber-600",
  late_fee: "text-red-500",
  misc_fee: "text-red-500",
  payment_reversal: "text-red-600",
  note_renewal: "text-blue-600",
  vehicle_payoff: "text-green-700",
  payoff: "text-green-700",
  adjustment: "text-muted-foreground",
};

export default function DebtDetailPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const debtId = params.debtId as string;
  const router = useRouter();
  const supabase = createClient();

  const [instrument, setInstrument] = useState<AnyRow | null>(null);
  const [amortization, setAmortization] = useState<AnyRow[]>([]);
  const [rateHistory, setRateHistory] = useState<AnyRow[]>([]);
  const [transactions, setTransactions] = useState<AnyRow[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [linkedAsset, setLinkedAsset] = useState<FixedAssetRef | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Transaction document attachments
  const [txnDocs, setTxnDocs] = useState<Map<string, AnyRow[]>>(new Map());
  const [uploadingDocTxnId, setUploadingDocTxnId] = useState<string | null>(null);

  // GL linkage
  const [liabilityAccountId, setLiabilityAccountId] = useState("");
  const [interestAccountId, setInterestAccountId] = useState("");
  const [currentLiabilityAccountId, setCurrentLiabilityAccountId] = useState("");
  const [feeAccountId, setFeeAccountId] = useState("");

  // What-if scenario
  const [whatIfRate, setWhatIfRate] = useState("");
  const [whatIfTerm, setWhatIfTerm] = useState("");
  const [showWhatIf, setShowWhatIf] = useState(false);

  // Delete instrument
  const [deleting, setDeleting] = useState(false);
  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/debt?id=${debtId}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to delete");
      }
      toast.success("Instrument deleted");
      router.push(`/${entityId}/debt`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
      setDeleting(false);
    }
  }

  // Edit instrument
  const [editOpen, setEditOpen] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editForm, setEditForm] = useState({
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
    day_count_convention: "30/360",
    balloon_amount: "",
    is_pik: false,
    collateral_description: "",
    notes: "",
    status: "active",
  });

  function openEditDialog() {
    if (!instrument) return;
    setEditForm({
      instrument_name: instrument.instrument_name ?? "",
      lender_name: instrument.lender_name ?? "",
      loan_number: instrument.loan_number ?? "",
      debt_type: instrument.debt_type ?? "term_loan",
      payment_structure: instrument.payment_structure ?? "principal_and_interest",
      original_amount: String(instrument.original_amount ?? ""),
      interest_rate: instrument.interest_rate ? String((instrument.interest_rate * 100).toFixed(4)).replace(/\.?0+$/, "") : "",
      rate_type: instrument.rate_type ?? "fixed",
      index_rate_name: instrument.index_rate_name ?? "",
      spread_margin: instrument.spread_margin ? String((instrument.spread_margin * 100).toFixed(4)).replace(/\.?0+$/, "") : "",
      term_months: instrument.term_months ? String(instrument.term_months) : "",
      start_date: instrument.start_date ?? "",
      maturity_date: instrument.maturity_date ?? "",
      payment_amount: instrument.payment_amount ? String(instrument.payment_amount) : "",
      credit_limit: instrument.credit_limit ? String(instrument.credit_limit) : "",
      day_count_convention: instrument.day_count_convention ?? "30/360",
      balloon_amount: instrument.balloon_amount ? String(instrument.balloon_amount) : "",
      is_pik: !!instrument.is_pik,
      collateral_description: instrument.collateral_description ?? "",
      notes: instrument.notes ?? "",
      status: instrument.status ?? "active",
    });
    setEditOpen(true);
  }

  async function handleEditSave() {
    if (!editForm.instrument_name || !editForm.original_amount || !editForm.start_date) {
      toast.error("Name, original amount, and start date are required");
      return;
    }
    setEditSaving(true);
    try {
      const res = await fetch("/api/debt", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: debtId,
          instrument_name: editForm.instrument_name,
          lender_name: editForm.lender_name || null,
          loan_number: editForm.loan_number || null,
          debt_type: editForm.debt_type,
          payment_structure: editForm.payment_structure,
          original_amount: parseFloat(editForm.original_amount),
          interest_rate: parseFloat(editForm.interest_rate) || 0,
          rate_type: editForm.rate_type,
          index_rate_name: editForm.index_rate_name || null,
          spread_margin: editForm.spread_margin ? parseFloat(editForm.spread_margin) : null,
          term_months: editForm.term_months ? parseInt(editForm.term_months) : null,
          start_date: editForm.start_date,
          maturity_date: editForm.maturity_date || null,
          payment_amount: editForm.payment_amount ? parseFloat(editForm.payment_amount) : null,
          credit_limit: editForm.credit_limit ? parseFloat(editForm.credit_limit) : null,
          day_count_convention: editForm.day_count_convention,
          balloon_amount: editForm.balloon_amount ? parseFloat(editForm.balloon_amount) : null,
          is_secured: !!editForm.collateral_description,
          is_pik: editForm.is_pik,
          collateral_description: editForm.collateral_description || null,
          notes: editForm.notes || null,
          status: editForm.status,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || "Failed to update instrument");
      } else {
        toast.success("Instrument updated");
        setEditOpen(false);
        loadData();
      }
    } catch {
      toast.error("Network error");
    }
    setEditSaving(false);
  }

  // Regenerate amortization
  const [regenerating, setRegenerating] = useState(false);

  async function handleRegenerate() {
    setRegenerating(true);
    try {
      const res = await fetch("/api/debt/amortize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ debt_instrument_id: debtId }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || "Failed to generate schedule");
      } else {
        toast.success(`Generated ${json.periods} period${json.periods !== 1 ? "s" : ""}`);
        loadData();
      }
    } catch {
      toast.error("Network error");
    }
    setRegenerating(false);
  }

  // Add transaction
  const [txnOpen, setTxnOpen] = useState(false);
  const [txnSaving, setTxnSaving] = useState(false);
  const [txnForm, setTxnForm] = useState({
    transaction_type: "interest_payment",
    effective_date: new Date().toISOString().split("T")[0],
    amount: "",
    to_principal: "",
    to_interest: "",
    to_fees: "",
    running_balance: "",
    reference_number: "",
    description: "",
    notes: "",
  });

  function resetTxnForm() {
    setTxnForm({
      transaction_type: "interest_payment",
      effective_date: new Date().toISOString().split("T")[0],
      amount: "",
      to_principal: "",
      to_interest: "",
      to_fees: "",
      running_balance: "",
      reference_number: "",
      description: "",
      notes: "",
    });
  }

  async function handleAddTransaction() {
    if (!txnForm.effective_date || !txnForm.amount) {
      toast.error("Date and amount are required");
      return;
    }
    setTxnSaving(true);
    try {
      const res = await fetch("/api/debt/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          debt_instrument_id: debtId,
          transaction_date: txnForm.effective_date,
          effective_date: txnForm.effective_date,
          transaction_type: txnForm.transaction_type,
          amount: parseFloat(txnForm.amount),
          to_principal: txnForm.to_principal ? parseFloat(txnForm.to_principal) : 0,
          to_interest: txnForm.to_interest ? parseFloat(txnForm.to_interest) : 0,
          to_fees: txnForm.to_fees ? parseFloat(txnForm.to_fees) : 0,
          running_balance: txnForm.running_balance ? parseFloat(txnForm.running_balance) : null,
          reference_number: txnForm.reference_number || null,
          description: txnForm.description || null,
          notes: txnForm.notes || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || "Failed to add transaction");
      } else {
        toast.success("Transaction added");
        setTxnOpen(false);
        resetTxnForm();
        loadData();
      }
    } catch {
      toast.error("Network error");
    }
    setTxnSaving(false);
  }

  // Edit transaction
  const [editTxnOpen, setEditTxnOpen] = useState(false);
  const [editTxnSaving, setEditTxnSaving] = useState(false);
  const [editTxnId, setEditTxnId] = useState<string | null>(null);
  const [editTxnForm, setEditTxnForm] = useState({
    transaction_type: "interest_payment",
    effective_date: "",
    amount: "",
    to_principal: "",
    to_interest: "",
    to_fees: "",
    running_balance: "",
    reference_number: "",
    description: "",
    notes: "",
  });

  function openEditTxn(txn: AnyRow) {
    setEditTxnId(txn.id);
    setEditTxnForm({
      transaction_type: txn.transaction_type,
      effective_date: txn.effective_date ?? "",
      amount: String(txn.amount ?? ""),
      to_principal: txn.to_principal ? String(txn.to_principal) : "",
      to_interest: txn.to_interest ? String(txn.to_interest) : "",
      to_fees: txn.to_fees ? String(txn.to_fees) : "",
      running_balance: txn.running_balance != null ? String(txn.running_balance) : "",
      reference_number: txn.reference_number ?? "",
      description: txn.description ?? "",
      notes: txn.notes ?? "",
    });
    setEditTxnOpen(true);
  }

  async function handleEditTransaction() {
    if (!editTxnId || !editTxnForm.effective_date || !editTxnForm.amount) {
      toast.error("Date and amount are required");
      return;
    }
    setEditTxnSaving(true);
    try {
      const res = await fetch("/api/debt/transactions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editTxnId,
          transaction_date: editTxnForm.effective_date,
          effective_date: editTxnForm.effective_date,
          transaction_type: editTxnForm.transaction_type,
          amount: parseFloat(editTxnForm.amount),
          to_principal: editTxnForm.to_principal ? parseFloat(editTxnForm.to_principal) : 0,
          to_interest: editTxnForm.to_interest ? parseFloat(editTxnForm.to_interest) : 0,
          to_fees: editTxnForm.to_fees ? parseFloat(editTxnForm.to_fees) : 0,
          running_balance: editTxnForm.running_balance ? parseFloat(editTxnForm.running_balance) : null,
          reference_number: editTxnForm.reference_number || null,
          description: editTxnForm.description || null,
          notes: editTxnForm.notes || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || "Failed to update transaction");
      } else {
        toast.success("Transaction updated");
        setEditTxnOpen(false);
        loadData();
      }
    } catch {
      toast.error("Network error");
    }
    setEditTxnSaving(false);
  }

  async function handleDeleteTransaction(txnId: string) {
    if (!confirm("Delete this transaction? This will recalculate the running balance.")) return;
    try {
      const res = await fetch(`/api/debt/transactions?id=${txnId}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || "Failed to delete transaction");
      } else {
        toast.success("Transaction deleted");
        loadData();
      }
    } catch {
      toast.error("Network error");
    }
  }

  // --- Transaction document handlers ---

  async function handleDocUpload(txnId: string, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingDocTxnId(txnId);

    const timestamp = Date.now();
    const storagePath = `${entityId}/debt/${debtId}/${txnId}/${timestamp}_${file.name}`;

    const { error: uploadError } = await supabase.storage
      .from("debt-documents")
      .upload(storagePath, file, { contentType: file.type, upsert: false });

    if (uploadError) {
      toast.error(`Upload failed: ${uploadError.message}`);
      setUploadingDocTxnId(null);
      e.target.value = "";
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: dbError } = await (supabase as any)
      .from("debt_transaction_documents")
      .insert({
        transaction_id: txnId,
        file_name: file.name,
        file_path: storagePath,
        file_size_bytes: file.size,
      });

    if (dbError) toast.error(dbError.message);
    else toast.success("Document uploaded");
    setUploadingDocTxnId(null);
    e.target.value = "";
    loadData();
  }

  async function handleDocDownload(filePath: string, fileName: string) {
    try {
      const res = await fetch("/api/storage/signed-download-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bucket: "debt-documents", path: filePath }),
      });
      if (!res.ok) throw new Error("Failed to get download URL");
      const { signedUrl } = await res.json();
      const link = document.createElement("a");
      link.href = signedUrl;
      link.download = fileName;
      link.target = "_blank";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch {
      toast.error("Failed to download document");
    }
  }

  async function handleDocDelete(docId: string, filePath: string) {
    if (!confirm("Delete this document?")) return;
    // Remove from storage
    await supabase.storage.from("debt-documents").remove([filePath]);
    // Remove from database
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from("debt_transaction_documents").delete().eq("id", docId);
    toast.success("Document deleted");
    loadData();
  }

  function exportTransactionsToXlsx() {
    if (transactions.length === 0) {
      toast.error("No transactions to export");
      return;
    }
    const rows = transactions.map((txn: AnyRow) => ({
      Date: txn.effective_date ? txn.effective_date.split("T")[0] : "",
      Type: TRANSACTION_TYPE_LABELS[txn.transaction_type] ?? txn.transaction_type,
      Description: txn.description ?? "",
      Amount: txn.amount != null ? Number(txn.amount) : "",
      "To Principal": txn.to_principal != null ? Number(txn.to_principal) : "",
      "To Interest": txn.to_interest != null ? Number(txn.to_interest) : "",
      "To Fees": txn.to_fees != null ? Number(txn.to_fees) : "",
      Balance: txn.running_balance != null ? Number(txn.running_balance) : "",
      "Ref #": txn.reference_number ?? "",
      Reconciled: txn.is_reconciled ? "Yes" : "No",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    // Auto-size columns based on header + data widths
    const colKeys = Object.keys(rows[0]);
    ws["!cols"] = colKeys.map((key) => {
      const maxDataLen = rows.reduce((mx, r) => Math.max(mx, String(r[key as keyof typeof r] ?? "").length), 0);
      return { wch: Math.max(key.length, maxDataLen) + 2 };
    });
    const wb = XLSX.utils.book_new();
    const sheetName = (instrument?.instrument_name || "Transactions").slice(0, 31);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    const safeName = (instrument?.instrument_name || "transactions").replace(/[^a-zA-Z0-9_-]/g, "_");
    XLSX.writeFile(wb, `${safeName}_transactions.xlsx`);
  }

  const loadData = useCallback(async () => {
    // Fetch instrument
    const instrResult = await supabase
      .from("debt_instruments")
      .select("*")
      .eq("id", debtId)
      .single();

    // Fetch amortization
    const amortResult = await supabase
      .from("debt_amortization")
      .select("*")
      .eq("debt_instrument_id", debtId)
      .order("period_year")
      .order("period_month");

    // Fetch accounts
    const accountsResult = await supabase
      .from("accounts")
      .select("id, name, account_number, classification")
      .eq("entity_id", entityId)
      .eq("is_active", true)
      .order("account_number")
      .order("name");

    // Fetch rate history
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rateResult = await (supabase as any)
      .from("debt_rate_history")
      .select("*")
      .eq("debt_instrument_id", debtId)
      .order("effective_date", { ascending: true });

    // Fetch transactions
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const txnResult = await (supabase as any)
      .from("debt_transactions")
      .select("*")
      .eq("debt_instrument_id", debtId)
      .order("effective_date", { ascending: false })
      .order("created_at", { ascending: false });

    const instr = instrResult.data as AnyRow;
    if (instr) {
      setInstrument(instr);
      setLiabilityAccountId(instr.liability_account_id ?? "");
      setInterestAccountId(instr.interest_expense_account_id ?? "");
      setCurrentLiabilityAccountId(instr.current_liability_account_id ?? "");
      setFeeAccountId(instr.fee_expense_account_id ?? "");

      if (instr.fixed_asset_id) {
        const { data: assetData } = await supabase
          .from("fixed_assets")
          .select("id, asset_name, asset_tag")
          .eq("id", instr.fixed_asset_id)
          .single();
        setLinkedAsset((assetData as unknown as FixedAssetRef) ?? null);
      }
    }

    const txns = (txnResult.data as AnyRow[]) ?? [];
    setAmortization((amortResult.data as AnyRow[]) ?? []);
    setRateHistory((rateResult.data as AnyRow[]) ?? []);
    setTransactions(txns);
    setAccounts((accountsResult.data as Account[]) ?? []);

    // Fetch document attachments for all transactions
    if (txns.length > 0) {
      const txnIds = txns.map((t: AnyRow) => t.id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: docs } = await (supabase as any)
        .from("debt_transaction_documents")
        .select("*")
        .in("transaction_id", txnIds)
        .order("created_at", { ascending: false });

      const docMap = new Map<string, AnyRow[]>();
      for (const doc of (docs ?? [])) {
        const existing = docMap.get(doc.transaction_id) ?? [];
        existing.push(doc);
        docMap.set(doc.transaction_id, existing);
      }
      setTxnDocs(docMap);
    } else {
      setTxnDocs(new Map());
    }

    setLoading(false);
  }, [supabase, debtId, entityId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleSaveAccounts() {
    if (!instrument) return;
    setSaving(true);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from("debt_instruments")
      .update({
        liability_account_id: liabilityAccountId || null,
        interest_expense_account_id: interestAccountId || null,
        current_liability_account_id: currentLiabilityAccountId || null,
        fee_expense_account_id: feeAccountId || null,
      })
      .eq("id", debtId);

    if (error) {
      toast.error(error.message);
    } else {
      toast.success("GL accounts updated");
      loadData();
    }
    setSaving(false);
  }

  // What-if amortization schedule
  const whatIfSchedule = useMemo(() => {
    if (!instrument || !showWhatIf) return [];
    const rate = parseFloat(whatIfRate);
    const term = parseInt(whatIfTerm);
    if (isNaN(rate) || rate <= 0 || isNaN(term) || term <= 0) return [];

    return generateWhatIfSchedule({
      principal: amortization.length > 0
        ? amortization[amortization.length - 1].ending_balance
        : instrument.original_amount,
      annualRate: rate / 100,
      termMonths: term,
      startDate: new Date().toISOString().split("T")[0],
      paymentStructure: instrument.payment_structure ?? "principal_and_interest",
      dayCountConvention: instrument.day_count_convention ?? "30/360",
    });
  }, [instrument, showWhatIf, whatIfRate, whatIfTerm, amortization]);

  const whatIfSummary = useMemo(() => {
    if (whatIfSchedule.length === 0) return null;
    return summarizeSchedule(whatIfSchedule);
  }, [whatIfSchedule]);

  // Interest accrual schedule — walks month by month adjusting for transactions
  interface AccrualEntry {
    year: number;
    month: number;
    beginningBalance: number;
    rate: number;
    interestAccrued: number;
    endingBalance: number;
    cumulativeInterest: number;
    balanceChanges: number; // net draws/paydowns in the month
    interestPaid: number; // interest payments from transactions this month
    interestPayableBeg: number; // beginning interest payable balance
    interestPayableEnd: number; // ending interest payable balance (beg + accrued - paid)
  }

  const interestAccrualSchedule = useMemo((): AccrualEntry[] => {
    if (!instrument) return [];

    const entries: AccrualEntry[] = [];
    // Parse as local date to avoid UTC timezone shift
    const [sdY, sdM, sdD] = instrument.start_date.split("T")[0].split("-").map(Number);
    const startDate = new Date(sdY, sdM - 1, sdD);
    let sy = sdY;
    let sm = sdM;
    const now = new Date();
    const endYear = now.getFullYear();
    const endMonth = now.getMonth() + 1;
    const convention = instrument.day_count_convention ?? "30/360";
    const rate = instrument.interest_rate ?? 0;

    // Build a map of balance-affecting transactions by month, preserving the day
    // so we can pro-rate interest within the month
    interface DayChange { day: number; amount: number; }
    const monthlyDayChanges: Record<string, DayChange[]> = {};
    const monthlyNetChanges: Record<string, number> = {};
    const sortedTxns = [...transactions].sort(
      (a, b) => new Date(a.effective_date).getTime() - new Date(b.effective_date).getTime()
    );
    for (const txn of sortedTxns) {
      const d = new Date(txn.effective_date);
      const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
      if (!monthlyDayChanges[key]) monthlyDayChanges[key] = [];
      if (!monthlyNetChanges[key]) monthlyNetChanges[key] = 0;
      let delta = 0;
      if (txn.transaction_type === "advance") {
        delta = Math.abs(txn.amount);
      } else if (txn.transaction_type === "principal_payment" || txn.transaction_type === "vehicle_payoff") {
        delta = -Math.abs(txn.to_principal ?? txn.amount);
      } else if (txn.transaction_type === "payoff") {
        delta = -Math.abs(txn.amount);
      }
      if (delta !== 0) {
        monthlyDayChanges[key].push({ day: d.getDate(), amount: delta });
        monthlyNetChanges[key] += delta;
      }
    }

    // Build a map of interest payments by month (for interest payable roll forward)
    const monthlyInterestPaid: Record<string, number> = {};
    for (const txn of sortedTxns) {
      const d = new Date(txn.effective_date);
      const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
      let intPaid = 0;
      if ((txn.to_interest ?? 0) !== 0) {
        intPaid = Math.abs(txn.to_interest);
      } else if (txn.transaction_type === "interest_payment" && (txn.to_principal ?? 0) === 0 && (txn.to_fees ?? 0) === 0) {
        intPaid = Math.abs(txn.amount);
      }
      if (intPaid > 0) {
        monthlyInterestPaid[key] = (monthlyInterestPaid[key] ?? 0) + intPaid;
      }
    }

    // Also check rate history for variable-rate instruments
    const rateChangesSorted = [...rateHistory].sort(
      (a, b) => new Date(a.effective_date).getTime() - new Date(b.effective_date).getTime()
    );
    function getRateForMonth(y: number, m: number): number {
      if (rateChangesSorted.length === 0) return rate;
      const periodStart = new Date(y, m - 1, 1);
      let effective = rate;
      for (const rc of rateChangesSorted) {
        if (new Date(rc.effective_date) <= periodStart) {
          effective = rc.interest_rate;
        }
      }
      return effective;
    }

    let balance = instrument.current_draw ?? instrument.original_amount ?? 0;
    // Walk backwards from start to figure out original balance if transactions exist before start
    // Actually, start with original amount and apply transactions forward
    const isLOCType = ["line_of_credit", "revolving_credit"].includes(instrument.debt_type);
    balance = isLOCType ? (instrument.current_draw ?? instrument.original_amount) : instrument.original_amount;

    let cumInterest = 0;
    let interestPayable = 0; // running interest payable balance

    // Generate up to 24 months past current, but at least through today
    const maxMonths = 240; // 20 years max

    for (let i = 0; i < maxMonths; i++) {
      const cy = sy + Math.floor((sm - 1 + i) / 12);
      const cm = ((sm - 1 + i) % 12) + 1;

      // Stop 12 months past current period
      if (cy > endYear + 1 || (cy === endYear + 1 && cm > endMonth)) break;

      const key = `${cy}-${cm}`;
      const changes = monthlyNetChanges[key] ?? 0;
      const dayChanges = monthlyDayChanges[key] ?? [];
      const monthRate = getRateForMonth(cy, cm);

      // Calculate interest — pro-rate first month from instrument start day
      let interest: number;
      const totalDays = new Date(cy, cm, 0).getDate(); // days in this month
      const isFirstMonth = i === 0;
      const startDay = isFirstMonth ? startDate.getDate() : 1;
      const accrualDays = totalDays - startDay + 1; // days of interest in this period
      const fullFactor = interestFactor(cy, cm, convention);
      const factor = isFirstMonth ? fullFactor * (accrualDays / totalDays) : fullFactor;

      if (dayChanges.length > 0 || (isFirstMonth && startDay > 1)) {
        // Day-weighted average balance for mid-month transactions or partial first month
        const sorted = [...dayChanges].sort((a, b) => a.day - b.day);
        let runBal = balance;
        let weightedSum = 0;
        let prevDay = startDay;

        for (const dc of sorted) {
          if (dc.day < startDay) continue; // skip transactions before start day in first month
          const daysAtBal = Math.max(0, dc.day - prevDay);
          weightedSum += runBal * daysAtBal;
          runBal = Math.max(0, runBal + dc.amount);
          prevDay = dc.day;
        }
        // Remaining days at the final balance
        weightedSum += runBal * (totalDays - prevDay + 1);

        const avgBalance = accrualDays > 0 ? weightedSum / accrualDays : 0;
        interest = Math.round(avgBalance * monthRate * factor * 100) / 100;
      } else {
        interest = Math.round(balance * monthRate * factor * 100) / 100;
      }

      // PIK: interest capitalizes to the balance each period instead of
      // sitting in interest payable. Interest payable stays at 0 (unless
      // cash interest is paid for some reason).
      const intPaid = monthlyInterestPaid[key] ?? 0;
      const intPayableBeg = Math.round(interestPayable * 100) / 100;
      const pikCapitalized = !!instrument.is_pik && intPaid === 0;

      const adjustedBalance = Math.max(
        0,
        balance + changes + (pikCapitalized ? interest : 0)
      );
      cumInterest += interest;

      if (pikCapitalized) {
        // No payable buildup — interest immediately folds into the balance.
        interestPayable = Math.round(interestPayable * 100) / 100;
      } else {
        interestPayable = Math.round((interestPayable + interest - intPaid) * 100) / 100;
      }

      entries.push({
        year: cy,
        month: cm,
        beginningBalance: Math.round(balance * 100) / 100,
        rate: monthRate,
        interestAccrued: interest,
        endingBalance: Math.round(adjustedBalance * 100) / 100,
        cumulativeInterest: Math.round(cumInterest * 100) / 100,
        balanceChanges: Math.round(changes * 100) / 100,
        interestPaid: intPaid,
        interestPayableBeg: intPayableBeg,
        interestPayableEnd: interestPayable,
      });

      balance = adjustedBalance;

      // Balance changes via transactions (draws/paydowns) or PIK capitalization
      if (balance <= 0 && changes === 0 && !pikCapitalized && i > 0) break;
    }

    return entries;
  }, [instrument, transactions, rateHistory]);

  // ---------------------------------------------------------------------------
  // Dynamic amortization schedule — replays actual transactions for past months,
  // assumes scheduled payment for current + future, interest-first allocation,
  // continues until balance reaches zero
  // ---------------------------------------------------------------------------
  interface DynamicAmortEntry {
    period_year: number;
    period_month: number;
    beginning_balance: number;
    interest_accrued: number;
    unpaid_interest_beg: number;
    payment: number;
    to_interest: number;
    to_principal: number;
    ending_balance: number;
    unpaid_interest_end: number;
    interest_rate: number;
    is_actual: boolean; // true = past month with known data
    is_current: boolean;
    cumulative_principal: number;
    cumulative_interest: number;
  }

  const dynamicAmortization = useMemo((): DynamicAmortEntry[] => {
    if (!instrument || !instrument.start_date) return [];

    const convention = instrument.day_count_convention ?? "30/360";
    const baseRate = instrument.interest_rate ?? 0;

    // Parse start date (local, not UTC)
    const [sdY, sdM] = instrument.start_date.split("T")[0].split("-").map(Number);

    // Current month
    const now = new Date();
    const nowY = now.getFullYear();
    const nowM = now.getMonth() + 1;

    // Rate history
    const rateChangesSorted = [...rateHistory].sort(
      (a, b) => new Date(a.effective_date).getTime() - new Date(b.effective_date).getTime()
    );
    function getDynRateForMonth(y: number, m: number): number {
      if (rateChangesSorted.length === 0) return baseRate;
      const periodStart = new Date(y, m - 1, 1);
      let effective = baseRate;
      for (const rc of rateChangesSorted) {
        if (new Date(rc.effective_date) <= periodStart) {
          effective = rc.interest_rate;
        }
      }
      return effective;
    }

    // Build monthly totals from actual transactions, preserving actual allocations
    const sortedTxns = [...transactions].sort(
      (a, b) => new Date(a.effective_date).getTime() - new Date(b.effective_date).getTime()
    );

    interface MonthlyActuals {
      totalPayment: number;
      toPrincipal: number;
      toInterest: number;
    }
    const monthlyActuals: Record<string, MonthlyActuals> = {};
    // Advances (draws) per month
    const monthlyAdvances: Record<string, number> = {};

    // Day-level balance changes for day-weighted interest calculation
    interface DayChange { day: number; amount: number; }
    const amortDayChanges: Record<string, DayChange[]> = {};
    for (const txn of sortedTxns) {
      const d = new Date(txn.effective_date);
      const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
      let delta = 0;
      if (txn.transaction_type === "advance") {
        delta = Math.abs(txn.amount);
      } else if (txn.transaction_type === "principal_payment" || txn.transaction_type === "vehicle_payoff") {
        delta = -Math.abs(txn.to_principal ?? txn.amount);
      } else if (txn.transaction_type === "payoff") {
        delta = -Math.abs(txn.amount);
      }
      if (delta !== 0) {
        if (!amortDayChanges[key]) amortDayChanges[key] = [];
        amortDayChanges[key].push({ day: d.getDate(), amount: delta });
      }
    }

    const principalTypes = ["principal_payment", "vehicle_payoff", "payoff"];
    const interestTypes = ["interest_payment"];

    for (const txn of sortedTxns) {
      const d = new Date(txn.effective_date);
      const key = `${d.getFullYear()}-${d.getMonth() + 1}`;

      if (txn.transaction_type === "advance") {
        monthlyAdvances[key] = (monthlyAdvances[key] ?? 0) + Math.abs(txn.amount);
        continue;
      }

      // Skip non-payment transaction types (fees, adjustments, etc.)
      if (![...principalTypes, ...interestTypes].includes(txn.transaction_type)) continue;

      if (!monthlyActuals[key]) monthlyActuals[key] = { totalPayment: 0, toPrincipal: 0, toInterest: 0 };
      const ma = monthlyActuals[key];
      const amt = Math.abs(txn.amount);
      ma.totalPayment += amt;

      // Use explicit breakdown if available, otherwise infer from transaction type
      if ((txn.to_principal ?? 0) !== 0 || (txn.to_interest ?? 0) !== 0) {
        ma.toPrincipal += Math.abs(txn.to_principal ?? 0);
        ma.toInterest += Math.abs(txn.to_interest ?? 0);
      } else if (principalTypes.includes(txn.transaction_type)) {
        ma.toPrincipal += amt;
      } else if (interestTypes.includes(txn.transaction_type)) {
        ma.toInterest += amt;
      }
    }

    // Determine the scheduled payment amount for projections
    let scheduledPayment = instrument.payment_amount ?? 0;
    if (scheduledPayment <= 0 && instrument.term_months && baseRate > 0) {
      // Calculate from standard amortization formula using current balance would be wrong —
      // we need original parameters. Use original_amount + term_months.
      const r = baseRate / 12;
      const n = instrument.term_months;
      const factor = Math.pow(1 + r, n);
      scheduledPayment = Math.round(instrument.original_amount * (r * factor) / (factor - 1) * 100) / 100;
    } else if (scheduledPayment <= 0 && instrument.term_months && baseRate === 0) {
      scheduledPayment = Math.round(instrument.original_amount / instrument.term_months * 100) / 100;
    }

    const entries: DynamicAmortEntry[] = [];
    const isLOC = ["line_of_credit", "revolving_credit"].includes(instrument.debt_type);
    let balance = isLOC ? (instrument.current_draw ?? instrument.original_amount) : instrument.original_amount;
    let unpaidInterest = 0;
    let cumPrincipal = 0;
    let cumInterest = 0;

    const maxPeriods = 600; // 50-year safety cap

    for (let i = 0; i < maxPeriods; i++) {
      const cy = sdY + Math.floor((sdM - 1 + i) / 12);
      const cm = ((sdM - 1 + i) % 12) + 1;

      if (balance <= 0.005 && unpaidInterest <= 0.005) break;

      const rate = getDynRateForMonth(cy, cm);
      const fullFactor = interestFactor(cy, cm, convention);
      // Pro-rate the first period based on the actual start day within the month
      const isFirstPeriod = i === 0;
      const startDay = isFirstPeriod ? Number(instrument.start_date.split("T")[0].split("-")[2]) : 1;
      const totalDays = new Date(cy, cm, 0).getDate();
      const accrualDays = totalDays - startDay + 1;
      const factor = isFirstPeriod ? fullFactor * (accrualDays / totalDays) : fullFactor;

      const isPast = cy < nowY || (cy === nowY && cm < nowM);
      const isCurrent = cy === nowY && cm === nowM;
      const key = `${cy}-${cm}`;
      const advance = monthlyAdvances[key] ?? 0;

      // Use day-weighted average balance when mid-month transactions exist
      // (matches the Interest Roll Forward methodology)
      const dayChanges = amortDayChanges[key] ?? [];
      let monthInterest: number;
      // Only use instrument start day for the first period; all others start at day 1
      const effectiveStartDay = isFirstPeriod ? startDay : 1;

      if (dayChanges.length > 0 || (isFirstPeriod && startDay > 1)) {
        const sorted = [...dayChanges].sort((a, b) => a.day - b.day);
        let runBal = balance;
        let weightedSum = 0;
        let prevDay = effectiveStartDay;

        for (const dc of sorted) {
          if (dc.day < effectiveStartDay) continue;
          const daysAtBal = Math.max(0, dc.day - prevDay);
          weightedSum += runBal * daysAtBal;
          runBal = Math.max(0, runBal + dc.amount);
          prevDay = dc.day;
        }
        weightedSum += runBal * (totalDays - prevDay + 1);

        const avgBalance = accrualDays > 0 ? weightedSum / accrualDays : 0;
        monthInterest = Math.round(avgBalance * rate * factor * 100) / 100;
      } else {
        monthInterest = Math.round(balance * rate * factor * 100) / 100;
      }

      let payment = 0;
      let toInterest = 0;
      let toPrincipal = 0;

      if (isPast) {
        // Past month — use actual transaction breakdowns
        const ma = monthlyActuals[key];
        if (ma) {
          payment = ma.totalPayment;
          toInterest = ma.toInterest;
          toPrincipal = Math.min(ma.toPrincipal, balance); // cap at current balance
        }
        // else payment = 0 (no payment made)
      } else {
        // Current or future month — assume scheduled payment, interest-first allocation
        if (scheduledPayment > 0) {
          const totalOwed = balance + unpaidInterest + monthInterest;
          payment = Math.min(scheduledPayment, Math.round(totalOwed * 100) / 100);

          const totalInterestOwed = unpaidInterest + monthInterest;
          toInterest = Math.round(Math.min(payment, totalInterestOwed) * 100) / 100;
          const remainder = Math.round((payment - toInterest) * 100) / 100;
          toPrincipal = Math.round(Math.min(remainder, balance) * 100) / 100;
        }
      }

      const newUnpaidInterest = Math.round(
        Math.max(0, unpaidInterest + monthInterest - toInterest) * 100
      ) / 100;
      const endingBalance = Math.round(
        Math.max(0, balance - toPrincipal + advance) * 100
      ) / 100;

      cumPrincipal += toPrincipal;
      cumInterest += toInterest;

      entries.push({
        period_year: cy,
        period_month: cm,
        beginning_balance: Math.round(balance * 100) / 100,
        interest_accrued: monthInterest,
        unpaid_interest_beg: Math.round(unpaidInterest * 100) / 100,
        payment: Math.round(payment * 100) / 100,
        to_interest: Math.round(toInterest * 100) / 100,
        to_principal: Math.round(toPrincipal * 100) / 100,
        ending_balance: endingBalance,
        unpaid_interest_end: newUnpaidInterest,
        interest_rate: rate,
        is_actual: isPast,
        is_current: isCurrent,
        cumulative_principal: Math.round(cumPrincipal * 100) / 100,
        cumulative_interest: Math.round(cumInterest * 100) / 100,
      });

      balance = endingBalance;
      unpaidInterest = newUnpaidInterest;
    }

    return entries;
  }, [instrument, transactions, rateHistory]);

  // Current vs long-term portion — derived from next 12 months of projected principal paydown
  const { currentPortion, longTermPortion } = useMemo(() => {
    if (dynamicAmortization.length === 0 || !instrument) {
      return { currentPortion: 0, longTermPortion: 0 };
    }

    const now = new Date();
    const nowY = now.getFullYear();
    const nowM = now.getMonth() + 1;

    // Find the current month's entry to get the starting balance
    const currentIdx = dynamicAmortization.findIndex(
      (r) => r.period_year === nowY && r.period_month === nowM
    );
    if (currentIdx < 0) {
      // If current month not in schedule, loan may already be paid off or not started
      const lastEntry = dynamicAmortization[dynamicAmortization.length - 1];
      return { currentPortion: 0, longTermPortion: lastEntry?.ending_balance ?? 0 };
    }

    // Sum principal paid in the next 12 months (current month + 11 more)
    let principalNext12 = 0;
    for (let i = currentIdx; i < Math.min(currentIdx + 12, dynamicAmortization.length); i++) {
      principalNext12 += dynamicAmortization[i].to_principal;
    }

    const currentBalance = dynamicAmortization[currentIdx].beginning_balance;
    const current = Math.round(Math.min(principalNext12, currentBalance) * 100) / 100;
    const longTerm = Math.round(Math.max(0, currentBalance - current) * 100) / 100;

    return { currentPortion: current, longTermPortion: longTerm };
  }, [dynamicAmortization, instrument]);

  // Daily interest based on current outstanding balance (from transactions, not amortization)
  const dailyInterest = useMemo(() => {
    if (!instrument) return 0;
    const balance = instrument.current_draw ?? instrument.original_amount;
    const rate = instrument.interest_rate ?? 0;
    const convention = instrument.day_count_convention ?? "30/360";
    switch (convention) {
      case "30/360": return Math.round(balance * rate / 360 * 100) / 100;
      case "actual/360": return Math.round(balance * rate / 360 * 100) / 100;
      case "actual/365": return Math.round(balance * rate / 365 * 100) / 100;
      case "actual/actual": {
        const now = new Date();
        const diy = (now.getFullYear() % 4 === 0 && (now.getFullYear() % 100 !== 0 || now.getFullYear() % 400 === 0)) ? 366 : 365;
        return Math.round(balance * rate / diy * 100) / 100;
      }
      default: return Math.round(balance * rate / 365 * 100) / 100;
    }
  }, [instrument]);

  if (loading)
    return <p className="text-muted-foreground p-6">Loading...</p>;
  if (!instrument)
    return <p className="text-muted-foreground p-6">Instrument not found</p>;

  const liabilityAccounts = accounts.filter(
    (a) => a.classification === "Liability"
  );
  const expenseAccounts = accounts.filter(
    (a) => a.classification === "Expense"
  );

  const latestAmort =
    amortization.length > 0 ? amortization[amortization.length - 1] : null;

  const principalTypes = ["principal_payment", "vehicle_payoff", "payoff", "advance"];
  const interestTypes = ["interest_payment"];
  const feeTypes = ["fee_payment", "late_fee", "misc_fee", "origination_fee", "annual_fee"];

  const totalInterest = transactions.reduce((sum: number, t: AnyRow) => {
    if ((t.to_interest ?? 0) !== 0) return sum + t.to_interest;
    if ((t.to_principal ?? 0) === 0 && (t.to_fees ?? 0) === 0 && interestTypes.includes(t.transaction_type)) return sum + (t.amount ?? 0);
    return sum;
  }, 0);
  const totalPrincipal = transactions.reduce((sum: number, t: AnyRow) => {
    if ((t.to_principal ?? 0) !== 0) return sum + t.to_principal;
    if ((t.to_interest ?? 0) === 0 && (t.to_fees ?? 0) === 0 && principalTypes.includes(t.transaction_type)) return sum + (t.amount ?? 0);
    return sum;
  }, 0);
  const totalFees = transactions.reduce((sum: number, t: AnyRow) => {
    if ((t.to_fees ?? 0) !== 0) return sum + t.to_fees;
    if ((t.to_principal ?? 0) === 0 && (t.to_interest ?? 0) === 0 && feeTypes.includes(t.transaction_type)) return sum + (t.amount ?? 0);
    return sum;
  }, 0);

  const isLOC = ["line_of_credit", "revolving_credit"].includes(instrument.debt_type);

  const formatDate = (d: string | null) => {
    if (!d) return "---";
    // Parse as local date to avoid UTC timezone shift (e.g. 2025-12-19 → Dec 18 in PST)
    const [y, m, day] = d.split("T")[0].split("-").map(Number);
    return new Date(y, m - 1, day).toLocaleDateString();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push(`/${entityId}/debt`)}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              {instrument.instrument_name}
            </h1>
            <Badge variant={STATUS_VARIANTS[instrument.status as DebtStatus] ?? "outline"}>
              {STATUS_LABELS[instrument.status as DebtStatus] ?? instrument.status}
            </Badge>
            <Badge variant="outline">
              {TYPE_LABELS[instrument.debt_type] ?? instrument.debt_type}
            </Badge>
            {instrument.payment_structure && (
              <Badge variant="outline">
                {PAYMENT_STRUCTURE_LABELS[instrument.payment_structure] ??
                  instrument.payment_structure}
              </Badge>
            )}
            {instrument.is_pik && (
              <Badge variant="secondary">PIK</Badge>
            )}
          </div>
          <div className="flex items-center gap-4 text-muted-foreground mt-1">
            {instrument.lender_name && (
              <span>Lender: {instrument.lender_name}</span>
            )}
            {instrument.loan_number && (
              <span className="font-mono text-sm">
                Loan #{instrument.loan_number}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={openEditDialog}>
            <Pencil className="mr-2 h-4 w-4" />
            Edit
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="icon">
                <Trash2 className="h-4 w-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete Instrument</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete &ldquo;{instrument.instrument_name}&rdquo; and all
                  associated transactions, amortization schedules, and rate history. This action
                  cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleDelete} disabled={deleting}>
                  {deleting ? "Deleting…" : "Delete"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* Edit Instrument Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Instrument</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit_instrument_name">Instrument Name *</Label>
                <Input id="edit_instrument_name" value={editForm.instrument_name} onChange={(e) => setEditForm({ ...editForm, instrument_name: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit_lender_name">Lender</Label>
                <Input id="edit_lender_name" value={editForm.lender_name} onChange={(e) => setEditForm({ ...editForm, lender_name: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit_loan_number">Loan / Account #</Label>
                <Input id="edit_loan_number" value={editForm.loan_number} onChange={(e) => setEditForm({ ...editForm, loan_number: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Debt Type</Label>
                <Select value={editForm.debt_type} onValueChange={(v) => setEditForm({ ...editForm, debt_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(TYPE_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Payment Structure</Label>
                <Select value={editForm.payment_structure} onValueChange={(v) => setEditForm({ ...editForm, payment_structure: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(PAYMENT_STRUCTURE_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit_original_amount">Original Amount *</Label>
                <Input id="edit_original_amount" type="number" step="0.01" value={editForm.original_amount} onChange={(e) => setEditForm({ ...editForm, original_amount: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit_interest_rate">Interest Rate (%)</Label>
                <Input id="edit_interest_rate" type="number" step="0.01" value={editForm.interest_rate} onChange={(e) => setEditForm({ ...editForm, interest_rate: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Rate Type</Label>
                <Select value={editForm.rate_type} onValueChange={(v) => setEditForm({ ...editForm, rate_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fixed">Fixed</SelectItem>
                    <SelectItem value="variable">Variable</SelectItem>
                    <SelectItem value="adjustable">Adjustable</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {editForm.rate_type !== "fixed" && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit_index_rate_name">Index / Benchmark</Label>
                  <Input id="edit_index_rate_name" value={editForm.index_rate_name} onChange={(e) => setEditForm({ ...editForm, index_rate_name: e.target.value })} placeholder="e.g. Prime, SOFR" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit_spread_margin">Spread / Margin (%)</Label>
                  <Input id="edit_spread_margin" type="number" step="0.01" value={editForm.spread_margin} onChange={(e) => setEditForm({ ...editForm, spread_margin: e.target.value })} />
                </div>
              </div>
            )}
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit_start_date">Start Date *</Label>
                <Input id="edit_start_date" type="date" value={editForm.start_date} onChange={(e) => setEditForm({ ...editForm, start_date: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit_maturity_date">Maturity Date</Label>
                <Input id="edit_maturity_date" type="date" value={editForm.maturity_date} onChange={(e) => setEditForm({ ...editForm, maturity_date: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit_term_months">Term (months)</Label>
                <Input id="edit_term_months" type="number" value={editForm.term_months} onChange={(e) => setEditForm({ ...editForm, term_months: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit_payment_amount">Monthly Payment</Label>
                <Input id="edit_payment_amount" type="number" step="0.01" value={editForm.payment_amount} onChange={(e) => setEditForm({ ...editForm, payment_amount: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit_credit_limit">Credit Limit</Label>
                <Input id="edit_credit_limit" type="number" step="0.01" value={editForm.credit_limit} onChange={(e) => setEditForm({ ...editForm, credit_limit: e.target.value })} />
              </div>
              {/* Current Draw / Balance is read-only — only changes via recorded transactions */}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Day Count Convention</Label>
                <Select value={editForm.day_count_convention} onValueChange={(v) => setEditForm({ ...editForm, day_count_convention: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="30/360">30/360</SelectItem>
                    <SelectItem value="actual/360">Actual/360</SelectItem>
                    <SelectItem value="actual/365">Actual/365</SelectItem>
                    <SelectItem value="actual/actual">Actual/Actual</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={editForm.status} onValueChange={(v) => setEditForm({ ...editForm, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="paid_off">Paid Off</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-start justify-between rounded-lg border p-3">
              <div className="space-y-0.5 pr-4">
                <Label htmlFor="edit_is_pik" className="cursor-pointer">PIK Interest</Label>
                <p className="text-xs text-muted-foreground">
                  Interest capitalizes to the balance each period (compounds — pay interest on the interest) instead of being paid in cash. Entire accrued balance is due at maturity. Toggling recalculates the amortization table and interest roll forward.
                </p>
              </div>
              <Switch
                id="edit_is_pik"
                checked={editForm.is_pik}
                onCheckedChange={(v) => setEditForm({ ...editForm, is_pik: v })}
              />
            </div>
            {editForm.payment_structure === "balloon" && (
              <div className="space-y-2">
                <Label htmlFor="edit_balloon_amount">Balloon Amount</Label>
                <Input id="edit_balloon_amount" type="number" step="0.01" value={editForm.balloon_amount} onChange={(e) => setEditForm({ ...editForm, balloon_amount: e.target.value })} />
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit_collateral_description">Collateral Description</Label>
                <Input id="edit_collateral_description" value={editForm.collateral_description} onChange={(e) => setEditForm({ ...editForm, collateral_description: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit_notes">Notes</Label>
                <Input id="edit_notes" value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
              <Button onClick={handleEditSave} disabled={editSaving}>
                {editSaving ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Summary Bar */}
      <div className="flex items-center gap-6 p-4 rounded-lg border bg-muted/40 flex-wrap">
        <div>
          <span className="text-sm text-muted-foreground">
            {isLOC ? "Credit Limit" : "Original Amount"}
          </span>
          <p className="text-lg font-semibold tabular-nums">
            {isLOC && instrument.credit_limit
              ? formatCurrency(instrument.credit_limit)
              : formatCurrency(instrument.original_amount)}
          </p>
        </div>
        <div>
          <span className="text-sm text-muted-foreground">
            {isLOC ? "Outstanding Draw" : "Current Balance"}
          </span>
          <p className="text-lg font-semibold tabular-nums">
            {formatCurrency(instrument.current_draw ?? instrument.original_amount)}
          </p>
        </div>
        <div>
          <span className="text-sm text-muted-foreground">Interest Rate</span>
          <p className="text-lg font-semibold tabular-nums">
            {formatPercentage(
              latestAmort?.interest_rate ?? instrument.interest_rate,
              2
            )}
            {instrument.rate_type && instrument.rate_type !== "fixed" && (
              <span className="text-xs text-muted-foreground ml-1">
                ({instrument.rate_type})
              </span>
            )}
          </p>
        </div>
        {instrument.term_months && (
          <div>
            <span className="text-sm text-muted-foreground">Term</span>
            <p className="text-lg font-semibold">
              {instrument.term_months} mo ({(instrument.term_months / 12).toFixed(1)} yr)
            </p>
          </div>
        )}
        {instrument.maturity_date && (
          <div>
            <span className="text-sm text-muted-foreground">Maturity</span>
            <p className="text-lg font-semibold">
              {formatDate(instrument.maturity_date)}
            </p>
          </div>
        )}
        {instrument.payment_amount && (
          <div>
            <span className="text-sm text-muted-foreground">Payment</span>
            <p className="text-lg font-semibold tabular-nums">
              {formatCurrency(instrument.payment_amount)}
            </p>
          </div>
        )}
        <div>
          <span className="text-sm text-muted-foreground">Day Count</span>
          <p className="text-lg font-semibold">{instrument.day_count_convention ?? "30/360"}</p>
        </div>
        <div className="border-l pl-6">
          <span className="text-sm text-muted-foreground">Daily Interest</span>
          <p className="text-lg font-semibold tabular-nums text-amber-600">
            {formatCurrency(dailyInterest)}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="details">
        <TabsList>
          <TabsTrigger value="details">
            <FileText className="h-4 w-4 mr-1" />
            Details
          </TabsTrigger>
          <TabsTrigger value="rates">
            <History className="h-4 w-4 mr-1" />
            Rate History ({rateHistory.length})
          </TabsTrigger>
          <TabsTrigger value="transactions">
            <ArrowUpDown className="h-4 w-4 mr-1" />
            Transactions ({transactions.length})
          </TabsTrigger>
          <TabsTrigger value="amortization">Amortization ({dynamicAmortization.length})</TabsTrigger>
          <TabsTrigger value="accrual">
            <DollarSign className="h-4 w-4 mr-1" />
            Interest Roll Forward ({interestAccrualSchedule.length})
          </TabsTrigger>
          <TabsTrigger value="whatif">
            <Calculator className="h-4 w-4 mr-1" />
            What-If
          </TabsTrigger>
        </TabsList>

        {/* TAB: Details */}
        <TabsContent value="details" className="space-y-6">
          <div className="grid grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Instrument Details</CardTitle>
                <CardDescription>Loan terms and identifiers</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Type</span>
                    <p className="font-medium">{TYPE_LABELS[instrument.debt_type] ?? instrument.debt_type}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Payment Structure</span>
                    <p className="font-medium">{PAYMENT_STRUCTURE_LABELS[instrument.payment_structure] ?? instrument.payment_structure ?? "P&I"}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Start Date</span>
                    <p className="font-medium">{formatDate(instrument.start_date)}</p>
                  </div>
                  {instrument.maturity_date && (
                    <div>
                      <span className="text-muted-foreground">Maturity Date</span>
                      <p className="font-medium">{formatDate(instrument.maturity_date)}</p>
                    </div>
                  )}
                  <div>
                    <span className="text-muted-foreground">Interest Rate</span>
                    <p className="font-medium tabular-nums">
                      {formatPercentage(instrument.interest_rate, 2)}
                      {instrument.rate_type && instrument.rate_type !== "fixed" && (
                        <span className="text-muted-foreground ml-1">
                          ({instrument.rate_type}
                          {instrument.index_rate_name ? ` — ${instrument.index_rate_name}` : ""}
                          {instrument.spread_margin ? ` + ${formatPercentage(instrument.spread_margin, 2)}` : ""}
                          )
                        </span>
                      )}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Day Count</span>
                    <p className="font-medium">{instrument.day_count_convention ?? "30/360"}</p>
                  </div>
                  {instrument.term_months && (
                    <div>
                      <span className="text-muted-foreground">Term</span>
                      <p className="font-medium">{instrument.term_months} months ({(instrument.term_months / 12).toFixed(1)} years)</p>
                    </div>
                  )}
                  <div>
                    <span className="text-muted-foreground">Total Principal Paid</span>
                    <p className="font-medium tabular-nums">{formatCurrency(totalPrincipal)}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Total Interest Paid</span>
                    <p className="font-medium tabular-nums">{formatCurrency(totalInterest)}</p>
                  </div>
                  {totalFees > 0 && (
                    <div>
                      <span className="text-muted-foreground">Total Fees</span>
                      <p className="font-medium tabular-nums">{formatCurrency(totalFees)}</p>
                    </div>
                  )}
                </div>

                {instrument.is_renewable && (
                  <div className="mt-4 pt-4 border-t">
                    <p className="text-sm font-medium mb-2">Renewal</p>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      {instrument.last_renewal_date && (
                        <div>
                          <span className="text-muted-foreground">Last Renewal</span>
                          <p className="font-medium">{formatDate(instrument.last_renewal_date)}</p>
                        </div>
                      )}
                      {instrument.next_renewal_date && (
                        <div>
                          <span className="text-muted-foreground">Next Renewal</span>
                          <p className="font-medium">{formatDate(instrument.next_renewal_date)}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {instrument.is_secured && (
                  <div className="mt-4 pt-4 border-t">
                    <p className="text-sm font-medium mb-2">Collateral</p>
                    <p className="text-sm">{instrument.collateral_description ?? "Secured — no description"}</p>
                  </div>
                )}

                {linkedAsset && (
                  <div className="mt-4 pt-4 border-t">
                    <div className="flex items-center gap-2 text-sm">
                      <LinkIcon className="h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground">Linked Asset:</span>
                      <span className="font-medium">
                        {linkedAsset.asset_tag ? `${linkedAsset.asset_tag} — ` : ""}
                        {linkedAsset.asset_name}
                      </span>
                    </div>
                  </div>
                )}

                {(currentPortion > 0 || longTermPortion > 0) && (
                  <div className="mt-4 pt-4 border-t">
                    <p className="text-sm font-medium mb-2">Balance Sheet Classification</p>
                    <p className="text-xs text-muted-foreground mb-2">Based on projected principal paydown over the next 12 months</p>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="text-muted-foreground">Current Portion</span>
                        <p className="font-medium tabular-nums">{formatCurrency(currentPortion)}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Long-Term Portion</span>
                        <p className="font-medium tabular-nums">{formatCurrency(longTermPortion)}</p>
                      </div>
                    </div>
                  </div>
                )}

                {instrument.source_file_name && (
                  <div className="mt-4 pt-4 border-t">
                    <span className="text-muted-foreground text-sm">Source File</span>
                    <p className="font-medium text-xs">
                      {instrument.source_file_name}
                      {instrument.uploaded_at && ` — ${new Date(instrument.uploaded_at).toLocaleString()}`}
                    </p>
                  </div>
                )}

                {instrument.notes && (
                  <div className="mt-4 pt-4 border-t">
                    <span className="text-muted-foreground text-sm">Notes</span>
                    <p className="text-sm whitespace-pre-wrap mt-1">{instrument.notes}</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* GL Account Linkage */}
            <Card>
              <CardHeader>
                <CardTitle>GL Accounts</CardTitle>
                <CardDescription>Chart of accounts linkage for journal entries</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Long-Term Liability Account</Label>
                  <AccountCombobox
                    accounts={liabilityAccounts.map((a) => ({
                      id: a.id,
                      account_number: a.account_number,
                      name: a.name,
                    }))}
                    value={liabilityAccountId}
                    onValueChange={setLiabilityAccountId}
                    placeholder="Select liability account..."
                  />
                </div>
                <div className="space-y-2">
                  <Label>Current Portion Liability Account</Label>
                  <AccountCombobox
                    accounts={liabilityAccounts.map((a) => ({
                      id: a.id,
                      account_number: a.account_number,
                      name: a.name,
                    }))}
                    value={currentLiabilityAccountId}
                    onValueChange={setCurrentLiabilityAccountId}
                    placeholder="Select current liability account..."
                  />
                </div>
                <div className="space-y-2">
                  <Label>Interest Expense Account</Label>
                  <AccountCombobox
                    accounts={expenseAccounts.map((a) => ({
                      id: a.id,
                      account_number: a.account_number,
                      name: a.name,
                    }))}
                    value={interestAccountId}
                    onValueChange={setInterestAccountId}
                    placeholder="Select expense account..."
                  />
                </div>
                <div className="space-y-2">
                  <Label>Fee Expense Account</Label>
                  <AccountCombobox
                    accounts={expenseAccounts.map((a) => ({
                      id: a.id,
                      account_number: a.account_number,
                      name: a.name,
                    }))}
                    value={feeAccountId}
                    onValueChange={setFeeAccountId}
                    placeholder="Select fee expense account..."
                  />
                </div>
                <Button onClick={handleSaveAccounts} disabled={saving} className="w-full">
                  <Save className="mr-2 h-4 w-4" />
                  {saving ? "Saving..." : "Save GL Accounts"}
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* TAB: Rate History */}
        <TabsContent value="rates">
          <Card>
            <CardHeader>
              <CardTitle>Rate History</CardTitle>
              <CardDescription>
                {rateHistory.length} rate change{rateHistory.length !== 1 ? "s" : ""} recorded
                {instrument.rate_type !== "fixed" && instrument.index_rate_name && (
                  <span> — Index: {instrument.index_rate_name}
                    {instrument.spread_margin ? ` + ${formatPercentage(instrument.spread_margin, 2)} spread` : ""}
                  </span>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {rateHistory.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  No rate changes recorded. For variable rate instruments, rate changes will appear here.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Effective Date</TableHead>
                      <TableHead className="text-right">Rate</TableHead>
                      <TableHead className="text-right">Index</TableHead>
                      <TableHead className="text-right">Spread</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rateHistory.map((rate: AnyRow) => (
                      <TableRow key={rate.id}>
                        <TableCell className="font-medium">{formatDate(rate.effective_date)}</TableCell>
                        <TableCell className="text-right tabular-nums font-medium">{formatPercentage(rate.interest_rate, 3)}</TableCell>
                        <TableCell className="text-right tabular-nums">{rate.index_rate != null ? formatPercentage(rate.index_rate, 3) : "---"}</TableCell>
                        <TableCell className="text-right tabular-nums">{rate.spread != null ? formatPercentage(rate.spread, 3) : "---"}</TableCell>
                        <TableCell className="text-muted-foreground">{rate.change_reason ?? "---"}</TableCell>
                        <TableCell className="text-muted-foreground text-xs">{rate.notes ?? ""}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB: Transactions */}
        <TabsContent value="transactions">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Transaction Ledger</CardTitle>
                  <CardDescription>
                    {transactions.length} transaction{transactions.length !== 1 ? "s" : ""} — draws, payments, fees, and adjustments
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" onClick={exportTransactionsToXlsx} disabled={transactions.length === 0}>
                    <Download className="mr-2 h-4 w-4" />
                    Export
                  </Button>
                  <Button onClick={() => setTxnOpen(true)}>
                    <Plus className="mr-2 h-4 w-4" />
                    Add Transaction
                  </Button>
                </div>
              </div>
            </CardHeader>

            {/* Add Transaction Dialog */}
            <Dialog open={txnOpen} onOpenChange={(open) => { setTxnOpen(open); if (!open) resetTxnForm(); }}>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>Add Transaction</DialogTitle>
                </DialogHeader>
                <div className="grid gap-4 py-2">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Transaction Type</Label>
                      <Select value={txnForm.transaction_type} onValueChange={(v) => setTxnForm({ ...txnForm, transaction_type: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Object.entries(TRANSACTION_TYPE_LABELS).map(([k, v]) => (
                            <SelectItem key={k} value={k}>{v}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="txn_date">Effective Date *</Label>
                      <Input id="txn_date" type="date" value={txnForm.effective_date} onChange={(e) => setTxnForm({ ...txnForm, effective_date: e.target.value })} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="txn_amount">Total Amount *</Label>
                    <Input id="txn_amount" type="number" step="0.01" value={txnForm.amount} onChange={(e) => setTxnForm({ ...txnForm, amount: e.target.value })} placeholder="0.00" />
                  </div>
                  {["principal_payment", "interest_payment", "fee_payment", "vehicle_payoff", "payment_reversal"].includes(txnForm.transaction_type) ? (
                    <div className="grid grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="txn_to_principal">To Principal</Label>
                        <Input id="txn_to_principal" type="number" step="0.01" value={txnForm.to_principal} onChange={(e) => setTxnForm({ ...txnForm, to_principal: e.target.value })} placeholder="0.00" />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="txn_to_interest">To Interest</Label>
                        <Input id="txn_to_interest" type="number" step="0.01" value={txnForm.to_interest} onChange={(e) => setTxnForm({ ...txnForm, to_interest: e.target.value })} placeholder="0.00" />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="txn_to_fees">To Fees</Label>
                        <Input id="txn_to_fees" type="number" step="0.01" value={txnForm.to_fees} onChange={(e) => setTxnForm({ ...txnForm, to_fees: e.target.value })} placeholder="0.00" />
                      </div>
                    </div>
                  ) : null}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="txn_running_balance">Running Balance</Label>
                      <Input id="txn_running_balance" type="number" step="0.01" value={txnForm.running_balance} onChange={(e) => setTxnForm({ ...txnForm, running_balance: e.target.value })} placeholder="After this transaction" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="txn_reference_number">Reference #</Label>
                      <Input id="txn_reference_number" value={txnForm.reference_number} onChange={(e) => setTxnForm({ ...txnForm, reference_number: e.target.value })} placeholder="Check #, wire ref, etc." />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="txn_description">Description</Label>
                    <Input id="txn_description" value={txnForm.description} onChange={(e) => setTxnForm({ ...txnForm, description: e.target.value })} placeholder="e.g. Monthly interest payment" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="txn_notes">Notes</Label>
                    <Input id="txn_notes" value={txnForm.notes} onChange={(e) => setTxnForm({ ...txnForm, notes: e.target.value })} />
                  </div>
                  <div className="flex justify-end gap-2 pt-2">
                    <Button variant="outline" onClick={() => setTxnOpen(false)}>Cancel</Button>
                    <Button onClick={handleAddTransaction} disabled={txnSaving}>
                      {txnSaving ? "Adding..." : "Add Transaction"}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>

            {/* Edit Transaction Dialog */}
            <Dialog open={editTxnOpen} onOpenChange={setEditTxnOpen}>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>Edit Transaction</DialogTitle>
                </DialogHeader>
                <div className="grid gap-4 py-2">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Transaction Type</Label>
                      <Select value={editTxnForm.transaction_type} onValueChange={(v) => setEditTxnForm({ ...editTxnForm, transaction_type: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Object.entries(TRANSACTION_TYPE_LABELS).map(([k, v]) => (
                            <SelectItem key={k} value={k}>{v}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Effective Date *</Label>
                      <Input type="date" value={editTxnForm.effective_date} onChange={(e) => setEditTxnForm({ ...editTxnForm, effective_date: e.target.value })} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Total Amount *</Label>
                    <Input type="number" step="0.01" value={editTxnForm.amount} onChange={(e) => setEditTxnForm({ ...editTxnForm, amount: e.target.value })} placeholder="0.00" />
                  </div>
                  {["principal_payment", "interest_payment", "fee_payment", "vehicle_payoff", "payment_reversal"].includes(editTxnForm.transaction_type) && (
                    <div className="grid grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label>To Principal</Label>
                        <Input type="number" step="0.01" value={editTxnForm.to_principal} onChange={(e) => setEditTxnForm({ ...editTxnForm, to_principal: e.target.value })} placeholder="0.00" />
                      </div>
                      <div className="space-y-2">
                        <Label>To Interest</Label>
                        <Input type="number" step="0.01" value={editTxnForm.to_interest} onChange={(e) => setEditTxnForm({ ...editTxnForm, to_interest: e.target.value })} placeholder="0.00" />
                      </div>
                      <div className="space-y-2">
                        <Label>To Fees</Label>
                        <Input type="number" step="0.01" value={editTxnForm.to_fees} onChange={(e) => setEditTxnForm({ ...editTxnForm, to_fees: e.target.value })} placeholder="0.00" />
                      </div>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Running Balance</Label>
                      <Input type="number" step="0.01" value={editTxnForm.running_balance} onChange={(e) => setEditTxnForm({ ...editTxnForm, running_balance: e.target.value })} placeholder="After this transaction" />
                    </div>
                    <div className="space-y-2">
                      <Label>Reference #</Label>
                      <Input value={editTxnForm.reference_number} onChange={(e) => setEditTxnForm({ ...editTxnForm, reference_number: e.target.value })} placeholder="Check #, wire ref, etc." />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Description</Label>
                    <Input value={editTxnForm.description} onChange={(e) => setEditTxnForm({ ...editTxnForm, description: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Notes</Label>
                    <Input value={editTxnForm.notes} onChange={(e) => setEditTxnForm({ ...editTxnForm, notes: e.target.value })} />
                  </div>
                  <div className="flex justify-end gap-2 pt-2">
                    <Button variant="outline" onClick={() => setEditTxnOpen(false)}>Cancel</Button>
                    <Button onClick={handleEditTransaction} disabled={editTxnSaving}>
                      {editTxnSaving ? "Saving..." : "Save Changes"}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>

            <CardContent>
              {transactions.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  No transactions recorded yet. Click &quot;Add Transaction&quot; to record a payment, draw, or fee.
                </p>
              ) : (
                <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead className="text-right">To Principal</TableHead>
                        <TableHead className="text-right">To Interest</TableHead>
                        <TableHead className="text-right">To Fees</TableHead>
                        <TableHead className="text-right">Balance</TableHead>
                        <TableHead>Ref #</TableHead>
                        <TableHead className="text-center">Doc</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {transactions.map((txn: AnyRow) => (
                        <TableRow key={txn.id}>
                          <TableCell className="font-medium whitespace-nowrap">{formatDate(txn.effective_date)}</TableCell>
                          <TableCell>
                            <span className={`text-sm font-medium ${TRANSACTION_TYPE_COLORS[txn.transaction_type] ?? ""}`}>
                              {TRANSACTION_TYPE_LABELS[txn.transaction_type] ?? txn.transaction_type}
                            </span>
                          </TableCell>
                          <TableCell className="text-muted-foreground text-sm max-w-[200px] truncate">{txn.description ?? "---"}</TableCell>
                          <TableCell className="text-right tabular-nums font-medium">{formatCurrency(txn.amount)}</TableCell>
                          <TableCell className="text-right tabular-nums">{txn.to_principal ? formatCurrency(txn.to_principal) : "---"}</TableCell>
                          <TableCell className="text-right tabular-nums">{txn.to_interest ? formatCurrency(txn.to_interest) : "---"}</TableCell>
                          <TableCell className="text-right tabular-nums">{txn.to_fees ? formatCurrency(txn.to_fees) : "---"}</TableCell>
                          <TableCell className="text-right tabular-nums font-medium">{txn.running_balance != null ? formatCurrency(txn.running_balance) : "---"}</TableCell>
                          <TableCell className="text-xs text-muted-foreground font-mono">{txn.reference_number ?? ""}</TableCell>
                          <TableCell className="text-center">
                            {(() => {
                              const docs = txnDocs.get(txn.id) ?? [];
                              const hasDoc = docs.length > 0;
                              return (
                                <Popover>
                                  <PopoverTrigger asChild>
                                    <Button variant="ghost" size="sm" className={`h-7 w-7 p-0 ${hasDoc ? "text-blue-600" : "text-muted-foreground/40 hover:text-muted-foreground"}`}>
                                      <Paperclip className="h-3.5 w-3.5" />
                                    </Button>
                                  </PopoverTrigger>
                                  <PopoverContent className="w-72 p-3" align="end">
                                    <div className="space-y-2">
                                      <div className="flex items-center justify-between">
                                        <span className="text-sm font-medium">Documents</span>
                                        <label className="cursor-pointer">
                                          <input
                                            type="file"
                                            className="hidden"
                                            onChange={(e) => handleDocUpload(txn.id, e)}
                                            disabled={uploadingDocTxnId === txn.id}
                                          />
                                          <span className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700">
                                            <Upload className="h-3 w-3" />
                                            {uploadingDocTxnId === txn.id ? "Uploading..." : "Upload"}
                                          </span>
                                        </label>
                                      </div>
                                      {docs.length === 0 ? (
                                        <p className="text-xs text-muted-foreground py-1">No documents attached.</p>
                                      ) : (
                                        <div className="space-y-1">
                                          {docs.map((doc: AnyRow) => (
                                            <div key={doc.id} className="flex items-center gap-2 text-xs rounded-md border px-2 py-1.5">
                                              <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
                                              <button
                                                className="truncate text-left hover:underline flex-1"
                                                onClick={() => handleDocDownload(doc.file_path, doc.file_name)}
                                                title={doc.file_name}
                                              >
                                                {doc.file_name}
                                              </button>
                                              <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-5 w-5 p-0 shrink-0 text-muted-foreground hover:text-destructive"
                                                onClick={() => handleDocDelete(doc.id, doc.file_path)}
                                              >
                                                <X className="h-3 w-3" />
                                              </Button>
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  </PopoverContent>
                                </Popover>
                              );
                            })()}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              {txn.is_reconciled && <Badge variant="secondary" className="text-xs">Reconciled</Badge>}
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEditTxn(txn)}>
                                <Pencil className="h-3 w-3" />
                              </Button>
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => handleDeleteTransaction(txn.id)}>
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB: Amortization Schedule (Dynamic) */}
        <TabsContent value="amortization">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Amortization Schedule</CardTitle>
                  <CardDescription>
                    {dynamicAmortization.length > 0
                      ? `${dynamicAmortization.filter(r => r.is_actual).length} actual + ${dynamicAmortization.filter(r => !r.is_actual).length} projected periods`
                      : "Requires start date and balance to generate"}
                  </CardDescription>
                </div>
                {dynamicAmortization.length > 0 && (
                  <div className="flex gap-6 text-right">
                    <div>
                      <span className="text-sm text-muted-foreground">Total Principal</span>
                      <p className="text-lg font-semibold tabular-nums text-green-600">
                        {formatCurrency(dynamicAmortization.reduce((s, r) => s + r.to_principal, 0))}
                      </p>
                    </div>
                    <div>
                      <span className="text-sm text-muted-foreground">Total Interest</span>
                      <p className="text-lg font-semibold tabular-nums text-amber-600">
                        {formatCurrency(dynamicAmortization.reduce((s, r) => s + r.to_interest, 0))}
                      </p>
                    </div>
                    {dynamicAmortization.some(r => r.unpaid_interest_end > 0.005) && (
                      <div>
                        <span className="text-sm text-muted-foreground">Unpaid Interest</span>
                        <p className="text-lg font-semibold tabular-nums text-red-600">
                          {formatCurrency(dynamicAmortization[dynamicAmortization.length - 1]?.unpaid_interest_end ?? 0)}
                        </p>
                      </div>
                    )}
                    <div>
                      <span className="text-sm text-muted-foreground">Payoff</span>
                      <p className="text-lg font-semibold tabular-nums">
                        {getPeriodShortLabel(
                          dynamicAmortization[dynamicAmortization.length - 1]?.period_year ?? 0,
                          dynamicAmortization[dynamicAmortization.length - 1]?.period_month ?? 0
                        )}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {dynamicAmortization.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  No schedule available. Ensure the instrument has a start date, balance, and interest rate.
                </p>
              ) : (
                <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Period</TableHead>
                        <TableHead className="text-right">Beg Balance</TableHead>
                        <TableHead className="text-right">Interest Accrued</TableHead>
                        <TableHead className="text-right">Payment</TableHead>
                        <TableHead className="text-right">To Interest</TableHead>
                        <TableHead className="text-right">To Principal</TableHead>
                        <TableHead className="text-right">End Balance</TableHead>
                        {dynamicAmortization.some(r => r.unpaid_interest_end > 0.005) && (
                          <TableHead className="text-right">Unpaid Int</TableHead>
                        )}
                        <TableHead className="text-right">Rate</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dynamicAmortization.map((row, idx) => {
                        const hasUnpaidCol = dynamicAmortization.some(r => r.unpaid_interest_end > 0.005);
                        return (
                          <TableRow
                            key={idx}
                            className={
                              row.is_current
                                ? "bg-blue-50 dark:bg-blue-950/20"
                                : !row.is_actual && !row.is_current
                                ? "text-muted-foreground"
                                : ""
                            }
                          >
                            <TableCell className="font-medium whitespace-nowrap">
                              {getPeriodShortLabel(row.period_year, row.period_month)}
                              {row.is_current && <Badge variant="outline" className="ml-2 text-xs">Current</Badge>}
                              {row.is_actual && row.payment === 0 && (
                                <Badge variant="secondary" className="ml-2 text-xs text-red-600">No Payment</Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{formatCurrency(row.beginning_balance)}</TableCell>
                            <TableCell className="text-right tabular-nums text-amber-600">{formatCurrency(row.interest_accrued)}</TableCell>
                            <TableCell className="text-right tabular-nums font-medium">
                              {row.payment > 0 ? formatCurrency(row.payment) : "---"}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {row.to_interest > 0 ? formatCurrency(row.to_interest) : "---"}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-green-600">
                              {row.to_principal > 0 ? formatCurrency(row.to_principal) : "---"}
                            </TableCell>
                            <TableCell className="text-right tabular-nums font-medium">{formatCurrency(row.ending_balance)}</TableCell>
                            {hasUnpaidCol && (
                              <TableCell className={`text-right tabular-nums ${row.unpaid_interest_end > 0.005 ? "text-red-600 font-medium" : "text-muted-foreground"}`}>
                                {row.unpaid_interest_end > 0.005 ? formatCurrency(row.unpaid_interest_end) : "---"}
                              </TableCell>
                            )}
                            <TableCell className="text-right tabular-nums text-muted-foreground">
                              {formatPercentage(row.interest_rate, 2)}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      <TableRow className="font-semibold border-t-2">
                        <TableCell>Totals</TableCell>
                        <TableCell />
                        <TableCell className="text-right tabular-nums text-amber-600">
                          {formatCurrency(dynamicAmortization.reduce((s, r) => s + r.interest_accrued, 0))}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCurrency(dynamicAmortization.reduce((s, r) => s + r.payment, 0))}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCurrency(dynamicAmortization.reduce((s, r) => s + r.to_interest, 0))}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-green-600">
                          {formatCurrency(dynamicAmortization.reduce((s, r) => s + r.to_principal, 0))}
                        </TableCell>
                        <TableCell colSpan={dynamicAmortization.some(r => r.unpaid_interest_end > 0.005) ? 3 : 2} />
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB: Interest Roll Forward */}
        <TabsContent value="accrual">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Interest Roll Forward</CardTitle>
                  <CardDescription>
                    Monthly interest accrued vs. paid, with running interest payable balance
                  </CardDescription>
                </div>
                {interestAccrualSchedule.length > 0 && (
                  <div className="flex gap-6 text-right">
                    <div>
                      <span className="text-sm text-muted-foreground">Total Accrued</span>
                      <p className="text-lg font-semibold tabular-nums text-amber-600">
                        {formatCurrency(interestAccrualSchedule.reduce((s, r) => s + r.interestAccrued, 0))}
                      </p>
                    </div>
                    <div>
                      <span className="text-sm text-muted-foreground">Total Paid</span>
                      <p className="text-lg font-semibold tabular-nums text-green-600">
                        {formatCurrency(interestAccrualSchedule.reduce((s, r) => s + r.interestPaid, 0))}
                      </p>
                    </div>
                    <div>
                      <span className="text-sm text-muted-foreground">Interest Payable</span>
                      <p className="text-lg font-semibold tabular-nums">
                        {formatCurrency(interestAccrualSchedule[interestAccrualSchedule.length - 1].interestPayableEnd)}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {interestAccrualSchedule.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  No interest accrual data available. Ensure the instrument has a start date and balance.
                </p>
              ) : (
                <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Period</TableHead>
                        <TableHead className="text-right">Principal Balance</TableHead>
                        <TableHead className="text-right">Rate</TableHead>
                        <TableHead className="text-right border-l">Beg Int Payable</TableHead>
                        <TableHead className="text-right">Interest Accrued</TableHead>
                        <TableHead className="text-right">Interest Paid</TableHead>
                        <TableHead className="text-right">End Int Payable</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {interestAccrualSchedule.map((row, idx) => {
                        const now = new Date();
                        const isCurrent = row.year === now.getFullYear() && row.month === now.getMonth() + 1;
                        const isPast = new Date(row.year, row.month - 1, 1) < new Date(now.getFullYear(), now.getMonth(), 1);
                        return (
                          <TableRow
                            key={idx}
                            className={isCurrent ? "bg-amber-50 dark:bg-amber-950/20" : !isPast ? "text-muted-foreground" : ""}
                          >
                            <TableCell className="font-medium">
                              {getPeriodShortLabel(row.year, row.month)}
                              {isCurrent && <Badge variant="outline" className="ml-2 text-xs">Current</Badge>}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatCurrency(row.endingBalance)}
                              {row.balanceChanges !== 0 && (
                                <span className={`ml-1 text-xs ${row.balanceChanges > 0 ? "text-red-500" : "text-green-500"}`}>
                                  ({row.balanceChanges > 0 ? "+" : ""}{formatCurrency(row.balanceChanges)})
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-muted-foreground">{formatPercentage(row.rate, 2)}</TableCell>
                            <TableCell className="text-right tabular-nums border-l">{formatCurrency(row.interestPayableBeg)}</TableCell>
                            <TableCell className="text-right tabular-nums font-medium text-amber-600">{formatCurrency(row.interestAccrued)}</TableCell>
                            <TableCell className={`text-right tabular-nums ${row.interestPaid > 0 ? "font-medium text-green-600" : "text-muted-foreground"}`}>
                              {row.interestPaid > 0 ? `(${formatCurrency(row.interestPaid)})` : "---"}
                            </TableCell>
                            <TableCell className={`text-right tabular-nums font-medium ${row.interestPayableEnd > 0 ? "" : "text-muted-foreground"}`}>
                              {formatCurrency(row.interestPayableEnd)}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      <TableRow className="font-semibold border-t-2">
                        <TableCell>Total</TableCell>
                        <TableCell />
                        <TableCell />
                        <TableCell className="border-l" />
                        <TableCell className="text-right tabular-nums text-amber-600">
                          {formatCurrency(interestAccrualSchedule.reduce((s, r) => s + r.interestAccrued, 0))}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-green-600">
                          {formatCurrency(interestAccrualSchedule.reduce((s, r) => s + r.interestPaid, 0))}
                        </TableCell>
                        <TableCell />
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB: What-If Scenario */}
        <TabsContent value="whatif">
          <Card>
            <CardHeader>
              <CardTitle>What-If Amortization</CardTitle>
              <CardDescription>Model different rate and term scenarios</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-end gap-4">
                <div className="space-y-2">
                  <Label>Annual Rate (%)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    placeholder={`Current: ${(instrument.interest_rate * 100).toFixed(2)}`}
                    value={whatIfRate}
                    onChange={(e) => setWhatIfRate(e.target.value)}
                    className="w-[160px]"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Term (months)</Label>
                  <Input
                    type="number"
                    step="1"
                    placeholder={`Current: ${instrument.term_months ?? 60}`}
                    value={whatIfTerm}
                    onChange={(e) => setWhatIfTerm(e.target.value)}
                    className="w-[160px]"
                  />
                </div>
                <Button onClick={() => setShowWhatIf(true)} disabled={!whatIfRate || !whatIfTerm}>
                  <Calculator className="mr-2 h-4 w-4" />
                  Generate Schedule
                </Button>
              </div>

              {whatIfSummary && (
                <div className="flex items-center gap-6 p-4 rounded-lg border bg-muted/40 flex-wrap">
                  <div>
                    <span className="text-sm text-muted-foreground">Monthly Payment</span>
                    <p className="text-lg font-semibold tabular-nums">
                      {whatIfSchedule.length > 0 ? formatCurrency(whatIfSchedule[0].payment) : "---"}
                    </p>
                  </div>
                  <div>
                    <span className="text-sm text-muted-foreground">Total Interest</span>
                    <p className="text-lg font-semibold tabular-nums">{formatCurrency(whatIfSummary.total_interest)}</p>
                  </div>
                  <div>
                    <span className="text-sm text-muted-foreground">Total Payments</span>
                    <p className="text-lg font-semibold tabular-nums">{formatCurrency(whatIfSummary.total_payments)}</p>
                  </div>
                  <div>
                    <span className="text-sm text-muted-foreground">vs Current Interest</span>
                    <p className={`text-lg font-semibold tabular-nums ${
                      whatIfSummary.total_interest < totalInterest ? "text-green-600" :
                      whatIfSummary.total_interest > totalInterest ? "text-red-600" : ""
                    }`}>
                      {formatCurrency(whatIfSummary.total_interest - totalInterest)}
                    </p>
                  </div>
                </div>
              )}

              {whatIfSchedule.length > 0 && (
                <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>#</TableHead>
                        <TableHead>Period</TableHead>
                        <TableHead className="text-right">Beg Balance</TableHead>
                        <TableHead className="text-right">Payment</TableHead>
                        <TableHead className="text-right">Principal</TableHead>
                        <TableHead className="text-right">Interest</TableHead>
                        <TableHead className="text-right">End Balance</TableHead>
                        <TableHead className="text-right">Cum. Interest</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {whatIfSchedule.map((row, idx) => (
                        <TableRow key={idx}>
                          <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                          <TableCell className="font-medium">{getPeriodShortLabel(row.period_year, row.period_month)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatCurrency(row.beginning_balance)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatCurrency(row.payment)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatCurrency(row.principal)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatCurrency(row.interest)}</TableCell>
                          <TableCell className="text-right tabular-nums font-medium">{formatCurrency(row.ending_balance)}</TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">{formatCurrency(row.cumulative_interest)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
