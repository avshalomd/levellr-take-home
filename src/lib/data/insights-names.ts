import "server-only";
import { unstable_cache } from "next/cache";
import { query } from "./db";
import { INSIGHTS_VERSION_TAG } from "./insights";

// The topic names the Explore page is rendered with, so its first paint says "Highlights & Creations" and not a name
// made from the key (D28). The browser's own GET /api/taxonomy arrives after hydration with everything else the topics
// editor needs (counts, the relabel, the budget); this is only the names.
//
// Here the names are the loader's (dataset_meta.topics: the label set the human approved, with its descriptions). One
// row, read only. With none stored it returns nothing, and the grid names each topic from its key.

/** A stored label set as key -> name. Tolerates what a hand-edited or half-written row could hold. */
export function namesOf(labels: unknown): Record<string, string> {
  if (!Array.isArray(labels)) return {};
  const out: Record<string, string> = {};
  for (const l of labels as { key?: unknown; name?: unknown }[]) {
    if (typeof l?.key === "string" && typeof l.name === "string" && l.name.trim()) out[l.key] = l.name;
  }
  return out;
}

export const NAMES_SQL = `SELECT value AS labels FROM dataset_meta WHERE key = 'topics'`;

// Cached with the grid's version (open item 2026-09-26): a rename goes through the edit route, which calls
// topicsChanged() (insights.ts), so a warm Explore load reads nothing. A failed read throws out of the cache, so it is
// not kept.
const storedNames = unstable_cache(
  async () => namesOf((await query<{ labels: unknown }>(NAMES_SQL))[0]?.labels),
  ["insights-names-1"],
  { tags: [INSIGHTS_VERSION_TAG], revalidate: 300 },
);

/** The active label set's names by key; empty when there is none or the database cannot be read. */
export async function topicNames(): Promise<Record<string, string>> {
  return storedNames().catch(() => ({}));
}
