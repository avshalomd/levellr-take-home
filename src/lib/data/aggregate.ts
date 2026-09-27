import "server-only";
import { query } from "./db";
import { AGGREGATE_ROWS, FLAG_THRESHOLD, topicKeys, whereOf } from "./filters";
import type { Filters } from "./types";

// Exact numbers come from SQL, never from a model reading text (Jev's own documentation: it is weak at counting).
// The agent picks a metric and a grouping from these allow-lists; it never writes SQL (docs/DECISIONS.md D3).

export const METRICS = {
  conversations: "count(*)::int",
  messages: "sum(c.n_messages)::int",
  authors: "(SELECT count(DISTINCT m.author) FROM messages m WHERE m.conversation_id = ANY(array_agg(c.id)))::int",
  avg_sentiment: "round(avg(c.sentiment)::numeric, 3)::float",
  share_negative: "round(avg((c.sentiment < 0.375)::int)::numeric, 3)::float",
  share_bug: `round(avg((c.p_bug >= ${FLAG_THRESHOLD})::int)::numeric, 3)::float`,
  share_feature: `round(avg((c.p_feature >= ${FLAG_THRESHOLD})::int)::numeric, 3)::float`,
  share_complaint: `round(avg((c.p_complaint >= ${FLAG_THRESHOLD})::int)::numeric, 3)::float`,
  share_help: `round(avg((c.p_help >= ${FLAG_THRESHOLD})::int)::numeric, 3)::float`,
  // The net votes (Reddit) or reactions (Discord) on the conversations' messages, added up: engagement at the one unit
  // the app counts in. A conversation is dated by the day it starts, and so are its votes (his ruling 27 Sep: the
  // conversation is the unit, and the agent says so rather than pretend to count single messages).
  net_votes: "sum(c.score_sum)::int",
} as const;
export type Metric = keyof typeof METRICS;

export const GROUPINGS = {
  none: "'all'",
  day: "to_char(date_trunc('day', c.started_at), 'YYYY-MM-DD')",
  week: "to_char(date_trunc('week', c.started_at), 'YYYY-MM-DD')",
  month: "to_char(date_trunc('month', c.started_at), 'YYYY-MM')",
  topic: "tk.key", // one row per topic a conversation touches: see FROM_TOPICS
  channel: "c.channel",
} as const;
export type Grouping = keyof typeof GROUPINGS;

// By topic, a conversation is counted under every topic it touches (D46): the rows overlap, so they add up to more than
// the conversations in the slice. The result then carries `total`, the slice's distinct conversations, so the reader is
// given the honest denominator beside the overlapping rows.
const FROM_TOPICS = `conversations c CROSS JOIN LATERAL ${topicKeys("c")} AS tk(key)`;

export type AggregateResult = {
  metric: Metric;
  groupBy: Grouping;
  filters: Filters;
  rows: { key: string; value: number; n: number }[];
  total?: number; // grouped by topic only: the distinct conversations in the slice (the rows overlap and add up to more)
  sql: string; // shown in the UI behind "show the query", so a number can be checked
  params: unknown[];
};

export async function aggregate(metric: Metric, groupBy: Grouping, filters: Filters = {}): Promise<AggregateResult> {
  const params: unknown[] = [];
  const where = whereOf(filters, params);
  const key = GROUPINGS[groupBy];
  const order = groupBy === "day" || groupBy === "week" || groupBy === "month" ? "key" : "value DESC NULLS LAST";
  const sql =
    `SELECT ${key} AS key, ${METRICS[metric]} AS value, count(*)::int AS n\n` +
    `FROM ${groupBy === "topic" ? FROM_TOPICS : "conversations c"}\nWHERE ${where}\nGROUP BY 1\nORDER BY ${order}\nLIMIT ${AGGREGATE_ROWS}`;
  const rows = await query<{ key: string; value: number; n: number }>(sql, params);
  if (groupBy !== "topic") return { metric, groupBy, filters, rows, sql, params };
  const [all] = await query<{ n: number }>(`SELECT count(*)::int AS n FROM conversations c WHERE ${where}`, params);
  return { metric, groupBy, filters, rows, total: all?.n ?? 0, sql, params };
}
