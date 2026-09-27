import type { ModelMessage } from "ai";
import { claimsOf } from "@/lib/claims";
import { withoutDates } from "@/lib/dates-in-text";

// A per-day rate in an answer must be one the tools worked out. QA 2026-09-26: "And in July?" said "about 7
// conversations per day versus 9 per day in September", but September in the data is 1-24 September, 271 over 24 days,
// 11.3 per day: the model had divided by 30 itself. The tools state every rate they work out in one fixed form, "N per
// day over D days" (for-model.ts aggregateForModel and scanForModel, from the days each period actually covers, clipped
// to the data), so what the model was given can be read back from what it read, this turn and the turns before.
// The claim check (verify.ts) flags a stated rate that matches none of them, and the correction is told the real ones.
// Pure, tested in rates.test.ts.

export type KnownRate = { value: number; words: string };
export type RateCheck = { claim: string; stated: string; known: string[] };

// Exactly the tools' own form, and nothing looser: a rate the model wrote is never taken for one a tool gave.
const TOOL_RATE = /(\d+(?:\.\d+)?) per day over (\d+) days?/g;

/** Every per-day rate the tools gave in this conversation, from the text of their results. */
export function knownRates(history: ReadonlyArray<ModelMessage>): KnownRate[] {
  const out = new Map<string, KnownRate>();
  for (const m of history) {
    if (!Array.isArray(m.content)) continue;
    for (const p of m.content as Array<{ type: string; output?: unknown }>) {
      if (p.type !== "tool-result") continue;
      const o = p.output as { value?: unknown } | undefined;
      const text = typeof o?.value === "string" ? o.value : JSON.stringify(o?.value ?? "");
      for (const r of text.matchAll(TOOL_RATE)) out.set(r[0], { value: Number(r[1]), words: r[0] });
    }
  }
  return [...out.values()];
}

/** Every number the tools worked out this conversation (counts, rates, moods, days), from their results' own lines:
 *  the printed conversations are left out, since what a message says is checked against that message, not against any
 *  message the tools happened to show (verify.ts). */
export function toolFigures(history: ReadonlyArray<ModelMessage>): number[] {
  const out = new Set<number>();
  for (const m of history) {
    if (!Array.isArray(m.content)) continue;
    for (const p of m.content as Array<{ type: string; output?: unknown }>) {
      if (p.type !== "tool-result") continue;
      const o = p.output as { value?: unknown } | undefined;
      const text = typeof o?.value === "string" ? o.value : JSON.stringify(o?.value ?? "");
      for (const line of text.split("\n")) {
        if (/^## conversation\b/.test(line)) break; // the printed conversations start here and run to the end
        if (/\[msg\d+\]/.test(line)) continue;
        for (const n of figuresIn(line)) out.add(n.value);
      }
    }
  }
  return [...out];
}

/** The numbers written in a text, dates and release numbers left out: "25%" and "25 percent" are both 25. */
export function figuresIn(text: string): { value: number; words: string; decimals: number }[] {
  return [
    ...withoutDates(text).matchAll(
      /(?<![\p{L}\d.,])(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(?:\s*(%|percent\b|per cent\b))?/giu,
    ),
  ].map((m) => ({
    value: Number(`${m[1].replace(/,/g, "")}${m[2] ? `.${m[2]}` : ""}`),
    words: m[0].trim(),
    decimals: m[2]?.length ?? 0,
  }));
}

// A number, then at most a count noun of the data, then a per-day unit: "about 7 conversations per day", "9 per day",
// "11.3 complaint threads a day", "4.6/day", "12 posts daily". Review 2026-09-26: any three words were taken, so "3
// crashes per day [msg1]" and "100 gems per day" (what players said, not a count of ours) were flagged, and each false
// flag cost a rewrite told to remove a correct sentence. Only the nouns the tools count are a rate of ours, with at most
// one word before them ("complaint threads", "help requests"); a figure with no noun ("9 per day") is one too.
const COUNT_NOUN = String.raw`(?:conversations?|threads?|messages?|posts?|comments?|replies|complaints?|reports?|requests?|mentions?|questions?)`;
const NOUN_BEFORE = String.raw`(?:complaint|bug|help|feature|support|new|relevant|negative|positive|related)`;
// "per day", "per-day", "a day", "/day", "daily". A week's figure is left out on purpose: the by-week counts give a
// count for each week, not a rate, so "63 complaints per week" is usually a week's own count, and checking it against
// a daily rate times seven would flag it when it is right.
const PER_DAY = String.raw`(?:\s*(?:per[\s-]|a\s|\/\s?)day\b|\s+daily\b)`;
const STATED = new RegExp(
  String.raw`(?<![\p{L}\d.,])(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(?:\s+(?:${NOUN_BEFORE}\s+)?${COUNT_NOUN})?${PER_DAY}`,
  "giu",
);

// Half a unit of a figure's last decimal: 0.5 for "7", 0.05 for "11.3", 0.005 for "11.29".
const halfUnit = (decimals: number) => 0.5 * 10 ** -decimals;
const decimalsOf = (words: string) => /^\d+(?:\.(\d+))?/.exec(words)?.[1]?.length ?? 0;

/** The rates an answer states that no tool gave. A stated rate matches a tool's within half a unit of whichever of the
 *  two is written less precisely: "about 7" matches 7.1; "11.29" matches the tools' 11.3 (itself rounded, 271/24 is
 *  11.29), and "0.04" their "0.0" (review 2026-09-26: both were flagged); "11.2" does not match 11.3. */
export function rateMismatches(answer: string, known: ReadonlyArray<KnownRate>): RateCheck[] {
  const out: RateCheck[] = [];
  for (const { claim } of claimsOf(answer))
    for (const m of claim.matchAll(STATED)) {
      const stated = Number(`${m[1].replace(/,/g, "")}${m[2] ? `.${m[2]}` : ""}`);
      const statedHalf = halfUnit(m[2]?.length ?? 0);
      const matches = known.some(
        (k) => Math.abs(k.value - stated) <= Math.max(statedHalf, halfUnit(decimalsOf(k.words))) + 1e-9,
      );
      if (!matches)
        out.push({
          claim,
          stated: m[0].replace(new RegExp(`${PER_DAY}$`, "iu"), "").trim(),
          known: known.map((k) => k.words),
        });
    }
  return out;
}
