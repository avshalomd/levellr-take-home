import "server-only";
import { query } from "./db";
import { topicKeys } from "./filters";
import type { ConversationRow, MessageRow } from "./types";

export type Conversation = ConversationRow & { context_ids: string[]; messages: MessageRow[] };

export async function getConversation(id: string): Promise<Conversation | null> {
  const [c] = await query<ConversationRow & { context_ids: string[] }>(`SELECT * FROM conversations WHERE id = $1`, [id]);
  if (!c) return null;
  const messages = await query<MessageRow>(
    `SELECT id, ref, kind, channel, thread_id, reply_to, conversation_id, in_window, author, ts, text, score, removed, is_bot
     FROM messages WHERE (conversation_id = $1 OR id = ANY($2)) AND NOT is_bot ORDER BY ts`,
    [id, c.context_ids],
  );
  return { ...c, messages };
}

export type ThreadNode = Omit<MessageRow, "text"> & { text: string; topic: string | null; topics: string[] };
export type Thread = { thread_id: string; title: string; channel: string; nodes: ThreadNode[] };

/**
 * A whole thread, for the thread map: every message with its parent link and the conversation it belongs to.
 * Text is cut to a preview; the evidence panel fetches a full message only when it is opened.
 */
export async function getThread(threadId: string): Promise<Thread | null> {
  const nodes = await query<ThreadNode>(
    `SELECT m.id, m.ref, m.kind, m.channel, m.thread_id, m.reply_to, m.conversation_id, m.in_window, m.author, m.ts,
            left(m.text, 400) AS text, m.score, m.removed, m.is_bot, c.topic,
            coalesce(c.topics, '{}') AS topics
     FROM messages m LEFT JOIN conversations c ON c.id = m.conversation_id
     WHERE m.thread_id = $1 AND NOT m.is_bot ORDER BY m.ts`,
    [threadId],
  );
  if (!nodes.length) return null;
  const post = nodes.find((n) => n.id === threadId);
  const [meta] = await query<{ thread_title: string; channel: string }>(
    `SELECT thread_title, channel FROM conversations WHERE thread_id = $1 LIMIT 1`,
    [threadId],
  );
  return { thread_id: threadId, title: meta?.thread_title ?? post?.text.split("\n")[0] ?? threadId, channel: meta?.channel ?? "", nodes };
}

export async function getMessages(ids: string[]): Promise<MessageRow[]> {
  if (!ids.length) return [];
  return query<MessageRow>(
    `SELECT id, ref, kind, channel, thread_id, reply_to, conversation_id, in_window, author, ts, text, score, removed, is_bot
     FROM messages WHERE id = ANY($1)`,
    [ids],
  );
}

/** Messages by their short ref - how the verifier reads back what the agent cited. */
export async function getMessagesByRef(refs: number[]): Promise<MessageRow[]> {
  if (!refs.length) return [];
  return query<MessageRow>(
    `SELECT id, ref, kind, channel, thread_id, reply_to, conversation_id, in_window, author, ts, text, score, removed, is_bot
     FROM messages WHERE ref = ANY($1::int[])`,
    [refs],
  );
}

/** A conversation id from what the agent passes: its handle (conv123) or, tolerated, the raw id. */
export async function conversationIdOf(handle: string): Promise<string | null> {
  const m = /^conv(\d+)$/i.exec(handle.trim());
  if (!m) return handle.trim() || null;
  const [row] = await query<{ id: string }>(`SELECT id FROM conversations WHERE ref = $1`, [Number(m[1])]);
  return row?.id ?? null;
}

export type Overview = {
  meta: Record<string, unknown>;
  conversations: number;
  // n = conversations touching the topic. A conversation can touch several topics (D46), so they add up to more
  // than `conversations`; topicsNote says so to the model in words.
  topics: { key: string; name: string; description: string; n: number; avg_sentiment: number }[];
  topicsNote: string;
};

export async function getOverview(): Promise<Overview> {
  const [meta, topics, [all]] = await Promise.all([
    query<{ key: string; value: unknown }>(`SELECT key, value FROM dataset_meta`),
    query<{ key: string; n: number; avg_sentiment: number }>(
      `SELECT tk.key, count(*)::int AS n, round(avg(c.sentiment)::numeric, 3)::float AS avg_sentiment
       FROM conversations c CROSS JOIN LATERAL ${topicKeys("c")} AS tk(key) GROUP BY 1 ORDER BY 2 DESC`,
    ),
    query<{ n: number }>(`SELECT count(*)::int AS n FROM conversations`),
  ]);
  // Names and definitions come from the customer's active label set, so the agent reads labels as the team wrote them.
  const [tax] = await query<{ labels: { key: string; name: string; description: string }[] }>(`SELECT labels FROM taxonomies WHERE active`);
  const def = new Map((tax?.labels ?? []).map((l) => [l.key, l]));
  return {
    meta: Object.fromEntries(meta.map((r) => [r.key, r.value])),
    conversations: all?.n ?? 0,
    topicsNote:
      `n is the number of conversations touching each topic. A conversation can have several topics, so these add up ` +
      `to more than the ${all?.n ?? 0} conversations, and shares by topic can add up to more than 100%.`,
    topics: topics.map((t) => ({ ...t, name: def.get(t.key)?.name ?? t.key, description: def.get(t.key)?.description ?? "" })),
  };
}
