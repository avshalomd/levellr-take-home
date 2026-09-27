import "server-only";
import { query } from "./db";
import { whereOf } from "./filters";
import type { Filters } from "./types";

// Who is talking in a slice. Authors are the source's public handles (docs/DATA.md), and who says something (a regular,
// a big creator, a moderator) is part of the signal. Bots and deleted accounts are not voices. Counted in SQL, like
// every number in the app (aggregate.ts).

export type Voice = {
  author: string;
  messages: number; // messages they wrote in the slice's conversations
  conversations: number; // conversations they wrote in
  score: number; // the net score of those messages
  started: number; // conversations whose first message is theirs
  first_ts: string; // their first and last message in the slice, ISO
  last_ts: string;
};

export type VoicesResult = {
  filters: Filters;
  limit: number;
  total_authors: number; // every human author in the slice: the denominator for the rows shown
  rows: Voice[];
  sql: string; // shown behind "show the query", as aggregate does
  params: unknown[];
};

export const MAX_VOICES = 50;

/** A sane row count: at least 1, at most MAX_VOICES, a whole number. */
export const clampLimit = (limit: number) =>
  Math.min(MAX_VOICES, Math.max(1, Math.floor(Number.isFinite(limit) ? limit : 12)));

/** The authors of the given conversations, as rows of Voice. `conv` is a query selecting conversation ids (as `id`); it
 * may name a CTE of an enclosing query (the inner CTE is `vconv`, so an outer `conv` stays visible).
 * Shared by topVoices and the Explore selection so both count a voice the same way. */
export const voicesOver = (conv: string, limitParam: string) =>
  `WITH vconv AS (${conv}),
     firsts AS (
       SELECT DISTINCT ON (m.conversation_id) m.conversation_id, m.author
       FROM messages m JOIN vconv ON m.conversation_id = vconv.id
       ORDER BY m.conversation_id, m.ts, m.id),
     msgs AS (
       SELECT m.author, m.conversation_id, m.score, m.ts
       FROM messages m JOIN vconv ON m.conversation_id = vconv.id
       WHERE NOT m.is_bot AND m.author <> 'deleted-user')
   SELECT v.author, count(*)::int AS messages, count(DISTINCT v.conversation_id)::int AS conversations,
          coalesce(sum(v.score), 0)::int AS score,
          (SELECT count(*)::int FROM firsts f WHERE f.author = v.author) AS started,
          min(v.ts) AS first_ts, max(v.ts) AS last_ts,
          (SELECT count(DISTINCT author)::int FROM msgs) AS total_authors
   FROM msgs v
   GROUP BY v.author
   ORDER BY messages DESC, score DESC, v.author
   LIMIT ${limitParam}`;

/** A result row as a Voice: the per-query total dropped, timestamps as ISO in UTC ("Z") whichever way they arrived (the
 * driver gives Z, json_agg gives +00:00). */
export const toVoice = (r: Voice & { total_authors?: number }): Voice => ({
  author: r.author,
  messages: r.messages,
  conversations: r.conversations,
  score: r.score,
  started: r.started,
  first_ts: new Date(r.first_ts).toISOString(),
  last_ts: new Date(r.last_ts).toISOString(),
});

/** The SQL and parameters for topVoices, without running it. */
export function voicesQuery(filters: Filters, limit: number): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const where = whereOf(filters, params);
  params.push(clampLimit(limit));
  return { sql: voicesOver(`SELECT c.id FROM conversations c WHERE ${where}`, `$${params.length}`), params };
}

/** The most active people in the conversations matching `filters`, most messages first, then highest score. */
export async function topVoices(filters: Filters = {}, limit = 12): Promise<VoicesResult> {
  const { sql, params } = voicesQuery(filters, limit);
  const raw = await query<Voice & { total_authors: number }>(sql, params);
  const rows = raw.map(toVoice);
  return { filters, limit: clampLimit(limit), total_authors: raw[0]?.total_authors ?? 0, rows, sql, params };
}
