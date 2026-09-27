import { sentenceCuts } from "@/lib/claims";
import type { CorroboratedClaim } from "@/lib/agent/corroborate";
import { CITE_RE, tagsIn } from "@/lib/refs";

export { sentenceCuts };

// An answer read as claims: each sentence or bullet, with the messages it cites. Hovering a claim lights its evidence
// in the thread tree, so the split has to agree with how a reader sees a sentence end - and with the verifier, which
// splits the same way (lib/claims.ts claimsOf). Kept free of React so it is unit-tested (claims.test.ts).

/** The citation tags in a piece of text, in order, once each. */
export function citedIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(CITE_RE)) for (const t of tagsIn(m[1])) if (!out.includes(t)) out.push(t);
  return out;
}

export type Claim<T> = { pieces: (string | T)[]; tags: string[] };

/** Whether a claim's text closes on a citation that is shown: the "+N more" beside a claim sits right after that
 *  chip, and one after a claim whose chips are elsewhere (or all hidden) stood alone with no number beside it (QA
 *  2026-09-27). */
export function endsWithShownCitation(text: string, shown: ReadonlyArray<string>): boolean {
  const m = /\[(msg\d+(?:, msg\d+)*)\]\s*[.!?;:,]*\s*$/.exec(text);
  return Boolean(m && tagsIn(m[1]).some((t) => shown.includes(t)));
}

/**
 * Group a block's inline pieces (strings, and elements such as bold text whose text `textOf` reads) into claims.
 * Strings are cut at sentence ends; an element always joins the sentence it sits in. Every piece lands in exactly
 * one claim, in order, so rendering the claims one after another renders the block unchanged.
 */
export function groupClaims<T>(pieces: (string | T)[], textOf: (p: T) => string): Claim<T>[] {
  const out: Claim<T>[] = [];
  let cur: (string | T)[] = [];
  let text = "";
  const add = (p: string | T) => {
    cur.push(p);
    text += typeof p === "string" ? p : textOf(p);
  };
  const close = () => {
    if (!cur.length) return;
    // Whitespace between two sentences is not a claim of its own; it rides with the one before it.
    if (!text.trim() && out.length) out.at(-1)!.pieces.push(...cur);
    else out.push({ pieces: cur, tags: citedIn(text) });
    cur = [];
    text = "";
  };
  for (const p of pieces) {
    if (typeof p !== "string") {
      add(p);
      continue;
    }
    let last = 0;
    for (const cut of sentenceCuts(p)) {
      add(p.slice(last, cut));
      close();
      last = cut;
    }
    if (last < p.length) add(p.slice(last));
  }
  close();
  return out;
}

/**
 * A text split before its last word: "moving gear into vehicles. " -> ["moving gear into ", "vehicles. "]. The answer
 * binds that last word to the citation chips after it, so the chips never wrap onto a line of their own.
 */
export function lastWord(s: string): [string, string] {
  const m = /(\S+\s*)$/.exec(s);
  return m ? [s.slice(0, m.index), m[1]] : ["", s];
}

/**
 * A claim's pieces with the punctuation that ends it cut off: [pieces before it, the mark, the space after it]. The
 * "+N more" beside a claim goes before its full stop, next to the chips it adds to; put after the claim, it sat past
 * the full stop, at the start of the next sentence (QA 2026-09-26). A claim that does not end in punctuation (a
 * bullet, or bold text last) is returned whole.
 */
export function splitClosing<T>(pieces: (string | T)[]): [(string | T)[], string, string] {
  const last = pieces.at(-1);
  const m = typeof last === "string" ? /([.!?;:]+)(\s*)$/.exec(last) : null;
  if (!m || typeof last !== "string") return [pieces, "", ""];
  const head = last.slice(0, m.index);
  return [[...pieces.slice(0, -1), ...(head ? [head] : [])], m[1], m[2]];
}

/**
 * A list item that offers a question to ask: an answer that cites nothing (a question outside the conversations) ends
 * with two or three questions the reader could ask instead, one per bullet (lib/agent/instructions.ts), and a tap asks
 * it. The item is the question when it is one short sentence ending in "?", with no citation or number tag in it.
 */
export function offeredQuestion(text: string): string | null {
  const t = text.trim();
  if (t.length < 8 || t.length > 160 || !t.endsWith("?") || t.includes("[")) return null;
  return /[.?!]\s/.test(t) ? null : t;
}

/**
 * The words of a claim's "+N more", in conversations throughout: how many say it, how many of those the answer cites
 * (its chips, one per conversation, evidence.ts onePerConversation), and how many more. The panel opens on the same
 * three numbers ("5 conversations say this. 2 are cited in the answer"); said in messages, a claim showed 3 chips and
 * "+3 more" beside a panel saying 5 and 2 (QA 2026-09-26).
 */
export function morePillWords(c: Pick<CorroboratedClaim, "conversations" | "moreTotal">): string {
  const n = (x: number) => x.toLocaleString("en-GB");
  const cited = Math.max(0, c.conversations - c.moreTotal);
  const say = `${n(c.conversations)} ${c.conversations === 1 ? "conversation says" : "conversations say"} this`;
  return cited ? `${say}: ${n(cited)} cited in the answer, ${n(c.moreTotal)} more` : `${say}: ${n(c.moreTotal)} more`;
}
