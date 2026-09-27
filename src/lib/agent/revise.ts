import "server-only";
import { generateText, type ModelMessage } from "ai";
import { proseMarks } from "@/components/chat/evidence";
import { getMessagesByRef } from "@/lib/data/read";
import { normalizeCitations, refOfTag } from "@/lib/refs";
import { flattenForAnswer } from "./agent";
import { textModel } from "./model";
import { claimsOf } from "@/lib/claims";
import { figuresIn, rateMismatches, toolFigures, type KnownRate, type RateCheck } from "./rates";
import {
  countMismatches,
  directionMismatches,
  pctWords,
  toolTrends,
  type ChangeRow,
  type DirectionCheck,
} from "./trends";
import { SUPPORTED, unbackedFigures, verify, type ClaimCheck, type Verification } from "./verify";

// Check, then correct once. The verifier finds the claims whose citations do not hold up; instead of showing the
// reader a list of struck-through sources, the answer goes back to a model with exactly those claims and the text of
// the messages they cite, and is rewritten: each weak claim is re-cited from what the tools returned, narrowed to
// what its sources say, or dropped. The rewrite is verified again and kept only if it is at least as well supported.
// One pass, never a loop: a second pass on a free model costs another 10-30 s for a small gain. DECISIONS D15.

export type RevisionPart =
  // `cite`: the answer cited nothing and is being sent back to cite the messages it read (citeAnswer)
  // `text`: what stays on screen while the rewrite runs, the cite pass's kept text when there was one (review
  // 2026-09-26: the running part replaced the kept one under the same id, and the uncited stream came back for 10-60 s)
  // `counts`: the answer cites nothing, and only its rates and directions are being corrected against the counts
  // (correctCounts; open item 2026-09-26: "to match what the messages say" was untrue there)
  | { status: "running"; weak: number; cite?: boolean; counts?: boolean; text?: string }
  // `cite` on done: the kept text is the cite pass's, which added citations and changed no wording (review 2026-09-26:
  // it had read "Some wording was tightened")
  | {
      status: "done";
      kept: boolean;
      text: string;
      before: { supported: number; cited: number };
      cite?: boolean;
    }
  | { status: "failed"; error: string };

export type Checked = { text: string; verification: Verification; revision?: RevisionPart };

// A claim the check never reached is not weak: nothing is known against it, and a rewrite would only reword it blind.
// A citation that does not exist or was never read is still caught, in code.
export const weakClaims = (v: Verification): ClaimCheck[] =>
  v.claims.filter(
    (c) =>
      c.citations.length &&
      (((c.support ?? 0) < SUPPORTED && !c.unchecked) || c.citations.some((x) => x.status !== "ok")),
  );

// The share of the claims actually checked that are backed.
const rate = (v: Verification) => {
  const checked = v.cited - (v.unchecked ?? 0);
  return checked ? v.supported / checked : 1;
};

const squash = (t: string) => t.replace(/\s+/g, " ").trim();

