import type { AggregateResult } from "@/lib/data/aggregate";
import type { ScanResult } from "@/lib/data/scan";
import type { SearchResult } from "@/lib/data/search";
import type { Filters } from "@/lib/data/types";
import type { VoicesResult } from "@/lib/data/voices";
import { convTag } from "@/lib/refs";
import { REFUSED } from "./flags";
import { changeWords, type Change } from "./trends";

// What the model reads back from each tool: compact text, in the app's own units. Mood is 0-100 everywhere the reader
// looks (the grid, the activity steps), so the model is handed 0-100 too; given the raw 0-1 sentiment it wrote "0.238"
// next to an activity line saying "24 / 100". Pure, so every wording here is tested (for-model.test.ts).

export const FLAG_WORDS: Record<string, string> = {
  excited: "excited conversations",
  frustrated: "frustrated conversations",
  bug: "bug reports",
  feature: "feature requests",
  help: "requests for help",
};

/** 0-1 sentiment as the app's 0-100 mood. */
export const mood = (x: number | null) => (x === null ? "?" : `${Math.round(x * 100)}/100`);
/** Topic keys to the names the reader knows (dataset_meta.topics). The model reads and writes topics by name; the
 *  tools take a name or a key (tools.ts checked), so no key needs to reach the answer (QA 2026-09-27: an answer wrote
 *  "other-games-off-topic"). */
export type TopicNames = ReadonlyMap<string, string>;
const topicName = (key: string, names?: TopicNames) => names?.get(key) ?? key;
/** A whole number as the chart writes it: "2,753" (QA 2026-09-27: the answer wrote "2753" beside a chart's 2,753). */
export const num = (n: number) => (Number.isInteger(n) ? n.toLocaleString("en-GB") : String(n));
const pct = (x: number | null) => (x === null ? "?" : `${Math.round(x * 100)}%`);

/** The filters in words, so a count can be read against the right denominator. A topic filter is membership (D46):
 *  every conversation touching the topic, whatever else it is about. */
export function sliceWords(f: Filters, names?: TopicNames): string {
  const bits = [
    f.topic && `conversations touching the topic "${topicName(f.topic, names)}"`,
    f.channel && `channel ${f.channel}`,
    f.flag && `only ${FLAG_WORDS[f.flag] ?? f.flag}`,
    f.since && `from ${f.since.slice(0, 10)}`,
    f.until && `before ${f.until.slice(0, 10)}`,
    f.author && `only conversations ${f.author} wrote in`,
  ].filter(Boolean);
  return bits.length ? bits.join(", ") : "all conversations";
}

// The one unit the app counts in is the conversation (docs/DESIGN.md decision 2): a count of messages, people or
// reactions is those of the conversations counted, each dated by the day it starts. Said with every such count, so an answer to a question
// the unit cannot answer says what it counted instead of passing it off as the thing asked.
const UNIT_METRICS = new Set(["messages", "authors", "engagement", "avg_engagement", "reactions"]);
export const UNIT_WORDS =
  "These are the messages, people and reactions of the conversations counted, each conversation dated by the day it " +
  "starts: a reply written in a later conversation counts in that one. Counts of single messages by their own time, " +
  "and one person's own messages or reactions are not available " +
  "(filters.author counts the conversations a person took part in); if the question asks for one of these, the " +
  "answer's first sentence says what was counted instead.";

export function caveats(metric: string, groupBy: string): string {
  const notes: string[] = [];
  if (metric === "avg_sentiment" || metric === "share_negative")
    notes.push(
      "Mood is a label, not a survey: compare it across slices or days; do not read the absolute level or the " +
        "negative share as a literal fraction of unhappy people.",
    );
  if (metric === "engagement" || metric === "avg_engagement")
    notes.push(
      "Engagement is distinct authors + replies + reactions per conversation. Reactions alone are too sparse here " +
        "to say what resonates, so they are one part of it. An engagement score is never a number of conversations " +
        "or people: write \"an engagement score of 253\", and take how many conversations from the count beside it.",
    );
  if (groupBy === "week" || groupBy === "day" || groupBy === "month")
    notes.push("The first and last periods of the conversations are partial days or weeks.");
  if (UNIT_METRICS.has(metric)) notes.push(UNIT_WORDS);
  return notes.length ? "\nNote: " + notes.join(" ") : "";
}

