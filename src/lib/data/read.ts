import "server-only";
import { query } from "./db";
import { CONV_COLUMNS, MSG_COLUMNS, topicKeys } from "./filters";
import type { ConversationRow, MessageRow } from "./types";

export type Conversation = ConversationRow & { context_ids: string[]; messages: MessageRow[] };

export async function getConversation(id: string): Promise<Conversation | null> {
  const [c] = await query<ConversationRow & { context_ids: string[] }>(
    `SELECT ${CONV_COLUMNS} FROM conversations c WHERE c.id = $1`,
    [id],
  );
  if (!c) return null;
  const messages = await query<MessageRow>(
    `SELECT ${MSG_COLUMNS()} FROM messages m WHERE m.conversation_id = $1 OR m.id = ANY($2) ORDER BY m.ts`,
    [id, c.context_ids ?? []],
  );
  return { ...c, messages };
}

export type ThreadNode = Omit<MessageRow, "text"> & { text: string; topic: string | null; topics: string[] };
export type Thread = { thread_id: string; title: string; channel: string; nodes: ThreadNode[] };

/**
 * One conversation as the evidence panel's thread tree: its messages and the reply parents it carries as context,
 * each with its parent link. A Discord channel has no threads, so the conversation is the thread (thread_id is its id).
 * Text is cut to a preview; the evidence panel fetches a full message only when it is opened.
 */
export async function getThread(conversationId: string): Promise<Thread | null> {
  const [c] = await query<{ thread_title: string; channel: string; context_ids: string[] }>(
    `SELECT ${CONV_COLUMNS} FROM conversations c WHERE c.id = $1`,
    [conversationId],
  );
  if (!c) return null;
  const nodes = await query<ThreadNode>(
    `SELECT ${MSG_COLUMNS("left(m.text, 400)")}, c.topic, coalesce(c.topics, '{}') AS topics
     FROM messages m LEFT JOIN conversations c ON c.id = m.conversation_id
     WHERE m.conversation_id = $1 OR m.id = ANY($2) ORDER BY m.ts`,
    [conversationId, c.context_ids ?? []],
  );
  return { thread_id: conversationId, title: c.thread_title, channel: c.channel, nodes };
}

export async function getMessages(ids: string[]): Promise<MessageRow[]> {
  if (!ids.length) return [];
  return query<MessageRow>(`SELECT ${MSG_COLUMNS()} FROM messages m WHERE m.id = ANY($1)`, [ids]);
}

/** Messages by their short ref - how the verifier reads back what the agent cited. */
export async function getMessagesByRef(refs: number[]): Promise<MessageRow[]> {
  if (!refs.length) return [];
  return query<MessageRow>(`SELECT ${MSG_COLUMNS()} FROM messages m WHERE m.ref = ANY($1::int[])`, [refs]);
}

/** A conversation id from what the agent passes: its handle (conv123) or, tolerated, the raw id. */
export async function conversationIdOf(handle: string): Promise<string | null> {
  const m = /^conv(\d+)$/i.exec(handle.trim());
  if (!m) return handle.trim() || null;
  const [row] = await query<{ id: string }>(`SELECT id FROM conversations WHERE ref = $1`, [Number(m[1])]);
  return row?.id ?? null;
}

export type TopicLabel = { key: string; name: string; description: string };

export type Overview = {
  meta: Record<string, unknown>;
  conversations: number;
  labelled: number; // conversations with labels: the rest are counted as "unlabelled" and carry no mood or flags
  channels: { key: string; n: number }[];
  // n = conversations touching the topic. A conversation can touch several topics, so they add up to more
  // than `conversations`; topicsNote says so to the model in words.
  topics: (TopicLabel & { n: number; avg_sentiment: number | null })[];
  topicsNote: string;
};

/** The topic labels as the loader stored them (dataset_meta.topics: a list of {key, name, description}, or of keys). */
export function topicLabelsOf(value: unknown): TopicLabel[] {
  const list = Array.isArray(value)
    ? value
    : Array.isArray((value as { labels?: unknown })?.labels)
      ? (value as { labels: unknown[] }).labels
      : [];
  return list.flatMap((t): TopicLabel[] => {
    if (typeof t === "string") return [{ key: t, name: t, description: "" }];
    if (!t || typeof t !== "object") return [];
    const o = t as Record<string, unknown>;
    const key = typeof o.key === "string" ? o.key : typeof o.name === "string" ? o.name : "";
    if (!key) return [];
    return [
      {
        key,
        name: typeof o.name === "string" ? o.name : key,
        description: typeof o.description === "string" ? o.description : "",
      },
    ];
  });
}

export async function topicLabels(): Promise<TopicLabel[]> {
  const [row] = await query<{ value: unknown }>(`SELECT value FROM dataset_meta WHERE key = 'topics'`);
  return topicLabelsOf(row?.value);
}

export async function getOverview(): Promise<Overview> {
  const [meta, topics, channels, [all]] = await Promise.all([
    query<{ key: string; value: unknown }>(`SELECT key, value FROM dataset_meta`),
    query<{ key: string; n: number; avg_sentiment: number | null }>(
      `SELECT tk.key, count(*)::int AS n, round(avg(c.sentiment)::numeric, 3)::float AS avg_sentiment
       FROM conversations c CROSS JOIN LATERAL ${topicKeys("c")} AS tk(key) GROUP BY 1 ORDER BY 2 DESC`,
    ),
    query<{ key: string; n: number }>(
      `SELECT channel AS key, count(*)::int AS n FROM conversations GROUP BY 1 ORDER BY 2 DESC`,
    ),
    query<{ n: number; labelled: number }>(
      `SELECT count(*)::int AS n, count(*) FILTER (WHERE sentiment IS NOT NULL)::int AS labelled FROM conversations`,
    ),
  ]);
  const m = Object.fromEntries(meta.map((r) => [r.key, r.value])) as Record<string, unknown>;
  // The UI words its engagement by platform ("discord"), in lower case whatever the manifest wrote.
  const source = m.source as { platform?: unknown } | undefined;
  if (source && typeof source.platform === "string")
    m.source = { ...source, platform: source.platform.toLowerCase() };
  const def = new Map(topicLabelsOf(m.topics).map((l) => [l.key, l]));
  // Everything but the topic list itself, which is given below with its counts.
  delete m.topics;
  return {
    meta: m,
    conversations: all?.n ?? 0,
    labelled: all?.labelled ?? 0,
    channels,
    topicsNote:
      `n is the number of conversations touching each topic. A conversation can have several topics, so these add up ` +
      `to more than the ${all?.n ?? 0} conversations, and shares by topic can add up to more than 100%.`,
    topics: topics.map((t) => ({
      ...t,
      name: def.get(t.key)?.name ?? t.key,
      description: def.get(t.key)?.description ?? "",
    })),
  };
}