export async function checkAndRevise(
  answer: string,
  retrieved: ReadonlySet<string>,
  history: ModelMessage[],
  on: { verification?: (v: Verification) => void; revision?: (r: RevisionPart) => void } = {},
  // The per-day rates the tools gave (rates.ts knownRates). A stated rate that matches none of them is corrected like a
  // weak claim (QA 2026-09-26: "9 per day in September" when the counts gave 11.3 per day over 24 days).
  known?: ReadonlyArray<KnownRate>,
  // The tools that gave a result in this chat (agent.ts toolsRan): a figure tagged with one that never ran fails.
  ran?: ReadonlySet<string>,
): Promise<Checked> {
  // Every number the tools worked out: a cited claim's figure must be one of these or in its messages (verify.ts).
  const figures = toolFigures(history);
  // The changes between periods the tools gave (trends.ts): "rose" about a topic whose rate fell is corrected like a
  // wrong rate (production QA 2026-09-26: "the September lift in … Updates & Feedback", which fell 6%).
  const trends = toolTrends(history);
  const first = await verify(answer, retrieved, known, figures, ran);
  const weak = weakClaims(first);
  const rates = first.rates ?? [];
  const directions = directionMismatches(answer, trends);
  if (!weak.length && !rates.length && !directions.length) return { text: answer, verification: first };

  on.verification?.(first);
  on.revision?.({ status: "running", weak: weak.length + rates.length + directions.length });
  try {
    // The same prose marks as the page (components/chat/evidence.ts proseMarks), so the claims checked are the ones shown.
    const text = proseMarks(normalizeCitations(await rewrite(answer, weak, history, rates, directions)));
    if (!text.trim()) throw new Error("the rewrite came back empty");
    const second = await verify(text, retrieved, known, figures, ran);
    // Kept only if it is at least as well supported, still cites, and states no more unmatched rates or wrong
    // directions than before. A rewrite asked for only because of those must state FEWER of them (D43; review
    // 2026-09-26: with "<=", a rewrite that fixed nothing replaced the answer, reworded, for the cost of a second check).
    const wrongBefore = rates.length + directions.length;
    const wrongAfter = (second.rates?.length ?? 0) + directionMismatches(text, trends).length;
    const fewerRates = weak.length ? wrongAfter <= wrongBefore : wrongAfter < wrongBefore;
    // A rewrite that changed no words is not kept (QA 2026-09-27): kept, it said "Some wording was tightened" under an
    // answer whose wording had not changed.
    const changed = squash(text) !== squash(answer);
    const kept = changed && rate(second) >= rate(first) && second.cited > 0 && fewerRates;
    const revision: RevisionPart = {
      status: "done",
      kept,
      text,
      before: { supported: first.supported, cited: first.cited },
    };
    on.revision?.(revision);
    return kept ? { text, verification: second, revision } : { text: answer, verification: first, revision };
  } catch (e) {
    const revision: RevisionPart = { status: "failed", error: String(e).slice(0, 300) };
    on.revision?.(revision);
    return { text: answer, verification: first, revision };
  }
}

async function rewrite(
  answer: string,
  weak: ClaimCheck[],
  history: ModelMessage[],
  rates: RateCheck[] = [],
  directions: DirectionCheck[] = [],
  uncited = false,
): Promise<string> {
  const cited = [...new Set(weak.flatMap((c) => c.citations.map((x) => x.id)))];
  const texts = new Map(
    (await getMessagesByRef(cited.map(refOfTag).filter((r): r is number => r !== null))).map((m) => [
      `msg${m.ref}`,
      m.text,
    ]),
  );
  const flagged = weak
    .map((c) => {
      const sources = c.citations
        .map((x) =>
          x.status === "unknown-id"
            ? `  [${x.id}] does not exist.`
            : x.status === "not-retrieved"
              ? `  [${x.id}] was not in any tool result.`
              : `  [${x.id}] says: "${(texts.get(x.id) ?? "").slice(0, 600).replace(/\s+/g, " ")}"`,
        )
        .join("\n");
      const why = (c.notes ?? []).map((n) => `\n  ${n}`).join("");
      return `- CLAIM: ${c.claim}\n${sources}${why}`;
    })
    .join("\n");
  // A rate the model worked out itself, from the wrong number of days (rates.ts), goes back with the rates the counts
  // gave, so the rewrite can use the right one for the period the claim is about.
  const flaggedRates = rates
    .map((r) => `- CLAIM: ${r.claim}\n  It gives ${r.stated} per day, which no count gave.`)
    .join("\n");
  const knownWords = [...new Set(rates.flatMap((r) => r.known))];
  const rateSection = rates.length
    ? `A CHECK FOUND THESE PER-DAY RATES THAT NO COUNT GAVE:\n${flaggedRates}\n` +
      `The per-day rates the counts gave: ${knownWords.length ? knownWords.join("; ") : "none"}. For each, use the rate ` +
      "for the period the claim is about, with its days, or remove the rate. Never work out a rate yourself."
    : "";
  const directionSection = directions.length
    ? "A CHECK FOUND THESE CHANGES STATED THE WRONG WAY ROUND:\n" +
      directions
        .map(
          (d) =>
            `- CLAIM: ${d.claim}\n  It says ${d.name} ${d.said}; the counts give ${d.name} ${pctWords(d.pct)} per day.`,
        )
        .join("\n") +
      "\nFor each, state the change the counts give, or remove it."
    : "";

  const brief = flattenForAnswer(history)[0].content as string;
  const { text } = await generateText({
    model: textModel(),
    temperature: 0,
    maxRetries: 1,
    abortSignal: AbortSignal.timeout(60_000),
    system:
      "You correct an analyst's answer so every claim is supported by the messages it cites. Output only the " +
      "corrected answer, in the same format as the original: same opening, same bullet style, citations as " +
      "[msg1234] right after each claim, number tags like [scan] kept. No preamble, no notes about what you changed.",
    prompt:
      brief.replace(/\n\nWrite the answer to the last QUESTION now, from these results only\.$/, "") +
      `\n\nTHE ANSWER THAT WAS WRITTEN:\n${answer}\n\n` +
      [
        weak.length ? `A CHECK FOUND THESE CLAIMS NOT SUPPORTED BY WHAT THEY CITE:\n${flagged}` : "",
        rateSection,
        directionSection,
      ]
        .filter(Boolean)
        .join("\n\n") +
      "\n\n" +
      "Rewrite the answer. For each flagged claim, do one of three things: cite messages from the RESULTS above that " +
      "do say it; narrow the claim to what its cited messages actually say; or remove it. Leave every other sentence " +
      "and citation exactly as it is. Never cite a message you did not see in the RESULTS." +
      // (open item 2026-09-26) An uncited answer's rewrite is not checked against messages, so it may not start citing.
      (uncited
        ? " This answer cites no messages: add no citations, and state no figure the counts above do not give."
        : ""),
  });
  return text;
}

