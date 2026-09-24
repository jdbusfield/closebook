/**
 * Matching quote project names to QuickBooks customers.
 *
 * QuickBooks customers look like "20th Television:911:911 S10 (HDR Location)";
 * quotes carry a project like "911 S10" or "9-1-1 Season 10". Both sides are
 * reduced to a lowercase alphanumeric key, then matched exactly, through the
 * alias list, or by close spelling.
 */

export function normKey(s: string): string {
  let k = String(s ?? "").toLowerCase().replace(/�/g, "");
  k = k.replace(/season\s*/g, "s");
  k = k.replace(/\(.*?\)|".*?"/g, "");
  k = k.replace(/[^a-z0-9]/g, "");
  return k.replace(/llc/g, "").replace(/inc/g, "");
}

/** Last segment of a fully qualified customer, without its "(W&T)" style tag. */
export function customerLeaf(customer: string): string {
  const parts = customer.split(":");
  return parts[parts.length - 1].replace(/\s*\([^)]*\)\s*$/, "").trim();
}

export function customerTop(customer: string): string {
  return customer.split(":")[0].replace(/\s*\([^)]*\)\s*$/, "").trim();
}

/** Ratcliff/Obershelp-style ratio (Python difflib.SequenceMatcher.ratio). */
export function similarity(a: string, b: string): number {
  if (!a.length && !b.length) return 1;
  const matches = matchCount(a, b);
  return (2 * matches) / (a.length + b.length);
}

function matchCount(a: string, b: string): number {
  if (!a.length || !b.length) return 0;
  // longest common substring
  let best = 0;
  let bi = 0;
  let bj = 0;
  const prev = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let diag = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = a[i - 1] === b[j - 1] ? diag + 1 : 0;
      if (prev[j] > best) {
        best = prev[j];
        bi = i - best;
        bj = j - best;
      }
      diag = tmp;
    }
  }
  if (best === 0) return 0;
  return best + matchCount(a.slice(0, bi), b.slice(0, bj)) + matchCount(a.slice(bi + best), b.slice(bj + best));
}

/**
 * Build a function mapping a quote project to the QuickBooks customer key it
 * most likely belongs to, or null.
 */
export function buildKeyMapper(
  customerKeys: Iterable<string>,
  aliases: Record<string, string>,
): (project: string) => string | null {
  const keys = new Set<string>();
  for (const k of customerKeys) if (k) keys.add(k);
  const list = [...keys];
  const cache = new Map<string, string | null>();
  return (project: string) => {
    let k = normKey(project);
    if (aliases[k]) k = aliases[k];
    if (!k) return null;
    if (cache.has(k)) return cache.get(k)!;
    let found: string | null = null;
    if (keys.has(k)) found = k;
    if (!found) {
      let bestScore = 0.85;
      for (const c of list) {
        if (Math.abs(c.length - k.length) > Math.max(c.length, k.length) * 0.3) continue;
        const s = similarity(k, c);
        if (s >= bestScore) {
          bestScore = s;
          found = c;
        }
      }
    }
    if (!found && k.length >= 5) {
      found = list.find((c) => c.length >= 5 && (c.includes(k) || k.includes(c))) ?? null;
    }
    cache.set(k, found);
    return found;
  };
}

/**
 * Quote numbers as typed on an invoice ("HDR-116116", "HDR 116116, 116117")
 * or as the Quotes Report writes them ("Quote HDR-116116"). The same number
 * can exist under HDR and WT, so a prefix is kept when present:
 * "HDR-116116"; a bare number stays "116116".
 */
export function parseQuoteRefs(value: string): string[] {
  const out: string[] = [];
  const re = /(?:\b([A-Za-z]{2,4})\s*[-#]?\s*)?(\d{5,7})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(value ?? ""))) !== null) {
    const pre = m[1] && !/^quote$/i.test(m[1]) ? m[1].toUpperCase() : "";
    out.push(pre ? `${pre}-${m[2]}` : m[2]);
  }
  return [...new Set(out)];
}
