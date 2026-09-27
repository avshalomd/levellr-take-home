import { CITE_RE, normalizeCitations, tagsIn } from "./refs";

// How an answer splits into claims: one per bullet and per sentence, each with the citations inside it. The verifier
// (lib/agent/verify.ts) checks these claims and the browser (components/chat/evidence.ts) prunes their citations, so
// the split lives here once, free of server-only imports, and both read the same claims.

const BULLET = /^\s*[-*•]\s*|\s*\d+\.\s+/;
// A sentence ends at . ! or ?, plus any citation groups written straight after it, then space and a capital, a digit
// or a quote. Citations after the full stop stay with the sentence they follow: "It crashed. [msg1] Then..." cites msg1
// for "It crashed.". The verifier, the pruning and the answer's hover claims (components/chat/claims.ts) all cut here,
// so a citation is checked against the sentence the reader sees it on. Before 2026-09-25 the verifier split after the
// full stop and handed such a citation to the NEXT sentence.
const SENTENCE_END = /[.!?](?:\s*\[msg\d+(?:, msg\d+)*\])*(?:\s+(?=["“A-Z0-9])|\s+$)/g;

/** The index just past each sentence end in `s`. */
export function sentenceCuts(s: string): number[] {
  return [...s.matchAll(SENTENCE_END)].map((m) => m.index + m[0].length);
}

/** A line cut into its sentences, citations kept with the sentence they follow. */
export function sentencesOf(line: string): string[] {
  const out: string[] = [];
  let last = 0;
  for (const cut of sentenceCuts(line)) {
    out.push(line.slice(last, cut));
    last = cut;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

/** A claim as the verifier stores it: the sentence without its citation groups. */
export const claimText = (piece: string) => piece.replace(CITE_RE, "").replace(/\s+([.,;:])/g, "$1").trim();

/** A claim for display outside the answer (the "more" list): markdown emphasis removed. Single underscores stay,
 *  because usernames carry them (wizard_brandon). */
export const plainClaim = (claim: string) => claim.replace(/\*\*|__|\*|`/g, "");

// Where one sentence reports two sides, each needing its own message (production QA 2026-09-26: "another said…" and
// "some players…, while others…" were checked as one claim, so one chip on either side passed both). A side starts at
// "while / whereas / but others", ", others", or ", another (player) said / called / wrote…". "another" alone is not
// a marker: ", another patch fixed it" is one claim.
const SPEECH = String.raw`(?:said|says|wrote|writes|called|calls|described|complained|added|argued|noted|felt|feels|thinks?|thought|wants?|wanted|asked|agreed|disagreed|replied|put it|found|finds|liked?|likes|hated?|hates|prefers?|preferred)`;
const CONTRAST = new RegExp(
  String.raw`(?:\s+(?:while|whereas|but)\s+|[,;]\s*(?:and\s+|but\s+)?)(?=others\b|another(?:\s+(?:player|user|one|person|poster|commenter|member))?\s+${SPEECH}\b)`,
  "gi",
);

type Clause = { claim: string; ids: string[] };
const clauseOf = (piece: string): Clause => ({ claim: claimText(piece).replace(/^[,;]\s*|\s*[,;]$/g, ""), ids: [...piece.matchAll(CITE_RE)].flatMap((m) => tagsIn(m[1])) });

/** A sentence's sides, when it reports more than one ("X [msg1], while others Y [msg2]"): each with the citations
 *  written inside it. One side, the sentence itself, when it reports one. */
export function contrastClauses(piece: string): Clause[] {
  const cuts = [...piece.matchAll(CONTRAST)].map((m) => m.index);
  if (!cuts.length) return [clauseOf(piece)];
  return [0, ...cuts].map((at, i) => clauseOf(piece.slice(at, cuts[i] ?? piece.length))).filter((c) => c.claim);
}

/** Split an answer into claims: bullets and sentences, each with the refs (msg12) cited inside it. A sentence that
 *  reports two sides carries them as `clauses`, each checked against its own citations (lib/agent/verify.ts). */
export function claimsOf(answer: string): { claim: string; ids: string[]; clauses?: Clause[] }[] {
  return normalizeCitations(answer)
    .split(/\n+/)
    .flatMap((line) => sentencesOf(line.replace(BULLET, "")))
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((piece) => {
      const clauses = contrastClauses(piece);
      return { ...clauseOf(piece), ...(clauses.length > 1 ? { clauses } : {}) };
    });
}

export type ClaimSupport = { claim: string; citations: { id: string; status: string; support: number | null }[] };

/**
 * Within a claim that at least one checked citation backs, drop the citations the check found do not back it: the
 * claim stands on the ones that do, and a dashed "partly backs" chip beside a solid one only made a sound claim look
 * doubtful (his review, 2026-09-25, DECISIONS D22). A claim with no backed citation keeps every one - its weakness is
 * the verifier's to report, never hidden. Claims are matched to sentences by their text, in order, so a sentence the
 * verifier never saw (a preamble streamed before a tool call) is left alone.
 */
export function pruneWeak(text: string, claims: ClaimSupport[], bar = 0.5): string {
  const drops: Set<string>[] = []; // one per citation group, in text order
  let next = 0;
  for (const line of text.split("\n"))
    for (const raw of sentencesOf(line.replace(BULLET, ""))) {
      let drop = new Set<string>();
      const piece = raw.trim();
      if (piece) {
        const want = claimText(piece);
        const j = claims.findIndex((c, k) => k >= next && c.claim === want);
        if (j >= 0) {
          next = j + 1;
          drop = weakIn(claims[j], bar);
        }
      }
      drops.push(...Array.from(raw.matchAll(CITE_RE), () => drop));
    }
  let g = 0;
  return text.replace(/([ \t]*)\[(msg\d+(?:, msg\d+)*)\]/g, (_, space: string, group: string) => {
    const drop = drops[g++] ?? new Set<string>();
    const keep = tagsIn(group).filter((t) => !drop.has(t));
    return keep.length ? `${space}[${keep.join(", ")}]` : "";
  });
}

/**
 * The citations of a checked claim the reader sees as chips: what pruneWeak leaves, less a citation to a message that
 * does not exist (components/chat/evidence.ts drops those). "+N more" counts beyond exactly these: counted against
 * every citation the check saw, a claim showing 3 chips said "4 are cited in the answer" and "10 more", when a fourth,
 * weak citation had been pruned from the text (QA 2026-09-26).
 */
export function shownCitations(c: ClaimSupport, bar = 0.5): string[] {
  const weak = weakIn(c, bar);
  return [...new Set(c.citations.filter((x) => x.status !== "unknown-id" && !weak.has(x.id)).map((x) => x.id))];
}

function weakIn(c: ClaimSupport, bar: number): Set<string> {
  const backed = c.citations.some((x) => x.status === "ok" && x.support !== null && x.support >= bar);
  if (!backed) return new Set();
  return new Set(c.citations.filter((x) => x.status !== "ok" || (x.support !== null && x.support < bar)).map((x) => x.id));
}