// The words a call narrowed by a flag the reader's question never named (lib/agent/flags.ts) returns in place of a read.
// A note beside the number was not enough: asked how people reacted to 42.3, the model still read only the complaint
// threads and bug reports, took praise from complaint threads, and read "80 of 224 complaints" as "80 of 224 about
// 42.3" (QA 2026-09-26, the note having been added for the same fault on the Rondo question). Refused, the call reads
// nothing and costs nothing, and the model reads again without the flag.
export function refusalWords(flag: string): string {
  const kind = FLAG_WORDS[flag] ?? flag;
  return (
    `${REFUSED} the question does not ask about ${kind}. A flag picks a kind of conversation, not an opinion, so ` +
    `reading only ${kind} would answer a smaller question than the one asked. Nothing was read. Call it again without ` +
    "filters.flag; if that is too many conversations, narrow by topic or dates instead."
  );
}

/** The data's own span: its first day and its last day, inclusive (lib/data/profile.ts). */
export type DataWindow = { from: string; to: string };
const DAY = 86_400_000;
const dayOf = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
const isoOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The days a slice's dates actually cover, clipped to the data: "since 2026-09-01, until 2026-10-01" over data that ends
 *  24 September is 24 days, not 30. `until` is exclusive, as the tools take it. Null when an end is open and the data's
 *  own span is not known. */
export function periodOf(f: Filters, w?: DataWindow): { since: string; until: string; days: number } | null {
  const start = Math.max(f.since ? dayOf(f.since) : -Infinity, w?.from ? dayOf(w.from) : -Infinity);
  const end = Math.min(f.until ? dayOf(f.until) : Infinity, w?.to ? dayOf(w.to) + DAY : Infinity);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return {
    since: isoOf(start),
    until: isoOf(Math.max(start, end)),
    days: Math.max(0, Math.round((end - start) / DAY)),
  };
}

const perDay = (n: number, days: number) => (n / days).toFixed(1);

// Counts carry no messages. An answer resting on counts alone quoted thread titles and a cause ("traced to AWS server
// congestion") with no citation and no check under it (QA 2026-09-26): what people wrote comes from a read.
export const COUNTS_ONLY =
  "These are counts from the labels: no messages, nothing to cite. Anything the answer says about what people wrote " +
  "(examples, thread names, causes, quotes) must come from scan or find results and be cited.";

/** An aggregate as the model reads it. A count of conversations or messages also says how many days its period covers
 *  and gives a per-day rate: comparing July (31 days) with 1-24 September by raw counts, an answer called 144 against 109
 *  "the biggest shift" when per day it was flat, 4.6 against 4.5 (QA 2026-09-26). `period` is the days the tool
 *  worked out (tools.ts), clipped to the data. */
