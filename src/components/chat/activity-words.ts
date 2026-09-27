import { AGGREGATE_ROWS } from "@/lib/data/filters";
import { flagsNamed, isRefusal } from "@/lib/agent/flags";
import { isOffTopic } from "@/lib/agent/off-topic";
import { sentenceCuts } from "@/lib/claims";
import { shortDate } from "./evidence";
// sameSlice and within are shared with the claim check (lib/agent/corroborate.ts), so they live in lib (review 2026-09-26).
import { CATEGORIES, sameSlice, time, within } from "@/lib/agent/slices";

// What the agent did, in the words a community manager would use: "Read 118 complaint threads about Cheating & Bans,
// from 9 to 24 Sep", not `scan({ filters: { topic: "cheating-bans", flag: "complaint" } })`. No tool names, no ids,
// no JSON, no search strings and no filter words reach the reader (QA 2026-09-26). Topic keys are turned into the
// names the team gave them. Kept free of React so it is unit-tested.

type Filters = { topic?: string; channel?: string; since?: string; until?: string; flag?: string; author?: string };
export type StepLike = { type: string; state: string; input?: unknown; output?: unknown; errorText?: unknown };
export type StepWords = { text: string; detail?: string; running: boolean; failed: boolean; kind: "look" | "read" | "search" | "count" };

// A flag names a kind of conversation, and is said as one: "118 complaint threads", never "118 conversations,
// complaining" (QA 2026-09-26).
const KINDS: Record<string, [one: string, many: string]> = {
  complaint: ["complaint thread", "complaint threads"],
  bug: ["bug report", "bug reports"],
  feature: ["request for changes", "requests for changes"],
  help: ["request for help", "requests for help"],
};
/** The conversations a slice holds, as a noun: "conversations", or the kind its flag picks ("bug reports"). */
export const kindWords = (flag: string | undefined, n = 2) => {
  const [one, many] = (flag && KINDS[flag]) || ["conversation", "conversations"];
  return n === 1 ? one : many;
};

// The metric names as a phrase: "Worked out <phrase> in conversations about X".
const METRIC_WORDS: Record<string, string> = {
  conversations: "conversations",
  messages: "messages",
  authors: "people taking part",
  avg_sentiment: "the average mood",
  share_negative: "the share of negative conversations",
  share_bug: "the share of bug reports",
  share_feature: "the share of requests for changes",
  share_complaint: "the share of complaints",
  share_help: "the share of people asking for help",
  net_votes: "net votes",
};
// A count of things is counted; a mood or a share is worked out.
const COUNTED = new Set(["conversations", "messages", "authors", "net_votes"]);

// A chart title's grouping ("The share of complaints by week"), and a step's, said after its slice ("..., week by
// week"). A total is said too: two counts of one slice, one by week and one in total, read the same otherwise (QA
// 2026-09-26).
const GROUP_WORDS: Record<string, string> = { none: " in total", day: " by day", week: " by week", month: " by month", topic: " by topic", channel: " by channel" };
const STEP_GROUP_WORDS: Record<string, string> = { none: "", day: ", day by day", week: ", week by week", month: ", month by month", topic: ", topic by topic", channel: ", channel by channel" };

