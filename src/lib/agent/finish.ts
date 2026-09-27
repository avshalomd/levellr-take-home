import "server-only";
import type { ModelMessage, UIMessageStreamWriter } from "ai";
import { answerText, numberTagsOnly, proseMarks, stripToolMarkup } from "@/components/chat/evidence";
import { claimsOf } from "@/lib/claims";
import { normalizeCitations } from "@/lib/refs";
import { answerFromTools, retrievedRefs } from "./agent";
import { groundingOf, type Grounding } from "./grounding";
import { knownRates } from "./rates";
import { checkAndRevise, citeAnswer, correctCounts, type RevisionPart } from "./revise";
import { countMismatches, toolTrends } from "./trends";
import type { ChatMessage, VerificationPart } from "./ui-types";
import type { Verification } from "./verify";

// Everything that happens to an answer after the agent stops, in one place, so the chat route and the eval run exactly
// the same thing (review 2026-09-26: the off-topic reply and the cite pass lived only in the route, so the eval's
// out-of-scope questions reached its judge as an empty answer and the cite pass was never evaluated). In order:
//   1. the answer is tidied (tool markup, citation formats); a turn that used the tools and has no words is answered
//      once from what they returned (agent.ts answerFromTools);
//   2. an off-topic question gets the reply written in code (off-topic.ts), and nothing is checked;
//   3. an answer that read messages and cites none is sent back once to cite them (revise.ts citeAnswer);
//   4. an answer that cites messages is checked, and its weak claims corrected once (revise.ts checkAndRevise);
//   5. an answer from the tools that still cites nothing has its rates and directions checked against the counts in
//      code, is rewritten once on a mismatch (revise.ts correctCounts), and says so under it.
// Answer-model calls after the agent, worst case per turn: 2 (the cite pass, then one rewrite), plus 1 only when the
// agent left no words (answerFromTools). On an uncited answer: 2 (open item 2026-09-26); 1 on a counts-only answer.
// Jev is never called on an uncited answer.
// The route passes its stream's write, and the reader sees each part as it happens; the eval passes nothing and reads
// the result. How many conversations back each claim (corroborate.ts) stays in the route: it changes no text.

type Chunk = Parameters<UIMessageStreamWriter<ChatMessage>["write"]>[0];
type StepLike = { content: ReadonlyArray<unknown> };

/** Every step's text, joined as the reader's page joins it (components/chat/evidence.ts answerText). Review 2026-09-26:
 *  the route and the eval passed result.text, which in AI SDK 7 is the last step's only. */
export function stepsText(steps: ReadonlyArray<StepLike>): string {
  return answerText(
    steps.map((s) =>
      s.content
        .map((p) => ((p as { type?: string }).type === "text" ? ((p as { text?: string }).text ?? "") : ""))
        .join(""),
    ),
  );
}

export type AfterAgent = {
  /** What the reader is shown. */
  text: string;
  grounding: Grounding;
  /** Every message the tools showed the agent this turn (agent.ts retrievedRefs). */
  retrieved: Set<string>;
  /** The check's result, when the answer cited messages and the check ran to the end. */
  checked?: Verification;
  /** The last verification and revision parts written, as the saved chat holds them. */
  verification?: VerificationPart;
  revision?: RevisionPart;
};

const BEFORE_NOTHING = { supported: 0, cited: 0 };

/** A revision the check writes, as the reader is shown it after a kept cite pass: one not kept, or failed, puts the
 *  cited text back, and one still running carries it (review 2026-09-26: written under the same id, "running" replaced
 *  the kept revision, and for the 10-60 s of the rewrite the uncited stream came back and the chips went). */
export function afterCite(r: RevisionPart, cited: RevisionPart | undefined): RevisionPart {
  if (!cited || cited.status !== "done") return r;
  if (r.status === "running") return { ...r, text: cited.text };
  return r.status === "failed" || !r.kept ? cited : r;
}