export function aggregateForModel(
  o: AggregateResult & { period?: { since: string; until: string; days: number } | null; change?: Change },
  names?: TopicNames,
): string {
  const isMood = o.metric === "avg_sentiment";
  const isEngagement = o.metric === "engagement" || o.metric === "avg_engagement";
  const name = isMood
    ? "average mood (0-100, the scale the app shows; say it as e.g. 24/100)"
    : o.metric === "engagement"
      ? "engagement (distinct authors + replies + reactions, summed over the conversations)"
      : o.metric;
  const summed =
    o.metric === "conversations" ||
    o.metric === "messages" ||
    o.metric === "engagement" ||
    o.metric === "reactions";
  const rated = summed && o.period && o.period.days > 0 && o.groupBy !== "day";
  const days = o.period?.days ?? 0;
  const value = (r: { key: string; value: number }) => {
    if (isMood) return mood(r.value);
    if (!rated) return num(r.value);
    // A week row holds only the days of its week inside the period (a partial first or last week).
    const d =
      o.groupBy === "week"
        ? weekDaysIn(r.key, o.period!)
        : o.groupBy === "month"
          ? monthDaysIn(r.key, o.period!)
          : days;
    return d > 0
      ? `${num(r.value)}, ${perDay(r.value, d)} per day over ${d} ${d === 1 ? "day" : "days"}`
      : num(r.value);
  };
  // A count by day or by week also gets its total and rate for the whole period (review 2026-09-26, live): asked how
  // September's daily rate compared with July's, the agent counted both months by day, got no rate, and worked out
  // "~38 per day" for July itself, which the claim check then had to strike.
  const counted = summed && o.period && days > 0;
  const total = o.rows.reduce((sum, r) => sum + r.value, 0);
  const inAll =
    counted && (o.groupBy === "day" || o.groupBy === "week" || o.groupBy === "month")
      ? ` In all: ${num(total)}, ${perDay(total, days)} per day over ${days} ${days === 1 ? "day" : "days"}.`
      : "";
  const span = o.period
    ? `\nPeriod: ${o.period.since} to ${isoOf(dayOf(o.period.until) - DAY)}, ${days} ${days === 1 ? "day" : "days"}.` +
      inAll +
      (rated || inAll
        ? " To compare periods of different lengths, compare the per-day rates, never the raw counts, and give the " +
          'rate with its days ("4.6 per day over 11 days").'
        : "")
    : "";
  return (
    `${name} by ${o.groupBy}, over ${sliceWords(o.filters, names)}:\n` +
    // An engagement figure is a score, and its row says so, with the conversations behind it: bare, "Tides Remastered:
    // 253" was written as "253 conversations" when 34 were counted (QA 2026-09-27).
    o.rows
      .map((r) => ({ ...r, key: o.groupBy === "topic" ? topicName(r.key, names) : r.key }))
      .map((r) =>
        isEngagement
          ? `${r.key}: engagement score ${value(r)} (a score, not a count; from ${num(r.n)} ${r.n === 1 ? "conversation" : "conversations"})`
          : `${r.key}: ${value(r)} (n=${num(r.n)})`,
      )
      .join("\n") +
    overlapWords(o.total) +
    span +
    (o.change ? `\n${changeWords(o.change)}` : "") +
    caveats(o.metric, o.groupBy) +
    `\n${COUNTS_ONLY}`
  );
}

// By topic the rows overlap (D46): a conversation counts under every topic it touches. Said beside the rows, with the
// slice's real number of conversations, so an answer neither adds the rows up into a total nor reads shares by topic
// as parts of one whole.
export function overlapWords(total: number | undefined): string {
  if (total === undefined) return "";
  return (
    `\nA conversation can have several topics, so it is counted under each: these rows overlap and add up to more ` +
    `than the ${num(total)} conversations in the slice. Never add them up; shares by topic can add up to more than 100%.`
  );
}

/** The days of the week starting `monday` that fall inside a period. */
/** The days of a month row ("2026-09") inside the period: September's row over 1-24 September holds 24. */
function monthDaysIn(month: string, p: { since: string; until: string }): number {
  const first = dayOf(`${month}-01`);
  const d = new Date(first);
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  const start = Math.max(first, dayOf(p.since));
  const end = Math.min(next, dayOf(p.until));
  return Math.max(0, Math.round((end - start) / DAY));
}

function weekDaysIn(monday: string, p: { since: string; until: string }): number {
  const start = Math.max(dayOf(monday), dayOf(p.since));
  const end = Math.min(dayOf(monday) + 7 * DAY, dayOf(p.until));
  return Math.max(0, Math.round((end - start) / DAY));
}

type Hit = SearchResult["hits"][number] | Extract<ScanResult, { status: "ok" }>["hits"][number];
/** The conversations a read or a search returned, each with its handle, topics and relevance. No mood per conversation:
 *  handed ten of them, the answer said "the ten conversations shown in the scan ranged from 11/100 to 87/100", a
 *  sample the reader never saw standing in for 119 (QA 2026-09-26). The mood of the whole set is given once, above. */
export function conversationsForModel(hits: Hit[], names?: TopicNames): string {
  return (Array.isArray(hits) ? hits : []).map((h) => conversationForModel(h, names)).join("\n\n");
}

