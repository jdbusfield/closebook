"use client";

/**
 * Activity by methodology — a dense tile strip that maps 1:1 to the
 * Add Transaction dropdown so the dashboard vocabulary matches the ledger.
 * Investors usually care about Draws / Principal / Payoffs / Interest;
 * the trailing buckets (adjustments, reversals, renewals) stay in a
 * secondary row so the primary four don't fight for eye time.
 */

import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Car,
  CheckCircle2,
  FileText,
  RefreshCcw,
  Percent,
  Undo2,
  Wrench,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils/dates";
import {
  BUCKET_LABELS,
  TRANSACTION_TYPE_TO_BUCKET,
  type DebtTransactionInput,
  type DebtTransactionType,
  type GroupedRollForward,
  type MethodologyBucket,
} from "@/lib/utils/debt-rollforward";

type Tone = "negative" | "positive" | "neutral" | "amber";

interface TileConfig {
  bucket: MethodologyBucket;
  icon: React.ComponentType<{ className?: string }>;
  tone: Tone;
}

const PRIMARY_TILES: TileConfig[] = [
  { bucket: "draws", icon: ArrowDownToLine, tone: "negative" },
  { bucket: "principal_payments", icon: ArrowUpFromLine, tone: "positive" },
  { bucket: "vehicle_payoffs", icon: Car, tone: "positive" },
  { bucket: "payoffs", icon: CheckCircle2, tone: "positive" },
  { bucket: "interest_payments", icon: Percent, tone: "amber" },
  { bucket: "fees", icon: FileText, tone: "amber" },
];

const SECONDARY_TILES: TileConfig[] = [
  { bucket: "adjustments", icon: Wrench, tone: "neutral" },
  { bucket: "reversals", icon: Undo2, tone: "negative" },
  { bucket: "note_renewals", icon: RefreshCcw, tone: "neutral" },
];

interface Props {
  rollForward: GroupedRollForward | null;
  transactions: DebtTransactionInput[];
  startIso: string;
  endIso: string;
  onSelectBucket?: (bucket: MethodologyBucket | null) => void;
  selectedBucket?: MethodologyBucket | null;
}

export function MethodologyTiles({
  rollForward,
  transactions,
  startIso,
  endIso,
  onSelectBucket,
  selectedBucket,
}: Props) {
  const counts = new Map<MethodologyBucket, number>();
  for (const t of transactions) {
    const d = t.effective_date.slice(0, 10);
    if (d < startIso || d > endIso) continue;
    const bucket =
      TRANSACTION_TYPE_TO_BUCKET[t.transaction_type as DebtTransactionType];
    if (!bucket) continue;
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }

  const totals = rollForward?.totals;
  const values: Record<MethodologyBucket, number> = {
    draws: totals?.draws ?? 0,
    principal_payments: totals?.principalPayments ?? 0,
    vehicle_payoffs: totals?.vehiclePayoffs ?? 0,
    payoffs: totals?.payoffs ?? 0,
    interest_payments: totals?.interestPayments ?? 0,
    fees: totals?.fees ?? 0,
    adjustments: totals?.adjustments ?? 0,
    reversals: totals?.reversals ?? 0,
    note_renewals: totals?.noteRenewals ?? 0,
  };

  const hasSecondary = SECONDARY_TILES.some(
    (t) => Math.abs(values[t.bucket]) > 0.005 || (counts.get(t.bucket) ?? 0) > 0
  );

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {PRIMARY_TILES.map((cfg) => (
          <Tile
            key={cfg.bucket}
            cfg={cfg}
            value={values[cfg.bucket]}
            count={counts.get(cfg.bucket) ?? 0}
            selected={selectedBucket === cfg.bucket}
            onClick={
              onSelectBucket
                ? () =>
                    onSelectBucket(
                      selectedBucket === cfg.bucket ? null : cfg.bucket
                    )
                : undefined
            }
          />
        ))}
      </div>
      {hasSecondary && (
        <div className="grid grid-cols-3 gap-3">
          {SECONDARY_TILES.map((cfg) => (
            <Tile
              key={cfg.bucket}
              cfg={cfg}
              value={values[cfg.bucket]}
              count={counts.get(cfg.bucket) ?? 0}
              selected={selectedBucket === cfg.bucket}
              onClick={
                onSelectBucket
                  ? () =>
                      onSelectBucket(
                        selectedBucket === cfg.bucket ? null : cfg.bucket
                      )
                  : undefined
              }
              dim
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface TileProps {
  cfg: TileConfig;
  value: number;
  count: number;
  selected: boolean;
  onClick?: () => void;
  dim?: boolean;
}
function Tile({ cfg, value, count, selected, onClick, dim }: TileProps) {
  const { bucket, icon: Icon, tone } = cfg;
  const toneClass =
    tone === "negative"
      ? "text-rose-600 dark:text-rose-400"
      : tone === "positive"
        ? "text-emerald-600 dark:text-emerald-400"
        : tone === "amber"
          ? "text-amber-600 dark:text-amber-400"
          : "text-muted-foreground";
  const iconBgClass =
    tone === "negative"
      ? "bg-rose-500/10"
      : tone === "positive"
        ? "bg-emerald-500/10"
        : tone === "amber"
          ? "bg-amber-500/10"
          : "bg-muted";
  return (
    <Card
      className={cn(
        "transition-colors",
        onClick && "cursor-pointer hover:bg-muted/50",
        selected && "ring-2 ring-primary",
        dim && !selected && "opacity-80"
      )}
      onClick={onClick}
    >
      <CardContent className="flex items-start justify-between gap-3 p-3">
        <div className="min-w-0 space-y-1">
          <div className="truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {BUCKET_LABELS[bucket]}
          </div>
          <div
            className={cn(
              "text-base font-semibold tabular-nums md:text-lg",
              toneClass
            )}
          >
            {formatCurrency(Math.abs(value))}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {count} {count === 1 ? "txn" : "txns"}
          </div>
        </div>
        <div
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-md",
            iconBgClass
          )}
        >
          <Icon className={cn("size-4", toneClass)} />
        </div>
      </CardContent>
    </Card>
  );
}
