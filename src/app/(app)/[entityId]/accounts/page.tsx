"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { fetchAllPaginated } from "@/lib/utils/paginated-fetch";
import {
  Card,
  CardContent,
  CardHeader,
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/utils/dates";
import { Settings2, Save, ChevronDown, ChevronRight } from "lucide-react";
import type { AccountClassification } from "@/lib/types/database";

interface Account {
  id: string;
  account_number: string | null;
  name: string;
  fully_qualified_name: string | null;
  classification: AccountClassification;
  account_type: string;
  account_sub_type: string | null;
  is_active: boolean;
  current_balance: number;
  display_order: number;
}

const CLASSIFICATION_COLORS: Record<AccountClassification, string> = {
  Asset: "bg-blue-100 text-blue-800",
  Liability: "bg-red-100 text-red-800",
  Equity: "bg-purple-100 text-purple-800",
  Revenue: "bg-green-100 text-green-800",
  Expense: "bg-orange-100 text-orange-800",
};

const SCHEDULE_TYPES = [
  { value: "none", label: "None" },
  { value: "prepaid", label: "Prepaid / Amortization" },
  { value: "fixed_asset", label: "Rental Asset / Depreciation" },
  { value: "debt", label: "Debt Schedule" },
  { value: "accrual", label: "Accrual Schedule" },
  { value: "custom", label: "Custom Schedule" },
];

const TASK_CATEGORIES = [
  { value: "none", label: "None" },
  { value: "Reconciliation", label: "Reconciliation" },
  { value: "Accruals", label: "Accruals" },
  { value: "Journal Entries", label: "Journal Entries" },
  { value: "Review", label: "Review" },
  { value: "Reporting", label: "Reporting" },
  { value: "Other", label: "Other" },
];

interface AccountSettings {
  schedule_type: string;
  task_category: string;
  requires_reconciliation: boolean;
  notes: string;
}

export default function AccountsPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const supabase = createClient();

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [classFilter, setClassFilter] = useState("all");
  const [showInactive, setShowInactive] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [accountSettings, setAccountSettings] = useState<
    Record<string, AccountSettings>
  >({});
  const [editSettings, setEditSettings] = useState<AccountSettings>({
    schedule_type: "none",
    task_category: "none",
    requires_reconciliation: false,
    notes: "",
  });
  // Draft values for the two DB-backed account fields the detail panel lets
  // the user edit. Kept separate from editSettings (which is localStorage
  // only) because these need to be persisted via the accounts API.
  const [editAccountFields, setEditAccountFields] = useState<{
    accountNumber: string;
    name: string;
  }>({ accountNumber: "", name: "" });
  const [savingAccountFields, setSavingAccountFields] = useState(false);

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const loadAccounts = useCallback(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await fetchAllPaginated<any>((offset, limit) => {
      let query = supabase
        .from("accounts")
        .select("*")
        .eq("entity_id", entityId)
        .order("classification")
        .order("account_type")
        .order("account_number")
        .order("name");

      if (!showInactive) {
        query = query.eq("is_active", true);
      }

      return query.range(offset, offset + limit - 1);
    });
    setAccounts(data as Account[]);
    setLoading(false);
  }, [supabase, entityId, showInactive]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(`account-settings-${entityId}`);
      if (stored) {
        setAccountSettings(JSON.parse(stored));
      }
    } catch {
      // ignore
    }
  }, [entityId]);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  function openSettings(account: Account) {
    setSelectedAccount(account);
    const existing = accountSettings[account.id] || {
      schedule_type: "none",
      task_category: "none",
      requires_reconciliation: false,
      notes: "",
    };
    setEditSettings({ ...existing });
    setEditAccountFields({
      accountNumber: account.account_number ?? "",
      name: account.name,
    });
    setSheetOpen(true);
  }

  async function handleSaveAccountFields() {
    if (!selectedAccount) return;
    const trimmedName = editAccountFields.name.trim();
    if (trimmedName.length === 0) {
      toast.error("Account name cannot be blank");
      return;
    }
    const trimmedNumber = editAccountFields.accountNumber.trim();
    const currentNumber = selectedAccount.account_number ?? "";
    const numberChanged = trimmedNumber !== currentNumber;
    const nameChanged = trimmedName !== selectedAccount.name;
    if (!numberChanged && !nameChanged) {
      toast.info("No changes to save");
      return;
    }

    setSavingAccountFields(true);
    try {
      const res = await fetch(`/api/accounts/${selectedAccount.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(numberChanged
            ? { accountNumber: trimmedNumber.length > 0 ? trimmedNumber : null }
            : {}),
          ...(nameChanged ? { name: trimmedName } : {}),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ?? "Failed to update account");
        return;
      }
      const { account } = (await res.json()) as {
        account: { account_number: string | null; name: string };
      };
      // Refresh the list in-place so the row reflects the update.
      setAccounts((prev) =>
        prev.map((a) =>
          a.id === selectedAccount.id
            ? {
                ...a,
                account_number: account.account_number,
                name: account.name,
              }
            : a
        )
      );
      setSelectedAccount({
        ...selectedAccount,
        account_number: account.account_number,
        name: account.name,
      });
      toast.success("Account updated");
    } catch {
      toast.error("Failed to update account — network error");
    } finally {
      setSavingAccountFields(false);
    }
  }

  function handleSaveSettings() {
    if (!selectedAccount) return;
    setSaving(true);

    const updated = {
      ...accountSettings,
      [selectedAccount.id]: { ...editSettings },
    };
    setAccountSettings(updated);

    try {
      localStorage.setItem(
        `account-settings-${entityId}`,
        JSON.stringify(updated)
      );
    } catch {
      // ignore
    }

    toast.success(`Settings saved for ${selectedAccount.name}`);
    setSaving(false);
    setSheetOpen(false);
  }

  const filtered = accounts.filter((a) => {
    const matchesSearch =
      !search ||
      a.name.toLowerCase().includes(search.toLowerCase()) ||
      (a.account_number ?? "").includes(search) ||
      (a.fully_qualified_name ?? "")
        .toLowerCase()
        .includes(search.toLowerCase());
    const matchesClass =
      classFilter === "all" || a.classification === classFilter;
    return matchesSearch && matchesClass;
  });

  const grouped = filtered.reduce<Record<string, Account[]>>((acc, account) => {
    const key = account.classification;
    if (!acc[key]) acc[key] = [];
    acc[key].push(account);
    return acc;
  }, {});

  const classificationOrder: AccountClassification[] = [
    "Asset",
    "Liability",
    "Equity",
    "Revenue",
    "Expense",
  ];

  function toggleCollapse(classification: string) {
    setCollapsed((prev) => ({
      ...prev,
      [classification]: !prev[classification],
    }));
  }

  function getSettingsTags(accountId: string): string[] {
    const s = accountSettings[accountId];
    if (!s) return [];
    const tags: string[] = [];
    if (s.schedule_type && s.schedule_type !== "none") {
      const found = SCHEDULE_TYPES.find((t) => t.value === s.schedule_type);
      tags.push(found?.label ?? s.schedule_type);
    }
    if (s.task_category && s.task_category !== "none") {
      tags.push(s.task_category);
    }
    if (s.requires_reconciliation) {
      tags.push("Recon");
    }
    return tags;
  }

  const configuredCount = Object.values(accountSettings).filter(
    (s) =>
      s.schedule_type !== "none" ||
      s.task_category !== "none" ||
      s.requires_reconciliation
  ).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Chart of Accounts
        </h1>
        <p className="text-muted-foreground">
          {accounts.length} accounts synced from QuickBooks
          {configuredCount > 0 && ` \u2022 ${configuredCount} configured`}
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-4">
            <Input
              placeholder="Search accounts..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-xs"
            />
            <Select value={classFilter} onValueChange={setClassFilter}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Classification" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Classifications</SelectItem>
                <SelectItem value="Asset">Asset</SelectItem>
                <SelectItem value="Liability">Liability</SelectItem>
                <SelectItem value="Equity">Equity</SelectItem>
                <SelectItem value="Revenue">Revenue</SelectItem>
                <SelectItem value="Expense">Expense</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="showInactive"
                checked={showInactive}
                onCheckedChange={(checked) => setShowInactive(checked === true)}
              />
              <Label htmlFor="showInactive" className="text-sm">
                Show inactive
              </Label>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading accounts...</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {accounts.length === 0
                ? "No accounts yet. Connect QuickBooks and sync to populate your chart of accounts."
                : "No accounts match your search."}
            </p>
          ) : (
            <div className="space-y-2">
              {classificationOrder.map((classification) => {
                const classAccounts = grouped[classification];
                if (!classAccounts || classAccounts.length === 0) return null;
                const isCollapsed = collapsed[classification];

                const totalBalance = classAccounts.reduce(
                  (sum, a) => sum + (a.current_balance ?? 0),
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
                      <span className="ml-auto text-sm font-medium tabular-nums">
                        {formatCurrency(totalBalance)}
                      </span>
                    </button>

                    {!isCollapsed && (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-24">Number</TableHead>
                            <TableHead>Name</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Settings</TableHead>
                            <TableHead className="text-right">
                              Balance
                            </TableHead>
                            <TableHead className="w-10"></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {classAccounts.map((account) => {
                            const tags = getSettingsTags(account.id);
                            return (
                              <TableRow
                                key={account.id}
                                className="cursor-pointer hover:bg-muted/50"
                                onClick={() => openSettings(account)}
                              >
                                <TableCell className="font-mono text-sm">
                                  {account.account_number ?? "---"}
                                </TableCell>
                                <TableCell className="font-medium">
                                  {account.fully_qualified_name ?? account.name}
                                  {!account.is_active && (
                                    <Badge
                                      variant="secondary"
                                      className="ml-2 text-xs"
                                    >
                                      Inactive
                                    </Badge>
                                  )}
                                </TableCell>
                                <TableCell className="text-muted-foreground text-sm">
                                  {account.account_type}
                                  {account.account_sub_type && (
                                    <span className="text-xs block text-muted-foreground/60">
                                      {account.account_sub_type}
                                    </span>
                                  )}
                                </TableCell>
                                <TableCell>
                                  <div className="flex flex-wrap gap-1">
                                    {tags.map((tag) => (
                                      <Badge
                                        key={tag}
                                        variant="secondary"
                                        className="text-xs"
                                      >
                                        {tag}
                                      </Badge>
                                    ))}
                                  </div>
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {formatCurrency(account.current_balance)}
                                </TableCell>
                                <TableCell>
                                  <Settings2 className="h-4 w-4 text-muted-foreground" />
                                </TableCell>
                              </TableRow>
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

      {/* Account Settings Side Panel */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="overflow-y-auto">
          {selectedAccount && (
            <>
              <SheetHeader>
                <SheetTitle>
                  {selectedAccount.fully_qualified_name ?? selectedAccount.name}
                </SheetTitle>
                <SheetDescription>
                  <span className="flex items-center gap-2 mt-1">
                    <Badge
                      variant="outline"
                      className={
                        CLASSIFICATION_COLORS[selectedAccount.classification]
                      }
                    >
                      {selectedAccount.classification}
                    </Badge>
                    <span>{selectedAccount.account_type}</span>
                    {selectedAccount.account_number && (
                      <span className="font-mono">
                        #{selectedAccount.account_number}
                      </span>
                    )}
                  </span>
                </SheetDescription>
              </SheetHeader>

              <div className="mt-6 space-y-6">
                <div className="rounded-lg border p-4 bg-muted/30">
                  <div className="text-sm text-muted-foreground">
                    Current Balance
                  </div>
                  <div className="text-2xl font-semibold tabular-nums">
                    {formatCurrency(selectedAccount.current_balance)}
                  </div>
                </div>

                <Separator />

                <div className="space-y-4">
                  <h3 className="font-medium">Account Details</h3>

                  <div className="grid grid-cols-[140px_1fr] gap-3 items-start">
                    <Label htmlFor="account-number" className="pt-2">
                      Account Number
                    </Label>
                    <Input
                      id="account-number"
                      placeholder="e.g. 10100"
                      value={editAccountFields.accountNumber}
                      onChange={(e) =>
                        setEditAccountFields((f) => ({
                          ...f,
                          accountNumber: e.target.value,
                        }))
                      }
                    />

                    <Label htmlFor="account-name" className="pt-2">
                      Account Name
                    </Label>
                    <Input
                      id="account-name"
                      placeholder="Account name"
                      value={editAccountFields.name}
                      onChange={(e) =>
                        setEditAccountFields((f) => ({
                          ...f,
                          name: e.target.value,
                        }))
                      }
                    />
                  </div>

                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      onClick={handleSaveAccountFields}
                      disabled={savingAccountFields}
                    >
                      {savingAccountFields ? "Saving..." : "Save account details"}
                    </Button>
                  </div>
                </div>

                <Separator />

                <div className="space-y-4">
                  <h3 className="font-medium">Close Task Settings</h3>

                  <div className="space-y-2">
                    <Label>Task Category</Label>
                    <Select
                      value={editSettings.task_category}
                      onValueChange={(v) =>
                        setEditSettings({ ...editSettings, task_category: v })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TASK_CATEGORIES.map((c) => (
                          <SelectItem key={c.value} value={c.value}>
                            {c.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Determines what type of close task is created for this
                      account each period
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label>Schedule Type</Label>
                    <Select
                      value={editSettings.schedule_type}
                      onValueChange={(v) =>
                        setEditSettings({ ...editSettings, schedule_type: v })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SCHEDULE_TYPES.map((s) => (
                          <SelectItem key={s.value} value={s.value}>
                            {s.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Links this account to a supporting schedule for tie-out
                    </p>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="requiresRecon"
                      checked={editSettings.requires_reconciliation}
                      onCheckedChange={(checked) =>
                        setEditSettings({
                          ...editSettings,
                          requires_reconciliation: checked === true,
                        })
                      }
                    />
                    <Label htmlFor="requiresRecon">
                      Requires reconciliation each period
                    </Label>
                  </div>

                  <Separator />

                  <div className="space-y-2">
                    <Label>Notes</Label>
                    <Input
                      placeholder="Optional notes about this account..."
                      value={editSettings.notes}
                      onChange={(e) =>
                        setEditSettings({
                          ...editSettings,
                          notes: e.target.value,
                        })
                      }
                    />
                  </div>
                </div>

                <Button
                  className="w-full"
                  onClick={handleSaveSettings}
                  disabled={saving}
                >
                  <Save className="mr-2 h-4 w-4" />
                  {saving ? "Saving..." : "Save Settings"}
                </Button>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
