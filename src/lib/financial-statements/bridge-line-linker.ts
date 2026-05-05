// Cross-chart line-linking heuristic.
//
// Pairs a line on the accountant chart with the closest semantic match on
// the management chart (or vice-versa). The auditor convention is to leave
// unmatched lines inline — never silently drop them — and to favour
// explicit mappings over over-eager fuzzy matches.
//
// The match key is built from:
//   - Major group (Assets / Liabilities / Equity / Revenue / Expense) — must agree
//   - Account-number prefix family (FS-A vs 1xxx etc.)
//   - Lowercased name with stopwords removed
//   - Edit-distance similarity, with thresholds chosen conservatively

import type { LineItem, StatementData } from "@/components/financial-statements/types";

const STOPWORDS = new Set([
  "the", "and", "of", "a", "an", "for", "on", "to", "in", "by",
  "total", "net", "less", "other",
]);

const SECTION_TO_GROUP: Record<string, string> = {
  // Income statement
  revenue: "Revenue",
  cost_of_goods_sold: "Expense",
  gross_profit: "Revenue",
  direct_operating_costs: "Expense",
  operating_expenses: "Expense",
  operating_income: "Revenue",
  other_income_expense: "Expense",
  income_before_tax: "Revenue",
  tax_expense: "Expense",
  net_income: "Revenue",
  // Balance sheet
  current_assets: "Assets",
  fixed_assets: "Assets",
  other_assets: "Assets",
  total_assets: "Assets",
  current_liabilities: "Liabilities",
  long_term_liabilities: "Liabilities",
  total_liabilities: "Liabilities",
  equity: "Equity",
  total_liabilities_equity: "Liabilities",
};

export interface IndexedLine {
  line: LineItem;
  sectionId: string;
  sectionTitle: string;
  group: string;
  normalized: string;
  numberPrefix: string | null;
}

/** Build an index of all real lines in a statement, skipping headers and separators. */
export function indexStatement(stmt: StatementData): IndexedLine[] {
  const out: IndexedLine[] = [];
  for (const section of stmt.sections) {
    const group = SECTION_TO_GROUP[section.id] ?? section.title;
    for (const line of section.lines) {
      if (line.isHeader || line.isSeparator) continue;
      out.push({
        line,
        sectionId: section.id,
        sectionTitle: section.title,
        group,
        normalized: normalize(line.label),
        numberPrefix: numberPrefix(line.accountNumber),
      });
    }
    if (section.subtotalLine) {
      out.push({
        line: section.subtotalLine,
        sectionId: section.id,
        sectionTitle: section.title,
        group,
        normalized: normalize(section.subtotalLine.label),
        numberPrefix: null,
      });
    }
  }
  return out;
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0 && !STOPWORDS.has(w))
    .join(" ");
}

function numberPrefix(num: string | null | undefined): string | null {
  if (!num) return null;
  const m = num.match(/^([A-Z]+-[A-Z]+|[A-Z]+|\d{1,2})/i);
  return m ? m[1].toUpperCase() : null;
}

/** Token-set similarity (Jaccard) on normalized words. */
function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const ta = new Set(a.split(" "));
  const tb = new Set(b.split(" "));
  let intersect = 0;
  for (const t of ta) if (tb.has(t)) intersect++;
  const union = ta.size + tb.size - intersect;
  return union === 0 ? 0 : intersect / union;
}

export interface LinePair {
  fromIdx: number | null;
  toIdx: number | null;
  group: string;
  /** Match score 0-1; 1 means exact, 0 means unmatched */
  score: number;
}

/**
 * Greedy bipartite match. Each from-line picks its best to-line within the
 * same group, score must clear MIN_SCORE. Unmatched lines on either side
 * become rows with one side null.
 */
export function linkLines(
  fromIndex: IndexedLine[],
  toIndex: IndexedLine[],
): LinePair[] {
  const MIN_SCORE = 0.34;
  const used = new Set<number>();
  const pairs: LinePair[] = [];

  // Pass 1: each from-line claims its best to-line above the threshold.
  for (let i = 0; i < fromIndex.length; i++) {
    const f = fromIndex[i];
    let bestJ = -1;
    let bestScore = 0;
    for (let j = 0; j < toIndex.length; j++) {
      if (used.has(j)) continue;
      const t = toIndex[j];
      if (t.group !== f.group) continue;
      const s = scorePair(f, t);
      if (s > bestScore) {
        bestScore = s;
        bestJ = j;
      }
    }
    if (bestJ >= 0 && bestScore >= MIN_SCORE) {
      used.add(bestJ);
      pairs.push({ fromIdx: i, toIdx: bestJ, group: f.group, score: bestScore });
    } else {
      pairs.push({ fromIdx: i, toIdx: null, group: f.group, score: 0 });
    }
  }

  // Pass 2: surface unclaimed to-lines as unmatched (toIdx with no fromIdx).
  for (let j = 0; j < toIndex.length; j++) {
    if (used.has(j)) continue;
    pairs.push({ fromIdx: null, toIdx: j, group: toIndex[j].group, score: 0 });
  }

  return pairs;
}

function scorePair(a: IndexedLine, b: IndexedLine): number {
  // Subtotal/grand-total lines must match other subtotals of the same kind.
  const aIsSub = a.line.isTotal || a.line.isGrandTotal;
  const bIsSub = b.line.isTotal || b.line.isGrandTotal;
  if (aIsSub !== bIsSub) return 0;

  let s = similarity(a.normalized, b.normalized);

  // Prefix bonus: account-number families that share a prefix (rare across
  // ACC/MGT charts but valuable when present).
  if (a.numberPrefix && b.numberPrefix && a.numberPrefix === b.numberPrefix) {
    s += 0.1;
  }

  // Section-id bonus: same logical section in our config (e.g., both
  // "current_assets") suggests stronger match.
  if (a.sectionId === b.sectionId) {
    s += 0.05;
  }

  return Math.min(1, s);
}
