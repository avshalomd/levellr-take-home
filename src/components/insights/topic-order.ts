import { isOther } from "@/lib/data/insights-labels";

/**
 * The topics editor's list in the grid's row order (busiest first), so a reader moving between the two finds each
 * topic in the same place. The editor kept the order the labels were saved in, which matched nothing on screen (QA
 * 2026-09-25). Topics the grid does not show yet (just added, or with no conversations) follow the grid's own, in the
 * order they were written, and the catch-all stays last, as it does in the grid. Pinned by topic-order.test.ts.
 */
export function inGridOrder<T extends { key: string }>(labels: T[], gridKeys: string[]): T[] {
  const index = new Map(gridKeys.map((k, i) => [k, i]));
  const rank = (key: string) => (isOther(key) ? Infinity : (index.get(key) ?? gridKeys.length));
  return [...labels].sort((a, b) => rank(a.key) - rank(b.key)); // a stable sort: equal ranks keep their order
}