// An answer that cites nothing never reaches checkAndRevise, yet its per-day rates and directions come from the counts
// and can be wrong (open item 2026-09-26, D45: "Which topics grew the most from August to September?" cited nothing,
// so nothing checked them). The caller (finish.ts) finds them in code (trends.ts countMismatches), with no model and no
// Jev call, and only on a mismatch is the answer sent back once. There is no Jev pass here, so the keep rule is its own (keepCountsRewrite).

/** Whether an uncited answer's rewrite replaces it. Kept only if it
 *  - states strictly fewer rates and directions the counts contradict (a rewrite that fixed nothing only rewords);
 *  - still cites nothing: no Jev pass runs on this path, so a citation it added would stand unchecked;
 *  - states no figure that neither the answer nor a tool gave (verify.ts unbackedFigures, with no messages to back it);
 *  - keeps its substance: it was asked to fix or drop only the flagged sentences, so it may lose at most one claim per
 *    flagged sentence, never more (a claim guard, not a length guard, because a corrected rate can be longer or shorter
 *    than the wrong one, while a sentence dropped that was not flagged is a loss of substance whatever its length). */
export function keepCountsRewrite(
  answer: string,
  text: string,
  known: ReadonlyArray<KnownRate>,
  trends: ReadonlyArray<ChangeRow>,
  figures: ReadonlyArray<number>,
): boolean {
  if (!text.trim()) return false;
  const before = countMismatches(answer, known, trends);
  if (countMismatches(text, known, trends) >= before) return false;
  const claims = claimsOf(text);
  if (claims.some((c) => c.ids.length)) return false;
  const given = [...figures, ...figuresIn(answer).map((f) => f.value)];
  if (unbackedFigures(text, [], new Map(), given).length) return false;
  const flagged = new Set(
    [...rateMismatches(answer, known), ...directionMismatches(answer, trends)].map((m) => m.claim),
  ).size;
  return claims.length >= claimsOf(answer).length - flagged;
}

export type CountsChecked = { text: string; rates: RateCheck[]; revision: RevisionPart };

/** One rewrite of an uncited answer whose rates or directions the counts contradict, kept by keepCountsRewrite. One
 *  answer-model call, no Jev call. `rates`: the rate mismatches left in the text kept, for the line under it. */
