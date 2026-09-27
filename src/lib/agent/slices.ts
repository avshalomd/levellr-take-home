// How two slices of conversations compare: one holds the other, or they are the same conversations. The chat's steps
// (components/chat/activity-words.ts) and the claim check's reads (lib/agent/corroborate.ts poolOf) must compare them
// the same way, so both import them from here (review 2026-09-26: the server-side check imported them from a UI module).
// No server-only imports: the browser uses these too. Pure, tested in slices.test.ts.

export type SliceFilters = { topic?: string; channel?: string; since?: string; until?: string; flag?: string; author?: string };

/** The filters that pick one kind of conversation; the dates are compared as a range. */
export const CATEGORIES = ["topic", "channel", "flag", "author"] as const;

/** A date filter as a time, an open end as `open` (-Infinity for a start, Infinity for an end). */
export const time = (s: string | undefined, open: number) => (s ? Date.parse(s.length === 10 ? `${s}T00:00:00Z` : s) : open);

/** Whether every conversation in slice `a` is also in slice `b`: each of b's filters is a's too, and a's dates sit
 *  inside b's. A topic filter is membership (D46): two different topics may share conversations, but neither slice
 *  holds the other. */
export function within(a: SliceFilters, b: SliceFilters): boolean {
  if (CATEGORIES.some((k) => b[k] && a[k] !== b[k])) return false;
  return time(a.since, -Infinity) >= time(b.since, -Infinity) && time(a.until, Infinity) <= time(b.until, Infinity);
}

/** Whether two slices are the same conversations: each holds the other (the same filters, dates written either way). */
export const sameSlice = (a: SliceFilters, b: SliceFilters) => within(a, b) && within(b, a);
