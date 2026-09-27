import "server-only";
import { decide, noul } from "@/lib/llm/decide";
import { getMessagesByRef } from "@/lib/data/read";
import { claimsOf } from "@/lib/claims";
import { msgTag, refOfTag } from "@/lib/refs";
import { mapPool } from "@/lib/data/pool";
import { figuresIn, rateMismatches, type KnownRate, type RateCheck } from "./rates";

// After the answer is written, every cited claim is checked, and the result streams to the UI as a badge per claim.
// Two checks, one in code and one by Jev:
//   1. Does the cited ref exist, and did the agent actually see it in this turn? (code - a made-up ref is caught here)
//   2. Does the cited message support the sentence it is attached to? (Jev, one Noul per cited message)
// Verification is shown, never silent: a weakly supported answer says so at the top. docs/DECISIONS.md D11.

export const SUPPORTED = 0.5;

export type CitationCheck = {
  id: string;
  status: "ok" | "unknown-id" | "not-retrieved";
  support: number | null;
};
// `notes`: why a claim fails beyond its citations' scores, in words for the rewrite (revise.ts): a figure none of its
// messages and no count gives, or a side of the sentence with no citation of its own.
// `unchecked`: Jev never answered for this claim (busy, rate-limited, down), so nothing is known about its support. It
// is counted apart and never sent for a rewrite (QA 2026-09-27: one failed call read as "0 of 9 claims are backed").
export type ClaimCheck = {
  claim: string;
  citations: CitationCheck[];
  support: number | null;
  notes?: string[];
  unchecked?: true;
};
export type Verification = {
  claims: ClaimCheck[];
  supported: number; // claims whose best citation this turn read is at or above SUPPORTED
  cited: number; // claims with at least one citation
  unchecked?: number; // cited claims the check never reached (ClaimCheck.unchecked); absent on answers saved before 2026-09-27
  invalidIds: string[];
  uncitedSentences: number; // sentences that state something without a citation (headlines excluded)
  /** Per-day rates the answer states that no tool gave (rates.ts). Absent on answers saved before 2026-09-26. */
  rates?: RateCheck[];
};

// Production QA 2026-09-26: "some players like Rondo's terrain" passed on a message saying "The terrain leaves
// something to be desired". The question asks for SUPPORT in so many words, and says that a message saying the
// opposite, or only about the same subject, does not give it.
export const SUPPORT_QUESTION = (id: string, target: string) =>
  `Does the message \`evidence.${id}\` SUPPORT \`${target}\` - does it say, show or clearly imply what the claim ` +
  "attributes to it? It supports the claim if it is one instance of what the claim describes. A message that says the " +
  "opposite, disagrees with it, or is only about the same subject without saying it, does NOT support it.";

/** `known`: the per-day rates the tools gave (rates.ts knownRates); when given, a stated rate that matches none of them
 *  is flagged. `figures`: every number the tools worked out (rates.ts toolFigures); when given, a cited claim that
 *  states a figure none of its messages and none of the tools gives fails (production QA 2026-09-26: "at 25% each").
 *
 *  Jev is asked once per cited claim, as before: a sentence with two sides puts each of its citations to its own side
 *  in that one call, and the figure check is code. Worst case, before and after: one call per cited claim. */