// (sanity QA 2026-09-26: "chat failed TypeError: Cannot read properties of undefined (reading 'slice')" on a follow-up.)
// A hit replayed from a saved chat is whatever the chat holds, not what the tools return today: every earlier turn's
// output goes back through toModelOutput on the next turn (route.ts convertToModelMessages), and a chat saved through
// PUT /api/chats (the e2e seeds, e2e/seed.ts) holds a find hit with only id, thread_title, relevance and messages. So
// every field is read as possibly missing, and a hit with no transcript is given the message previews it does carry,
// so its [msgN] refs stay citable. A follow-up in an old chat must never fail on the shape of an old result.
type LooseHit = { [K in keyof Hit]?: unknown } & { messages?: unknown };
type LooseMessage = { ref?: unknown; author?: unknown; ts?: unknown; text?: unknown };
const str = (x: unknown) => (typeof x === "string" ? x : "");
function conversationForModel(hit: Hit, names?: TopicNames): string {
  const h = (hit ?? {}) as LooseHit;
  const handle = typeof h.ref === "number" ? convTag(h.ref) : "(no handle)";
  const relevance = typeof h.relevance === "number" ? pct(h.relevance) : "?";
  const previews = (Array.isArray(h.messages) ? (h.messages as LooseMessage[]) : [])
    .filter((m) => m && typeof m.ref === "number" && typeof m.text === "string")
    .map((m) => `[msg${m.ref}] ${str(m.author) || "?"} · ${str(m.ts).slice(0, 10) || "?"}: ${m.text}`);
  const text = str(h.transcript) || [str(h.thread_title), ...previews].filter(Boolean).join("\n");
  // Every topic the conversation touches, primary first (D46); a hit saved before topics were multi-label has only one.
  const topics = Array.isArray(h.topics)
    ? (h.topics as unknown[]).filter((t): t is string => typeof t === "string" && t !== "").map((t) => topicName(t, names))
    : [];
  const topicLine =
    topics.length > 1 ? `topics ${topics.join(", ")}` : `topic ${topics[0] ?? (str(h.topic) ? topicName(str(h.topic), names) : "?")}`;
  const engagement = typeof h.engagement === "number" ? ` · engagement ${h.engagement}` : "";
  return (
    `## conversation ${handle} · ${str(h.channel) || "?"} · ${topicLine} · ` +
    `relevance ${relevance}${engagement} · ${str(h.started_at).slice(0, 10) || "?"}\n${text.slice(0, 2500)}`
  );
}

/** What a read adds for the model beside the scan itself (tools.ts): the average mood of the slice it read, from the
 *  labels, and notes on how the read was made. */
export type ScanExtras = {
  sliceMood?: number | null;
  notes?: string[];
  period?: { since: string; until: string; days: number } | null;
};

