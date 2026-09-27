// Row shapes shared by the tools, the API routes and the UI. The database is db/schema.sql (docs/DESIGN.md).

// The flags the brief asks about (docs/DESIGN.md decision 4). "excited" and "frustrated" are the brief's own words;
// bug, feature and help are the kinds of conversation a community team acts on; noise is memes and chatter.
export const FLAGS = ["excited", "frustrated", "bug", "feature", "help", "noise"] as const;
export type Flag = (typeof FLAGS)[number];

export type MessageRow = {
  id: string;
  ref: number; // cited as [msg<ref>] (db/schema.sql)
  channel: string;
  thread_id: string | null; // the conversation it belongs to (= conversation_id): the evidence panel's thread
  reply_to: string | null;
  conversation_id: string | null;
  author: string;
  ts: string;
  text: string;
  n_reactions: number; // total reaction count on the message (Discord); reactions are sparse on this server
};

/** A message as the UI needs it for a citation chip or a thread-map node: the text is cut to a preview. */
export type MessageRef = Omit<MessageRow, "text"> & { text: string };

export type ConversationRow = {
  id: string;
  ref: number; // the agent's handle for it: conv<ref>
  thread_title: string; // what the reader calls it: "#channel: <its first line>" (filters.ts CONV_COLUMNS)
  channel: string;
  kind: string;
  started_at: string;
  ended_at: string;
  n_messages: number;
  n_authors: number;
  n_replies: number;
  n_reactions: number;
  engagement: number; // distinct authors + replies + reactions: what "resonating" is measured as (DESIGN.md 3)
  transcript: string;
  // Topics are multi-label: `topics` is every topic the conversation touches, highest probability first, or
  // ["other"] when none applies; `topic` is its first (the primary) and `topic_conf` that one's probability.
  // Labels arrive after the load, so these may be null (topics empty) on an unlabelled conversation.
  topics: string[];
  topic: string | null;
  topic_conf: number | null;
  sentiment: number | null;
  p_excited: number | null;
  p_frustrated: number | null;
  p_bug: number | null;
  p_feature: number | null;
  p_help: number | null;
  p_noise: number | null;
};

export type Filters = {
  channel?: string;
  topic?: string; // conversations touching this topic (a member of `topics`), not only those where it is primary
  since?: string; // ISO date, inclusive
  until?: string; // ISO date, exclusive
  flag?: Exclude<Flag, "noise">;
  author?: string; // conversations this person wrote a message in (messages.author: the pseudonym)
};

/** How a message is cited, and how a citation is read back. The prefix is ours, so it cannot be confused with
 * anything a player writes. */
export const msgTag = (ref: number) => `msg${ref}`;
export const convTag = (ref: number) => `conv${ref}`;

/** The link back to the source. A Discord export carries none, so there is never one; the app shows the message
 * itself in the evidence panel instead. Kept as a function so the UI has one place to ask. */
export function permalink(_m: Pick<MessageRow, "id">): string | null {
  return null;
}