export async function verify(
  answer: string,
  retrieved: Set<string>,
  known?: ReadonlyArray<KnownRate>,
  figures?: ReadonlyArray<number>,
): Promise<Verification> {
  const claims = claimsOf(answer);
  const allIds = [...new Set(claims.flatMap((c) => c.ids))];
  const refs = allIds.map(refOfTag).filter((r): r is number => r !== null);
  const messages = new Map((await getMessagesByRef(refs)).map((m) => [msgTag(m.ref), m]));

  const checked = await mapPool(claims, 8, async ({ claim, ids, clauses }): Promise<ClaimCheck> => {
    if (!ids.length) return { claim, citations: [], support: null };
    const valid = ids.filter((id) => messages.has(id));
    // One side, the sentence, keyed by the ref as before; two or more, each ref asked about the side it is written in.
    const sides = clauses ?? [{ claim, ids }];
    const asks = sides.flatMap((side, k) =>
      side.ids
        .filter((id) => messages.has(id))
        .map((id) => ({ key: clauses ? `c${k}_${id}` : id, id, side: k })),
    );
    let answers: Record<string, number> = {};
    let failed = false;
    if (valid.length) {
      try {
        const evidence = Object.fromEntries(valid.map((id) => [id, messages.get(id)!.text.slice(0, 3000)]));
        const state = clauses
          ? { clauses: Object.fromEntries(sides.map((c, k) => [`c${k}`, c.claim])), evidence }
          : { claim, evidence };
        const res = await decide({
          state,
          questions: Object.fromEntries(
            asks.map((a) => [a.key, noul(SUPPORT_QUESTION(a.id, clauses ? `clauses.c${a.side}` : "claim"))]),
          ),
        });
        answers = Object.fromEntries(
          asks.map((a) => [a.key, (res.answers as Record<string, { noul: number }>)[a.key].noul]),
        );
      } catch (e) {
        // Said to the reader as "could not be checked"; the reason goes to the server log, never to the page.
        console.warn(`claim check failed: ${e instanceof Error ? e.message : String(e)}`);
        answers = {};
        failed = true;
      }
    }
    const scoreOf = (id: string) => {
      const s = asks.filter((a) => a.id === id && answers[a.key] !== undefined).map((a) => answers[a.key]);
      return s.length ? Math.max(...s) : null;
    };
    const citations: CitationCheck[] = ids.map((id) => ({
      id,
      status: !messages.has(id) ? "unknown-id" : retrieved.has(id) ? "ok" : "not-retrieved",
      support: scoreOf(id),
    }));
    // Only a citation this turn read can back a claim (QA 2026-09-26): a ref carried over from an earlier turn, or one
    // never shown to the agent, is checked and reported, but "backed" never rests on it.
    const read = (id: string) => retrieved.has(id) && messages.has(id);
    const best = (side: number, sideIds: string[]) => {
      const s = asks
        .filter((a) => a.side === side && read(a.id) && answers[a.key] !== undefined)
        .map((a) => answers[a.key]);
      return s.length ? Math.max(...s) : sideIds.length ? null : 0;
    };
    // A sentence with two sides is as backed as its weaker side, and a side with no citation of its own is not backed.
    const perSide = sides.map((side, k) => best(k, side.ids));
    let support = perSide.some((s) => s === null) ? null : Math.min(...(perSide as number[]));
    const notes: string[] = [];
    if (clauses)
      for (const side of sides)
        if (!side.ids.length) notes.push(`The part "${side.claim}" has no citation of its own.`);

    const unbacked = figures ? unbackedFigures(claim, ids, messages, figures) : [];
    for (const f of unbacked)
      notes.push(`It states ${f}, which none of its cited messages and none of the counts gives.`);
    if (unbacked.length) support = 0;
    // A figure no source gives fails the claim whatever Jev would have said, so only a claim with nothing else against
    // it is left unchecked.
    const unchecked = failed && !unbacked.length;
    return {
      claim,
      citations,
      support,
      ...(notes.length ? { notes } : {}),
      ...(unchecked ? { unchecked: true as const } : {}),
    };
  });

  const cited = checked.filter((c) => c.citations.length);
  return {
    claims: checked,
    cited: cited.length,
    unchecked: cited.filter((c) => c.unchecked).length,
    supported: cited.filter((c) => (c.support ?? 0) >= SUPPORTED).length,
    invalidIds: allIds.filter((id) => !messages.has(id)),
    uncitedSentences: checked.filter(
      (c) => !c.citations.length && /\b(people|players|users|many|some|most|several)\b/i.test(c.claim),
    ).length,
    ...(known ? { rates: rateMismatches(answer, known) } : {}),
  };
}

/** The figures a cited claim states that none of its messages contains and no tool worked out. A figure matches a tool's
 *  within half a unit of its own last decimal ("about 46" for 46.2). A count equal to the claim's own citations ("3
 *  players said so" beside three chips) is the chips themselves. Dates and release numbers are not figures. */
export function unbackedFigures(
  claim: string,
  ids: ReadonlyArray<string>,
  messages: ReadonlyMap<string, { text: string }>,
  figures: ReadonlyArray<number>,
): string[] {
  const inMessages = ids.flatMap((id) => figuresIn(messages.get(id)?.text ?? "").map((f) => f.value));
  return figuresIn(claim)
    .filter((f) => {
      const near = (v: number) => Math.abs(v - f.value) <= 0.5 * 10 ** -f.decimals + 1e-9;
      return !inMessages.includes(f.value) && !figures.some(near) && f.value !== new Set(ids).size;
    })
    .map((f) => f.words);
}
