import type { Filters } from "./types";

/** The most rows one aggregate returns. A chart that adds rows up reads a count this long as cut short (activity-words). */
export const AGGREGATE_ROWS = 60;

// Every filter becomes a numbered parameter, never string-spliced SQL. Flags are an allow-list, so the column name
// that is interpolated can only be one of five known ones.
const FLAG_COLUMN = {
  excited: "p_excited",
  frustrated: "p_frustrated",
  bug: "p_bug",
  feature: "p_feature",
  help: "p_help",
} as const;

/** A label counts as present at probability 0.5 or more. One threshold everywhere, stated in docs/DATA.md. */
export const FLAG_THRESHOLD = 0.5;

// A date filter goes to Postgres as `::timestamptz`, which throws on "July 2026" or "2026-02-30". The tools check the
// shape first, so the model is told plainly what to send instead of seeing a database error, or a retry hiding one
// (review 2026-09-26). A day, optionally with a time and zone: "2026-07-01", "2026-07-01T00:00:00Z".
const ISO_DATE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}(?::?\d{2})?)?)?$/;

/** Whether a date filter is an ISO date Postgres reads: the right shape, and a day the calendar has. */
export function isIsoDate(s: string): boolean {
  const m = ISO_DATE.exec(s.trim());
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const day = new Date(Date.UTC(y, mo - 1, d));
  return day.getUTCFullYear() === y && day.getUTCMonth() === mo - 1 && day.getUTCDate() === d;
}

/**
 * One row per topic a conversation touches, as SQL for a lateral join: `CROSS JOIN LATERAL ${topicKeys("c")} AS tk(key)`.
 * Topics are multi-label (D46), so a conversation counts under every topic it touches and counts by topic add up to
 * more than the conversations; a conversation not labelled yet counts once, as "unlabelled".
 */
export const topicKeys = (alias = "c") =>
  `unnest(CASE WHEN cardinality(${alias}.topics) > 0 THEN ${alias}.topics ELSE ARRAY['unlabelled'] END)`;

/**
 * The columns every conversation read selects, as ConversationRow (types.ts). The schema has no thread title (a Discord
 * channel has no threads), so the title the reader sees is the channel and the conversation's first line, cut from the
 * transcript (its lines read "[msgN] author · 2026-09-13 19:44: text"). Labels arrive after the load and may be NULL;
 * `topics` is then empty, never NULL.
 */
export const CONV_COLUMNS = `c.id, c.ref, c.channel, c.kind, c.started_at, c.ended_at, c.n_messages, c.n_authors, c.n_replies,
  c.n_reactions, c.engagement, c.transcript, c.context_ids,
  '#' || c.channel || ': ' || left(coalesce(substring(c.transcript from '\\n\\[msg[0-9]+\\][^\\n]*?: ([^\\n]*)'), ''), 80) AS thread_title,
  coalesce(c.topics, '{}') AS topics, c.topic, c.topic_conf, c.sentiment,
  c.p_excited, c.p_frustrated, c.p_bug, c.p_feature, c.p_help, c.p_noise`;

/** The columns every message read selects, as MessageRow. `thread_id` is the conversation the message belongs to: the
 * evidence panel opens a conversation as its thread tree (there are no Discord threads in the export). The panel's
 * components read a few fields this export does not have, so they are given here in this data's terms: `score`
 * is the message's reactions, every message is a "message" (no thread-opening post), and none is removed, a bot's or
 * from before the window (the export has none of these, docs/DESIGN.md). */
export const MSG_COLUMNS = (text = "m.text") =>
  `m.id, m.ref, m.channel, m.conversation_id AS thread_id, m.reply_to, m.conversation_id, m.author, m.ts, ${text} AS text,
   m.n_reactions, m.n_reactions AS score, 'message' AS kind, false AS removed, false AS is_bot, true AS in_window`;

export function whereOf(f: Filters, params: unknown[], alias = "c"): string {
  const parts: string[] = [];
  const p = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  if (f.channel) parts.push(`${alias}.channel = ${p(f.channel)}`);
  // A topic means every conversation that touches it, not only those where it is the primary one: topics are
  // multi-label (D46), and conversations.topics carries a GIN index for this.
  if (f.topic) parts.push(`${p(f.topic)} = ANY(${alias}.topics)`);
  if (f.since) parts.push(`${alias}.started_at >= ${p(f.since)}::timestamptz`);
  if (f.until) parts.push(`${alias}.started_at < ${p(f.until)}::timestamptz`);
  if (f.flag) parts.push(`${alias}.${FLAG_COLUMN[f.flag]} >= ${FLAG_THRESHOLD}`);
  // A person: every conversation they wrote at least one message in (messages_author_idx serves the lookup).
  if (f.author)
    parts.push(
      `EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = ${alias}.id AND m.author = ${p(f.author)})`,
    );
  return parts.length ? parts.join(" AND ") : "TRUE";
}
