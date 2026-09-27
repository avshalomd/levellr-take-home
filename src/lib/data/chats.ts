import "server-only";
import type { ChatMessage } from "@/lib/agent/ui-types";
import { query } from "./db";

// Saved chats (db/app.sql). Every read and write is scoped to the owner, so an id guessed from someone else's URL
// returns nothing.

export type ChatSummary = { id: string; title: string; updated_at: string };

export const listChats = (owner: string) =>
  query<ChatSummary>(`SELECT id, title, updated_at FROM chats WHERE owner = $1 ORDER BY updated_at DESC LIMIT 100`, [owner]);

// A turn is one question and its answer, named by the question's message id. A chat is saved twice a turn: when the
// question arrives, so a reload while the answer is being written finds the question, and when the answer is done.
// The second save lands only while its turn is still the chat's latest, so an answer that finishes after the reader
// stopped it (or asked again) never writes over what came after.

/** How long a question with no answer yet counts as being answered: the route's limit (maxDuration 300 s), plus slack. */
export const ANSWER_WINDOW_S = 330;

export type SavedChat = { id: string; title: string; messages: ChatMessage[]; answering: boolean };

export async function getChat(id: string, owner: string): Promise<SavedChat | null> {
  const [row] = await query<SavedChat>(
    `SELECT id, title, messages,
            (turn IS NOT NULL AND messages -> -1 ->> 'role' = 'user' AND updated_at > now() - make_interval(secs => $3)) AS answering
     FROM chats WHERE id = $1 AND owner = $2`,
    [id, owner, ANSWER_WINDOW_S],
  );
  return row ?? null;
}

/** The title is a question the reader asked, cut at a word boundary: no model call, and it never says anything the
 *  user did not. It is the first question the agent answered from the data - one whose answer used a tool - and the
 *  first question until there is one: a chat opened with "What's a good pizza place in Oslo?" (declined, no tool)
 *  kept that name in the sidebar after a real question was answered in it (QA 2026-09-26). Once a question has been
 *  answered from the data the title stays put, since later turns come after it. */
export function titleOf(messages: ChatMessage[]): string {
  const answered = messages.find((m, i) => m.role === "user" && messages[i + 1]?.role === "assistant" && messages[i + 1].parts.some(readTheData));
  const first = answered ?? messages.find((m) => m.role === "user");
  const text = (first?.parts.find((p) => p.type === "text") as { text?: string } | undefined)?.text?.trim() ?? "New chat";
  if (text.length <= 64) return text;
  const cut = text.slice(0, 64);
  return cut.slice(0, cut.lastIndexOf(" ") > 40 ? cut.lastIndexOf(" ") : 64) + "…";
}

// A step that read the data: a finished call to a tool that reads conversations. A look at what the data covers or a
// call that failed answered nothing from the data, and named the chat after a question the agent never answered from
// it (reference review). This repo's tools have no refused results, so the reference's refusal check is not carried.
const READERS = new Set(["tool-scan", "tool-find", "tool-aggregate", "tool-voices", "tool-read_conversation"]);
const readTheData = (p: ChatMessage["parts"][number]) =>
  READERS.has(p.type) && "state" in p && p.state === "output-available" && Boolean(p.output);

// The id of a saved chat's latest question, in SQL.
const LATEST_QUESTION = `(SELECT e ->> 'id' FROM jsonb_array_elements(chats.messages) WITH ORDINALITY AS t(e, n)
                          WHERE e ->> 'role' = 'user' ORDER BY n DESC LIMIT 1)`;

const latestQuestion = (messages: ChatMessage[]) => messages.findLast((m) => m.role === "user")?.id ?? null;

/**
 * A question arrives: the chat is saved with it, and this turn becomes the one being answered. An id already owned by
 * someone else is left alone, never overwritten. `asked` is a question sent for the first time (not an "Ask again"):
 * when the reader stopped it before this save landed, their Stop is already saved (keepChat) and this late write of
 * the same question must not wipe it.
 */
export async function startTurn(id: string, owner: string, messages: ChatMessage[], turn: string, asked = true): Promise<void> {
  await query(
    `INSERT INTO chats (id, owner, title, messages, turn) VALUES ($1, $2, $3, $4::jsonb, $5)
     ON CONFLICT (id) DO UPDATE SET messages = EXCLUDED.messages, turn = EXCLUDED.turn, updated_at = now()
     WHERE chats.owner = EXCLUDED.owner
       AND NOT ($6 AND chats.turn IS NULL AND chats.messages -> -1 -> 'metadata' ? 'stopped'
                AND ${LATEST_QUESTION} IS NOT DISTINCT FROM $7)`,
    [id, owner, titleOf(messages), JSON.stringify(messages), turn, asked, latestQuestion(messages)],
  );
}

/** Its answer is done: saved, but only if this turn is still the chat's latest. The title is written again, since
 *  an answer from the data can name the chat (titleOf). */
export async function finishTurn(id: string, owner: string, messages: ChatMessage[], turn: string): Promise<void> {
  await query(`UPDATE chats SET messages = $3::jsonb, title = $5, turn = NULL, updated_at = now() WHERE id = $1 AND owner = $2 AND turn = $4`, [
    id,
    owner,
    JSON.stringify(messages),
    turn,
    titleOf(messages),
  ]);
}

/** The reader stopped an answer: the chat as their screen shows it, and the answer still running on the server is
 *  no longer the chat's turn, so it is not saved over this. It lands only while the stopped question is still the
 *  chat's latest: a Stop that reaches the server after the next question was asked must not erase that question. A
 *  Stop pressed so early that the question's own save has not landed yet saves the chat itself (see startTurn). */
export async function keepChat(id: string, owner: string, messages: ChatMessage[]): Promise<void> {
  await query(
    `INSERT INTO chats (id, owner, title, messages, turn) VALUES ($1, $2, $3, $4::jsonb, NULL)
     ON CONFLICT (id) DO UPDATE SET messages = EXCLUDED.messages, turn = NULL, updated_at = now()
     WHERE chats.owner = EXCLUDED.owner AND ${LATEST_QUESTION} IS NOT DISTINCT FROM $5`,
    [id, owner, titleOf(messages), JSON.stringify(messages), latestQuestion(messages)],
  );
}

export const deleteChat = (id: string, owner: string) => query(`DELETE FROM chats WHERE id = $1 AND owner = $2`, [id, owner]);
