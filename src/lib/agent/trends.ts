import type { ModelMessage } from "ai";
import { claimsOf } from "@/lib/claims";
import { rateMismatches, type KnownRate } from "./rates";
import { CATEGORIES, time, type SliceFilters } from "./slices";

// How a count changed between two periods, worked out in code and checked in code (production QA 2026-09-26).
//  - "Which topics grew the most from August to September?" was answered with +124%, from rates rounded to one decimal;
//    113 over 24 days against 66 over 31 is +121%. The aggregate tool now works the change out from the unrounded
//    rates and hands it to the model in one fixed form (changeWords), the way it hands per-day rates.
//  - "The September lift in Performance & Access and Updates & Feedback…": Updates & Feedback fell, 10.0 to 9.4 a day.
//    A direction word about a named topic or kind is read against the changes the tools gave (directionMismatches),
//    and a wrong one goes to the rewrite like a wrong rate (revise.ts).
// Pure, tested in trends.test.ts.

export type Period = { since: string; until: string; days: number };
/** A count as the aggregate tool returns it, with its period and a name for each row. */
export type CountLike = {
  metric: string;
  groupBy: string;
  filters: SliceFilters;
  rows: { key: string; value: number }[];
  period?: Period | null;
};
export type ChangeRow = { name: string; pct: number };
export type Change = { metric: string; from: Period; to: Period; rows: ChangeRow[] };

// Only counts add up over days, so only they have a per-day rate to compare. A mood's change is left out: it is a
// score, not a rate, and the QA case was about counts.
const RATED = new Set(["conversations", "messages", "engagement", "reactions"]);

/** The change per day from the latest earlier count of the same slice, grouped the same way, over a separate period.
 *  `nameOf` names a row as the reader knows it ("Updates & Feedback", "complaints"). Undefined when there is none. */
export function changeAgainst(earlier: ReadonlyArray<CountLike>, next: CountLike, nameOf: (key: string, f: SliceFilters) => string): Change | undefined {
  if (!RATED.has(next.metric) || !next.period?.days || !next.filters.since || !next.filters.until) return undefined;
  const prev = [...earlier].reverse().find(
    (c) =>
      c.metric === next.metric &&
      c.groupBy === next.groupBy &&
      !!c.period?.days &&
      !!c.filters.since &&
      !!c.filters.until &&
      CATEGORIES.every((k) => (c.filters[k] ?? "") === (next.filters[k] ?? "")) &&
      (time(c.filters.until, Infinity) <= time(next.filters.since, -Infinity) || time(next.filters.until, Infinity) <= time(c.filters.since, -Infinity)),
  );
  if (!prev) return undefined;
  const [a, b] = time(prev.filters.since, 0) < time(next.filters.since, 0) ? [prev, next] : [next, prev];
  const before = new Map(a.rows.map((r) => [r.key, r.value / a.period!.days]));
  const rows = b.rows
    .filter((r) => (before.get(r.key) ?? 0) > 0)
    .map((r) => ({ name: nameOf(r.key, b.filters), pct: ((r.value / b.period!.days) / before.get(r.key)! - 1) * 100 }));
  return rows.length ? { metric: next.metric, from: a.period!, to: b.period!, rows } : undefined;
}

// U+2212, a minus sign, not a hyphen (production QA 2026-09-26, F).
export const pctWords = (p: number) => {
  const r = Math.round(p);
  return r === 0 ? "0%" : `${r > 0 ? "+" : "−"}${Math.abs(r)}%`;
};

const DAY = 86_400_000;
const lastDay = (until: string) => new Date(Date.parse(`${until.slice(0, 10)}T00:00:00Z`) - DAY).toISOString().slice(0, 10);

/** The change as the model reads it, in one fixed form that toolTrends reads back. */
export function changeWords(c: Change): string {
  return (
    `Change in ${c.metric} per day, ${c.from.since} to ${lastDay(c.from.until)} against ${c.to.since} to ${lastDay(c.to.until)}: ` +
    c.rows.map((r) => `${r.name} ${pctWords(r.pct)}`).join("; ") +
    ".\nGive a change between these periods as this percentage, worked out from the unrounded rates; never work one out " +
    "yourself. Say it rose only where it is +, fell only where it is −."
  );
}