const count = (n: number) => n.toLocaleString("en-GB");
const plural = (n: number, one: string, many = `${one}s`) => `${count(n)} ${n === 1 ? one : many}`;
const times = (n: number) => (n === 1 ? "once" : n === 2 ? "twice" : `${count(n)} times`);
const NUMBER_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const inWords = (n: number) => NUMBER_WORDS[n] ?? count(n);
const listWords = (xs: string[]) => (xs.length < 2 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

// The agent writes its own sub-questions, sometimes a paragraph long. A step names what it was about in the agent's
// plain words for the reader (the tools' `about`); an older step without them quotes its question's first sentence
// when that is short, and otherwise says "the question": a question cut off with "…" read as a fault (QA 2026-09-26).
const QUOTE_MAX = 90;
export function questionWords(question: unknown, about?: unknown): string {
  const subject = aboutWords(about);
  if (subject) return subject;
  const first = String(question ?? "").trim().split(/(?<=[.?!])\s+/)[0];
  return first && first.length <= QUOTE_MAX ? `“${first}”` : "the question";
}

// The agent's `about` names a subject, but often with the lean it asked about stuck on: "version 42.3 reaction" read
// as a machine's label in "12 of them bear on version 42.3 reaction" (QA 2026-09-26). The lean is dropped, since a
// read's count is the conversations on the subject whichever way they lean (D33): "version 42.3".
const LEAN_BEFORE = /^(?:(?:the|player|players'|community|people's)\s+)?(?:reactions?|opinions?|views|feelings?|sentiment|mood)\s+(?:to|on|about|of|towards?)\s+/i;
const LEAN_AFTER = /\s+(?:reactions?|opinions?|views|feelings?|sentiment|mood)$/i;
export function aboutWords(about: unknown): string {
  if (typeof about !== "string") return "";
  const t = about.trim();
  const bare = t.replace(LEAN_BEFORE, "").replace(LEAN_AFTER, "").trim();
  return bare || t;
}

/** A finished read's detail: how many of the conversations it read were on its subject. Said as what they "were about"
 *  when the agent named the subject, which reads as plain speech ("12 of them were about the 42.3 update"); a quoted
 *  question keeps "bear on" (QA 2026-09-26). Either way it is every conversation on it, for or against (D33). */
export function relevantWords(relevant: number, question: unknown, about?: unknown): string {
  const n = relevant === 0 ? "None" : count(relevant);
  const subject = aboutWords(about);
  if (subject) return `${n} of them ${relevant === 1 ? "was" : "were"} about ${subject}`;
  return `${n} of them ${relevant === 1 ? "bears" : "bear"} on ${questionWords(question)}`;
}

/** A call the tools refused (lib/agent/tools.ts: narrowed to a kind of conversation the question never named) read
 *  nothing and is read again without it, so it is not a step: shown, it said "did not finish" (QA 2026-09-26). The
 *  tools return it as a result (review 2026-09-26): thrown, it reached the browser as the SDK's "An error occurred."
 *  and this never matched. */
export const isRefused = (s: StepLike) => s.state === "output-available" && isRefusal(s.output);
/** The out_of_scope call is how an off-topic question is answered (lib/agent/off-topic.ts), not work done on the data:
 *  shown, an answer about the weather opened with "Checked the data". It is never a step. */
const isOffTopicCall = (s: StepLike) => s.type === "tool-out_of_scope" || (s.state === "output-available" && isOffTopic(s.output));
export const withoutRefused = <T extends StepLike>(steps: T[]): T[] => steps.filter((s) => !isRefused(s) && !isOffTopicCall(s));

/** The tools' `until` is exclusive (lib/agent/tools.ts), so the last day a span covers is the day before it. */
export function lastDayOf(until: string): string {
  const d = new Date(`${until.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return until;
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
/** "from 9 to 24 Sep", "from 31 Aug to 6 Sep", "on 9 Sep". */
function spanWords(since: string, until: string): string {
  const [from, last] = [since.slice(0, 10), lastDayOf(until)];
  if (last <= from) return `on ${shortDate(from)}`;
  const [a, b] = [shortDate(from), shortDate(last)];
  const [aDay, ...aMonth] = a.split(" ");
  return aMonth.join(" ") === b.split(" ").slice(1).join(" ") ? `from ${aDay} to ${b}` : `from ${a} to ${b}`;
}

/** The slice a step looked at, as words to put after a noun: " in complaint threads about Maps & Modes, from 9 Sep".
 *  The kind of conversation and its topic read as one phrase; the channel, the person and the dates follow. */
export function scopeWords(f: Filters | undefined, topicNames: Map<string, string>): string {
  if (!f) return "";
  const kind = f.flag && KINDS[f.flag] ? `in ${kindWords(f.flag)}` : "";
  const topic = f.topic ? `about ${topicNames.get(f.topic) ?? f.topic.replace(/[-_]/g, " ")}` : "";
  const bits = [
    [kind, topic].filter(Boolean).join(" "),
    f.channel && `in ${f.channel}`,
    f.author && `with ${f.author} in them`,
    f.since && f.until ? spanWords(f.since, f.until) : f.since ? `from ${shortDate(f.since)}` : f.until && `before ${shortDate(f.until)}`,
  ].filter(Boolean);
  return bits.length ? ` ${bits.join(", ")}` : "";
}
const withoutFlag = (f: Filters | undefined): Filters | undefined => (f ? { ...f, flag: undefined } : f);

const isRunning = (s: { state?: string }) => s.state === "input-streaming" || s.state === "input-available";

/** A step still marked running in an answer no longer being written was cut off (a Stop, a lost connection). It reads
 *  as stopped: a reopened stopped chat said "Reading conversations…" with a breathing dot, for ever (QA 2026-09-26). */
export const STOPPED = "stopped";
export function haltSteps<T extends { state?: string }>(steps: T[], live: boolean): T[] {
  return live ? steps : steps.map((s) => (isRunning(s) ? ({ ...s, state: STOPPED } as T) : s));
}

export function stepWords(step: StepLike, topicNames: Map<string, string> = new Map()): StepWords {
  const running = isRunning(step);
  const stopped = step.state === STOPPED;
  const failed = step.state === "output-error" || stopped;
  const done = step.state === "output-available";
  const input = (step.input ?? {}) as Record<string, unknown>;
  const f = input.filters as Filters | undefined;
  const scope = scopeWords(f, topicNames);
  const out = (done ? step.output : undefined) as Record<string, unknown> | null | undefined;
  const base = { running, failed };
  // Said as what it means for the answer, in the kind of step it was: "This step did not finish; the answer uses the
  // others." read as the machine talking (QA 2026-09-26). A failed step was already tried twice (lib/agent/tools.ts).
  const unfinished = (what: string) => (stopped ? "Stopped before this step finished" : `This ${what} didn't finish, so the answer leaves it out`);

  switch (step.type) {
    case "tool-dataset_overview":
      return { ...base, kind: "look", text: done ? "Looked at what the data covers" : "Looking at what the data covers" };

    case "tool-scan": {
      // The kind of conversation is the noun ("118 complaint threads"), so the rest of the slice follows it.
      const slice = (n?: number) => `${n === undefined ? "" : `${count(n)} `}${kindWords(f?.flag, n)}${scopeWords(withoutFlag(f), topicNames)}`;
      const subject = questionWords(input.question, input.about);
      if (!out) return { ...base, kind: "read", text: `Reading ${slice()}`, detail: failed ? unfinished("read") : `On ${subject}` };
      if (out.status === "too-broad")
        return { ...base, kind: "read", text: `Found ${slice(Number(out.total))}`, detail: "Too many to read at once, so narrowing down" };
      if (out.status === "empty") return { ...base, kind: "read", text: `Found no ${slice()}`, detail: "Trying a different set" };
      // "Bear on", not "answer": the count is every conversation with something to say on the question, whichever way
      // it leans, so "22 of them answer “Do players like the anti-cheat?”" read as 22 who like it (QA 2026-09-26).
      return { ...base, kind: "read", text: `Read ${slice(Number(out.scanned))}`, detail: relevantWords(Number(out.relevant), input.question, input.about) };
    }

    case "tool-find": {
      // The search string is the agent's own ("new Rondo map changes update 43.1 Rondo") and never shown; `about` is
      // what it was looking for in plain words.
      const about = typeof input.about === "string" && input.about.trim() ? ` about ${input.about.trim()}` : "";
      const text = `${done ? "Looked" : "Looking"} for conversations${about}${scope}`;
      if (!out) return { ...base, kind: "search", text, detail: failed ? unfinished("search") : undefined };
      const hits = (out.hits as unknown[] | undefined)?.length ?? 0;
      return { ...base, kind: "search", text, detail: hits ? `Found ${plural(hits, "matching conversation")}` : "Nothing matched" };
    }

    case "tool-aggregate": {
      // One sentence: "Worked out the average mood in conversations about Maps & Modes, from 1 to 31 Jul, week by
      // week". Split into two ("Counted the average mood in total. In conversations about…") it read as broken.
      // While the call's input is still arriving it has no metric yet, and "Working out conversations in conversations"
      // was the garble of a missing one (QA 2026-09-26): an unknown metric is a plain count of conversations.
      const metric = typeof input.metric === "string" && input.metric in METRIC_WORDS ? input.metric : "conversations";
      const verb = COUNTED.has(metric) ? (done ? "Counted" : "Counting") : done ? "Worked out" : "Working out";
      const among = metric.startsWith("share") ? "among" : "in";
      const where = `${kindWords(f?.flag)}${scopeWords(withoutFlag(f), topicNames)}`;
      const what = metric === "conversations" ? where : `${METRIC_WORDS[metric] ?? "conversations"} ${among} ${where}`;
      return { ...base, kind: "count", text: `${verb} ${what}${STEP_GROUP_WORDS[String(input.group_by)] ?? ""}`, detail: failed ? unfinished("count") : undefined };
    }

    case "tool-voices": {
      const text = `${done ? "Looked at" : "Looking at"} who is talking${scope}`;
      const rows = (out?.rows as { author: string }[] | undefined) ?? [];
      if (!out) return { ...base, kind: "count", text, detail: failed ? unfinished("count") : undefined };
      return { ...base, kind: "count", text, detail: rows.length ? `Most active: ${listWords(rows.slice(0, 3).map((r) => r.author))}` : "Nobody wrote here" };
    }

    case "tool-read_conversation": {
      const title = typeof out?.thread_title === "string" ? out.thread_title : "";
      if (done && !out) return { ...base, kind: "read", text: "Looked for a conversation that was not there" };
      return { ...base, kind: "read", text: done ? (title ? `Read “${title}” in full` : "Read a conversation in full") : "Reading a conversation in full", detail: failed ? unfinished("read") : undefined };
    }

    default:
      return { ...base, kind: "look", text: done ? "Checked the data" : "Checking the data" };
  }
}

/** A number's source tag in the answer ([scan], [aggregate], [voices], [find]), as what its button does: it opens the
 *  step the number came from. "Counted from the labelled conversations, above" spoke the app's own language. */
export const sourceWords = (tag: string) =>
  `Show where this number comes from: ${
    tag === "aggregate" ? "counting the conversations" : tag === "scan" ? "reading the conversations" : tag === "voices" ? "counting who is talking" : "the search"
  }`;

/** The dates a count covers, as the tools take them (`until` exclusive). A week row covers only the part of its week
 *  inside this span. */
export type Span = { since?: string; until?: string };
const isoDay = (s: string) => s.slice(0, 10);
const addDays = (iso: string, n: number) => {
  const d = new Date(`${isoDay(iso)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** "9–13 Sep", "31 Aug–6 Sep", or one day's date. */
export function rangeWords(from: string, to: string): string {
  if (to <= from) return shortDate(from);
  const [a, b] = [shortDate(from), shortDate(to)];
  const [aDay, ...aMonth] = a.split(" ");
  const [bDay, ...bMonth] = b.split(" ");
  return aMonth.join(" ") === bMonth.join(" ") ? `${aDay}–${bDay} ${bMonth.join(" ")}` : `${a}–${b}`;
}

/** The first and last day a week row counts. The database buckets weeks from their Monday, so a count "from 9 Sep"
 *  has a first row keyed 7 Sep that holds only 9 Sep onwards; labelled "7 Sep" under a title saying "between 9 Sep and
 *  24 Sep" it read as a contradiction (QA, 2026-09-25). */
export function weekDays(monday: string, span: Span = {}): [string, string] {
  let from = isoDay(monday);
  let to = addDays(monday, 6);
  if (span.since && isoDay(span.since) > from) from = isoDay(span.since);
  if (span.until && lastDayOf(span.until) < to) to = lastDayOf(span.until);
  return [from, to];
}

/** One row key of a count, readable: a topic's name, a week as the days it covers ("9–13 Sep"), a day, or "All". */
export function rowLabel(key: string, groupBy: string, topicNames: Map<string, string>, span?: Span): string {
  if (groupBy === "none") return "All";
  if (groupBy === "topic") return topicNames.get(key) ?? (key === "unlabelled" ? "Not labelled" : key);
  if (groupBy === "week" && /^\d{4}-\d{2}-\d{2}$/.test(key)) return rangeWords(...weekDays(key, span));
  if (groupBy === "day" && /^\d{4}-\d{2}-\d{2}$/.test(key)) return shortDate(key);
  if (groupBy === "month" && /^\d{4}-\d{2}$/.test(key))
    return new Date(`${key}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  return key;
}

/** One value of a count, readable: shares as percentages, the mood score out of 100, counts with separators. */
export function valueLabel(metric: string, value: number): string {
  if (metric.endsWith(PER_DAY)) return `${value.toFixed(1)} per day`;
  if (metric.startsWith("share")) return `${Math.round(value * 100)}%`;
  if (metric === "avg_sentiment") return `${Math.round(value * 100)} / 100`;
  return count(value);
}

// The whole working as one line, and the one chart worth showing. A turn can make six or seven tool calls; listed one
// by one, each with its own card, they buried the answer under their own bookkeeping (his review, 2026-09-25). The
// steps stay one click away; what shows by default is what the answer rests on.

/** Whether two slices cannot share a conversation: a conversation has one channel and one start time. Two topics are
 *  never apart: a conversation can touch several topics (D46), so two topic slices may share conversations. */
function apart(a: Filters, b: Filters): boolean {
  if (a.channel && b.channel && a.channel !== b.channel) return true;
  return time(a.until, Infinity) <= time(b.since, -Infinity) || time(b.until, Infinity) <= time(a.since, -Infinity);
}

/** A finished step's slice: the filters the tool actually applied (its output carries them), else the ones asked for. */
const filtersOf = (s: StepLike): Filters =>
  ((s.output as { filters?: Filters } | null | undefined)?.filters ?? (s.input as { filters?: Filters } | undefined)?.filters ?? {}) as Filters;


/** How many different conversations the reads covered. Two reads of one slice (two questions about it) read the same
 *  conversations twice, and "Read 236" for 118 conversations read twice was a number that appeared nowhere else (QA,
 *  2026-09-25). A read returns its slice, not the list of what it read, so a slice inside another one adds nothing and
 *  slices that cannot overlap add up. When two slices may overlap and neither holds the other, how many they share is
 *  not known: `exact` is false, `n` is the largest slice (a floor), and `sets` are the slices' sizes. */
export function conversationsRead(reads: { filters: Filters; scanned: number }[]): { n: number; exact: boolean; sets: number[] } {
  const kept = reads.filter((r, i) => !reads.some((o, j) => j !== i && within(r.filters, o.filters) && (!within(o.filters, r.filters) || j < i)));
  const exact = kept.every((r, i) => kept.every((o, j) => j <= i || apart(r.filters, o.filters)));
  const sets = kept.map((r) => r.scanned);
  return { n: exact ? sets.reduce((t, n) => t + n, 0) : Math.max(0, ...sets), exact, sets };
}

type Read = { filters: Filters; scanned: number; question: string };

/** The reads as the summary line says them, one true sentence the steps under it bear out (QA 2026-09-26: "Read at
 *  least 118 conversations" over two steps that each said 118 read). One slice read once: "read 118 complaint threads".
 *  One slice read for several questions: "read the same 118 complaint threads twice, for two questions". Slices that
 *  nest or cannot overlap: their total. Slices that may share conversations: each size, as passes ("read 25 and 224
 *  conversations in two passes"), since no single number would be true. */
export function readWords(reads: Read[]): string | null {
  if (!reads.length) return null;
  if (reads.every((r) => sameSlice(r.filters, reads[0].filters))) {
    const { scanned: n, filters } = reads[0];
    const what = `${count(n)} ${kindWords(filters.flag, n)}`;
    if (reads.length === 1) return `read ${what}`;
    const questions = new Set(reads.map((r) => r.question)).size;
    return `read the same ${what} ${times(reads.length)}${questions > 1 ? `, for ${inWords(questions)} questions` : ""}`;
  }
  const read = conversationsRead(reads);
  if (read.exact) return `read ${plural(read.n, "conversation")}`;
  // Slices that may share conversations: each size, never their sum (a conversation in both would count twice) and
  // never "at least". "Read two sets of conversations, 25 and 224, that may overlap" read awkwardly (QA 2026-09-26).
  return `read ${listWords(read.sets.map(count))} conversations in ${inWords(read.sets.length)} passes`;
}

/** "Read 840 conversations, searched twice and counted 3 times"; while a step runs, that step's own words. It counts
 *  the steps the list shows (shownSteps): counted from every call, it said "Counted 3 times" beside "1 step" and "read
 *  the same 118 complaint threads twice" over one line (review 2026-09-26). */
export function activitySummary(steps: StepLike[], topicNames: Map<string, string> = new Map()): { text: string; running: boolean } {
  const live = steps.findLast(isRunning);
  if (live) return { text: stepWords(live, topicNames).text, running: true };
  steps = shownSteps(steps).map((x) => x.step);
  const reads: Read[] = [];
  let searches = 0;
  const counts: StepLike[] = [];
  let full = 0;
  let voices = 0;
  let overview = 0;
  let broad = 0;
  let unfinished = 0;
  for (const s of steps) {
    if (s.state !== "output-available") {
      unfinished++;
      continue;
    }
    const o = s.output as Record<string, unknown> | null | undefined;
    const input = (s.input ?? {}) as Record<string, unknown>;
    if (s.type === "tool-scan" && o?.status === "ok") reads.push({ filters: filtersOf(s), scanned: Number(o.scanned) || 0, question: String(input.question ?? "") });
    else if (s.type === "tool-scan") broad++;
    else if (s.type === "tool-find") searches++;
    else if (s.type === "tool-aggregate") counts.push(s);
    else if (s.type === "tool-read_conversation" && o) full++;
    else if (s.type === "tool-voices") voices++;
    else if (s.type === "tool-dataset_overview") overview++;
  }
  const bits = [
    readWords(reads),
    full > 0 && `opened ${plural(full, "thread")} in full`,
    searches > 0 && `searched ${times(searches)}`,
    countedWords(counts),
    voices > 0 && "looked at who is talking",
  ].filter((b): b is string => Boolean(b));
  // The headline says only what succeeded (QA 2026-09-26, production): "Read 224 conversations and one step didn't
  // finish" put a fault in the one line every reader sees, when the answer already says what it covers. A step that did
  // not finish is said in the expanded list, on its own line, flagged `failed` (stepLines).
  // Nothing was read, searched or counted: every step is said, not only the first ("Looked at what the data covers"
  // over four steps, QA 2026-09-26).
  if (!bits.length) {
    if (overview) bits.push("looked at what the data covers");
    if (broad) bits.push(broad === 1 ? "found no set of conversations small enough to read" : `tried ${inWords(broad)} sets of conversations, none small enough to read`);
    const stopped = steps.some((s) => s.state === STOPPED);
    if (stopped) bits.push(bits.length ? "stopped before the next step finished" : "stopped before the first step finished");
    else if (unfinished) bits.push(`${inWords(unfinished)} ${unfinished === 1 ? "step" : "steps"} did not finish`);
  }
  const text = bits.length ? listWords(bits) : "checked the data";
  return { text: text[0].toUpperCase() + text.slice(1), running: false };
}

/** What the counts counted, for the summary line: "counted complaint threads by topic", "worked out the average mood
 *  by week". "Read 1,232 complaint threads and counted once" left the reader asking what was counted (QA 2026-09-26).
 *  One kind made over several slices says how often ("counted complaint threads by topic twice"); two kinds are both
 *  said; more than two are "made three counts". */
export function countedWords(counts: StepLike[]): string | null {
  if (!counts.length) return null;
  const phrases = [
    ...new Set(
      counts.map((s) => {
        const input = (s.input ?? {}) as { metric?: unknown; group_by?: unknown; filters?: Filters };
        const metric = typeof input.metric === "string" && input.metric in METRIC_WORDS ? input.metric : "conversations";
        const by = input.group_by === "none" ? "" : (GROUP_WORDS[String(input.group_by)] ?? "");
        const what = metric === "conversations" ? kindWords(filtersOf(s).flag) : METRIC_WORDS[metric];
        return `${COUNTED.has(metric) ? "counted" : "worked out"} ${what}${by}`;
      }),
    ),
  ];
  if (phrases.length > 2) return `made ${inWords(counts.length)} counts`;
  // One kind of count made over several slices (two periods, several topics) says how often; two kinds are both named.
  if (phrases.length === 1 && counts.length > 1) return `${phrases[0]} ${times(counts.length)}`;
  return listWords(phrases);
}

/** The steps as the list shows them. A step that reads word for word like an earlier finished one is the same call
 *  made again (the agent repeats itself), and three "Counted the average mood, between 1 Jul and 31 Jul" lines in a
 *  row read as a fault (QA 2026-09-26): it is shown once, at its first place, and says nothing of how many times it ran
 *  ("Ran 5 times" told the reader nothing they could use, QA 2026-09-26). A step still running, or one that did not
 *  finish, keeps its own line. A read of a slice an earlier read already covered,
 *  for another question, says it is the same conversations again: two lines "Read 118 complaint threads" looked like
 *  one step shown twice (QA 2026-09-26). */
// `failed`: the step did not finish; the list flags it, and the headline leaves it out (activitySummary).
export type StepLine = { id: string; tool: string; words: StepWords; failed: boolean };
export function stepLines(steps: (StepLike & { toolCallId?: string })[], topicNames: Map<string, string> = new Map()): StepLine[] {
  return shownSteps(steps).map(({ step: s, index, again }) => {
    let words = stepWords(s, topicNames);
    if (again) {
      const n = Number((s.output as { scanned?: number }).scanned);
      words = { ...words, text: `Read the same ${count(n)} ${kindWords(filtersOf(s).flag, n)} again, for another question` };
    }
    return { id: s.toolCallId ?? String(index), tool: s.type.slice(5), words, failed: words.failed };
  });
}

/** The calls the steps list shows, in order: the list (stepLines) and the summary (activitySummary) both read these, so
 *  they count the same steps (review 2026-09-26). A refused call is left out. A settled call identical to an earlier
 *  settled one is folded into it. A read of the same question over the same slice is the same read, however its other
 *  settings differ; a read of a slice already read, for another question, is kept and marked `again`. */
function shownSteps<T extends StepLike>(steps: T[]): { step: T; index: number; again: boolean }[] {
  const out: { step: T; index: number; again: boolean }[] = [];
  const settled = (s: StepLike) => !isRunning(s) && s.state !== "output-error" && s.state !== STOPPED;
  const readOk = (s: StepLike) => s.type === "tool-scan" && s.state === "output-available" && (s.output as { status?: string } | null)?.status === "ok";
  const questionOf = (s: StepLike) => (s.input as { question?: string } | undefined)?.question;
  // Folded by what was called, not by how it reads: two scans whose questions share a first sentence, or two untitled
  // conversations read in full, are different steps with the same words.
  const calls = new Set<string>();
  const reads: T[] = [];
  steps.forEach((s, index) => {
    if (isRefused(s) || isOffTopicCall(s)) return;
    const call = `${s.type} ${JSON.stringify(s.input ?? null)}`;
    if (settled(s) && calls.has(call)) return;
    let again = false;
    if (readOk(s)) {
      if (reads.some((r) => sameSlice(filtersOf(r), filtersOf(s)) && questionOf(r) === questionOf(s))) return;
      again = reads.some((r) => sameSlice(filtersOf(r), filtersOf(s)));
      reads.push(s);
    }
    if (settled(s)) calls.add(call);
    out.push({ step: s, index, again });
  });
  return out;
}

/** The steps button's name for a screen reader: what pressing it does, then the line it shows. */
export function stepsToggleLabel(open: boolean, summary: string, steps: number): string {
  return `${open ? "Hide" : "Show"} ${steps === 1 ? "the step" : `the ${count(steps)} steps`}: ${summary}`;
}

/** Whether the agent's steps are over: the answer's text has begun after the last of them. Until then a later count can
 *  still arrive, and a chart drawn between two steps was replaced under the reader's eyes (QA, 2026-09-25: 28/46/40
 *  became 25/46/38 while the answer streamed). */
export function stepsSettled(parts: ReadonlyArray<{ type: string; text?: string }>): boolean {
  const last = parts.findLastIndex((p) => p.type.startsWith("tool-"));
  return parts.slice(last + 1).some((p) => p.type === "text" && Boolean(p.text?.trim()));
}

const after = (scope: string) => (scope ? `,${scope}` : "");

export type Chart = { id: string; title: string; rows: { key: string; value: number }[]; metric: string; groupBy: string; span?: Span };
type Row = { key: string; value: number; n?: number };
type Count = { step: StepLike & { toolCallId?: string }; metric: string; groupBy: string; filters: Filters; rows: Row[] };

/** One period's value from a count's rows: counts add up, and a mood or share is a mean over conversations, so rows
 *  weigh by their conversations. People cannot be added across weeks (the same person writes in several), so a count
 *  of people only has a period value when it is one row. */
function periodValue(metric: string, rows: Row[]): number | null {
  const ok = rows.filter((r) => Number.isFinite(r.value));
  if (!ok.length) return null;
  if (SUMMED.has(metric)) return ok.reduce((t, r) => t + r.value, 0);
  if (metric === "authors") return ok.length === 1 ? ok[0].value : null;
  const n = ok.reduce((t, r) => t + (r.n ?? 0), 0);
  return n ? ok.reduce((t, r) => t + r.value * (r.n ?? 0), 0) / n : null;
}

/** A comparison of periods ("July against September"): the same count over the same slice with different, separate
 *  dates, one bar per period. Drawn from the last such count alone, it charted September only (QA, 2026-09-25).
 *  Counts grouped differently compare only when every period is named at both ends (1-31 July against 1-24
 *  September): a total "before 9 Sep" beside a week-by-week series "from 9 Sep" is a trend with its background, and
 *  the series is drawn as it is. A count that hit the row cap cannot be added up (review 2026-09-26). */
function comparison(last: Count, all: Count[], topicNames: Map<string, string>): Chart | null {
  const periodic = (c: Count) => ["none", "week", "day"].includes(c.groupBy) && Boolean(c.filters.since || c.filters.until) && c.rows.length < AGGREGATE_ROWS;
  const named = (c: Count) => Boolean(c.filters.since && c.filters.until);
  if (!periodic(last)) return null;
  const peers = [last];
  for (const c of [...all].reverse()) {
    const same = c.metric === last.metric && periodic(c) && CATEGORIES.every((k) => (c.filters[k] ?? "") === (last.filters[k] ?? ""));
    const alike = c.groupBy === last.groupBy || (named(c) && named(last));
    if (c !== last && same && alike && peers.every((p) => apart(p.filters, c.filters))) peers.push(c);
  }
  if (peers.length < 2) return null;
  const rows = peers
    .map((c) => ({ c, value: periodValue(c.metric, c.rows) }))
    .filter((r): r is { c: Count; value: number } => r.value !== null)
    .sort((a, b) => time(a.c.filters.since, -Infinity) - time(b.c.filters.since, -Infinity))
    .map(({ c, value }) => ({ key: periodWords(c.filters), value, days: daysOf(c) }));
  if (rows.length < 2) return null;
  const what = METRIC_WORDS[last.metric] ?? "conversations";
  const undated = { ...last.filters, since: undefined, until: undefined };
  // Periods of different lengths are drawn per day: July's 144 against 1-24 September's 109 drew as a fall when per day
  // it was flat, 4.6 against 4.5 (QA 2026-09-26). The days are the count's own, stamped by the tool (lib/agent/tools.ts).
  const days = peers.map(daysOf);
  const perDay = SUMMED.has(last.metric) && days.every((d) => d > 0) && new Set(days).size > 1;
  return {
    id: last.step.toolCallId ?? "",
    title: `${what[0].toUpperCase()}${what.slice(1)}${perDay ? " per day" : ""} by period${after(scopeWords(undated, topicNames))}`,
    rows: perDay ? rows.map((r) => ({ ...r, value: r.value / (r.days || 1) })) : rows.map(({ key, value }) => ({ key, value })),
    metric: perDay ? `${last.metric}${PER_DAY}` : last.metric,
    groupBy: "period",
  };
}

/** Two periods of the same count by topic or channel ("topics, August against September"): each row drawn as a pair,
 *  one bar per period, per day. Drawn from the last count alone, the chart showed September's topics and none of the
 *  change the answer was about (production QA 2026-09-26). Per day always, since the periods are rarely the same length
 *  and a raw count would draw the longer one bigger. The rows the later period ranks highest, at most PAIRED_MAX. */
const PAIRED_MAX = 5;
function pairedPeriods(last: Count, all: Count[], topicNames: Map<string, string>): Chart | null {
  const pairable = (c: Count) => ["topic", "channel"].includes(c.groupBy) && SUMMED.has(c.metric) && Boolean(c.filters.since && c.filters.until) && daysOf(c) > 0;
  if (!pairable(last)) return null;
  const other = [...all].reverse().find(
    (c) => c !== last && pairable(c) && c.metric === last.metric && c.groupBy === last.groupBy && CATEGORIES.every((k) => (c.filters[k] ?? "") === (last.filters[k] ?? "")) && apart(c.filters, last.filters),
  );
  if (!other) return null;
  const [a, b] = time(other.filters.since, 0) < time(last.filters.since, 0) ? [other, last] : [last, other];
  const perDay = (c: Count) => new Map(c.rows.map((r) => [r.key, r.value / daysOf(c)]));
  const [before, after_] = [perDay(a), perDay(b)];
  const keys = [...new Set([...b.rows.map((r) => r.key), ...a.rows.map((r) => r.key)])]
    .sort((x, y) => (after_.get(y) ?? 0) - (after_.get(x) ?? 0))
    .slice(0, PAIRED_MAX);
  const [pa, pb] = [periodWords(a.filters), periodWords(b.filters)];
  const name = (k: string) => rowLabel(k, last.groupBy, topicNames);
  const what = METRIC_WORDS[last.metric] ?? "conversations";
  const undated = { ...last.filters, since: undefined, until: undefined };
  return {
    id: last.step.toolCallId ?? "",
    title: `${what[0].toUpperCase()}${what.slice(1)} per day${GROUP_WORDS[last.groupBy]}, ${pa} against ${pb}${after(scopeWords(undated, topicNames))}`,
    rows: keys.flatMap((k) => [
      { key: `${name(k)} \u00b7 ${pa}`, value: before.get(k) ?? 0 },
      { key: `${name(k)} \u00b7 ${pb}`, value: after_.get(k) ?? 0 },
    ]),
    metric: `${last.metric}${PER_DAY}`,
    groupBy: "period",
  };
}

// Counts that add up over days, so a period's total can be said per day.
const SUMMED = new Set(["conversations", "messages", "net_votes"]);
const PER_DAY = "_per_day";
/** The days a count's period covers, as the tool worked them out (0 when it did not say). */
const daysOf = (c: Count) => Number((c.step.output as { period?: { days?: number } | null } | undefined)?.period?.days) || 0;

/** A period as a row label: "1–31 Jul", "from 1 Sep", "before 9 Sep". */
function periodWords(f: Filters): string {
  if (f.since && f.until) return rangeWords(isoDay(f.since), lastDayOf(f.until));
  return f.since ? `from ${shortDate(f.since)}` : `before ${shortDate(f.until!)}`;
}

/** The answer's first sentence, from the text after the last step: what the reader takes as the answer, and what the
 *  chart has to agree with. Null while it is still being written, so the chart waits for it rather than change. */
export function answerLead(parts: ReadonlyArray<{ type: string; text?: string }>, complete: boolean): string | null {
  const last = parts.findLastIndex((p) => p.type.startsWith("tool-"));
  const text = parts
    .slice(last + 1)
    .map((p) => (p.type === "text" ? (p.text ?? "") : ""))
    .join("")
    .trimStart();
  // A heading or a bold label alone on its line ("## Summary", "**Short answer:**") is not the answer's first
  // sentence: the one under it is (review 2026-09-26).
  const lines = text.split("\n");
  const at = lines.findIndex((l) => l.trim() && !LABEL_ONLY.test(l.trim()));
  if (at < 0) return complete ? "" : null;
  const line = lines[at];
  const cut = sentenceCuts(line)[0];
  if (cut !== undefined) return line.slice(0, cut).trim();
  return complete || at < lines.length - 1 ? line.trim() : null;
}
const LABEL_ONLY = /^(?:#{1,6}\s.*|\*\*[^*]+\*\*:?|__[^_]+__:?)$/;

/** The one count to draw under the steps: a comparison of periods when the turn counted the same thing over separate
 *  dates, else the last count (or list of voices) with at least two rows. A single number is already in the answer;
 *  nothing is drawn.
 *
 *  A count narrowed to one kind of conversation (a flag) is drawn only when the reader was told about that kind:
 *  `told` (the question, and the answer's first sentence) names it. Otherwise the chart shows a slice the answer
 *  never mentioned: a July-against-September answer about complaints drew the requests for help, and "who is most
 *  active in discussions about lag" drew only the people reporting bugs (QA 2026-09-26). Such a count is passed over
 *  for an earlier one that fits, and when none fits nothing is drawn.
 *
 *  A read is never drawn. Its tally is the conversations that bear on the agent's own question, whichever way they
 *  lean, so under a yes/no question ("Do players express approval of the anti-cheat?") its bars read as the people
 *  who said yes, beside an answer saying most of them hate it (QA 2026-09-26). No short title can say "on the
 *  question, for or against" without quoting the agent's question, and quoting it is what misled. A count from the
 *  labels means what its title says. */
export function pickChart(steps: (StepLike & { toolCallId?: string })[], topicNames: Map<string, string> = new Map(), told = ""): Chart | null {
  const named = flagsNamed(told);
  const fits = (s: StepLike) => {
    const flag = filtersOf(s).flag;
    return !flag || named.has(flag);
  };
  const done = steps.filter((s) => s.state === "output-available" && fits(s));
  const counts: Count[] = done.flatMap((s) => {
    const o = s.output as { rows?: Row[]; metric?: string; groupBy?: string } | undefined;
    return s.type === "tool-aggregate" && o?.rows ? [{ step: s, metric: String(o.metric), groupBy: String(o.groupBy), filters: filtersOf(s), rows: o.rows }] : [];
  });
  for (const s of [...done].reverse()) {
    if (s.type === "tool-voices") {
      const o = s.output as { rows?: { author: string; messages: number }[] } | undefined;
      if (!o?.rows || o.rows.length < 2) continue;
      return {
        id: s.toolCallId ?? "",
        title: `Most active people, by messages written${after(scopeWords(filtersOf(s), topicNames))}`,
        rows: o.rows.map((r) => ({ key: r.author, value: r.messages })),
        metric: "messages",
        groupBy: "author",
      };
    }
    const c = counts.find((x) => x.step === s);
    if (!c) continue;
    // A community-wide mood is passed over for one on a slice (production QA 2026-09-26: asked about one topic, the
    // chart drew the whole community's mood under an answer about that topic).
    if (c.metric === "avg_sentiment" && !sliced(c) && counts.some((x) => x.metric === "avg_sentiment" && sliced(x))) continue;
    const paired = pairedPeriods(c, counts, topicNames);
    if (paired) return paired;
    const compared = comparison(c, counts, topicNames);
    if (compared) return compared;
    if (c.rows.length < 2) continue;
    const what = METRIC_WORDS[c.metric] ?? "conversations";
    // Only the community-wide mood, under a question that names a topic: the title says whose mood it is.
    const whole = c.metric === "avg_sentiment" && !sliced(c) && namesATopic(told, topicNames) ? ", whole community" : "";
    const title = `${what[0].toUpperCase()}${what.slice(1)}${GROUP_WORDS[c.groupBy] ?? ""}${whole}${after(scopeWords(c.filters, topicNames))}`;
    return { id: s.toolCallId ?? "", title, rows: c.rows.map((r) => ({ key: r.key, value: r.value })), metric: c.metric, groupBy: c.groupBy, span: c.filters };
  }
  return null;
}

/** A count narrowed to a topic, channel, kind or person: a subject's slice, not the whole community. */
const sliced = (c: Count) => CATEGORIES.some((k) => Boolean(c.filters[k]));
/** Whether the question or answer names one of the team's topics. */
const namesATopic = (told: string, topicNames: Map<string, string>) => {
  const t = told.toLowerCase();
  return [...topicNames.values()].some((n) => n && (t.includes(n.toLowerCase()) || t.includes(n.toLowerCase().replace(/ & /g, " and "))));
};

/** What a full bar stands for. A mood and a share have a whole scale (0-100, 0-100%), and a bar is drawn against it:
 *  scaled to the largest value, 38/100 and 37/100 both drew nearly full, as if the mood were high (QA 2026-09-26).
 *  A count has no ceiling, so its largest value is the full bar. */
export function barFull(metric: string, values: number[]): number {
  if (metric === "avg_sentiment" || metric.startsWith("share")) return 1;
  return Math.max(0, ...values) || 1;
}

/** How much of the bar a value fills, 0 to 1. */
export const barFill = (value: number, full: number) => Math.min(Math.max(value / full, 0), 1);

/** For a long series, the two readings a chart is looked at for: its highest point and where it ends. */
export function seriesCallouts(chart: Chart, topicNames: Map<string, string> = new Map()): { peak: string; latest: string } {
  const peak = chart.rows.reduce((a, b) => (b.value > a.value ? b : a));
  const last = chart.rows.at(-1)!;
  const say = (r: { key: string; value: number }) => `${valueLabel(chart.metric, r.value)} (${rowLabel(r.key, chart.groupBy, topicNames, chart.span)})`;
  return { peak: say(peak), latest: say(last) };
}