export function scanForModel(o: ScanResult & ScanExtras, maxScan: number, names?: TopicNames): string {
  if (o.status === "empty") return "No conversations match these filters.";
  if (o.status === "too-broad")
    return (
      `Slice too broad: ${o.total} conversations (max ${maxScan}). Narrow it.\nBy topic (a conversation counts under each ` +
      "topic it touches, so these add up to more): " +
      o.byTopic.map((t) => `${topicName(t.key, names)} ${num(t.n)}`).join(", ") +
      "\nBy week: " +
      o.byWeek.map((t) => `${t.key} ${t.n}`).join(", ")
    );
  // The slice's own filters are restated with the count: 80 of 129 means "of the 129 complaints", and an answer
  // that read it as 80 of 129 conversations about the topic called a topic "critical" on a slice that was all complaints.
  const filtered = o.filters.flag
    ? `\nAll ${o.scanned} were already ${FLAG_WORDS[o.filters.flag] ?? o.filters.flag} before the question was asked, so ` +
      `${o.relevant} of ${o.scanned} is a share of those, not of the topic. For how common ${FLAG_WORDS[o.filters.flag] ?? o.filters.flag} ` +
      "are, use aggregate."
    : "";
  // The breakdowns below are counts of the relevant conversations, so a share of them is a share of that count. Divided by the
  // number read instead, an answer gave "of 1,232" beside a step saying 1,170 were on the question (QA 2026-09-26).
  const shares =
    `\nThe breakdowns below count the ${o.relevant} relevant conversations: a share of them is "X of ${o.relevant}", never ` +
    `"X of ${o.scanned}". By topic, a conversation counts under each topic it touches, so the topic counts can add up to ` +
    `more than ${o.relevant}.`;
  const moodLine =
    o.sliceMood === undefined || o.sliceMood === null
      ? ""
      : `\nAverage mood of all ${o.scanned} conversations read: ${mood(o.sliceMood)}. Say the mood as this number, for ` +
        "the whole set; never as a range or an average over the few conversations printed below, which are a sample.";
  const notes = o.notes?.length ? `\nNote: ${o.notes.join(" ")}` : "";
  // The read's days, and its counts per day over them, worked out here (review 2026-09-26): given only "271 relevant"
  // for 1-24 September, an answer divided by 30 and said "9 per day" for 11.3. Said in the one form every rate takes
  // ("N per day over D days"), which the claim check reads back (rates.ts).
  const days = o.period?.days ?? 0;
  const period =
    o.period && days > 0
      ? `\nPeriod: ${o.period.since} to ${isoOf(dayOf(o.period.until) - DAY)}, ${days} ${days === 1 ? "day" : "days"}: ${o.relevant} relevant, ` +
        `${perDay(o.relevant, days)} per day over ${days} ${days === 1 ? "day" : "days"}; ${o.scanned} read, ${perDay(o.scanned, days)} per day over ` +
        `${days} ${days === 1 ? "day" : "days"}. To compare periods of different lengths, compare these per-day rates, never the raw counts, ` +
        "and never work out a rate yourself."
      : "";
  return (
    // "Relevant" is spelt out: the count is every conversation that bears on the question, for or against, and read as
    // "how many said yes" it put a yes/no question's count behind an answer that said the opposite (QA 2026-09-26).
    `Scanned ${num(o.scanned)} conversations (${sliceWords(o.filters, names)}); ${num(o.relevant)} relevant to the question ` +
    "(they bear on it, whichever way they lean; Jev probability >= 50%)" +
    (o.failed ? `; ${o.failed} could not be judged` : "") +
    `.${filtered}${shares}${moodLine}${period}${notes}\nRelevant by week: ${o.relevantByWeek.map((w) => `${w.key} ${w.n}`).join(", ") || "none"}` +
    `\nRelevant by topic: ${o.relevantByTopic.map((w) => `${topicName(w.key, names)} ${w.n}`).join(", ") || "none"}\n\n` +
    `The ${o.hits.length} most relevant, with message refs to cite:\n\n` +
    conversationsForModel(o.hits, names)
  );
}

// A step that failed twice (tools.ts retries once). The model is told what to say, in the reader's words: after "a step
// did not finish" the answer's first sentence named no scope, and read as covering the whole question (QA 2026-09-26).
export function failedWords(tool: "scan" | "find" | "aggregate" | "voices"): string {
  const what = tool === "scan" ? "read" : tool === "find" ? "search" : "count";
  return (
    `This ${what} did not finish, twice, so nothing from it can be used. Answer from the other results. Your FIRST ` +
    `sentence says what the answer covers, in plain words: "One ${what} didn't finish, so this covers only the ` +
    `conversations about <what the other results covered>." If nothing else was read, say that the conversations could not be read ` +
    "this time and suggest asking again."
  );
}

/** The most active people in a slice, one line each, with the slice's head count as the denominator. */
export function voicesForModel(o: VoicesResult, names?: TopicNames): string {
  if (!o.rows.length) return `Nobody wrote in ${sliceWords(o.filters, names)}.`;
  return (
    `The ${o.rows.length} most active of ${num(o.total_authors)} people in ${sliceWords(o.filters, names)} ` +
    `(messages, conversations written in, conversations started, reactions on their messages, first and last message):\n` +
    o.rows
      .map(
        (v) =>
          `${v.author}: ${v.messages} messages in ${v.conversations} conversations, started ${v.started}, ${v.reactions} reactions, ${v.first_ts.slice(0, 10)} to ${v.last_ts.slice(0, 10)}`,
      )
      .join("\n")
  );
}
