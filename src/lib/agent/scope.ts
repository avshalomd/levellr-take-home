import "server-only";
import { decide, noul } from "@/lib/llm/decide";
import type { Profile } from "@/lib/data/profile";

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

/** The probability that the conversations bear on the question, or null when the check could not be made. */
export async function bearsOn(question: string, p: Profile): Promise<number | null> {
  try {
    const r = await decide({
      state: {
        question,
        community: `${p.community}${p.platform ? ` (${p.platform})` : ""}${p.about ? `: ${p.about}` : ""}`,
        conversations_from: p.from,
        conversations_to: p.to,
      },
      questions: { bears: noul(BEARS) },
    });
    return (r.answers.bears as { noul: number }).noul;
  } catch (e) {
    console.warn("scope check failed", String(e).slice(0, 200));
    return null;
  }
}

/** An out_of_scope call the check turned down: the loop goes on, and the model is told to answer from the data. */
export type InScope = { status: "in-scope"; bears: number };
export const isInScope = (o: unknown): o is InScope =>
  typeof o === "object" && o !== null && (o as { status?: unknown }).status === "in-scope";

export const IN_SCOPE_WORDS =
  "Not out of scope: the community's conversations bear on this question, since its members share experiences, " +
  "opinions and advice on it. Answer it from them: search or read first, then answer with citations. out_of_scope " +
  "is not available again this turn.";
