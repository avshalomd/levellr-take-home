import { evidenceOf, isToolPart } from "@/components/chat/evidence";
import type { ChatMessage } from "@/lib/agent/ui-types";
import { friendly } from "@/lib/llm/errors";

// What one turn sends the model from the chat so far, and what the reader is told when the model fails.

/** How many earlier questions, each with its answer, the model is sent with a new one. */
export const EXCHANGES = 6;

type Part = ChatMessage["parts"][number];

/** An answer the reader was given: it has words on screen (a kept revision's too). A failed or stopped turn that wrote
 *  nothing is not one. */
const answered = (m: ChatMessage) => evidenceOf(m).text.trim() !== "";

/**
 * The chat the model is sent: the last EXCHANGES questions that got an answer, each followed by that answer, then the
 * new question. It always starts at a question. QA P18: the last 12 messages of a chat of 13 started on an answer, and
 * an answer from the data opens with a tool call, which Gemini refuses unless a user turn comes before it, so from the
 * 7th question on a chat stopped answering. A question with no answer (it failed, or was stopped before a word) is left
 * out with its empty answer: sent, it read as a second question to answer, and two questions in a row are not a chat.
 * The verifier still reads every earlier tool result from the whole chat (agent.ts chatToolSteps); this is only what
 * the model is sent.
 */
export function chatWindow(messages: ChatMessage[], exchanges = EXCHANGES): ChatMessage[] {
  const question = messages.at(-1);
  if (!question) return [];
  const pairs: ChatMessage[][] = [];
  for (let i = 0; i < messages.length - 2; i++) {
    const [q, a] = [messages[i], messages[i + 1]];
    if (q.role === "user" && a.role === "assistant" && answered(a)) pairs.push([q, a]);
  }
  return [...pairs.slice(-exchanges).flat(), question];
}

/** An answer as the reader was shown it: its words (a kept revision's, citations as [msgN]) after the tool parts it
 *  read, or its words alone. */
function asShown(m: ChatMessage, withTools: boolean): ChatMessage {
  const words: Part = { type: "text", text: evidenceOf(m).text };
  if (!withTools || !m.parts.some((p) => isToolPart(p.type))) return { ...m, parts: [words] };
  // Each step's tool parts, in their steps, then one more step with the words, so they come after the last tool
  // result as they were written. A step whose only part was text is dropped with it.
  const parts: Part[] = [];
  for (const p of [...m.parts, { type: "step-start" } as Part])
    if (p.type === "step-start" ? parts.length && parts.at(-1)?.type !== "step-start" : isToolPart(p.type)) parts.push(p);
  return { ...m, parts: [{ type: "step-start" }, ...parts, words] };
}

/**
 * The window as the agent's model is sent it. The last answer keeps what its tools returned, so a follow-up ("which of
 * those are bugs?", "tell me more about the second one") can answer from it; the ones before are their words only. An
 * answer from a scan carries 130 to 530 KB of results (QA P18), and every later question sent them all again. The
 * checks after the agent are given the whole window with its tool results (route.ts), as before.
 */
export function slimWindow(window: ChatMessage[]): ChatMessage[] {
  const lastAnswer = window.findLastIndex((m) => m.role === "assistant");
  return window.map((m, i) => (m.role === "assistant" ? asShown(m, i === lastAnswer) : m));
}

/** Said when the model refuses a turn. The provider's own reason ("Please ensure that function call turn comes
 *  immediately after a user turn", QA P18) goes to the log: it tells the reader nothing they can do. */
export const MODEL_REFUSED = "The model could not answer this turn. Try again, or start a new chat.";

/** The chat's error line for a failed turn: the plain words lib/llm/errors.ts has for what a reader can act on (busy,
 *  allowance, too long), and MODEL_REFUSED for a provider's refusal. */
export function turnErrorWords(e: unknown): string {
  const words = friendly(e);
  if (!words.startsWith("The model could not answer:")) return words;
  console.error("chat failed", words, e);
  return MODEL_REFUSED;
}
