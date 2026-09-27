import type { ModelMessage } from "ai";

// A flag (bug, feature, complaint, help) is a kind of conversation, and narrowing a question to one silently answers a
// smaller question than the one asked: "how do players feel about the Rondo changes" read only complaint threads and
// said "mostly negative" (QA 2026-09-26). Whether the reader asked about a kind is read from their own words here, by
// the tools (to refuse a call narrowed to a kind the reader never asked about) and by the chart (components/chat/activity-words.ts pickChart,
// to draw only a slice the reader was told about). Pure, so it is unit-tested (flags.test.ts).
//
// The words are whole words, and each names the kind only where it means that kind: "the data suggest" is not a
// suggestion, "the new features" are not feature requests, "help me understand" is not a request for help (review
// 2026-09-26). English and Norwegian, because the reader may ask in either.

const FLAG_NAMES: Record<string, RegExp[]> = {
  // "frustrations" as a noun names complaints; "are players frustrated" asks how they feel (review 2026-09-26).
  complaint: [/\bcomplain(?:t|ts|s|ed|ing)?\b/i, /\bgripes?\b/i, /\bgrievances?\b/i, /\bfrustrations\b/i, /\bklag\w*/i],
  bug: [
    /\bbug(?:s|gy)?\b/i,
    /\bglitch(?:es|y)?\b/i,
    /\bcrash(?:es|ed|ing)?\b/i,
    /\b(?:issues?|problems?)\b[^.?!]{0,30}\breport/i, // "issues people report"
    /\breport\w*\b[^.?!]{0,20}\b(?:issues?|problems?)\b/i, // "reported problems"
    /\bfeil(?:en|ene)?\b/i,
  ],
  // A request names the kind only as a request noun or as what people request: "the requested changes" and "I wish to
  // know" name nothing, and "help requests" / "asking for help" are help, not feature requests (review 2026-09-26).
  feature: [
    /\b(?:feature|change) (?:requests?|ideas?|wish(?:es)?)\b/i,
    /\brequests? for\b(?! help\b)/i, // "requests for a new map"
    /\bmost[- ]requested\b/i,
    /\b(?:people|players|users|everyone|they|the community)(?: are| keep)? request(?:s|ed|ing)?\b(?! help\b)/i, // "what people request"
    /\basking for\b(?! help\b)/i,
    /\bsuggestions?\b/i,
    /\bwish(?:es|list)\b/i,
    /\bwant(?:s|ed)? (?:\w+ )?(?:changed|added|fixed)\b/i, // "want changed", "want the map changed"
    /(?<![\p{L}])ønsk\p{L}*/iu,
  ],
  help: [
    /\bfor help\b/i, // "ask for help", "look for help", "asking the mods for help"
    /\bhelp (?:requests?|threads?|questions?|channel)\b/i,
    /\brequest(?:s|ed|ing)? help\b/i, // "people request help"
    /\bneed(?:s|ed|ing)? help\b/i,
    /\bsupport questions?\b/i,
    /\b(?:om|etter) hjelp\b/i, // "ber om hjelp", "spør etter hjelp"
    /\btrenger (?:\p{L}+ )?hjelp\b/iu,
    /\bhjelpetråd\w*/i,
  ],
};

/** The flags a text names: "Among the complaint threads, …" names `complaint`. */
export function flagsNamed(text: string): Set<string> {
  return new Set(Object.keys(FLAG_NAMES).filter((f) => FLAG_NAMES[f].some((re) => re.test(text))));
}

// A follow-up leans on the question before it: "And in July?", "What about September?", "After the patch?". It carries
// that question's kind of conversation, so narrowing "And in July?" to the complaints the reader just asked about is
// what they asked. A full question starts afresh: "How do players feel about Rondo?" after a question about complaints
// asks about everyone.
//
// Review 2026-09-26: a follow-up leans on the question right before it only, never across a full question that named
// no kind ("And in July?" after "How do players feel about Rondo overall?" had taken the complaints from two questions
// back). "Now" and "then" open full questions as often as follow-ups ("Now, how did people react to 42.3?"), so they
// are not openers. A question about how people feel or who takes part is never narrowed, whatever opens it (D36).
// "Short" alone was not a follow-up either: "How do players feel?" and "Who is most active?" are four words. A short
// fragment is, when it does not open with a question word ("In July?", "September?"), or is one or two words ("Why?").
const FOLLOW_UP = /^\s*(?:and|also|same|what about|how about|og|hva med|samme)\b/i;
const QUESTION_WORD = /^\s*(?:how|who|what|why|which|when|where|is|are|was|were|do|does|did|can|could|has|have|will|would|should|hvordan|hvem|hva|hvorfor|hvilke|hvilken|når|hvor|er|var|har|kan|vil)\b/i;
const ABOUT_PEOPLE = /\b(?:feel\w*|react\w*|mood|think\w*|opinions?|views?|sentiment|who|whom|føl\w*|reag\w*|stemning\w*|synes|mener|tenk\w*|hvem)\b/i;
/** Whether a question leans on the one before it by its form alone: it opens with a follow-up word, or is a short
 *  fragment. What a read looks for uses this (followUpContext). */
