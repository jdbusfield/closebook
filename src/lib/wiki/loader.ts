import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Filesystem-backed wiki loader.
 *
 * Wiki content lives as Markdown files under `docs/wiki/`. Each file may
 * have a YAML-style frontmatter block:
 *
 *     ---
 *     title: Getting Started
 *     slug: getting-started
 *     section: Getting Started
 *     order: 10
 *     description: ...
 *     ---
 *
 * Pages without a slug fall back to their filename (without extension).
 * Pages without a title fall back to the slug.
 *
 * In addition to `docs/wiki/`, we surface a small registry of long-form
 * docs that already live elsewhere in `docs/` (e.g. the Accounting Manager
 * Onboarding Packet) so they aren't orphaned.
 */

export interface WikiPageMeta {
  title: string;
  slug: string;
  section: string;
  order: number;
  description?: string;
  /** Absolute path to the source file, for debugging. */
  sourcePath: string;
}

export interface WikiPage extends WikiPageMeta {
  content: string;
}

const REPO_ROOT = process.cwd();
const WIKI_DIR = path.join(REPO_ROOT, "docs", "wiki");

/**
 * Files outside `docs/wiki/` we still want to expose through the wiki.
 * Keep this list short and intentional.
 */
const EXTERNAL_PAGES: Array<{
  sourcePath: string;
  slug: string;
  title: string;
  section: string;
  order: number;
  description?: string;
}> = [
  {
    sourcePath: path.join(REPO_ROOT, "docs", "accounting-manager-onboarding-packet.md"),
    slug: "accounting-manager-onboarding-packet",
    title: "Accounting Manager Onboarding Packet",
    section: "Onboarding",
    order: 80,
    description:
      "Long-form onboarding document for incoming accounting managers — entities, systems, close process, gotchas.",
  },
];

function parseFrontmatter(raw: string): {
  meta: Record<string, string | number>;
  body: string;
} {
  if (!raw.startsWith("---")) {
    return { meta: {}, body: raw };
  }
  const end = raw.indexOf("\n---", 3);
  if (end === -1) {
    return { meta: {}, body: raw };
  }
  const fmBlock = raw.slice(3, end).trim();
  const body = raw.slice(end + 4).replace(/^\r?\n/, "");
  const meta: Record<string, string | number> = {};
  for (const line of fmBlock.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let value: string | number = m[2].trim();
    // Strip wrapping quotes.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key === "order" && /^-?\d+$/.test(value as string)) {
      value = Number(value);
    }
    meta[key] = value;
  }
  return { meta, body };
}

async function readWikiFile(
  filePath: string,
  fallback: Partial<WikiPageMeta> = {},
): Promise<WikiPage | null> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
  const { meta, body } = parseFrontmatter(raw);
  const baseName = path.basename(filePath, path.extname(filePath));

  const slug =
    (typeof meta.slug === "string" && meta.slug) ||
    fallback.slug ||
    baseName;
  const title =
    (typeof meta.title === "string" && meta.title) ||
    fallback.title ||
    slug;
  const section =
    (typeof meta.section === "string" && meta.section) ||
    fallback.section ||
    "Other";
  const order =
    typeof meta.order === "number"
      ? meta.order
      : fallback.order ?? 9999;
  const description =
    (typeof meta.description === "string" && meta.description) ||
    fallback.description;

  return {
    title,
    slug,
    section,
    order,
    description,
    sourcePath: filePath,
    content: body,
  };
}

let cache: WikiPage[] | null = null;

export async function loadAllPages(): Promise<WikiPage[]> {
  if (cache) return cache;

  const pages: WikiPage[] = [];

  // 1) docs/wiki/*.md
  let entries: string[] = [];
  try {
    entries = await fs.readdir(WIKI_DIR);
  } catch {
    entries = [];
  }
  for (const name of entries) {
    if (!name.endsWith(".md")) continue;
    const full = path.join(WIKI_DIR, name);
    const page = await readWikiFile(full);
    if (page) pages.push(page);
  }

  // 2) Registered external pages from elsewhere in docs/
  for (const ext of EXTERNAL_PAGES) {
    const page = await readWikiFile(ext.sourcePath, ext);
    if (page) pages.push(page);
  }

  // Sort within each section by order, then alphabetical.
  pages.sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    return a.title.localeCompare(b.title);
  });

  cache = pages;
  return pages;
}

export async function getPage(slug: string): Promise<WikiPage | null> {
  const pages = await loadAllPages();
  return pages.find((p) => p.slug === slug) ?? null;
}

export interface WikiSection {
  section: string;
  pages: WikiPageMeta[];
}

export async function getSections(): Promise<WikiSection[]> {
  const pages = await loadAllPages();
  const bySection = new Map<string, WikiPageMeta[]>();
  for (const p of pages) {
    const meta: WikiPageMeta = {
      title: p.title,
      slug: p.slug,
      section: p.section,
      order: p.order,
      description: p.description,
      sourcePath: p.sourcePath,
    };
    const arr = bySection.get(p.section) ?? [];
    arr.push(meta);
    bySection.set(p.section, arr);
  }
  // Preserve first-seen section order (already sorted by `order` above).
  const sections: WikiSection[] = [];
  const seen = new Set<string>();
  for (const p of pages) {
    if (seen.has(p.section)) continue;
    seen.add(p.section);
    sections.push({
      section: p.section,
      pages: bySection.get(p.section) ?? [],
    });
  }
  return sections;
}

export async function getAllSlugs(): Promise<string[]> {
  const pages = await loadAllPages();
  return pages.map((p) => p.slug);
}
