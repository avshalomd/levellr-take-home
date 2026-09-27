import type { CorroborationPart, CorroboratedClaim } from "@/lib/agent/corroborate";
import type { RevisionPart } from "@/lib/agent/revise";
import { isRefusal } from "@/lib/agent/flags";
import { claimText, pruneWeak, sentencesOf } from "@/lib/claims";
import { plainClaim } from "./verification-words";
import type { ChatMessage, VerificationPart } from "@/lib/agent/ui-types";
import type { MessageRef } from "@/lib/data/types";
import { withoutDates } from "@/lib/dates-in-text";
import { CITE_RE, citedTags, msgTag, normalizeCitations, tagsIn } from "@/lib/refs";

// Everything the UI knows about the evidence behind one assistant message, derived from its streamed parts:
// the messages the tools returned (so a citation chip can show its author, time and text the moment its id
// streams), which conversations were read, the citation order, and each citation's verification result.

export type Ref = MessageRef & { relevance?: number | null; threadTitle?: string };

// Everything is keyed by the citation tag (msg1234), the one handle the answer, the verifier and the thread share.
export type Evidence = {
  refs: Map<string, Ref>;
  retrievedConversations: Set<string>;
  cited: string[]; // tags in order of first citation, the hidden ones left out; the chip number is index + 1
  support: Map<string, { support: number | null; status: string }>;
  verification?: VerificationPart;
  revision?: RevisionPart;
  corroboration?: CorroborationPart;
  text: string;
};

// A number's provenance tag, [scan] or [aggregate]: the tool step the number came from.
// A free model that has run out of tool calls sometimes writes its own function-call syntax as the answer
// (`<dots_function_call><invoke name="find">…`). It is never meant for the reader; an unclosed block is cut to the end.
const TOOL_MARKUP_RE = /<(\w+_)?function_calls?>[\s\S]*?(<\/(\w+_)?function_calls?>|$)/g;
export const stripToolMarkup = (s: string) => s.replace(TOOL_MARKUP_RE, "");

export const TOOL_TAG_RE = /\[(scan|aggregate|find|voices)\]/g;

// A number written as digits, or as a count word ("three of the five topics", "hundreds of players", "a third of
// threads", "40 percent"). Review 2026-09-26: count words like "hundreds" and "a third" were missed, so their tag was
// dropped; and a date, a release number or "no one" counted, so "after the 9 September patch [scan]" and "No one liked
// the patch [scan]" kept a tag that pointed at no number. Digits inside dates and release numbers are taken out first
// (lib/dates-in-text.ts).
const COUNT_WORD = new RegExp(
  [
    String.raw`(?<!\bno[\s-])\bone\b`, // "one of them", not "no one"
    String.raw`\b(?:two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b`,
    String.raw`\b(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\b`,
    String.raw`\b(?:dozens?|hundreds?|thousands?|millions?|half|per ?cent)\b`,
    String.raw`\b(?:a|one|two)[\s-](?:thirds?|quarters?)\b`, // "a third of threads", not "the third patch"
    "%",
  ].join("|"),
  "i",
);
const statesANumber = (s: string) => /\d/.test(withoutDates(s)) || COUNT_WORD.test(s);

/** A tool tag stays only in a sentence that states a number (QA 2026-09-26, production): the tag becomes "Show where
 *  this number comes from", and on "Most of the complaints were about lag [scan]." it pointed at a number that was not
 *  there. Elsewhere it is dropped with the space before it. Pure, tested in evidence.test.ts. */