function leansOnBefore(q: string): boolean {
  if (FOLLOW_UP.test(q)) return true;
  const words = q.trim().split(/\s+/).filter(Boolean).length;
  return words > 0 && (words <= 2 || (words <= 4 && !QUESTION_WORD.test(q)));
}
/** A follow-up for flags: one that leans on the question before, unless it asks how people feel or who takes part,
 *  which is never narrowed to a kind (D36). */
const isFollowUp = (q: string) => !ABOUT_PEOPLE.test(q) && leansOnBefore(q);

/** The words a question's kinds are read from: the latest question, and, when it is a follow-up that names no kind
 *  itself, the question right before it as that one was read (itself with the one it followed up, if it was a
 *  follow-up too). `questions` is oldest first. */
export function questionInContext(questions: ReadonlyArray<string>): string {
  const latest = questions.at(-1) ?? "";
  if (flagsNamed(latest).size || !isFollowUp(latest) || questions.length < 2) return latest;
  const before = questionInContext(questions.slice(0, -1));
  return flagsNamed(before).size ? `${before}\n${latest}` : latest;
}

/** The words a follow-up is about, whatever kind it names: the latest question, joined to the one before it (as that
 *  one was itself read) when it is a follow-up. "And in July?" after "What do people say about the new map?" is about
 *  the new map in July. questionInContext joins only a question that named a kind, which is right for flags and wrong
 *  for what a read looks for (review 2026-09-26: the forced read's ", " fallback scanned for "And in July?"). */
//
// Review 2026-09-26: it had used isFollowUp, whose feelings-and-people exclusion exists for flags, so "And how did they
// feel in July?" after "What do people say about the new map?" was read without the map. The subject still carries.
export function followUpContext(questions: ReadonlyArray<string>): string {
  const latest = questions.at(-1) ?? "";
  if (!leansOnBefore(latest) || questions.length < 2) return latest;
  return `${followUpContext(questions.slice(0, -1))}\n${latest}`;
}

const textOf = (m: ModelMessage) =>
  typeof m.content === "string" ? m.content : m.content.map((p) => (p.type === "text" ? p.text : "")).join(" ");

/** The reader's questions, oldest first, from the messages a tool call was made in. */
export function questionsOf(messages: ReadonlyArray<ModelMessage>): string[] {
  return messages.filter((m) => m.role === "user").map(textOf);
}

/** The reader's latest question, from the messages a tool call was made in. */
export function lastQuestion(messages: ReadonlyArray<ModelMessage>): string {
  return questionsOf(messages).at(-1) ?? "";
}

/** The flag a call narrowed to that the question (read with the one it follows up) never named, if any. The tools
 *  refuse such a call (lib/agent/tools.ts). */
export function unaskedFlag(flag: string | undefined, messages: ReadonlyArray<ModelMessage>): string | undefined {
  return flag && !flagsNamed(questionInContext(questionsOf(messages))).has(flag) ? flag : undefined;
}

// The words a refusal opens with (lib/agent/for-model.ts refusalWords), for the model.
export const REFUSED = "Not run:";

/** What a tool returns for a call it refused (lib/agent/tools.ts): a result, not a thrown error. Thrown, it reached the
 *  browser as the AI SDK's "An error occurred." and every refused call showed as a step that did not finish (review
 *  2026-09-26). As a result, the model reads `words` (toModelOutput) and the steps leave the call out
 *  (components/chat/activity-words.ts), live and in a saved chat alike. */
export type Refusal = { status: "refused"; flag: string; words: string };
export const isRefusal = (output: unknown): output is Refusal =>
  typeof output === "object" && output !== null && (output as { status?: unknown }).status === "refused";
