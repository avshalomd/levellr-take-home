// Short refs: how the agent cites a message ([msg1234]) and names a conversation (conv123). The numbers are ours,
// assigned at load time in time order (db/schema.sql), so the model copies a short token instead of a raw id (msg_000054),
// and anything that still slips through can be found and tidied. DECISIONS D14.
//
// Shared by the server (verifier, route, eval) and the browser (chips), so it carries no server-only imports.

import { withoutTimeWords } from "./dates-in-text";

export const msgTag = (ref: number) => `msg${ref}`;
export const convTag = (ref: number) => `conv${ref}`;
export const refOfTag = (tag: string): number | null => {
  const m = /^msg(\d+)$/i.exec(tag.trim());
  return m ? Number(m[1]) : null;
};

/** One citation group as the answer carries it after normalizeCitations: [msg12] or [msg12, msg40]. */
export const CITE_RE = /\[(msg\d+(?:, msg\d+)*)\]/g;
export const tagsIn = (group: string) => group.split(", ");

const GROUP = String.raw`msg\d+(?:\s*[,;/&]\s*(?:and\s+)?msg\d+)*`;
const LIST_SPLIT = /\s*[,;/&]\s*(?:and\s+)?/;
const tidyGroup = (g: string) => `[${g.split(LIST_SPLIT).map((t) => t.toLowerCase()).join(", ")}]`;

// The tool tags an answer carries after a number (components/chat/evidence.ts TOOL_TAG_RE).
const TOOL_WORD = /^(?:scan|aggregate|find|voices)$/i;
// Words that only point at the ref or say which turn it came from: "(see msg12)", "(e.g. msg12)", "(msg12, from the
// last turn)".
const POINTER = /\b(?:see|e\.g\.?|cf\.?|and|from|in|on|posted|dated|above|(?:the\s+|an?\s+)?(?:earlier|last|previous|prior)\s+(?:turn|answer|reply|question))\b/gi;

/** A bracket or parenthesis holding refs and other words, the inside of it. When everything besides the refs only says
 *  when (a month, a date, a dash) it becomes the refs' citation: "[msg41525 — Sept]" -> "[msg41525]". Review
 *  2026-09-26: the words were all dropped, so "(212 of 840 conversations, msg12)" lost its count, "[scan, msg12]" its
 *  tag and "(as msg12 put it, love the map)" its sentence. So a tool tag stays a tag ("[scan] [msg12]"), and any other
 *  words stay where they were, in parentheses, with the refs left for the bare-ref pass to make citations of:
 *  "(212 of 840 conversations, [msg12])". Digits are never dropped, except inside a date. */
function decoratedGroup(inner: string): string {
  const refs = (inner.match(/\bmsg\d+\b/gi) ?? []).map((t) => t.toLowerCase());
  const items = inner.split(/\s*[,;]\s*/).filter((i) => i.trim());
  const tags = items.filter((i) => TOOL_WORD.test(i.trim())).map((i) => `[${i.trim().toLowerCase()}] `);
  // a tool name or other snake_case token beside the refs ("[dataset_overview, msg12]") is never shown
  const rest = items.filter((i) => !TOOL_WORD.test(i.trim()) && !/^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/i.test(i.trim()));
  const onlyWhen = rest.every(
    (i) => !withoutTimeWords(i).replace(/\bmsg\d+\b/gi, "").replace(POINTER, "").replace(/[\s.:/&—–-]+/g, ""),
  );
  if (onlyWhen) return `${tags.join("")}[${refs.join(", ")}]`;
  return `(${rest.map((i) => i.trim()).join(", ")})${tags.map((t) => ` ${t.trim()}`).join("")}`;
}

/**
 * Everything a model writes when it half-follows the citation format, turned into the one shape the app renders,
 * and every id the reader should never see removed:
 *  - [msg12,msg40] / [msg12; msg40] / (msg12) / (msg12, msg40) / a bare msg12  ->  [msg12] / [msg12, msg40]
 *  - [MSG12] -> [msg12]
 *  - [msg12 — Sept] / [msg12, Sept] / (see msg12)  ->  [msg12]
 *  - [scan, msg12] -> [scan] [msg12];  (212 of 840 conversations, msg12) -> (212 of 840 conversations, [msg12])
 *  - a raw message id (msg_000054), bracketed or not, and a conversation handle (conv123)  ->  removed
 * Idempotent, and safe to run on a half-streamed answer ("[msg1" stays as it is until it completes).
 */
export function normalizeCitations(text: string): string {
  let s = text
    // a bracketed tool name or other snake_case token, never a citation: "[dataset_overview]" (production QA
    // 2026-09-26); the step tags ([scan], [aggregate]…) are one word and stay; a link's text ("[a_b](url)") stays
    .replace(/\s*\[\s*[a-z][a-z0-9]*(?:_[a-z0-9]+)+\s*\](?!\()/gi, "")
    // raw ids and conversation handles, with their brackets or parentheses when they stand alone in them
    .replace(/\s*[[(]\s*(?:(?:msg_\d{3,}|conv\d+)\s*[,;]?\s*)+[\])]/gi, "")
    .replace(/\b(?:msg_\d{3,}|conv\d+)\b/gi, "")
    .replace(/\s*,\s*(?=[\])])/g, "")
    .replace(/([[(])\s*,\s*/g, "$1")
    // a group with words beside its refs (QA 2026-09-26: "[msg41525 — Sept]" stayed on screen as raw text)
    .replace(/[[(]([^[\]()\n]*?\bmsg\d+\b[^[\]()\n]*?)[\])]/gi, (_all, inner: string) => decoratedGroup(inner))
    // a citation in parentheses or with loose separators inside brackets
    .replace(new RegExp(String.raw`[[(]\s*(${GROUP})\s*[\])]`, "gi"), (_, g: string) => tidyGroup(g));
  // bare refs outside any bracket: protect the bracketed ones, then wrap the rest
  const kept: string[] = [];
  s = s.replace(/\[[^\]\n]*(?:\]|$)/g, (m) => `\u0000${kept.push(m) - 1}\u0000`);
  // (not one right after an unclosed "[": that is a citation still streaming)
  s = s.replace(new RegExp(String.raw`(?<!\[\s*)\b(${GROUP})\b`, "gi"), (_, g: string) => tidyGroup(g));
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i: string) => kept[Number(i)]);
  // the gaps a removal leaves: "the thread  ." / "( )" / "in ."
  return s
    .replace(/\(\s*\)|\[\s*\]/g, "")
    .replace(/[ \t]+([.,;:!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ");
}

/** The cited tags in order of first appearance. */
export function citedTags(text: string): string[] {
  const out: string[] = [];
  for (const m of normalizeCitations(text).matchAll(CITE_RE)) for (const t of tagsIn(m[1])) if (!out.includes(t)) out.push(t);
  return out;
}