export function numberTagsOnly(text: string): string {
  const bare = (s: string) => s.replace(TOOL_TAG_RE, "").replace(/\[[^\]]*\]/g, "");
  const ONE_TAG = /\[(?:scan|aggregate|find|voices)\]/;
  return text
    .split("\n")
    .map((line) => {
      const out = sentencesOf(line);
      for (let i = 0; i < out.length; i++) {
        if (statesANumber(bare(out[i]))) continue;
        const tags = out[i].match(TOOL_TAG_RE) ?? [];
        out[i] = out[i].replace(/\s*\[(?:scan|aggregate|find|voices)\]/g, "");
        // (production QA 2026-09-26: in "fell by about half, 11.8 to 6.2 a day. It is quieter now [aggregate]." the tag
        // was dropped and the figures were left with none.) A tag written one sentence late goes back onto the sentence
        // before it, when that one states a number and has no tag of its own.
        const prev = out[i - 1];
        if (tags.length && prev !== undefined && statesANumber(bare(prev)) && !ONE_TAG.test(prev))
          out[i - 1] = prev.replace(/([.!?]*)(\s*)$/, ` ${tags.join(" ")}$1$2`);
      }
      return out.join("");
    })
    .join("\n");
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Two marks of the prose the reader should not see (production QA 2026-09-26), put right in code as a backstop to the
 *  instructions: a fall written with a hyphen ("-48%") gets a minus sign ("−48%"), and an ISO date ("2026-09-09") is
 *  written as words ("9 September 2026"; the year kept, since a question can be about another year). Code spans are
 *  left as written, and a date inside a link or a path (after "/", "=" or a letter) is not prose. Pure, tested in
 *  evidence.test.ts; used by the page and by the post-agent pipeline (lib/agent/finish.ts), so both read the same. */