export async function correctCounts(
  answer: string,
  history: ModelMessage[],
  known: ReadonlyArray<KnownRate>,
  on: { revision?: (r: RevisionPart) => void } = {},
): Promise<CountsChecked> {
  const trends = toolTrends(history);
  const rates = rateMismatches(answer, known);
  const directions = directionMismatches(answer, trends);
  const unchanged = (revision: RevisionPart): CountsChecked => ({ text: answer, rates, revision });
  on.revision?.({
    status: "running",
    weak: new Set([...rates, ...directions].map((m) => m.claim)).size,
    counts: true,
  });
  try {
    const text = proseMarks(normalizeCitations(await rewrite(answer, [], history, rates, directions, true)));
    const kept = keepCountsRewrite(answer, text, known, trends, toolFigures(history));
    const revision: RevisionPart = { status: "done", kept, text, before: { supported: 0, cited: 0 } };
    on.revision?.(revision);
    return kept ? { text, rates: rateMismatches(text, known), revision } : unchanged(revision);
  } catch (e) {
    const revision: RevisionPart = { status: "failed", error: String(e).slice(0, 300) };
    on.revision?.(revision);
    return unchanged(revision);
  }
}

// An answer that read messages and cites none is sent back once to cite them (grounding.ts: "What are people
// complaining about most in September?" quoted thread titles and a cause with no citation, QA 2026-09-26). The rewrite
// sees what the tools returned, as the correction above does, and either cites a claim from those results or drops it.
// The caller keeps it only if it now cites something (lib/agent/finish.ts); either way what it keeps is checked like
// any other answer.
export const CITE_SYSTEM =
  "You add citations to an analyst's answer so every claim about what people said points to the messages it rests on. " +
  "Output only the answer, in the same format as the original: same opening, same bullet style, citations as " +
  "[msg1234] right after each claim, number tags like [scan] kept. No preamble, no notes about what you changed.";

/** How many refs the cite pass is offered. */
export const MAX_CITE_REFS = 80;

/** The message refs the cite pass may cite: the [msgN] tags in the results the model actually read (each conversation
 *  cut at 2,500 characters, for-model.ts conversationsForModel), that this turn retrieved, taken round-robin across
 *  conversations - the first of each, then the second of each - so the list holds as many conversations as it can.
 *  Review 2026-09-26: listed in the order the tools returned them, one long thread (patch notes) filled all 80 places,
 *  most of them past the cut the model read, while the prompt asked for refs each from a different conversation.
 *  `byConv` is each conversation's refs, by its handle (conv12), for a citation written as a handle. */
export function citableRefs(
  history: ReadonlyArray<ModelMessage>,
  retrieved: ReadonlySet<string>,
  max = MAX_CITE_REFS,
): { refs: string[]; byConv: Map<string, string[]> } {
  // A read_conversation result has no "## conversation" header: its handle is the call's own input.
  const handleOfCall = new Map<string, string>();
  for (const m of history)
    if (Array.isArray(m.content))
      for (const p of m.content as Array<{ type: string; toolCallId?: string; input?: unknown }>)
        if (p.type === "tool-call" && p.toolCallId) {
          const id = (p.input as { id?: unknown } | undefined)?.id;
          if (typeof id === "string" && /^conv\d+$/i.test(id))
            handleOfCall.set(p.toolCallId, id.toLowerCase());
        }

  const groups = new Map<string, string[]>();
  const seen = new Set<string>();
  for (const m of history) {
    if (!Array.isArray(m.content)) continue;
    for (const p of m.content as Array<{ type: string; toolCallId?: string; output?: unknown }>) {
      if (p.type !== "tool-result") continue;
      // The same text the brief carries (agent.ts flattenForAnswer).
      const o = p.output as { value?: unknown } | undefined;
      const text = typeof o?.value === "string" ? o.value : JSON.stringify(o?.value ?? o ?? "");
      let key = handleOfCall.get(p.toolCallId ?? "") ?? `call:${p.toolCallId}`;
      for (const line of text.split("\n")) {
        const header = /^## conversation (conv\d+)\b/i.exec(line);
        if (header) key = header[1].toLowerCase();
        for (const t of line.matchAll(/\[(msg\d+)\]/gi)) {
          const tag = t[1].toLowerCase();
          if (!retrieved.has(tag) || seen.has(tag)) continue;
          seen.add(tag);
          groups.set(key, [...(groups.get(key) ?? []), tag]);
        }
      }
    }
  }

  const lists = [...groups.values()];
  const refs: string[] = [];
  for (let i = 0; refs.length < max && lists.some((l) => l.length > i); i++)
    for (const l of lists) if (l[i] && refs.length < max) refs.push(l[i]);
  return { refs, byConv: new Map([...groups].filter(([k]) => k.startsWith("conv"))) };
}

