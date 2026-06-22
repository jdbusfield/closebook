"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { AccountCombobox } from "@/components/ui/account-combobox";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { generateLeasePaymentSchedule } from "@/lib/utils/lease-payments";
import type {
  PropertyType,
  LeaseType,
  MaintenanceType,
  PropertyTaxFrequency,
} from "@/lib/types/database";

interface Account {
  id: string;
  name: string;
  account_number: string | null;
  classification: string;
}

interface ExistingProperty {
  id: string;
  property_name: string;
}

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC",
];

export default function NewLeasePage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const router = useRouter();
  const supabase = createClient();

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [existingProperties, setExistingProperties] = useState<ExistingProperty[]>([]);
  const [creating, setCreating] = useState(false);

  // Property & Parties
  const [selectedPropertyId, setSelectedPropertyId] = useState("");
  const [propertyName, setPropertyName] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zipCode, setZipCode] = useState("");
  const [propertyType, setPropertyType] = useState<PropertyType>("office");
  const [totalSF, setTotalSF] = useState("");
  const [rentableSF, setRentableSF] = useState("");
  const [usableSF, setUsableSF] = useState("");
  const [lessorName, setLessorName] = useState("");
  const [lessorContact, setLessorContact] = useState("");

  // Lease Terms
  const [leaseName, setLeaseName] = useState("");
  const [leaseType, setLeaseType] = useState<LeaseType>("operating");
  const [leaseStatus, setLeaseStatus] = useState("active");
  const [commencementDate, setCommencementDate] = useState("");
  const [rentCommencementDate, setRentCommencementDate] = useState("");
  const [expirationDate, setExpirationDate] = useState("");
  const [leaseTermMonths, setLeaseTermMonths] = useState("");
  const [maintenanceType, setMaintenanceType] = useState<MaintenanceType>("gross");
  const [permittedUse, setPermittedUse] = useState("");

  // Financial Terms
  const [baseRentMonthly, setBaseRentMonthly] = useState("");
  const [rentPerSF, setRentPerSF] = useState("");
  const [securityDeposit, setSecurityDeposit] = useState("");
  const [tiAllowance, setTiAllowance] = useState("");
  const [rentAbatementMonths, setRentAbatementMonths] = useState("");
  const [rentAbatementAmount, setRentAbatementAmount] = useState("");
  const [discountRate, setDiscountRate] = useState("");
  const [initialDirectCosts, setInitialDirectCosts] = useState("");
  const [leaseIncentives, setLeaseIncentives] = useState("");
  const [prepaidRent, setPrepaidRent] = useState("");
  const [fairValue, setFairValue] = useState("");
  const [remainingEconomicLife, setRemainingEconomicLife] = useState("");

  // Operating Costs
  const [camMonthly, setCamMonthly] = useState("");
  const [insuranceMonthly, setInsuranceMonthly] = useState("");
  const [propertyTaxAnnual, setPropertyTaxAnnual] = useState("");
  const [propertyTaxFrequency, setPropertyTaxFrequency] =
    useState<PropertyTaxFrequency>("monthly");
  const [utilitiesMonthly, setUtilitiesMonthly] = useState("");
  const [otherMonthlyCosts, setOtherMonthlyCosts] = useState("");
  const [otherCostsDescription, setOtherCostsDescription] = useState("");

  // GL Accounts
  const [rouAssetAccountId, setRouAssetAccountId] = useState("");
  const [leaseLiabilityAccountId, setLeaseLiabilityAccountId] = useState("");
  const [leaseExpenseAccountId, setLeaseExpenseAccountId] = useState("");
  const [interestExpenseAccountId, setInterestExpenseAccountId] = useState("");
  const [camExpenseAccountId, setCamExpenseAccountId] = useState("");
  const [asc842AdjustmentAccountId, setAsc842AdjustmentAccountId] = useState("");
  const [cashApAccountId, setCashApAccountId] = useState("");

  // Notes
  const [notes, setNotes] = useState("");

  const loadData = useCallback(async () => {
    const [acctResult, propResult] = await Promise.all([
      supabase
        .from("accounts")
        .select("id, name, account_number, classification")
        .eq("entity_id", entityId)
        .eq("is_active", true)
        .order("account_number")
        .order("name"),
      supabase
        .from("properties")
        .select("id, property_name")
        .eq("entity_id", entityId)
        .order("property_name"),
    ]);

    setAccounts((acctResult.data as Account[]) ?? []);
    setExistingProperties(
      (propResult.data as unknown as ExistingProperty[]) ?? []
    );
  }, [supabase, entityId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Auto-calculate lease term from dates
  useEffect(() => {
    if (commencementDate && expirationDate) {
      const start = new Date(commencementDate + "T00:00:00");
      const end = new Date(expirationDate + "T00:00:00");
      const months =
        (end.getFullYear() - start.getFullYear()) * 12 +
        (end.getMonth() - start.getMonth());
      if (months > 0) setLeaseTermMonths(String(months));
    }
  }, [commencementDate, expirationDate]);

  // Auto-calculate rent per SF
  useEffect(() => {
    const rent = parseFloat(baseRentMonthly);
    const sf = parseFloat(rentableSF);
    if (rent > 0 && sf > 0) {
      setRentPerSF(((rent * 12) / sf).toFixed(2));
    }
  }, [baseRentMonthly, rentableSF]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const pName = selectedPropertyId
      ? existingProperties.find((p) => p.id === selectedPropertyId)
          ?.property_name
      : propertyName;

    if (!pName || !leaseName || !commencementDate || !expirationDate || !baseRentMonthly) {
      toast.error(
        "Property name, lease name, dates, and base rent are required."
      );
      return;
    }

    setCreating(true);

    // 1. Create or reuse property
    let propertyId: string;

    if (selectedPropertyId) {
      propertyId = selectedPropertyId;
    } else {
      const { data: newProperty, error: propError } = await supabase
        .from("properties")
        .insert({
          entity_id: entityId,
          property_name: propertyName,
          address_line1: addressLine1 || null,
          address_line2: addressLine2 || null,
          city: city || null,
          state: state || null,
          zip_code: zipCode || null,
          property_type: propertyType,
          total_square_footage: totalSF ? parseFloat(totalSF) : null,
          rentable_square_footage: rentableSF ? parseFloat(rentableSF) : null,
          usable_square_footage: usableSF ? parseFloat(usableSF) : null,
        })
        .select()
        .single();

      if (propError) {
        toast.error(propError.message);
        setCreating(false);
        return;
      }
      propertyId = newProperty.id;
    }

    // 2. Create lease
    const { data: lease, error: leaseError } = await supabase
      .from("leases")
      .insert({
        entity_id: entityId,
        property_id: propertyId,
        lease_name: leaseName,
        lessor_name: lessorName || null,
        lessor_contact_info: lessorContact || null,
        lease_type: leaseType,
        status: leaseStatus,
        commencement_date: commencementDate,
        rent_commencement_date: rentCommencementDate || null,
        expiration_date: expirationDate,
        lease_term_months: parseInt(leaseTermMonths) || 0,
        base_rent_monthly: parseFloat(baseRentMonthly) || 0,
        rent_per_sf: rentPerSF ? parseFloat(rentPerSF) : null,
        security_deposit: parseFloat(securityDeposit) || 0,
        tenant_improvement_allowance: parseFloat(tiAllowance) || 0,
        rent_abatement_months: parseFloat(rentAbatementMonths) || 0,
        rent_abatement_amount: parseFloat(rentAbatementAmount) || 0,
        discount_rate: discountRate ? parseFloat(discountRate) : 0,
        initial_direct_costs: parseFloat(initialDirectCosts) || 0,
        lease_incentives_received: parseFloat(leaseIncentives) || 0,
        prepaid_rent: parseFloat(prepaidRent) || 0,
        fair_value_of_asset: fairValue ? parseFloat(fairValue) : null,
        remaining_economic_life_months: remainingEconomicLife
          ? parseInt(remainingEconomicLife)
          : null,
        cam_monthly: parseFloat(camMonthly) || 0,
        insurance_monthly: parseFloat(insuranceMonthly) || 0,
        property_tax_annual: parseFloat(propertyTaxAnnual) || 0,
        property_tax_frequency: propertyTaxFrequency,
        utilities_monthly: parseFloat(utilitiesMonthly) || 0,
        other_monthly_costs: parseFloat(otherMonthlyCosts) || 0,
        other_monthly_costs_description: otherCostsDescription || null,
        maintenance_type: maintenanceType,
        permitted_use: permittedUse || null,
        notes: notes || null,
        rou_asset_account_id: rouAssetAccountId || null,
        lease_liability_account_id: leaseLiabilityAccountId || null,
        lease_expense_account_id: leaseExpenseAccountId || null,
        interest_expense_account_id: interestExpenseAccountId || null,
        cam_expense_account_id: camExpenseAccountId || null,
        asc842_adjustment_account_id: asc842AdjustmentAccountId || null,
        cash_ap_account_id: cashApAccountId || null,
      })
      .select()
      .single();

    if (leaseError) {
      toast.error(leaseError.message);
      setCreating(false);
      return;
    }

    // 3. Generate payment schedule
    const schedule = generateLeasePaymentSchedule(
      {
        commencement_date: commencementDate,
        rent_commencement_date: rentCommencementDate || null,
        expiration_date: expirationDate,
        base_rent_monthly: parseFloat(baseRentMonthly) || 0,
        cam_monthly: parseFloat(camMonthly) || 0,
        insurance_monthly: parseFloat(insuranceMonthly) || 0,
        property_tax_annual: parseFloat(propertyTaxAnnual) || 0,
        property_tax_frequency: propertyTaxFrequency,
        utilities_monthly: parseFloat(utilitiesMonthly) || 0,
        other_monthly_costs: parseFloat(otherMonthlyCosts) || 0,
        rent_abatement_months: parseFloat(rentAbatementMonths) || 0,
        rent_abatement_amount: parseFloat(rentAbatementAmount) || 0,
      },
      [] // no escalations on initial creation
    );

    if (schedule.length > 0) {
      const paymentRows = schedule.map((entry) => ({
        lease_id: lease.id,
        period_year: entry.period_year,
        period_month: entry.period_month,
        payment_type: entry.payment_type,
        scheduled_amount: entry.scheduled_amount,
      }));

      // Insert in batches of 500 to avoid request size limits
      for (let i = 0; i < paymentRows.length; i += 500) {
        const batch = paymentRows.slice(i, i + 500);
        const { error: payError } = await supabase
          .from("lease_payments")
          .insert(batch);
        if (payError) {
          toast.error(`Payment schedule error: ${payError.message}`);
        }
      }
    }

    toast.success("Lease created successfully");
    router.push(`/${entityId}/real-estate/${lease.id}`);
  }

  const assetAccounts = accounts.filter((a) => a.classification === "Asset");
  const liabilityAccounts = accounts.filter(
    (a) => a.classification === "Liability"
  );
  const expenseAccounts = accounts.filter(
    (a) => a.classification === "Expense"
  );
  const cashApAccounts = accounts.filter(
    (a) => a.classification === "Asset" || a.classification === "Liability"
  );

  function renderAccountSelect(
    label: string,
    id: string,
    value: string,
    onChange: (v: string) => void,
    accountList: Account[]
  ) {
    return (
      <div className="space-y-2">
        <Label htmlFor={id}>{label}</Label>
        <AccountCombobox
          accounts={accountList.map((a) => ({
            id: a.id,
            account_number: a.account_number,
            name: a.name,
          }))}
          value={value}
          onValueChange={onChange}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push(`/${entityId}/real-estate`)}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
      </div>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New Lease</h1>
        <p className="text-muted-foreground">
          Add a new real estate lease with property details and financial terms
        </p>
      </div>

      <form onSubmit={handleCreate}>
        <Tabs defaultValue="property" className="space-y-6">
          <TabsList>
            <TabsTrigger value="property">Property & Parties</TabsTrigger>
            <TabsTrigger value="terms">Lease Terms</TabsTrigger>
            <TabsTrigger value="financial">Financial Terms</TabsTrigger>
            <TabsTrigger value="operating">Operating Costs</TabsTrigger>
            <TabsTrigger value="gl">GL Accounts</TabsTrigger>
          </TabsList>

          {/* Property & Parties Tab */}
          <TabsContent value="property">
            <Card>
              <CardHeader>
                <CardTitle>Property & Parties</CardTitle>
                <CardDescription>
                  Select an existing property or enter details for a new one
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {existingProperties.length > 0 && (
                  <div className="space-y-2">
                    <Label htmlFor="existingProperty">
                      Existing Property (optional)
                    </Label>
                    <Select
                      value={selectedPropertyId}
                      onValueChange={(v) => {
                        setSelectedPropertyId(v === "new" ? "" : v);
                      }}
                    >
                      <SelectTrigger id="existingProperty">
                        <SelectValue placeholder="Create new property..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="new">
                          + Create new property
                        </SelectItem>
                        {existingProperties.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.property_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {!selectedPropertyId && (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="propertyName">Property Name *</Label>
                        <Input
                          id="propertyName"
                          placeholder="e.g., Main Office Building"
                          value={propertyName}
                          onChange={(e) => setPropertyName(e.target.value)}
                          required={!selectedPropertyId}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="propertyType">Property Type</Label>
                        <Select
                          value={propertyType}
                          onValueChange={(v) =>
                            setPropertyType(v as PropertyType)
                          }
                        >
                          <SelectTrigger id="propertyType">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="office">Office</SelectItem>
                            <SelectItem value="retail">Retail</SelectItem>
                            <SelectItem value="warehouse">Warehouse</SelectItem>
                            <SelectItem value="industrial">Industrial</SelectItem>
                            <SelectItem value="mixed_use">Mixed Use</SelectItem>
                            <SelectItem value="land">Land</SelectItem>
                            <SelectItem value="other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="address1">Address Line 1</Label>
                      <Input
                        id="address1"
                        placeholder="Street address"
                        value={addressLine1}
                        onChange={(e) => setAddressLine1(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="address2">Address Line 2</Label>
                      <Input
                        id="address2"
                        placeholder="Suite, floor, etc."
                        value={addressLine2}
                        onChange={(e) => setAddressLine2(e.target.value)}
                      />
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="city">City</Label>
                        <Input
                          id="city"
                          value={city}
                          onChange={(e) => setCity(e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="state">State</Label>
                        <Select value={state} onValueChange={setState}>
                          <SelectTrigger id="state">
                            <SelectValue placeholder="Select..." />
                          </SelectTrigger>
                          <SelectContent>
                            {US_STATES.map((st) => (
                              <SelectItem key={st} value={st}>
                                {st}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="zipCode">Zip Code</Label>
                        <Input
                          id="zipCode"
                          value={zipCode}
                          onChange={(e) => setZipCode(e.target.value)}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="totalSF">Total SF</Label>
                        <Input
                          id="totalSF"
                          type="number"
                          step="0.01"
                          value={totalSF}
                          onChange={(e) => setTotalSF(e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="rentableSF">Rentable SF</Label>
                        <Input
                          id="rentableSF"
                          type="number"
                          step="0.01"
                          value={rentableSF}
                          onChange={(e) => setRentableSF(e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="usableSF">Usable SF</Label>
                        <Input
                          id="usableSF"
                          type="number"
                          step="0.01"
                          value={usableSF}
                          onChange={(e) => setUsableSF(e.target.value)}
                        />
                      </div>
                    </div>
                  </>
                )}

                <div className="border-t pt-4 mt-4">
                  <h3 className="text-sm font-medium mb-3">Lessor Information</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="lessorName">Lessor Name</Label>
                      <Input
                        id="lessorName"
                        placeholder="Landlord / management company"
                        value={lessorName}
                        onChange={(e) => setLessorName(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="lessorContact">Contact Info</Label>
                      <Input
                        id="lessorContact"
                        placeholder="Phone, email, etc."
                        value={lessorContact}
                        onChange={(e) => setLessorContact(e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Lease Terms Tab */}
          <TabsContent value="terms">
            <Card>
              <CardHeader>
                <CardTitle>Lease Terms</CardTitle>
                <CardDescription>
                  Define the key dates and terms of the lease agreement
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="leaseName">Lease Name *</Label>
                    <Input
                      id="leaseName"
                      placeholder="e.g., Main Office - 5th Floor"
                      value={leaseName}
                      onChange={(e) => setLeaseName(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="leaseType">Lease Type</Label>
                    <Select
                      value={leaseType}
                      onValueChange={(v) => setLeaseType(v as LeaseType)}
                    >
                      <SelectTrigger id="leaseType">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="operating">Operating</SelectItem>
                        <SelectItem value="finance">Finance</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="leaseStatus">Status</Label>
                    <Select value={leaseStatus} onValueChange={setLeaseStatus}>
                      <SelectTrigger id="leaseStatus">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="draft">Draft</SelectItem>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="active_non_operational">Active (Non-Operational)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="maintenanceType">Maintenance Type</Label>
                    <Select
                      value={maintenanceType}
                      onValueChange={(v) =>
                        setMaintenanceType(v as MaintenanceType)
                      }
                    >
                      <SelectTrigger id="maintenanceType">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="gross">Gross</SelectItem>
                        <SelectItem value="modified_gross">
                          Modified Gross
                        </SelectItem>
                        <SelectItem value="triple_net">Triple Net (NNN)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="commencementDate">
                      Commencement Date *
                    </Label>
                    <Input
                      id="commencementDate"
                      type="date"
                      value={commencementDate}
                      onChange={(e) => setCommencementDate(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="rentCommencementDate">
                      Rent Commencement
                    </Label>
                    <Input
                      id="rentCommencementDate"
                      type="date"
                      value={rentCommencementDate}
                      onChange={(e) => setRentCommencementDate(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="expirationDate">Expiration Date *</Label>
                    <Input
                      id="expirationDate"
                      type="date"
                      value={expirationDate}
                      onChange={(e) => setExpirationDate(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="leaseTermMonths">
                      Lease Term (months)
                    </Label>
                    <Input
                      id="leaseTermMonths"
                      type="number"
                      value={leaseTermMonths}
                      onChange={(e) => setLeaseTermMonths(e.target.value)}
                      className="bg-muted"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="permittedUse">Permitted Use</Label>
                    <Input
                      id="permittedUse"
                      placeholder="e.g., General office use"
                      value={permittedUse}
                      onChange={(e) => setPermittedUse(e.target.value)}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Financial Terms Tab */}
          <TabsContent value="financial">
            <Card>
              <CardHeader>
                <CardTitle>Financial Terms</CardTitle>
                <CardDescription>
                  Rent, incentives, and ASC 842 inputs for lease accounting
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="baseRentMonthly">
                      Base Rent (Monthly) *
                    </Label>
                    <Input
                      id="baseRentMonthly"
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={baseRentMonthly}
                      onChange={(e) => setBaseRentMonthly(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="rentPerSF">Rent per SF (Annual)</Label>
                    <Input
                      id="rentPerSF"
                      type="number"
                      step="0.01"
                      value={rentPerSF}
                      className="bg-muted"
                      readOnly
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="securityDeposit">Security Deposit</Label>
                    <Input
                      id="securityDeposit"
                      type="number"
                      step="0.01"
                      value={securityDeposit}
                      onChange={(e) => setSecurityDeposit(e.target.value)}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="tiAllowance">TI Allowance</Label>
                    <Input
                      id="tiAllowance"
                      type="number"
                      step="0.01"
                      value={tiAllowance}
                      onChange={(e) => setTiAllowance(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="rentAbatementMonths">
                      Abatement Months
                    </Label>
                    <Input
                      id="rentAbatementMonths"
                      type="number"
                      value={rentAbatementMonths}
                      onChange={(e) => setRentAbatementMonths(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="rentAbatementAmount">
                      Abatement Amount (Monthly)
                    </Label>
                    <Input
                      id="rentAbatementAmount"
                      type="number"
                      step="0.01"
                      placeholder="0 for free rent"
                      value={rentAbatementAmount}
                      onChange={(e) => setRentAbatementAmount(e.target.value)}
                    />
                  </div>
                </div>

                <div className="border-t pt-4 mt-4">
                  <h3 className="text-sm font-medium mb-3">
                    ASC 842 Inputs
                  </h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="discountRate">
                        Discount Rate (IBR)
                      </Label>
                      <Input
                        id="discountRate"
                        type="number"
                        step="0.000001"
                        placeholder="e.g., 0.065 for 6.5%"
                        value={discountRate}
                        onChange={(e) => setDiscountRate(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="initialDirectCosts">
                        Initial Direct Costs
                      </Label>
                      <Input
                        id="initialDirectCosts"
                        type="number"
                        step="0.01"
                        value={initialDirectCosts}
                        onChange={(e) => setInitialDirectCosts(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4 mt-4">
                    <div className="space-y-2">
                      <Label htmlFor="leaseIncentives">
                        Lease Incentives Received
                      </Label>
                      <Input
                        id="leaseIncentives"
                        type="number"
                        step="0.01"
                        value={leaseIncentives}
                        onChange={(e) => setLeaseIncentives(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="prepaidRent">Prepaid Rent</Label>
                      <Input
                        id="prepaidRent"
                        type="number"
                        step="0.01"
                        value={prepaidRent}
                        onChange={(e) => setPrepaidRent(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4 mt-4">
                    <div className="space-y-2">
                      <Label htmlFor="fairValue">
                        Fair Value of Asset
                      </Label>
                      <Input
                        id="fairValue"
                        type="number"
                        step="0.01"
                        placeholder="For finance lease classification"
                        value={fairValue}
                        onChange={(e) => setFairValue(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="remainingEconomicLife">
                        Remaining Economic Life (months)
                      </Label>
                      <Input
                        id="remainingEconomicLife"
                        type="number"
                        placeholder="For finance lease classification"
                        value={remainingEconomicLife}
                        onChange={(e) =>
                          setRemainingEconomicLife(e.target.value)
                        }
                      />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Operating Costs Tab */}
          <TabsContent value="operating">
            <Card>
              <CardHeader>
                <CardTitle>Operating Costs</CardTitle>
                <CardDescription>
                  CAM, insurance, property taxes, and other recurring costs
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="camMonthly">CAM (Monthly)</Label>
                    <Input
                      id="camMonthly"
                      type="number"
                      step="0.01"
                      value={camMonthly}
                      onChange={(e) => setCamMonthly(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="insuranceMonthly">
                      Insurance (Monthly)
                    </Label>
                    <Input
                      id="insuranceMonthly"
                      type="number"
                      step="0.01"
                      value={insuranceMonthly}
                      onChange={(e) => setInsuranceMonthly(e.target.value)}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="propertyTaxAnnual">
                      Property Tax (Annual)
                    </Label>
                    <Input
                      id="propertyTaxAnnual"
                      type="number"
                      step="0.01"
                      value={propertyTaxAnnual}
                      onChange={(e) => setPropertyTaxAnnual(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="propertyTaxFrequency">
                      Tax Payment Frequency
                    </Label>
                    <Select
                      value={propertyTaxFrequency}
                      onValueChange={(v) =>
                        setPropertyTaxFrequency(v as PropertyTaxFrequency)
                      }
                    >
                      <SelectTrigger id="propertyTaxFrequency">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="monthly">
                          Monthly (1/12 each)
                        </SelectItem>
                        <SelectItem value="semi_annual">
                          Semi-Annual (Jun & Dec)
                        </SelectItem>
                        <SelectItem value="annual">Annual (Dec)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="utilitiesMonthly">
                      Utilities (Monthly)
                    </Label>
                    <Input
                      id="utilitiesMonthly"
                      type="number"
                      step="0.01"
                      value={utilitiesMonthly}
                      onChange={(e) => setUtilitiesMonthly(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="otherMonthlyCosts">
                      Other Costs (Monthly)
                    </Label>
                    <Input
                      id="otherMonthlyCosts"
                      type="number"
                      step="0.01"
                      value={otherMonthlyCosts}
                      onChange={(e) => setOtherMonthlyCosts(e.target.value)}
                    />
                  </div>
                </div>

                {otherMonthlyCosts && parseFloat(otherMonthlyCosts) > 0 && (
                  <div className="space-y-2">
                    <Label htmlFor="otherCostsDescription">
                      Other Costs Description
                    </Label>
                    <Input
                      id="otherCostsDescription"
                      placeholder="Describe the other recurring costs"
                      value={otherCostsDescription}
                      onChange={(e) =>
                        setOtherCostsDescription(e.target.value)
                      }
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* GL Accounts Tab */}
          <TabsContent value="gl">
            <Card>
              <CardHeader>
                <CardTitle>GL Accounts</CardTitle>
                <CardDescription>
                  Link this lease to your chart of accounts for ASC 842 journal
                  entries
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {renderAccountSelect(
                  "ROU Asset Account",
                  "rouAssetAccount",
                  rouAssetAccountId,
                  setRouAssetAccountId,
                  assetAccounts
                )}
                {renderAccountSelect(
                  "Lease Liability Account",
                  "leaseLiabilityAccount",
                  leaseLiabilityAccountId,
                  setLeaseLiabilityAccountId,
                  liabilityAccounts
                )}
                {renderAccountSelect(
                  "Lease Expense Account",
                  "leaseExpenseAccount",
                  leaseExpenseAccountId,
                  setLeaseExpenseAccountId,
                  expenseAccounts
                )}
                {renderAccountSelect(
                  "Interest Expense Account",
                  "interestExpenseAccount",
                  interestExpenseAccountId,
                  setInterestExpenseAccountId,
                  expenseAccounts
                )}
                {renderAccountSelect(
                  "CAM / OpEx Expense Account",
                  "camExpenseAccount",
                  camExpenseAccountId,
                  setCamExpenseAccountId,
                  expenseAccounts
                )}
                {renderAccountSelect(
                  "ASC 842 Adjustment Account",
                  "asc842AdjustmentAccount",
                  asc842AdjustmentAccountId,
                  setAsc842AdjustmentAccountId,
                  expenseAccounts
                )}
                {renderAccountSelect(
                  "Cash / AP Account",
                  "cashApAccount",
                  cashApAccountId,
                  setCashApAccountId,
                  cashApAccounts
                )}

                <div className="space-y-2 pt-4">
                  <Label htmlFor="notes">Notes</Label>
                  <Textarea
                    id="notes"
                    placeholder="Additional notes about this lease..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={3}
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <div className="flex justify-end pt-6">
          <Button type="submit" disabled={creating} size="lg">
            {creating ? "Creating..." : "Create Lease"}
          </Button>
        </div>
      </form>
    </div>
  );
}
