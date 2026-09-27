import "server-only";
import { decide, noul } from "@/lib/llm/decide";
import type { ModelMessage } from "ai";
import type { Profile } from "@/lib/data/profile";
import { questionsOf } from "./flags";

// Whether a question is one the community's conversations bear on, asked of Jev before an out_of_scope call is taken
// (eval run 7, 2026-09-26: "How do you aim the mortar?" was declined outright as general knowledge, while the
// community has a guide on exactly that). The model's own call is a judgment made once, on the wording alone; this
// is a second opinion on the same question, with the community's name and dates in front of it.
//
// Measured on 14 questions the same day: 7 the community bears on scored 0.59 to 0.96 ("How do you aim the mortar?"
// 0.94, a false premise about EU servers 0.59); 7 it does not (another game, January 2026, a company's revenue, pizza
// in Oslo, live server status, weather, the World Cup) scored 0.04 to 0.21. The bar sits between them.
export const SCOPE_BAR = 0.5;

const BEARS =
  "Could the `community`'s own conversations, dated `conversations_from` to `conversations_to`, bear on `question`: " +
  "members' experiences, opinions, advice, tips, reports or reactions on it? A how-to or advice question about the " +
  "thing the community is about bears on it, since members share how they do it. A question about something else " +
  "entirely, a time outside those dates, live status right now, or facts only an outside source holds (a company's " +
  "revenue, the weather, news) does not.";

// v1.1 QA (N1): in a chat, a question is read with the one before it, so "tell me more about the second one" or "why?"
// bears on the conversations as the question it follows did, and a poem or the weather asked mid-chat still does not.
const FOLLOWING =
  " `question` follows `earlier_question` in the same chat. A follow-up on it (more about something the answer said, a " +
  "detail, a reason, a shorter or clearer answer) bears on the conversations as `earlier_question` does; a request " +
  "for something else entirely (a poem, a story, the weather, general knowledge, small talk) does not, whatever came " +
  "before it.";

/** The probability that the conversations bear on the question, or null when the check could not be made. `earlier`:
 *  the reader's question before it in the chat, if any. */
export async function bearsOn(question: string, p: Profile, earlier?: string): Promise<number | null> {
  try {
    const r = await decide({
      state: {
        question,
        ...(earlier ? { earlier_question: earlier } : {}),
        community: `${p.community}${p.platform ? ` (${p.platform})` : ""}${p.about ? `: ${p.about}` : ""}`,
        conversations_from: p.from,
        conversations_to: p.to,
      },
      questions: { bears: noul(earlier ? BEARS + FOLLOWING : BEARS) },
    });
    return (r.answers.bears as { noul: number }).noul;
  } catch (e) {
    console.warn("scope check failed", String(e).slice(0, 200));
    return null;
  }
}

/** Whether the conversations bear on a turn's question, read with the reader's question before it in the chat: the one
 *  scope check every turn goes through, first or not, whether the model called out_of_scope (tools.ts) or answered
 *  with no tool at all (finish.ts, v1.1 QA N1). */
export function turnBearsOn(messages: ReadonlyArray<ModelMessage>, p: Profile): Promise<number | null> {
  const questions = questionsOf(messages);
  return bearsOn(questions.at(-1) ?? "", p, questions.at(-2));
}

/** An out_of_scope call the check turned down: the loop goes on, and the model is told to answer from the data. */
export type InScope = { status: "in-scope"; bears: number };
export const isInScope = (o: unknown): o is InScope =>
  typeof o === "object" && o !== null && (o as { status?: unknown }).status === "in-scope";

export const IN_SCOPE_WORDS =
  "Not out of scope: the community's conversations bear on this question, since its members share experiences, " +
  "opinions and advice on it. Answer it from them. Nothing has been read yet, so nothing is known about what people " +
  "said: call scan or find now, before writing a word, then answer with citations. A number or mood with no tool " +
  "result behind it is invented. If it asks " +
  "about another platform or community (Reddit, Steam, Twitter, the press), the answer's FIRST sentence says the " +
  "conversations cover only this community, not that platform, and what follows is named as this community's view. " +
  "out_of_scope is not available again this turn.";