// A citation group made only of handles and ids: [conv12], (conv12, msg40), [t3_abc123].
const HANDLE = String.raw`(?:conv\d+|msg\d+|t[13]_[a-z0-9]{4,})`;
const HANDLE_GROUP = new RegExp(
  String.raw`([[(])(\s*${HANDLE}(?:\s*[,;/&]\s*(?:and\s+)?${HANDLE})*\s*)([\])])`,
  "gi",
);

/** A citation written as a conversation handle becomes a message of that conversation the model read; one naming a
 *  conversation it did not read, or a raw Reddit id, cannot be placed and is reported (normalizeCitations then drops
 *  it). Review 2026-09-26: normalizeCitations had deleted them silently, so a pass that cited conversations looked
 *  like one that cited nothing. */
export function placeHandles(
  text: string,
  byConv: ReadonlyMap<string, string[]>,
): { text: string; placed: number; rejected: string[] } {
  let placed = 0;
  const out = text.replace(HANDLE_GROUP, (_all, open: string, inner: string, close: string) => {
    const mapped = inner.replace(/\bconv\d+\b/gi, (h) => {
      const tag = byConv.get(h.toLowerCase())?.[0];
      if (!tag) return h;
      placed++;
      return tag;
    });
    return open + mapped + close;
  });
  const rejected = [...out.matchAll(/\b(?:conv\d+|t[13]_[a-z0-9]{4,})\b/gi)].map((m) => m[0]);
  return { text: out, placed, rejected };
}

export function citePrompt(brief: string, answer: string, refs: readonly string[] = []): string {
  // The refs are listed again at the end: buried in a long brief, the one live cite pass wrote its answer back with
  // none (QA 2026-09-26, "Did people complain more in July or in September?", 10 refs in its results).
  const list = refs.length
    ? `\n\nThe message refs in the RESULTS, the only ones you may cite: ${refs
        .slice(0, MAX_CITE_REFS)
        .map((r) => `[${r}]`)
        .join(", ")}.`
    : "";
  return (
    brief.replace(/\n\nWrite the answer to the last QUESTION now, from these results only\.$/, "") +
    `\n\nTHE ANSWER THAT WAS WRITTEN (it cites no messages):\n${answer}\n\n` +
    "Rewrite it so it rests on the messages above. After each claim about what people said, cite two to four message " +
    "refs from the RESULTS that say it, each from a different conversation, as [msg1234]. Remove any claim no result " +
    "supports: a thread named, a cause, an example or a quote that is not in the RESULTS goes. Keep every number and " +
    "its [scan] or [aggregate] tag as it is. Never cite a message you did not see in the RESULTS." +
    list
  );
}

/** What the cite pass gave back: `text`, ready to show; `raw`, the model's own words, and why it stopped, for the log
 *  when it cited nothing; how many refs it was offered, and the handles it wrote that could and could not be placed. */
export type Cited = {
  text: string;
  raw: string;
  finishReason: string;
  offered: number;
  placed: number;
  rejected: string[];
};

export async function citeAnswer(
  answer: string,
  history: ModelMessage[],
  retrieved: ReadonlySet<string>,
): Promise<Cited> {
  const brief = flattenForAnswer(history)[0].content as string;
  const { refs, byConv } = citableRefs(history, retrieved);
  const { text: raw, finishReason } = await generateText({
    model: textModel(),
    temperature: 0,
    maxRetries: 1,
    abortSignal: AbortSignal.timeout(60_000),
    system: CITE_SYSTEM,
    prompt: citePrompt(brief, answer, refs),
  });
  const placed = placeHandles(raw, byConv);
  return {
    text: proseMarks(normalizeCitations(placed.text)),
    raw,
    finishReason: String(finishReason),
    offered: refs.length,
    placed: placed.placed,
    rejected: placed.rejected,
  };
}
