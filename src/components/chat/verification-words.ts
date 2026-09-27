import type { CorroborationPart } from "@/lib/agent/corroborate";
import type { RevisionPart } from "@/lib/agent/revise";
import type { VerificationPart } from "@/lib/agent/ui-types";

// The claim check, said in one plain sentence under the answer. The check runs after the answer is written; weak
// claims are then rewritten once (the revision part) and checked again, so the sentence moves through three states:
// checking, tightening, checked. It reports; it never alarms. Kept free of React so it is unit-tested.

// `weak`: fewer than half the checked claims are backed. The bar then shows a warning, never a check mark: "✓ Checked:
// 0 of 3 claims are backed" read as a pass (QA 2026-09-27).
export type VerificationWords = {
  state: "checking" | "tightening" | "checked" | "quiet";
  text: string;
  note?: string;
  weak?: true;
};

const claims = (n: number) => `${n} ${n === 1 ? "claim" : "claims"}`;

export function verificationWords(v?: VerificationPart, r?: RevisionPart): VerificationWords | null {
  if (!v) return null;
  // While the rewrite runs the verification part still says "running": the revision is the more precise news.
  if (r?.status === "running" && r.cite) return { state: "tightening", text: "Finding the messages behind each point…" };
  // (open item 2026-09-26) An uncited answer's rewrite corrects rates and directions against the counts, not messages.
  if (r?.status === "running" && r.counts) return { state: "tightening", text: `Correcting ${claims(r.weak)} to match the counts…` };
  if (r?.status === "running") return { state: "tightening", text: `Tightening ${claims(r.weak)} to match what the messages say…` };
  if (v.status === "running") return { state: "checking", text: "Checking each claim against the messages it cites…" };
  if (v.status === "failed") return { state: "quiet", text: "The claims could not be checked this time." };
  // An answer from the tools that cites nothing says so, in the place the check's line would be: blank, five points
  // quoting thread titles read as checked (QA 2026-09-26, lib/agent/grounding.ts).
  // Its rates are checked against the counts, though (open item 2026-09-26): one still wrong after the correction is
  // said, in the words a cited answer's line uses.
  if (v.status === "uncited") {
    const note = [ratesNote(v.rates), sourcelessNote(v.sourceless)].filter(Boolean).join(" ");
    return {
      state: "quiet",
      text: v.read
        ? "No messages are cited here, so this answer was not checked against any."
        : v.sourceless?.length
          ? "No messages are cited here, and nothing in this chat counted its figures."
          : "Counts only: no messages are cited, so this answer was not checked against any.",
      ...(note ? { note } : {}),
      ...(v.sourceless?.length ? { weak: true as const } : {}),
    };
  }
  // An answer that cites no message - a refusal, a question back, a count from the tools - has no line: the missing
  // chips already say it, and "nothing to check" under "I can't access live weather data." read as a fault (QA 2026-09-25).
  if (v.cited === 0) return null;

  // A claim the check never reached (Jev busy or down) is said apart, never counted as unbacked (QA 2026-09-27).
  const unchecked = v.unchecked ?? 0;
  const n = v.cited - unchecked;
  if (n === 0) return { state: "quiet", text: "The claims could not be checked this time." };
  const all = n === 1 ? "the claim is" : n === 2 ? "both claims are" : `all ${n} claims are`;
  const weak = v.supported * 2 < n || Boolean(v.sourceless?.length);
  const none = n === 2 ? "Neither claim" : `None of the ${n} claims`;
  const text =
    (v.supported === n
      ? `Checked: ${all} backed by the messages they cite`
      : v.supported === 0
        ? n === 1
          ? "The claim could not be backed by the message it cites"
          : `${none} could be backed by the messages they cite`
        : weak
          ? `Only ${v.supported} of ${claims(n)} ${v.supported === 1 ? "is" : "are"} backed by the messages they cite`
          : `Checked: ${v.supported} of ${claims(n)} are backed by the messages they cite`) +
    (unchecked ? `; ${unchecked} more could not be checked` : "");
  // A kept cite pass only added citations (r.cite), so it gets no note: "tightened" said wording changed when none had
  // (review 2026-09-26).
  const tightened = r?.status === "done" && r.kept && !r.cite ? "Some wording was tightened to match what the messages say." : "";
  const note = [tightened, ratesNote(v.rates), sourcelessNote(v.sourceless)].filter(Boolean).join(" ") || undefined;
  return { state: "checked", text, note, ...(weak ? { weak: true as const } : {}) };
}

