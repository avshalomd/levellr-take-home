// Turning a selection on the Explore grid into words: the panel's title ("Pricing and Support, 7–20 Sep"), the
// question it prefills for the chat ("What were people saying about pricing and support between 7 and 20 September
// 2026?"),
// the comparison it prefills when two separate blocks are picked, and the one-tap rewrites offered under the field.
// Pure, so the phrasing is pinned by insights-question.test.ts. Nothing here assumes a community, a product or a topic
// set.

import {
  addDays,
  dayMonth,
  dayOf,
  dayRange,
  moodOf,
  monthName,
  periodSpan,
  type Agg,
  type Period,
  type Resolution,
} from "./insights-model";

export type SelectedCell = { topic: string; period: Period };
export type Topic = { key: string; name: string };
export type Window = { from: string; to: string };

/** "a", "a and b", "a, b and c". */
export function listJoin(xs: string[]): string {
  if (xs.length <= 1) return xs[0] ?? "";
  return `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

/** A topic name as it reads mid-sentence: "Performance & Access" -> "performance & access". Acronyms and mixed-case
 * words ("AI", "PvP", "iOS") keep their case; so does a name whose later words are lower-case except for such words. */
export function inSentence(name: string): string {
  const keep = (w: string) => /^[A-Z0-9]{2,}$/.test(w) || /[a-z][A-Z]/.test(w);
  const lower = (w: string) => (keep(w) ? w : w[0].toLowerCase() + w.slice(1));
  const words = name.split(/(\s+)/);
  const plain = words.filter((w) => /^[A-Za-z]/.test(w) && !keep(w));
  const titleCase = plain.length >= 2 && plain.every((w) => /^[A-Z]/.test(w));
  if (titleCase) return words.map((w) => (/^[A-Za-z]/.test(w) ? lower(w) : w)).join("");
  return words.map((w, i) => (i === 0 && /^[A-Za-z]/.test(w) ? lower(w) : w)).join("");
}

/** Periods split into runs of neighbours (by their position on the axis). */
export function runs(periods: Period[], all: Period[]): Period[][] {
  const idx = (p: Period) => all.findIndex((x) => x.key === p.key);
  const sorted = [...new Map(periods.map((p) => [p.key, p])).values()].sort((a, b) => idx(a) - idx(b));
  const out: Period[][] = [];
  for (const p of sorted) {
    const last = out[out.length - 1];
    if (last && idx(p) === idx(last[last.length - 1]) + 1) last.push(p);
    else out.push([p]);
  }
  return out;
}

/** One run of periods as a span of days, clipped to the data window. */
function span(run: Period[], w: Window) {
  return { first: periodSpan(run[0], w).first, last: periodSpan(run[run.length - 1], w).last };
}

// ---------- dates in a question carry their year ----------
// (open item 2026-09-26, left in round 0: "between 18 June and 24 September" named no year.) A question goes to the chat
// and is read there on its own, so every date in it says its year - taken from the date itself, which comes from the
// dataset's periods, never written here. Where the dates of one phrase share a year it is written once, at the end:
// "between 18 June and 24 September 2026", "in the weeks of 6–27 July and 24 August 2026"; across a new year each end
// carries its own: "between 28 December 2025 and 3 January 2026". Titles ("7–20 Sep") are display and stay as they are.

const yearOf = (iso: string) => iso.slice(0, 4);
/** "7 September", or "7 September 2026" with `y`. */
const dayY = (iso: string, y: boolean) => (y ? `${dayMonth(iso, false)} ${yearOf(iso)}` : dayMonth(iso, false));
/** "July", or "July 2026" with `y`. */
const monthY = (iso: string, y: boolean) => (y ? `${monthName(iso)} ${yearOf(iso)}` : monthName(iso));

/** A date or a stretch of dates in a question, written with its year at its end (`y`) or without it. */
type Dated = { first: string; last: string; words: (y: boolean) => string };

/** Two days as a range: "7–20 September 2026", "25 August – 7 September 2026", "28 December 2025 – 3 January 2026". */
const daysItem = (a: string, b: string): Dated => ({
  first: a,
  last: b,
  words: (y) => {
    if (a === b) return dayY(a, y);
    if (a.slice(0, 7) === b.slice(0, 7)) return `${dayOf(a)}–${dayY(b, y)}`;
    const cross = yearOf(a) !== yearOf(b);
    return `${dayY(a, cross)} – ${dayY(b, y || cross)}`;
  },
});

/** A month, or months: "July 2026", "July to September 2026", "December 2025 to January 2026". */
const monthsItem = (a: string, b: string): Dated => ({
  first: a,
  last: b,
  words: (y) => {
    if (a === b) return monthY(a, y);
    const cross = yearOf(a) !== yearOf(b);
    return `${monthY(a, cross)} to ${monthY(b, y || cross)}`;
  },
});

/** Several dates in one list: the year once, after the last, when they all share it; otherwise after each. */
function withYears(items: Dated[]): string {
  const years = new Set(items.flatMap((i) => [yearOf(i.first), yearOf(i.last)]));
  return listJoin(items.map((i, k) => i.words(years.size > 1 || k === items.length - 1)));
}

/** "between 7 and 20 September 2026", "between 18 June and 24 September 2026", "between 28 December 2025 and 3 January 2026". */
function betweenDays(a: string, b: string): string {
  if (a.slice(0, 7) === b.slice(0, 7)) return `between ${dayOf(a)} and ${dayY(b, true)}`;
  return `between ${dayY(a, yearOf(a) !== yearOf(b))} and ${dayY(b, true)}`;
}

/** A run of periods as it reads in a question, preposition included. */
function runPhrase(run: Period[], res: Resolution, w: Window): string {
  if (res === "month") {
    const a = run[0].start, b = run[run.length - 1].start;
    return run.length === 1 ? `in ${monthY(a, true)}` : `between ${monthY(a, yearOf(a) !== yearOf(b))} and ${monthY(b, true)}`;
  }
  const { first, last } = span(run, w);
  if (first === last) return `on ${dayY(first, true)}`;
  if (res === "week" && run.length === 1 && !run[0].partial) return `in the week of ${dayY(first, true)}`;
  return betweenDays(first, last);
}

/** When, for a question: "between 7 and 20 September 2026", "in July 2026", "in the weeks of 7 and 21 September 2026". */
export function whenPhrase(periods: Period[], all: Period[], res: Resolution, w: Window): string {
  const rs = runs(periods, all);
  if (!rs.length) return "";
  if (rs.length === 1) return runPhrase(rs[0], res, w);
  if (rs.length <= 3) {
    // Each stretch named: "in the weeks of 6–27 July and 24 August 2026", "on 3–5 July and 12 July 2026", "in July and
    // September 2026".
    if (res === "month") return `in ${withYears(rs.map((r) => monthsItem(r[0].start, r[r.length - 1].start)))}`;
    if (res === "day") return `on ${withYears(rs.map((r) => span(r, w)).map(({ first, last }) => daysItem(first, last)))}`;
    return `in the weeks of ${withYears(rs.map((r) => daysItem(periodSpan(r[0], w).first, periodSpan(r[r.length - 1], w).first)))}`;
  }
  const first = span(rs[0], w).first, last = span(rs[rs.length - 1], w).last;
  const unit = res === "day" ? "days" : res === "week" ? "weeks" : "months";
  return `on ${periods.length} separate ${unit} ${betweenDays(first, last)}`;
}

/** When, for a title: "7–20 Sep", "July", "July – Sep", "3 days, 3–17 Sep". */
export function whenShort(periods: Period[], all: Period[], res: Resolution, w: Window): string {
  const rs = runs(periods, all);
  if (!rs.length) return "";
  if (res === "month") {
    if (rs.length === 1) {
      const a = monthName(rs[0][0].start), b = monthName(rs[0][rs[0].length - 1].start);
      return a === b ? a : `${a} – ${b}`;
    }
    return listJoin(rs.flat().map((p) => monthName(p.start, true)));
  }
  const first = span(rs[0], w).first, last = span(rs[rs.length - 1], w).last;
  if (rs.length === 1) return dayRange(first, last);
  const unit = res === "day" ? "days" : "weeks";
  return `${periods.length} ${unit}, ${dayRange(first, last)}`;
}

export type Described = {
  title: string; // "Pricing and Support"
  when: string; // "7–20 Sep"
  question: string; // the primary "Ask about this" question
  aboutTopics: string; // "about pricing and support", or "" for every topic
  whenLong: string;
  rectangular: boolean;
  first: string; // first and last day covered
  last: string;
};

function topicsTitle(names: string[], total: number): string {
  if (names.length === total && total > 1) return "All topics";
  if (names.length <= 3) return listJoin(names);
  return `${names.length} topics`;
}

function topicsAbout(names: string[], total: number): string {
  if (names.length === total && total > 1) return "";
  const lower = names.map(inSentence);
  if (lower.length <= 4) return `about ${listJoin(lower)}`;
  return `about ${lower.slice(0, 3).join(", ")} and ${lower.length - 3} other topics`;
}

/** Everything the panel says about a selection. `topics` is the grid's row order; `all` its column order. */
export function describe(cells: SelectedCell[], topics: Topic[], all: Period[], res: Resolution, w: Window): Described {
  const byTopic = new Map<string, Period[]>();
  for (const c of cells) byTopic.set(c.topic, [...(byTopic.get(c.topic) ?? []), c.period]);
  const order = topics.filter((t) => byTopic.has(t.key));
  const names = order.map((t) => t.name);
  const periods = [...new Map(cells.map((c) => [c.period.key, c.period])).values()];
  const periodSets = order.map((t) => byTopic.get(t.key)!.map((p) => p.key).sort().join());
  const rectangular = periodSets.every((s) => s === periodSets[0]);

  const rs = runs(periods, all);
  const first = rs.length ? span(rs[0], w).first : "";
  const last = rs.length ? span(rs[rs.length - 1], w).last : "";
  const whenLong = whenPhrase(periods, all, res, w);
  const about = topicsAbout(names, topics.length);

  let question: string;
  if (rectangular || order.length > 3) {
    question = about
      ? `What were people saying ${about} ${whenLong}?`
      : `What were people talking about ${whenLong}?`;
  } else {
    // A different stretch of time per topic: say each one, so the chat reads the same cells the grid shows.
    const parts = order.map((t) => `${inSentence(t.name)} ${whenPhrase(byTopic.get(t.key)!, all, res, w)}`);
    question = `What were people saying about ${parts.join(", and about ")}?`;
  }
  return {
    title: topicsTitle(names, topics.length),
    when: whenShort(periods, all, res, w),
    question,
    aboutTopics: about,
    whenLong,
    rectangular,
    first,
    last,
  };
}

// ---------- when, as a noun ----------

/** A run of periods as a noun, for the far side of a comparison: "the week of 7 September 2026", "7–20 September
 *  2026", "July 2026". */
function runNoun(run: Period[], res: Resolution, w: Window): Dated {
  if (res === "month") return monthsItem(run[0].start, run[run.length - 1].start);
  const { first, last } = span(run, w);
  if (res === "week" && run.length === 1 && !run[0].partial && first !== last) {
    return { first, last: first, words: (y) => `the week of ${dayY(first, y)}` };
  }
  return daysItem(first, last);
}

/** When, as a noun: "the week of 7 September 2026", "3 July and 12 July 2026", "5 separate weeks between 6 July and 20
 *  September 2026". */
export function whenNoun(periods: Period[], all: Period[], res: Resolution, w: Window): string {
  const items = nounItems(periods, all, res, w);
  if (items) return withYears(items);
  const rs = runs(periods, all);
  const unit = res === "day" ? "days" : res === "week" ? "weeks" : "months";
  return `${periods.length} separate ${unit} ${betweenDays(span(rs[0], w).first, span(rs[rs.length - 1], w).last)}`;
}

/** The stretches a noun names one by one, or null when there are too many to name (they are counted instead). */
function nounItems(periods: Period[], all: Period[], res: Resolution, w: Window): Dated[] | null {
  const rs = runs(periods, all);
  return rs.length <= 3 ? rs.map((r) => runNoun(r, res, w)) : null;
}

/** Several blocks' times in one list, the year once at the end when they share it: "the week of 7 September and
 *  21–24 September 2026". */
function nounList(parts: Part[]): string {
  const items = parts.map((p) => p.nounItems);
  return items.every((i): i is Dated[] => i !== null && i.length > 0) ? withYears(items.flat()) : listJoin(parts.map((p) => p.whenNoun));
}

// ---------- comparing blocks ----------

type Part = { about: string; when: string; whenNoun: string; nounItems: Dated[] | null; periods: string };

function part(block: SelectedCell[], topics: Topic[], all: Period[], res: Resolution, w: Window): Part {
  const keys = new Set(block.map((c) => c.topic));
  const names = topics.filter((t) => keys.has(t.key)).map((t) => t.name);
  const periods = [...new Map(block.map((c) => [c.period.key, c.period])).values()];
  return {
    about: topicsAbout(names, topics.length),
    when: whenPhrase(periods, all, res, w),
    whenNoun: whenNoun(periods, all, res, w),
    nounItems: nounItems(periods, all, res, w),
    periods: periods.map((p) => p.key).sort().join(),
  };
}

const about = (p: Part) => p.about || "across all topics";

/** Most separate blocks a comparison is written for; past this the selection reads as one scattered set. */
export const MAX_COMPARED = 4;

/**
 * The question for two or more separate blocks: "How did what people said about A <then> compare with <B>?". When the
 * blocks share their topics only the time is repeated ("…in the week of 7 September compare with the week of 14
 * September?"), when they share their time only the topics are ("…about A compare with what they said about B, in the
 * week of 7 September?"). Null for one block, or for more blocks than a question can carry.
 */
export function comparison(blockCells: SelectedCell[][], topics: Topic[], all: Period[], res: Resolution, w: Window): string | null {
  if (blockCells.length < 2 || blockCells.length > MAX_COMPARED) return null;
  const [a, ...rest] = blockCells.map((b) => part(b, topics, all, res, w));
  if (rest.every((b) => b.about === a.about)) {
    return `How did what people said ${a.about ? `${a.about} ` : ""}${a.when} compare with ${nounList(rest)}?`;
  }
  if (rest.every((b) => b.periods === a.periods)) {
    return `How did what people said ${about(a)} compare with what they said ${listJoin(rest.map(about))}, ${a.when}?`;
  }
  return `How did what people said ${about(a)} ${a.when} compare with what they said ${listJoin(rest.map((b) => `${about(b)} ${b.when}`))}?`;
}

// ---------- the one-tap rewrites ----------

/** A rewrite of the question field: a short label for the chip and the full question it puts in the field. */
export type Suggestion = { id: string; label: string; question: string };

/** The stretch of the same length just before a selection's periods, when they form one run that has one. */
export function periodsBefore(periods: Period[], all: Period[]): Period[] | null {
  const rs = runs(periods, all);
  if (rs.length !== 1) return null;
  const i = all.findIndex((p) => p.key === rs[0][0].key);
  if (i <= 0) return null;
  return all.slice(Math.max(0, i - rs[0].length), i);
}

const unitWord = (res: Resolution, n: number) => (res === "day" ? (n === 1 ? "day" : "days") : res === "week" ? (n === 1 ? "week" : "weeks") : n === 1 ? "month" : "months");

/**
 * The chips under the question field, the default first. One block: what was said; the same topics in the stretch
 * just before; the same time in the other topics; why the mood ran low or high when it clearly did; an event inside
 * it. Two or more blocks: the comparison, then all of it as one question. Every one is a full question with its
 * dates written out, so the chat never has to guess what "the week before" means.
 */
export function suggestions(args: {
  cells: SelectedCell[];
  blocks: SelectedCell[][];
  topics: Topic[];
  all: Period[];
  res: Resolution;
  w: Window;
  sel: Agg;
  population: Agg;
}): Suggestion[] {
  const { cells, blocks, topics, all, res, w, sel, population } = args;
  const d = describe(cells, topics, all, res, w);
  const compare = comparison(blocks, topics, all, res, w);
  if (compare) {
    return [
      { id: "compare", label: blocks.length === 2 ? "Compare the two" : `Compare the ${blocks.length}`, question: compare },
      { id: "together", label: "Ask about all of it together", question: d.question },
    ];
  }

  const out: Suggestion[] = [{ id: "what", label: "What was said", question: d.question }];
  const periods = [...new Map(cells.map((c) => [c.period.key, c.period])).values()];
  const where = d.aboutTopics ? `${d.aboutTopics} ` : "";

  const before = periodsBefore(periods, all);
  if (before) {
    const n = before.length; // can be shorter than the selection when it starts near the beginning of the data
    out.push({
      id: "before",
      label: `Compare with the ${n === 1 ? "" : `${n} `}${unitWord(res, n)} before`,
      question: `How did what people said ${where}${d.whenLong} compare with ${whenNoun(before, all, res, w)}?`,
    });
  }

  const chosen = new Set(cells.map((c) => c.topic));
  if (chosen.size < topics.length) {
    const n = periods.length;
    const same = res === "day" ? `on the same ${unitWord(res, n)}` : `in the same ${unitWord(res, n)}`;
    out.push({
      id: "others",
      label: "Compare with the other topics",
      question: `How did what people said ${where}${d.whenLong} compare with what they said about the other topics ${same}?`,
    });
  }

  const gap = moodOf(sel) - moodOf(population);
  if (sel.moodN >= 10 && Math.abs(gap) >= 3) {
    const convs = `conversations ${where}${d.whenLong}`;
    out.push(
      gap < 0
        ? { id: "mood", label: "Why the mood was low", question: `What made the mood lower than usual in ${convs}?` }
        : { id: "mood", label: "What lifted the mood", question: `What made people sound more positive than usual in ${convs}?` },
    );
  }
  return out;
}

/** The chat deep link the page navigates to. The chat page sends `q` as its first question. */
export const askHref = (question: string) => `/?q=${encodeURIComponent(question)}`;

/** The day after a span, for exclusive date ranges in queries. */
export const dayAfter = (iso: string) => addDays(iso, 1);
