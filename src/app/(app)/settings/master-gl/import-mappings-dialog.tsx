"use client";

import { useState, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Upload,
  Download,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  XCircle,
  ArrowRight,
  ArrowLeft,
  Loader2,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────

interface Entity {
  id: string;
  name: string;
  code: string;
}

interface PreviewRow {
  rowNumber: number;
  entityAccountNumber: string | null;
  entityAccountName: string;
  masterGLInput: string;
  masterAccountId: string | null;
  masterAccountName: string | null;
  entityAccountId: string | null;
  status: "matched" | "unmatched" | "already_mapped" | "error";
  message: string;
}

interface Summary {
  total: number;
  matched: number;
  unmatched: number;
  alreadyMapped: number;
  errors: number;
}

interface ImportMappingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entities: Entity[];
  chartId: string | null;
  chartName: string | null;
  onComplete: () => void;
}

type Step = 1 | 2 | 3 | 4;

// ── Status helpers ─────────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  PreviewRow["status"],
  { label: string; variant: "default" | "secondary" | "destructive" | "outline"; className: string }
> = {
  matched: {
    label: "Matched",
    variant: "default",
    className: "bg-green-100 text-green-800 hover:bg-green-100",
  },
  already_mapped: {
    label: "Already Mapped",
    variant: "secondary",
    className: "bg-yellow-100 text-yellow-800 hover:bg-yellow-100",
  },
  unmatched: {
    label: "Unmatched",
    variant: "destructive",
    className: "bg-red-100 text-red-800 hover:bg-red-100",
  },
  error: {
    label: "Error",
    variant: "destructive",
    className: "bg-red-100 text-red-800 hover:bg-red-100",
  },
};

const STEP_LABELS = ["Select Entity", "Upload File", "Preview", "Results"];

// ── Component ──────────────────────────────────────────────────────────

