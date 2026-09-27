// Row shapes shared by the tools, the API routes and the UI. The database is db/schema.sql.

// Generic flags that hold for any product community. (The first build also labelled a domain-specific "cheating" flag;
// the column is kept in the database but no longer surfaced: topic labels are where domain categories belong.)
export const FLAGS = ["bug", "feature", "complaint", "help", "noise"] as const;
export type Flag = (typeof FLAGS)[number];

export type MessageRow = {
  id: string;
  ref: number; // cited as [msg<ref>] (db/schema.sql)
  kind: "post" | "comment";
  channel: string;
  thread_id: string;
  reply_to: string | null;
  conversation_id: string | null;
  in_window: boolean;
  author: string;
  ts: string;
  text: string;
  score: number;
  removed: boolean;
  is_bot: boolean;
};

/** A message as the UI needs it for a citation chip or a thread-map node: the text is cut to a preview. */
export type MessageRef = Omit<MessageRow, "text"> & { text: string };

export type ConversationRow = {
  id: string;
  ref: number; // the agent's handle for it: conv<ref>
  thread_id: string;
  thread_title: string;
  channel: string;
  kind: string;
  started_at: string;
  ended_at: string;
  n_messages: number;
  n_authors: number;
  score_sum: number;
  transcript: string;
  // Topics are multi-label (D46): `topics` is every topic the conversation touches, highest probability first, or
  // ["other"] when none applies; `topic` is its first (the primary) and `topic_conf` that one's probability.
  topics: string[];
  topic: string | null;
  topic_conf: number | null;
  sentiment: number | null;
  p_bug: number | null;
  p_feature: number | null;
  p_complaint: number | null;
  p_help: number | null;
  p_noise: number | null;
};

export type Filters = {
  channel?: string;
  topic?: string; // conversations touching this topic (a member of `topics`), not only those where it is primary
  since?: string; // ISO date, inclusive
  until?: string; // ISO date, exclusive
  flag?: Exclude<Flag, "noise">;
  author?: string; // conversations this person wrote a message in (messages.author: the public handle)
};

/** How a message is cited, and how a citation is read back. The prefix is ours, so it cannot be confused with
 * anything a player writes (M416 is a rifle, R1895 a revolver: a bare m or r prefix would be). DECISIONS D14. */
export const msgTag = (ref: number) => `msg${ref}`;
export const convTag = (ref: number) => `conv${ref}`;

/** The permalink back to the source, for readers who want it; null where the source has no public link (a Discord
 * export carries no invite). The app never needs it to show evidence. */
export function permalink(m: Pick<MessageRow, "id" | "thread_id">): string | null {
  if (!/^t[13]_/.test(m.id)) return null;
  const post = m.thread_id.replace(/^t3_/, "");
  return m.id.startsWith("t3_")
    ? `https://www.reddit.com/comments/${post}/`
    : `https://www.reddit.com/comments/${post}/_/${m.id.replace(/^t1_/, "")}/`;
}