export function proseMarks(text: string): string {
  return text
    .split(/(`[^`]*`)/)
    .map((part, i) =>
      i % 2
        ? part
        : part
            .replace(/(^|[\s(])[-–](?=\d+(?:\.\d+)?\s?%)/g, "$1−")
            .replace(/(?<![\w/=.-])(\d{4})-(\d{2})-(\d{2})(?![\w/-])/g, (all, y: string, m: string, d: string) =>
              Number(m) >= 1 && Number(m) <= 12 && Number(d) >= 1 && Number(d) <= 31 ? `${Number(d)} ${MONTH_NAMES[Number(m) - 1]} ${y}` : all,
            ),
    )
    .join("");
}

/** Text that opens with punctuation: a glyph or chip before it gives up its right margin, so the mark hugs it. */
export const PUNCTUATION_NEXT = /^[.,;:!?)]/;

/** Text and tool tags in order, with the space before each tag dropped: the tag renders as a glyph with its own
 *  margin, so "relevant [aggregate]." must not come out as "relevant ▮ ." A tag that punctuation follows is marked
 *  `hug`: the glyph then gives up its right margin, or ", and" would still stand a space's width away (QA 2026-09-25). */
export function splitToolTags(s: string): { text?: string; tag?: string; hug?: boolean }[] {
  const parts = s.split(TOOL_TAG_RE);
  return parts.flatMap((part, i): { text?: string; tag?: string; hug?: boolean }[] => {
    if (i % 2 === 1) return [PUNCTUATION_NEXT.test(parts[i + 1]) ? { tag: part, hug: true } : { tag: part }];
    const text = i < parts.length - 1 ? part.replace(/\s+$/, "") : part;
    return text ? [{ text }] : [];
  });
}


/** The text before a citation that is not shown. Its trailing space goes when punctuation, a space or the end
 *  follows, so "release [scan] [hidden]." reads "release ▮." and not "release ▮ ." (QA 2026-09-25). */
export function beforeDroppedCitation(before: string, after: string): string {
  return /^(?:[\s.,;:!?)]|$)/.test(after) ? before.replace(/\s+$/, "") : before;
}

/** The answer's words: each step's text, the steps joined on a blank line. The one join the reader's page and the
 *  post-agent pipeline both use (lib/agent/finish.ts stepsText). Review 2026-09-26: the pipeline read only the last
 *  step's text (AI SDK 7's result.text) while the page showed every step's, so a claim written before a tool call was
 *  shown and never checked, and a cite pass on a short last line replaced the whole answer. The page had joined the
 *  steps with nothing, which ran "…the servers.Lag rose…" into one sentence. */
export function answerText(stepTexts: ReadonlyArray<string>): string {
  return stepTexts.filter((t) => t.trim()).join("\n\n");
}

/** A tool part, in a saved message ("tool-scan", "dynamic-tool") or in a step's content ("tool-call", "tool-result").
 *  The answer is the text written after the last of them: text written before a tool call, in its step or an earlier
 *  one, is a draft the model went on from, never the answer (eval 2026-09-27, O02: "…60/100 [aggregate]" written
 *  beside an out_of_scope call stayed in the final answer, above the one written after reading). The page
 *  (evidenceOf) and the post-agent pipeline (lib/agent/finish.ts stepsText) both cut here. */
export const isToolPart = (type: string) => type.startsWith("tool-") || type === "dynamic-tool";

type HitLike = { id: string; thread_title: string; relevance: number | null; messages: MessageRef[] };

export function evidenceOf(message: ChatMessage): Evidence {
  const refs = new Map<string, Ref>();
  const retrievedConversations = new Set<string>();
  const stepTexts = [""];
  let verification: VerificationPart | undefined;
  let revision: RevisionPart | undefined;
  let corroboration: CorroborationPart | undefined;

  const addHits = (hits: HitLike[]) => {
    for (const h of hits) {
      retrievedConversations.add(h.id);
      for (const m of h.messages) refs.set(msgTag(m.ref), { ...m, relevance: h.relevance, threadTitle: h.thread_title });
    }
  };

  for (const part of message.parts) {
    // Text before a tool call is a draft, never the answer (isToolPart).
    if (isToolPart(part.type)) stepTexts.splice(0, stepTexts.length, "");
    if (part.type === "step-start") stepTexts.push("");
    else if (part.type === "text") stepTexts[stepTexts.length - 1] += part.text;
    else if (part.type === "data-verification") verification = part.data;
    else if (part.type === "data-revision") revision = part.data;
    else if (part.type === "data-corroboration") corroboration = part.data;
    else if (part.type === "tool-scan" && part.state === "output-available" && part.output.status === "ok") addHits(part.output.hits);
    else if (part.type === "tool-find" && part.state === "output-available" && !isRefusal(part.output)) addHits(part.output.hits);
    else if (part.type === "tool-read_conversation" && part.state === "output-available" && part.output) {
      const c = part.output;
      retrievedConversations.add(c.id);
      for (const m of c.messages) refs.set(msgTag(m.ref), { ...m, threadTitle: c.thread_title });
    }
  }

  const support = new Map<string, { support: number | null; status: string }>();
  if (verification?.status === "done")
    for (const claim of verification.claims)
      for (const c of claim.citations) {
        const prev = support.get(c.id);
        if (!prev || (c.support ?? -1) > (prev.support ?? -1)) support.set(c.id, { support: c.support, status: c.status });
      }

  // The messages behind "+N more say this" open in the thread view like any citation, so they are refs too.
  if (corroboration?.status === "done")
    for (const c of corroboration.claims)
      for (const m of c.more) if (!refs.has(msgTag(m.ref))) refs.set(msgTag(m.ref), { ...m, relevance: m.support });

  // A corrected answer replaces the streamed one once the check has kept it. A citation to a message that does not
  // exist is dropped from the text: it points at nothing the reader could open, so it is never shown. Within a claim
  // that a checked citation backs, the ones that do not back it are left out (lib/claims.ts pruneWeak, D22).
  let text = answerText(stepTexts);
  if (revision?.status === "done" && revision.kept) text = revision.text;
  // A rewrite running after a kept cite pass carries the cited text, which stays on screen (lib/agent/finish.ts afterCite).
  else if (revision?.status === "running" && revision.text) text = revision.text;
  const unknown = new Set([...support].filter(([, s]) => s.status === "unknown-id").map(([id]) => id));
  text = numberTagsOnly(proseMarks(normalizeCitations(stripToolMarkup(text))));
  if (verification?.status === "done") text = pruneWeak(text, verification.claims);
  text = dropCitations(hidePartialCitation(text), unknown);
  text = onePerConversation(text, (tag) => refs.get(tag)?.conversation_id, support);
  const cited = citedTags(text);

  return { refs, retrievedConversations, cited, support, verification, revision, corroboration, text };
}

/**
 * Within one sentence, one chip per conversation: the best-backed of its messages, else the first. A chip is a message,
 * "+N more" and the panel count conversations, and two chips from one conversation beside "+3 more" read as 3 + 3
 * under a panel saying "5 conversations say this. 2 are cited" (QA 2026-09-26). With one chip per conversation, the
 * chips are the cited conversations and the three numbers add up. The other message is still in the thread the chip
 * opens. A tag whose conversation is not known yet (still streaming) is kept.
 */
export function onePerConversation(
  text: string,
  conversationOf: (tag: string) => string | null | undefined,
  support: Map<string, { support: number | null }> = new Map(),
): string {
  const score = (tag: string) => support.get(tag)?.support ?? -1;
  return text
    .split("\n")
    .map((line) =>
      sentencesOf(line)
        .map((sentence) => {
          const best = new Map<string, string>(); // conversation -> the tag kept for it
          for (const m of sentence.matchAll(CITE_RE))
            for (const tag of tagsIn(m[1])) {
              const conv = conversationOf(tag);
              if (!conv) continue;
              const kept = best.get(conv);
              if (!kept || score(tag) > score(kept)) best.set(conv, tag);
            }
          const drop = new Set(
            [...sentence.matchAll(CITE_RE)].flatMap((m) => tagsIn(m[1])).filter((t) => {
              const conv = conversationOf(t);
              return conv ? best.get(conv) !== t : false;
            }),
          );
          return dropCitations(sentence, drop);
        })
        .join(""),
    )
    .join("\n");
}

/** Remove the given tags from every citation group; a group left empty goes, with the space before it. */
export function dropCitations(text: string, drop: Set<string>): string {
  if (!drop.size) return text;
  return text.replace(/(\s*)\[(msg\d+(?:, msg\d+)*)\]/g, (_, space: string, group: string) => {
    const keep = tagsIn(group).filter((t) => !drop.has(t));
    return keep.length ? `${space}[${keep.join(", ")}]` : "";
  });
}

/** A citation still streaming ("…the patch [msg12") is held back until it completes, instead of flashing as text. */
export const hidePartialCitation = (text: string) => text.replace(/\s*\[(?:m(?:s(?:g[\d, msg]*)?)?)?$/, "");

// The verifier's own bar (lib/agent/verify.ts SUPPORTED): a citation at or above it backs its sentence.
const BACKED = 0.5;

/** How a citation reads to the reader: backed, only partly backed, or not checked yet. Never an alarm. */
export function supportLevel(s: { support: number | null; status: string } | undefined): "backed" | "weak" | "pending" {
  if (!s || s.support === null) return "pending";
  return s.support >= BACKED ? "backed" : "weak";
}

// Spelled out rather than Intl: ICU versions disagree on "Sep" and "Sept", and the server and the browser must print
// the same date or React sees a mismatch.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "9 Sep"; with the year, "9 Sep 2026". Dates in the data are UTC, so they are shown in UTC. */
export function shortDate(iso: string, withYear = false): string {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${withYear ? ` ${d.getUTCFullYear()}` : ""}`;
}

/** A claim's words for matching a rendered sentence to its checked claim: no citations, no markdown, one space. */
const claimWords = (s: string) => plainClaim(claimText(s)).replace(/\s+/g, " ").trim();

/** The corroboration of the claim a sentence cites: the checked claim with the sentence's own words (`sentence`, as
 *  the reader sees it), else the one citing exactly its chips, else the first sharing a chip with it. Matched by tags
 *  alone, two sentences citing exactly [msg1] both showed the first one's "+N more" (review 2026-09-26); the text is
 *  what tells them apart, as it is for pruneWeak (lib/claims.ts). `tags` are the chips the sentence shows. */
export function corroborationFor(e: Evidence, tags: string[], sentence?: string): CorroboratedClaim | undefined {
  if (e.corroboration?.status !== "done" || !tags.length) return undefined;
  const claims = e.corroboration.claims;
  const words = sentence === undefined ? "" : claimWords(sentence);
  const said = words ? claims.find((c) => claimWords(c.claim) === words) : undefined;
  const same = (c: CorroboratedClaim) => c.tags.length === tags.length && c.tags.every((t) => tags.includes(t));
  return said ?? claims.find(same) ?? claims.find((c) => c.tags.some((t) => tags.includes(t)));
}
