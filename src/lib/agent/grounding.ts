import { isRefusal } from "./flags";
import { isOffTopic } from "./off-topic";

// Whether an answer stands on messages the reader can open. QA 2026-09-26: "What are people complaining about most in
// September?" came back as five points quoting thread titles and a cause, with no citation chip and no "Checked:" line
// under it, and "And in July?" the same. The turn had counted, and an answer with no citations was never checked
// (D27: a refusal needs no check), so nothing on screen said it rested on nothing. A rule in the instructions alone
// has not held in earlier rounds, so three things in code:
//   1. a turn that has only counted may not answer yet when its question asks what people say: the next step must read
//      (needsRead, applied in agent.ts prepareStep);
//   2. an answer that read messages and still cites none is sent back once to cite them (lib/agent/revise.ts
//      citeAnswer, from the route);
//   3. whatever is still uncited says so under it: "Counts only: no messages are cited, so this was not checked."
// Pure, so every rule here is tested (grounding.test.ts).

type StepLike = { content: ReadonlyArray<unknown> };
type Part = { type: string; toolName?: string; output?: unknown };

const READS = new Set(["scan", "find", "read_conversation"]);
const COUNTS = new Set(["aggregate", "voices"]);

/** The tools a turn used and got a real result from: a refusal read nothing, and an error returned nothing. */
export function toolsUsed(steps: ReadonlyArray<StepLike>): { read: boolean; counted: boolean; offTopic: string | null } {
  let read = false;
  let counted = false;
  let offTopic: string | null = null;
  for (const s of steps)
    for (const part of s.content) {
      const p = part as Part;
      if (p.type !== "tool-result" || !p.toolName || isRefusal(p.output)) continue;
      if (isOffTopic(p.output)) offTopic = p.output.text;
      else if (p.toolName === "scan") read ||= (p.output as { status?: string } | null)?.status === "ok";
      // A search that found nothing read nothing (review 2026-09-26): it had counted as a read, so an answer resting
      // on counts and an empty search was sent to the cite pass and read as "not checked" rather than "counts only".
      else if (p.toolName === "find") read ||= ((p.output as { hits?: unknown[] } | null)?.hits?.length ?? 0) > 0;
      else if (READS.has(p.toolName)) read ||= Boolean(p.output);
      else if (COUNTS.has(p.toolName)) counted = true;
    }
  return { read, counted, offTopic };
}

// A question that asks only for numbers is answered by a count, and an answer of numbers has nothing to cite. Every
// other question asks what people say, and an answer to it points to their messages.
const NUMBERS_ONLY =
  /\b(?:how many|how much|how often|number of|count(?:s|ed)?|trends?|share|percent(?:age)?|per cent|proportion|average|grew|grow(?:n|ing)?|rose|fell|week by week|over time|hvor mange|antall|andel)\b/i;
/** Whether a question asks what people say, not only how many. */
export const asksWhatPeopleSay = (question: string) => !NUMBERS_ONLY.test(question);

/** Whether the turn has tried to read at all: any call to a reading tool, whatever came of it (a refusal, a failure,
 *  an empty or too-broad slice). */
export function triedToRead(steps: ReadonlyArray<StepLike>): boolean {
  return steps.some((s) => s.content.some((part) => READS.has((part as Part).toolName ?? "") && /^tool-(?:call|result|error)$/.test((part as Part).type)));
}

/** Whether the next step must read before answering: the turn has counted, has not tried to read, and the question
 *  asks what people say. The agent then offers the model only the reading tools, and requires a call (agent.ts).
 *  At most once a turn (review 2026-09-26): forced again after a read that failed twice, found nothing, was too broad
 *  or was refused, the model looped on reads to the step budget. One forced try, then the answer says what it has. */
export function needsRead(steps: ReadonlyArray<StepLike>, question: string): boolean {
  const used = toolsUsed(steps);
  return used.counted && !used.read && !used.offTopic && !triedToRead(steps) && asksWhatPeopleSay(question);
}

export type Grounding = { kind: "cited" } | { kind: "off-topic"; text: string } | { kind: "uncited"; read: boolean } | { kind: "none" };

/** How an answer stands. `cites` is whether it has citations. An answer that used no tool (a question back, a greeting)
 *  has nothing that could have been cited, and says nothing under it. */
export function groundingOf(cites: boolean, steps: ReadonlyArray<StepLike>): Grounding {
  const used = toolsUsed(steps);
  if (used.offTopic) return { kind: "off-topic", text: used.offTopic };
  if (cites) return { kind: "cited" };
  if (used.read || used.counted) return { kind: "uncited", read: used.read };
  return { kind: "none" };
}