/** A per-day rate that still matches none the counts gave, after the correction (lib/agent/rates.ts, QA 2026-09-26). */
function ratesNote(rates: ReadonlyArray<unknown> | undefined): string {
  const n = rates?.length ?? 0;
  return n ? (n === 1 ? "One per-day rate here does not match the counts it comes from." : `${n} per-day rates here do not match the counts they come from.`) : "";
}

const TOOL_NAMES: Record<string, string> = { aggregate: "count", scan: "scan", voices: "count of voices" };

/** A figure tagged as counted by a tool that never ran in the chat (lib/agent/rates.ts sourcelessFigures, QA
 *  2026-09-27): which figure, and that nothing counted it. */
function sourcelessNote(s: ReadonlyArray<{ tool: string; figure: string }> | undefined): string {
  if (!s?.length) return "";
  return s
    .map((f) => `${f.figure ? `“${f.figure}”` : "A figure"} is marked as counted, but no ${TOOL_NAMES[f.tool] ?? f.tool} ran in this chat.`)
    .join(" ");
}

/** A claim as plain words: it is cut from the answer's markdown, and "**Praised:** …" showed its asterisks. */
export function plainClaim(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*|__(.+?)__/g, "$1$2")
    .replace(/(^|[\s(])[*_](\S(?:.*?\S)?)[*_](?=[\s).,;:!?]|$)/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, "$1")
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/, "")
    .trim();
}

/** How long the answer took, under it: "Answered in 12 seconds", "Answered in 1 second", never "in 0 seconds". */
export function answeredIn(ms: number | undefined): string | null {
  if (!ms || ms < 0) return null;
  if (ms < 1000) return "Answered in under a second";
  const s = Math.round(ms / 1000);
  return `Answered in ${s} ${s === 1 ? "second" : "seconds"}`;
}

const convs = (n: number) => `${n.toLocaleString("en-GB")} ${n === 1 ? "conversation" : "conversations"}`;

const READS = ["", "one", "two", "three", "four", "five", "six", "seven", "eight"];

/** What the claims were weighed against, beyond their own citations (D22): the "+N more" beside each claim counts
 *  within this. Nothing is said when there was nothing to weigh. `found` is the different conversations the reads
 *  judged to bear on the question (lib/agent/corroborate.ts poolOf), `pool` the part of them read, cut at 80. The line
 *  says both when it was cut, and "all" only when nothing was: "all 80 conversations found to bear on the question"
 *  stood under steps saying 12 and 80, and "the 80 closest" under steps saying 85 and 18, with no word that 80 was a
 *  cap (QA 2026-09-26). When several reads fed it, `found` is the conversations they found between them, each once,
 *  and is said so: a bare union read as a fourth total beside the steps' own (QA 2026-09-26, earlier). */
export function corroborationWords(c?: CorroborationPart): { running: boolean; text: string } | null {
  if (!c) return null;
  if (c.status === "running") return { running: true, text: "Counting the conversations behind each claim…" };
  if (c.status === "failed" || !c.claims.length || !c.pool) return null;
  const reads = c.reads ?? 1;
  const n = c.found.toLocaleString("en-GB");
  const by = `the ${READS[reads] ?? reads.toLocaleString("en-GB")} reads found`;
  const against =
    c.pool < c.found
      ? `the ${convs(c.pool)} closest to the question, of the ${n} ${reads > 1 ? `${by} to bear on it` : "that bore on it"}`
      : c.found === 1
        ? "the one conversation that bore on the question"
        : reads > 1
          ? `all ${n} different conversations ${by} to bear on the question`
          : `all ${n} conversations that bore on the question`;
  const lost = c.failed ? ` (${convs(c.failed)} could not be read)` : "";
  return { running: false, text: `Each claim was also checked against ${against}${lost}. The number beside a claim is how many more of them say it.` };
}