const CHANGE_LINE = /^Change in (\w+) per day, [\d-]+ to [\d-]+ against [\d-]+ to [\d-]+: (.+)\.$/;

/** Every change the tools gave in this conversation, from the text of their results (changeWords). */
export function toolTrends(history: ReadonlyArray<ModelMessage>): ChangeRow[] {
  const out: ChangeRow[] = [];
  for (const m of history) {
    if (!Array.isArray(m.content)) continue;
    for (const p of m.content as Array<{ type: string; output?: unknown }>) {
      if (p.type !== "tool-result") continue;
      const o = p.output as { value?: unknown } | undefined;
      const text = typeof o?.value === "string" ? o.value : "";
      for (const line of text.split("\n")) {
        const c = CHANGE_LINE.exec(line);
        if (!c) continue;
        for (const item of c[2].split("; ")) {
          const r = /^(.+) ([+−]?)(\d+)%$/.exec(item);
          if (r) out.push({ name: r[1], pct: (r[2] === "−" ? -1 : 1) * Number(r[3]) });
        }
      }
    }
  }
  return out;
}

// Direction words, kept narrow as the rate check's nouns are: "up" and "down" only where they state a change ("went
// up", "is down", "up 12%"), never "set up" or "up to"; "higher than" compares two topics, not two periods.
const UP = /\b(?:rose|risen|rises?|rising|grew|grown|grows?|growing|lift(?:ed|s)?|increas(?:e|ed|es|ing)|climb(?:ed|s)?|jump(?:ed|s)?|higher(?! than)|(?:went|go(?:es)?|is|was|are|were) up(?! to\b)|up (?:from|by|\d))\b/i;
const DOWN = /\b(?:fell|fallen|falls?|falling|dropp?(?:ed|s)?|declin(?:e|ed|es|ing)|decreas(?:e|ed|es|ing)|lower(?! than)|(?:went|go(?:es)?|is|was|are|were) down|down (?:from|by|\d))\b/i;
// A sentence with both ways in it is read part by part.
const PARTS = /\s*(?:;|\bwhile\b|\bwhereas\b|\bbut\b|,\s*and\b)\s*/i;

export type DirectionCheck = { claim: string; name: string; said: "rose" | "fell"; pct: number };

// A topic's name is matched as written, capitals and all (open item 2026-09-26, live: the topic "Other" matched "Most
// other topics fell", flagging a correct answer and costing a rewrite); a kind the tools name in lower case
// ("complaints") is matched in any case.
const mentions = (text: string, name: string) => {
  const [t, n] = /^\p{Lu}/u.test(name) ? [text, name] : [text.toLowerCase(), name.toLowerCase()];
  return t.includes(n) || t.includes(n.replace(/ & /g, " and "));
};

/** The directions an answer states that the tools' changes contradict: "rose" about a topic whose rate fell, and the
 *  other way round. Only a topic or kind named as the tools named it ("Updates & Feedback", "complaints") is read; a
 *  part saying both ways is left alone. */
export function directionMismatches(answer: string, trends: ReadonlyArray<ChangeRow>): DirectionCheck[] {
  if (!trends.length) return [];
  const out: DirectionCheck[] = [];
  for (const { claim } of claimsOf(answer))
    for (const part of claim.split(PARTS)) {
      const up = UP.test(part);
      const down = DOWN.test(part);
      if (up === down) continue;
      for (const t of trends) {
        if (!mentions(part, t.name)) continue;
        const wrong = (up && Math.round(t.pct) < 0) || (down && Math.round(t.pct) > 0) || Math.round(t.pct) === 0;
        if (wrong && !out.some((o) => o.claim === claim && o.name === t.name)) out.push({ claim, name: t.name, said: up ? "rose" : "fell", pct: t.pct });
      }
    }
  return out;
}

/** How many rates and directions an answer states that the tools' counts contradict (rateMismatches plus
 *  directionMismatches): what an answer that cites nothing is checked on (open item 2026-09-26, revise.ts correctCounts). */
export const countMismatches = (answer: string, known: ReadonlyArray<KnownRate>, trends: ReadonlyArray<ChangeRow>) =>
  rateMismatches(answer, known).length + directionMismatches(answer, trends).length;