export function ImportMappingsDialog({
  open,
  onOpenChange,
  entities,
  chartId,
  chartName,
  onComplete,
}: ImportMappingsDialogProps) {
  const [step, setStep] = useState<Step>(1);
  const [entityId, setEntityId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [created, setCreated] = useState(0);
  const [statusFilter, setStatusFilter] = useState<
    PreviewRow["status"] | "all"
  >("all");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setStep(1);
      setEntityId("");
      setFile(null);
      setUploading(false);
      setCommitting(false);
      setPreview([]);
      setSummary(null);
      setCreated(0);
      setStatusFilter("all");
    }
  }, [open]);

  // ── Handlers ─────────────────────────────────────────────────────────

  async function handleDownloadTemplate() {
    if (!entityId) return;

    try {
      const response = await fetch(
        `/api/master-accounts/mappings/template?entityId=${entityId}`
      );
      if (!response.ok) {
        const data = await response.json();
        toast.error(data.error || "Failed to download template");
        return;
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "mapping-template.xlsx";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Failed to download template");
    }
  }

  async function handleUploadAndPreview() {
    if (!file || !entityId) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("entityId", entityId);
      formData.append("mode", "preview");
      if (chartId) formData.append("chartId", chartId);

      const response = await fetch("/api/master-accounts/mappings/import", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();
      if (!response.ok) {
        toast.error(data.error || "Failed to parse file");
        setUploading(false);
        return;
      }

      setPreview(data.preview);
      setSummary(data.summary);
      setStatusFilter("all");
      setStep(3);
    } catch {
      toast.error("An error occurred while uploading");
    }
    setUploading(false);
  }

  async function handleCommit() {
    if (!file || !entityId) return;

    setCommitting(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("entityId", entityId);
      formData.append("mode", "commit");
      if (chartId) formData.append("chartId", chartId);

      const response = await fetch("/api/master-accounts/mappings/import", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();
      if (!response.ok) {
        toast.error(data.error || "Failed to import mappings");
        setCommitting(false);
        return;
      }

      setCreated(data.created ?? 0);
      setPreview(data.preview);
      setSummary(data.summary);
      setStep(4);
    } catch {
      toast.error("An error occurred during import");
    }
    setCommitting(false);
  }

  function handleDone() {
    onComplete();
    onOpenChange(false);
  }

  // ── Filtered preview rows ────────────────────────────────────────────
  const filteredPreview =
    statusFilter === "all"
      ? preview
      : preview.filter((r) => r.status === statusFilter);

  const entityName =
    entities.find((e) => e.id === entityId)?.name ?? "Selected Entity";

  // ── Render ───────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={
          step === 3
            ? "max-h-[85vh] flex flex-col"
            : ""
        }
        style={step === 3 ? { maxWidth: "64rem" } : undefined}
      >
        {/* Step indicator */}
        <div className="flex items-center gap-1 mb-2">
          {STEP_LABELS.map((label, i) => {
            const stepNum = (i + 1) as Step;
            const isActive = step === stepNum;
            const isCompleted = step > stepNum;
            return (
              <div key={label} className="flex items-center gap-1">
                {i > 0 && (
                  <div
                    className={`h-px w-6 ${
                      isCompleted ? "bg-primary" : "bg-muted"
                    }`}
                  />
                )}
                <div
                  className={`flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full ${
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : isCompleted
                      ? "bg-primary/10 text-primary"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  <span>{stepNum}</span>
                  <span className="hidden sm:inline">{label}</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Step 1: Select Entity ─────────────────────────────────── */}
        {step === 1 && (
          <>
            <DialogHeader>
              <DialogTitle>Import Mappings — Select Entity</DialogTitle>
              <DialogDescription>
                Choose which entity&apos;s accounts you want to map to the
                master GL via an Excel import.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Entity</Label>
                <Select value={entityId} onValueChange={setEntityId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select entity..." />
                  </SelectTrigger>
                  <SelectContent>
                    {entities.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.name} ({e.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button disabled={!entityId} onClick={() => setStep(2)}>
                Next
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </DialogFooter>
          </>
        )}

        {/* ── Step 2: Upload File ───────────────────────────────────── */}
        {step === 2 && (
          <>
            <DialogHeader>
              <DialogTitle>Import Mappings — Upload File</DialogTitle>
              <DialogDescription>
                Download a template pre-filled with {entityName}&apos;s accounts,
                fill in the &quot;Master GL Account&quot; column with the account
                number or name, then upload it here.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-5 py-4">
              {/* Download template */}
              <div className="rounded-lg border border-dashed p-4 space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
                  Step 1: Download the mapping template
                </div>
                <p className="text-xs text-muted-foreground">
                  The template has two sheets — &quot;Mappings&quot; with your
                  entity accounts pre-filled, and &quot;Master GL Accounts&quot;
                  as a reference list.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDownloadTemplate}
                >
                  <Download className="mr-2 h-4 w-4" />
                  Download Template
                </Button>
              </div>

              <Separator />

              {/* Upload file */}
              <div className="rounded-lg border border-dashed p-4 space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Upload className="h-4 w-4 text-muted-foreground" />
                  Step 2: Upload the completed file
                </div>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="hidden"
                />

                <div className="flex items-center gap-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Choose File
                  </Button>
                  {file ? (
                    <span className="text-sm text-muted-foreground truncate max-w-[200px]">
                      {file.name}
                    </span>
                  ) : (
                    <span className="text-sm text-muted-foreground">
                      No file selected
                    </span>
                  )}
                </div>
              </div>
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => setStep(1)}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back
              </Button>
              <Button
                disabled={!file || uploading}
                onClick={handleUploadAndPreview}
              >
                {uploading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Parsing...
                  </>
                ) : (
                  <>
                    Upload &amp; Preview
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>
            </DialogFooter>
          </>
        )}

        {/* ── Step 3: Preview ───────────────────────────────────────── */}
        {step === 3 && summary && (
          <>
            <DialogHeader>
              <DialogTitle>Import Mappings — Preview</DialogTitle>
              <DialogDescription>
                Review the resolved mappings below. Only &quot;Matched&quot; rows
                will be imported.
              </DialogDescription>
            </DialogHeader>

            {/* Summary badges (clickable filters) */}
            <div className="flex flex-wrap gap-2">
              <Badge
                variant={statusFilter === "all" ? "default" : "outline"}
                className="cursor-pointer"
                onClick={() => setStatusFilter("all")}
              >
                All ({summary.total})
              </Badge>
              <Badge
                variant={statusFilter === "matched" ? "default" : "outline"}
                className={`cursor-pointer ${
                  statusFilter === "matched"
                    ? "bg-green-600 hover:bg-green-700"
                    : ""
                }`}
                onClick={() => setStatusFilter("matched")}
              >
                <CheckCircle2 className="mr-1 h-3 w-3" />
                Matched ({summary.matched})
              </Badge>
              <Badge
                variant={
                  statusFilter === "already_mapped" ? "default" : "outline"
                }
                className={`cursor-pointer ${
                  statusFilter === "already_mapped"
                    ? "bg-yellow-600 hover:bg-yellow-700"
                    : ""
                }`}
                onClick={() => setStatusFilter("already_mapped")}
              >
                Already Mapped ({summary.alreadyMapped})
              </Badge>
              <Badge
                variant={statusFilter === "unmatched" ? "default" : "outline"}
                className={`cursor-pointer ${
                  statusFilter === "unmatched"
                    ? "bg-red-600 hover:bg-red-700"
                    : ""
                }`}
                onClick={() => setStatusFilter("unmatched")}
              >
                <AlertCircle className="mr-1 h-3 w-3" />
                Unmatched ({summary.unmatched})
              </Badge>
              {summary.errors > 0 && (
                <Badge
                  variant={statusFilter === "error" ? "default" : "outline"}
                  className={`cursor-pointer ${
                    statusFilter === "error"
                      ? "bg-red-600 hover:bg-red-700"
                      : ""
                  }`}
                  onClick={() => setStatusFilter("error")}
                >
                  <XCircle className="mr-1 h-3 w-3" />
                  Errors ({summary.errors})
                </Badge>
              )}
            </div>

            {/* Preview table */}
            <div className="flex-1 overflow-auto border rounded-md min-h-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    <TableHead className="w-28">Acct #</TableHead>
                    <TableHead>Entity Account</TableHead>
                    <TableHead>Master GL (Input)</TableHead>
                    <TableHead>Resolved To</TableHead>
                    <TableHead className="w-32">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredPreview.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="text-center text-muted-foreground py-8"
                      >
                        No rows to display.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredPreview.map((row, idx) => {
                      const cfg = STATUS_CONFIG[row.status];
                      return (
                        <TableRow key={idx}>
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {row.rowNumber}
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            {row.entityAccountNumber ?? "—"}
                          </TableCell>
                          <TableCell className="text-sm">
                            {row.entityAccountName}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {row.masterGLInput}
                          </TableCell>
                          <TableCell className="text-sm">
                            {row.masterAccountName ?? (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={cfg.variant}
                              className={`text-xs ${cfg.className}`}
                            >
                              {cfg.label}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => setStep(2)}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back
              </Button>
              <Button
                disabled={committing || summary.matched === 0}
                onClick={handleCommit}
              >
                {committing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Importing...
                  </>
                ) : (
                  <>
                    Import {summary.matched} Mapping
                    {summary.matched !== 1 ? "s" : ""}
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>
            </DialogFooter>
          </>
        )}

        {/* ── Step 4: Results ───────────────────────────────────────── */}
        {step === 4 && (
          <>
            <DialogHeader>
              <DialogTitle>Import Complete</DialogTitle>
              <DialogDescription>
                Your account mappings have been imported.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="rounded-lg border p-4 space-y-3">
                <div className="flex items-center gap-2 text-green-700">
                  <CheckCircle2 className="h-5 w-5" />
                  <span className="font-medium">
                    {created} mapping{created !== 1 ? "s" : ""} created
                    successfully
                  </span>
                </div>

                {summary && summary.alreadyMapped > 0 && (
                  <p className="text-sm text-muted-foreground">
                    {summary.alreadyMapped} account
                    {summary.alreadyMapped !== 1 ? "s were" : " was"} already
                    mapped and skipped.
                  </p>
                )}

                {summary && summary.unmatched > 0 && (
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">
                      {summary.unmatched} account
                      {summary.unmatched !== 1 ? "s" : ""} could not be matched
                      and will need manual mapping:
                    </p>
                    <ul className="text-xs text-muted-foreground ml-4 list-disc space-y-0.5">
                      {preview
                        .filter((r) => r.status === "unmatched")
                        .slice(0, 10)
                        .map((r, i) => (
                          <li key={i}>
                            {r.entityAccountNumber
                              ? `#${r.entityAccountNumber} `
                              : ""}
                            {r.entityAccountName}
                          </li>
                        ))}
                      {preview.filter((r) => r.status === "unmatched").length >
                        10 && (
                        <li>
                          ...and{" "}
                          {preview.filter((r) => r.status === "unmatched")
                            .length - 10}{" "}
                          more
                        </li>
                      )}
                    </ul>
                  </div>
                )}

                {summary && summary.errors > 0 && (
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">
                      {summary.errors} row{summary.errors !== 1 ? "s" : ""} had
                      errors (entity account not found in database):
                    </p>
                    <ul className="text-xs text-muted-foreground ml-4 list-disc space-y-0.5">
                      {preview
                        .filter((r) => r.status === "error")
                        .slice(0, 10)
                        .map((r, i) => (
                          <li key={i}>
                            Row {r.rowNumber}: {r.message}
                          </li>
                        ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>

            <DialogFooter>
              <Button onClick={handleDone}>Done</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