export async function afterAgent(
  turn: { steps: ReadonlyArray<StepLike>; history: ModelMessage[] },
  write: (chunk: Chunk) => void = () => {},
): Promise<AfterAgent> {
  // Every step's text, tidied as the reader's page tidies it (components/chat/evidence.ts evidenceOf), so what is
  // checked, and what the eval judges, is what the reader is shown.
  const tidy = (t: string) => numberTagsOnly(proseMarks(normalizeCitations(stripToolMarkup(t))));
  let answer = tidy(stepsText(turn.steps));
  const retrieved = retrievedRefs(turn.steps);
  const cites = () => claimsOf(answer).some((c) => c.ids.length);
  let grounding = groundingOf(cites(), turn.steps);

  // A turn that used the tools and ended with no words is answered once from what they returned, as the last step
  // would have answered (agent.ts answerFromTools; eval run 7, T04: the model wrote its next tool call as text, which
  // is stripped, and the reader got nothing). Streamed as the answer's text, like the off-topic reply below; then
  // cited and checked like any other answer. If it fails too, the page says the answer is unfinished (chat-state.ts).
  if (!answer.trim() && (grounding.kind === "uncited" || grounding.kind === "cited")) {
    const text = tidy(await answerFromTools(turn.history));
    if (text.trim()) {
      write({ type: "text-start", id: "from-tools" });
      write({ type: "text-delta", id: "from-tools", delta: text });
      write({ type: "text-end", id: "from-tools" });
      answer = text;
      grounding = groundingOf(cites(), turn.steps);
    }
  }
  const out: AfterAgent = { text: answer, grounding, retrieved };
  const revise = (r: RevisionPart) => {
    out.revision = r;
    write({ type: "data-revision", id: "revision", data: r });
  };
  const verdict = (v: VerificationPart) => {
    out.verification = v;
    write({ type: "data-verification", id: "verification", data: v });
  };

  // A question the conversations cannot answer gets one reply, written in code (lib/agent/off-topic.ts): the loop
  // stopped at the out_of_scope call, so the model wrote nothing, or at most a line before it, which the reply
  // replaces on screen (a kept revision, components/chat/evidence.ts). It cites nothing, so nothing is checked.
  if (grounding.kind === "off-topic") {
    if (!answer.trim()) {
      write({ type: "text-start", id: "off-topic" });
      write({ type: "text-delta", id: "off-topic", delta: grounding.text });
      write({ type: "text-end", id: "off-topic" });
    } else revise({ status: "done", kept: true, text: grounding.text, before: BEFORE_NOTHING });
    out.text = grounding.text;
    return out;
  }

  // The cite pass's text, once it is kept: shown from the moment the pass succeeds, whatever the check does next.
  let cited: RevisionPart | undefined;
  try {
    // An answer that read messages and cites none is sent back once to cite them (grounding.ts). What it gives back
    // replaces the streamed text only if it now cites something. An answer with no words is not sent (review
    // 2026-09-26: the pass ran on an empty answer, and a failure left "Finding the messages…" running beside
    // "unfinished"); the page says it is unfinished and offers to ask again (chat-state.ts).
    if (grounding.kind === "uncited" && grounding.read && retrieved.size && answer.trim()) {
      verdict({ status: "running" });
      revise({ status: "running", weak: claimsOf(answer).length, cite: true });
      try {
        const c = await citeAnswer(answer, turn.history, retrieved);
        if (claimsOf(c.text).some((x) => x.ids.length)) {
          answer = c.text;
          // Written as a kept revision at once (review 2026-09-26): kept back until after the check, a check that threw
          // lost the cited text and left the part running ("Finding the messages…") in the saved chat.
          cited = { status: "done", kept: true, cite: true, text: answer, before: BEFORE_NOTHING };
          revise(cited);
        }
        // Said in the server log, so the next miss can be read: the model's own words and why it stopped (never a key).
        else
          console.warn("cite pass added no citations", {
            finishReason: c.finishReason,
            offered: c.offered,
            placed: c.placed,
            rejected: c.rejected.slice(0, 10),
            chars: c.raw.length,
            raw: c.raw.slice(0, 600),
          });
      } catch (e) {
        console.error("cite pass failed", e);
      }
      if (!cited) revise({ status: "failed", error: "no citations added" });
    }

    // Only an answer that cites messages has claims to check. A question back cites none and used no tool, and gets
    // no line (QA 2026-09-25); an answer from the tools that still cites nothing says so under it (QA 2026-09-26).
    if (cites()) {
      verdict({ status: "running" });
      try {
        // Weak claims are corrected before the reader is shown a verdict; the revision part carries the corrected
        // text, which the client renders in place of the streamed one (evidence.ts). After a cite pass, a correction
        // that was not kept, or failed, puts the cited text back on screen rather than the uncited stream.
        // The per-day rates the tools gave, this turn and before: a stated rate that matches none is corrected (rates.ts).
        const checked = await checkAndRevise(
          answer,
          retrieved,
          turn.history,
          { revision: (r) => revise(afterCite(r, cited)) },
          knownRates(turn.history),
        );
        answer = checked.text;
        out.checked = checked.verification;
        verdict({ status: "done", ...checked.verification });
      } catch (e) {
        verdict({ status: "failed", error: String(e).slice(0, 300) });
      }
    } else if (grounding.kind === "uncited" && answer.trim()) {
      // An answer with no words gets no line: the page says it is unfinished and offers to ask again (chat-state.ts).
      // (open item 2026-09-26: D45) Its rates and directions are still checked against the counts, in code; only a
      // mismatch costs a call, one rewrite, and a rate still wrong after it is said under the answer.
      const known = knownRates(turn.history);
      let line: VerificationPart = { status: "uncited", read: grounding.read };
      if (countMismatches(answer, known, toolTrends(turn.history))) {
        verdict({ status: "running" });
        const counted = await correctCounts(answer, turn.history, known, { revision: revise });
        answer = counted.text;
        if (counted.rates.length) line = { status: "uncited", read: grounding.read, rates: counted.rates };
      }
      verdict(line);
    }
  } finally {
    // Every way out closes what it opened (review 2026-09-26): a part left "running" is saved that way, and a reopened
    // chat said "Finding the messages behind each point…" for ever.
    if (out.revision?.status === "running") revise(cited ?? { status: "failed", error: "not finished" });
    if (out.verification?.status === "running") verdict({ status: "failed", error: "not finished" });
  }
  out.text = answer;
  return out;
}
