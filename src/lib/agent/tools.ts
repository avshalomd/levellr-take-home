import "server-only";
import { tool, type JSONValue, type ModelMessage, type UIMessageStreamWriter } from "ai";
import { z } from "zod";
import { aggregate, GROUPINGS, METRICS, type AggregateResult } from "@/lib/data/aggregate";
import { conversationIdOf, getConversation, getOverview } from "@/lib/data/read";
import { msgTag } from "@/lib/refs";
import type { Profile } from "@/lib/data/profile";
import { followUpContext, isRefusal, lastQuestion, questionsOf, unaskedFlag, type Refusal } from "./flags";
import { aggregateForModel, conversationsForModel, failedWords, FLAG_WORDS, periodOf, refusalWords, scanForModel, voicesForModel, type ScanExtras } from "./for-model";
import { changeAgainst, type CountLike } from "./trends";
import type { SliceFilters } from "./slices";
import { OFF_TOPIC_MODEL_WORDS, offTopicReply, type OffTopic } from "./off-topic";
import { bearsOn, IN_SCOPE_WORDS, isInScope, SCOPE_BAR, type InScope } from "./scope";
import { scan, MAX_SCAN, type ScanResult } from "@/lib/data/scan";
import { searchConversations, type SearchResult } from "@/lib/data/search";
import { topVoices, type VoicesResult } from "@/lib/data/voices";
import { active } from "@/lib/labels/store";
import type { Filters } from "@/lib/data/types";
import { isIsoDate } from "@/lib/data/filters";

// The agent's whole view of the data is these six tools. Each returns TWO things: the full result, which streams
// to the UI (citation chips, thread map, charts), and a compact text for the model (toModelOutput), so a scan of 40
// conversations does not cost the model 40 full transcripts of context.

// A date the model wrote as words ("July 2026") is refused with words it can act on, before anything reads (review
// 2026-09-26: Postgres threw on ::timestamptz, and the retry below hid that from the model, which used to see the
// error and correct the date).
const isoDate = z
  .string()
  .refine(isIsoDate, { error: (i) => `${JSON.stringify(i.input)} is not a date the tools read: write an ISO date, e.g. 2026-07-01 (a month is since 2026-07-01, until 2026-08-01)` });

const filters = z
  .object({
    topic: z
      .string()
      .optional()
      .describe(
        "one topic label key, as dataset_overview lists them: every conversation touching that topic (a conversation " +
          "can have several topics); omit for all topics",
      ),
    channel: z.string().optional().describe("post flair, e.g. Discussion, Official, Bug Report; see dataset_overview"),
    since: isoDate.optional().describe("ISO date, inclusive, e.g. 2026-09-09"),
    until: isoDate.optional().describe("ISO date, exclusive, e.g. 2026-10-01"),
    flag: z
      .enum(["bug", "feature", "complaint", "help"])
      .optional()
      .describe(
        "only conversations labelled with this flag (probability >= 0.5). Only when the question itself asks about " +
          "bugs, requests, complaints or help; never for how people feel, react or take part. A call with a flag the " +
          "question does not name is refused",
      ),
    author: z.string().optional().describe("only conversations this person wrote in, by their username exactly as the tools print it"),
  })
  .describe("the slice of conversations: every field narrows it");

// The reader's steps say what a read or a search was about in these words ("Looked for posts about the Rondo
// changes"), not the model's own search string or a rewritten question cut short (QA 2026-09-26). Optional, so a call
// without it still runs; the steps then fall back to plainer words (components/chat/activity-words.ts).
const about = z
  .string()
  .optional()
  .describe("always give it: what this is about, in 2-6 plain words for the reader, e.g. 'the Rondo changes', 'lag after the update'");

// A call narrowed by a flag the reader's question (read with the one it follows up) never named is refused before it
// reads anything: the model is told why and reads again without the flag (for-model.ts refusalWords). A note beside
// the number was ignored (QA 2026-09-26, the 42.3 reaction). Returned as a result, not thrown (review 2026-09-26: a
// thrown refusal reached the browser as "An error occurred." and showed as a step that did not finish); the model
// reads its words (modelOutput) and the steps leave it out.
function refusalOf(f: Filters | undefined, messages: ModelMessage[]): Refusal | null {
  const flag = unaskedFlag(f?.flag, messages);
  return flag ? { status: "refused", flag, words: refusalWords(flag) } : null;
}
/** What the model reads back: a refusal's words, else the tool's own compact text. */
const modelOutput =
  <T>(text: (o: T) => string) =>
  ({ output }: { output: unknown }) => ({ type: "text" as const, value: isRefusal(output) ? output.words : readBack(output, text) });

// (sanity QA 2026-09-26) Every earlier turn's results pass through here again on the next turn, from the chat the
// browser sends (route.ts convertToModelMessages), so a result saved in a shape the text no longer expects threw and
// failed the whole follow-up ("chat failed TypeError ... reading 'slice'", a seeded find hit). for-model.ts reads the
// hit fields defensively; this is the net under every other shape: the result is said to be unreadable, and logged.
export const UNREADABLE_RESULT = "This earlier result could not be read back. Read the conversations again if the answer needs them.";
function readBack<T>(output: unknown, text: (o: T) => string): string {
  try {
    return text(output as T);
  } catch (e) {
    console.error("tool result not readable for the model", e);
    return UNREADABLE_RESULT;
  }
}

const clean = (f: Filters | undefined): Filters =>
  Object.fromEntries(Object.entries(f ?? {}).filter(([, v]) => v !== undefined && v !== "")) as Filters;

// A step that fails on something passing is tried once more before it counts as failed: a read that fails once is
// usually a dropped connection, and one failed read had left an answer about "the latest update" standing on one
// topic (QA 2026-09-26). A second failure throws words for the model (for-model.ts failedWords), which the model reads
// as the tool's error; the reader's step says it in plain words (components/chat/activity-words.ts).
// Only a transient failure is retried (review 2026-09-26): an error the input causes (an unknown topic, a value
// Postgres rejects) fails the same way twice, and its own words are what the model needs to correct the call, so it
// is thrown as it is, at once.
export async function once<T>(tool: Parameters<typeof failedWords>[0], run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (!isTransient(e)) throw e;
    try {
      return await run();
    } catch (again) {
      if (!isTransient(again)) throw again;
      console.error(`${tool} failed twice`, again);
      throw new Error(failedWords(tool));
    }
  }
}

// What a dropped connection, a timeout or a busy provider looks like: Node's socket codes, Postgres's connection,
// resource and cancel classes (08, 53, 57), an AI SDK error that says it may be retried, and the words these carry
// when only a message survives. Anything else (a data or syntax error, 22xxx or 42xxx, our own errors) is not.
const TRANSIENT_CODES = /^(?:ECONNRESET|ECONNREFUSED|ECONNABORTED|ETIMEDOUT|EPIPE|EAI_AGAIN|UND_ERR_\w+|08\w{3}|53\w{3}|57P0\d|57014|40001|40P01)$/;
const TRANSIENT_WORDS =
  /\b(?:time[d ]?out|timeout|socket hang up|fetch failed|network error|connection (?:terminated|closed|reset|refused|error)|ECONNRESET|ECONNREFUSED|ETIMEDOUT|too many (?:requests|connections)|rate limit\w*|overloaded|429|502|503|504)\b/i;
export function isTransient(e: unknown, depth = 0): boolean {
  if (!e || typeof e !== "object" || e instanceof UnknownTopic || depth > 3) return false;
  const o = e as { name?: unknown; code?: unknown; isRetryable?: unknown; message?: unknown; cause?: unknown };
  if (o.name === "AbortError" || o.name === "TimeoutError" || o.isRetryable === true) return true;
  if (typeof o.code === "string" && TRANSIENT_CODES.test(o.code)) return true;
  if (typeof o.message === "string" && TRANSIENT_WORDS.test(o.message)) return true;
  return isTransient(o.cause, depth + 1);
}

// What a read looks for. Made to call a reading tool (agent.ts prepareStep), a free model filled the question with
// ", " (QA 2026-09-26, "And in July?"), and a read for nothing finds nothing. A question with no words in it is the
// reader's own question instead, read with the one it follows up, whether or not either named a kind (review
// 2026-09-26: questionInContext joins only a question that named one, so "And in July?" after a question about the
// new map scanned for "And in July?").
export function readQuestion(question: string, messages: ReadonlyArray<ModelMessage>): string {
  return /\p{L}{2}/u.test(question) ? question : followUpContext(questionsOf(messages)) || question;
}

// A question about a release is a question about the whole community over the release's days: "How do players feel
// about the latest update?" was read on one topic, Updates & Feedback, and answered as if that were everyone (QA
// 2026-09-26). The read is not refused (a question can name a topic too), but the model is told what it narrowed.
const RELEASE_WORDS = /\b(?:update|patch|release|version|season|oppdatering\w*)\b/i;
export function releaseNote(question: string, f: Filters): string | undefined {
  if (!f.topic || !RELEASE_WORDS.test(question)) return undefined;
  return (
    "This read covered one topic only. A reaction to a release is every topic's conversations over the release's " +
    "days: read again with no topic, over its dates, unless the question itself names this topic, and until then say in " +
    "the first sentence that the answer covers only this topic."
  );
}

// Topic labels are data (they are discovered per community and the customer can change them), so the schema cannot
// list them. An unknown key is answered with the real ones rather than an empty result the model would believe.
class UnknownTopic extends Error {}
async function checked(f: Filters | undefined, keys: () => Promise<string[]>): Promise<Filters> {
  const out = clean(f);
  if (out.topic) {
    const known = await keys();
    if (!known.includes(out.topic)) throw new UnknownTopic(`No topic "${out.topic}". The topic labels are: ${known.join(", ")}.`);
  }
  return out;
}

/** `p`: the community's profile (its name and dates), for the reply to a question it cannot answer and for the days a
 *  count covers. The chat passes it (agent.ts); without it those fall back to what the tools can say alone. */
export function makeTools(writer?: UIMessageStreamWriter, p?: Profile) {
  const window = p?.from && p?.to ? { from: p.from, to: p.to } : undefined;
  let labels: Promise<{ key: string; name: string }[]> | undefined;
  const topicLabels = () => (labels ??= active().then((t) => t.labels));
  const topicKeys = () => topicLabels().then((l) => l.map((x) => x.key));
  // This turn's counts, so a count of the same slice over another period is handed its change per day (trends.ts).
  const counts: CountLike[] = [];
  return {
    dataset_overview: tool({
      description:
        "What the dataset is: the community, time window, counts, channels, the topic labels (key, name, what each " +
        "covers, and how many conversations touch it: a conversation can have several topics, so these add up to more " +
        "than the total). Call it first when a question " +
        "depends on dates, labels or names you do not know yet.",
      inputSchema: z.object({}),
      execute: async () => getOverview(),
      toModelOutput: ({ output }: { output: unknown }) => ({ type: "json", value: output as JSONValue }),
    }),

    scan: tool({
      description:
        "THE MAIN WAY TO READ THE COMMUNITY. Point at a slice of conversations with filters, give a question, and " +
        "every conversation in the slice is read and judged for relevance to it. Returns the most relevant " +
        "conversations (with message refs to cite) AND how many in the slice are relevant - an exact count you can " +
        `report. Use it for "what are people saying about X", "how many complain about Y", "why". Slices over ${MAX_SCAN} ` +
        "conversations are refused with a breakdown by topic and week so you can narrow.",
      inputSchema: z.object({
        question: z.string().describe("a precise relevance question, e.g. 'Does anyone report stutter or FPS drops?'"),
        about,
        filters: filters.optional(),
        top: z.number().int().min(1).max(15).optional().describe("how many conversations to return (default 10)"),
      }),
      execute: async ({ question, filters: f, top }, { toolCallId, messages }) => {
        const refused = refusalOf(f, messages);
        if (refused) return refused;
        const slice = await checked(f, topicKeys);
        const read: ScanResult = await once("scan", () =>
          scan(readQuestion(question, messages), slice, {
            top,
            onProgress: (p) => writer?.write({ type: "data-scanProgress", id: toolCallId, data: { ...p, toolCallId } }),
          }),
        );
        if (read.status !== "ok") return read;
        const note = releaseNote(lastQuestion(messages), slice);
        // The days the read covers travel with it, like a count's, so its counts can be given per day (for-model.ts).
        return { ...read, sliceMood: await sliceMood(slice), period: periodOf(slice, window), ...(note ? { notes: [note] } : {}) };
      },
      toModelOutput: modelOutput<ScanResult & ScanExtras>((o) => scanForModel(o, MAX_SCAN)),
    }),

    find: tool({
      description:
        "Fast search across ALL conversations for a specific thing: a named item, skin, weapon, bug, phrase or " +
        "event. Returns up to k conversations, reranked for relevance. Use scan instead when the question is about " +
        "how common or how people feel about something.",
      inputSchema: z.object({
        query: z.string().describe("what to look for, in the community's own words"),
        about,
        filters: filters.optional(),
        k: z.number().int().min(1).max(12).optional(),
      }),
      execute: async ({ query, filters: f, k }, { messages }) => {
        const refused = refusalOf(f, messages);
        if (refused) return refused;
        const slice = await checked(f, topicKeys);
        return once("find", () => searchConversations(readQuestion(query, messages), slice, k ?? 8));
      },
      toModelOutput: modelOutput<SearchResult>((o) =>
        o.hits.length
          ? `${o.hits.length} relevant conversations${typeof o.candidates === "number" ? ` (of ${o.candidates} candidates)` : ""}.\n\n${conversationsForModel(o.hits)}`
          : `Nothing relevant found (${o.candidates} candidates read).`,
      ),
    }),

    aggregate: tool({
      description:
        "Exact numbers from the labels: counts of conversations, their messages, people and net votes, sentiment and " +
        "label shares, grouped by day, week, month, topic or channel. Use for trends and comparisons. Every number you " +
        "state must come from here or from a scan count. The unit is the conversation, dated by the day it starts. By " +
        "topic, a conversation counts under every topic it touches, so the rows overlap and shares by topic can add up " +
        "to more than 100%.",
      inputSchema: z.object({
        metric: z.enum(Object.keys(METRICS) as [keyof typeof METRICS, ...(keyof typeof METRICS)[]]),
        group_by: z.enum(Object.keys(GROUPINGS) as [keyof typeof GROUPINGS, ...(keyof typeof GROUPINGS)[]]),
        filters: filters.optional(),
      }),
      execute: async ({ metric, group_by, filters: f }, { messages }) => {
        const refused = refusalOf(f, messages);
        if (refused) return refused;
        const slice = await checked(f, topicKeys);
        const counted = await once("aggregate", () => aggregate(metric, group_by, slice));
        // The days the count covers travel with it, so a comparison of periods can be made per day (for-model.ts).
        const withDays = { ...counted, period: periodOf(slice, window) };
        // Against an earlier count of the same slice over another period, the change per day, from the unrounded rates
        // (production QA 2026-09-26: +124% stated for +121%). Named as the reader knows each row.
        const names = new Map((await topicLabels()).map((l) => [l.key, l.name]));
        const nameOf = (key: string, sf: SliceFilters) =>
          group_by === "topic" ? (names.get(key) ?? key) : group_by !== "none" ? key : sf.topic ? (names.get(sf.topic) ?? sf.topic) : sf.flag ? (FLAG_WORDS[sf.flag] ?? sf.flag) : "all conversations";
        const change = changeAgainst(counts, withDays, nameOf);
        counts.push(withDays);
        return change ? { ...withDays, change } : withDays;
      },
      toModelOutput: modelOutput<AggregateResult>(aggregateForModel),
    }),

    voices: tool({
      description:
        "Who is talking in a slice: the most active people, each with the messages and conversations they wrote, the " +
        "threads they started and the net votes their messages drew, plus how many people took part in all. Use it " +
        "for 'who are the regulars / main voices / creators', and to tell a view held by many from one pushed by a few " +
        "loud people. To read what one person says, pass filters.author to scan or find.",
      inputSchema: z.object({
        filters: filters.optional(),
        limit: z.number().int().min(1).max(25).optional().describe("how many people to list (default 10)"),
      }),
      execute: async ({ filters: f, limit }, { messages }) => {
        const refused = refusalOf(f, messages);
        if (refused) return refused;
        const slice = await checked(f, topicKeys);
        return once("voices", () => topVoices(slice, limit ?? 10));
      },
      toModelOutput: modelOutput<VoicesResult>(voicesForModel),
    }),

    read_conversation: tool({
      description:
        "The full text of one conversation (all its messages, untruncated), by the handle the other tools print " +
        "in its header, e.g. conv123.",
      inputSchema: z.object({ id: z.string().describe("the conversation handle, e.g. conv123") }),
      execute: async ({ id }) => {
        const cid = await conversationIdOf(id);
        return cid ? getConversation(cid) : null;
      },
      toModelOutput: ({ output }: { output: unknown }) => {
        const c = output as Awaited<ReturnType<typeof getConversation>>;
        return c
          ? { type: "text", value: `${c.thread_title} [${c.channel}]\n` + c.messages.map((m) => `[${msgTag(m.ref)}] ${m.author} ${m.ts.slice(0, 16)}: ${m.text}`).join("\n") }
          : { type: "text", value: "No such conversation." };
      },
    }),

    out_of_scope: tool({
      description:
        "Call this INSTEAD of answering when the question is not about the community's conversations at all: the " +
        "weather, live server status, news from elsewhere, general knowledge, small talk. Call it alone and write " +
        "nothing: the app writes the reply (what the conversations cover, and questions to ask). Never for a question " +
        "the conversations bear on, however thinly.",
      // No input: the reply names no subject (off-topic.ts), so the model is asked for none.
      inputSchema: z.object({}),
      execute: async (_, { messages }): Promise<OffTopic | InScope> => {
        // A second opinion before the question is turned away (scope.ts): one the conversations bear on is answered
        // from them. A check that could not be made takes the model's call as it stands.
        const bears = p ? await bearsOn(lastQuestion(messages), p) : null;
        if (bears !== null && bears >= SCOPE_BAR) return { status: "in-scope", bears };
        const o = await getOverview().catch(() => null);
        const who = p ?? { community: "the community", from: "", to: "" };
        return { status: "off-topic", text: offTopicReply(who, o?.topics ?? []) };
      },
      toModelOutput: ({ output }: { output: unknown }) => ({ type: "text" as const, value: isInScope(output) ? IN_SCOPE_WORDS : OFF_TOPIC_MODEL_WORDS }),
    }),
  };
}

// The average mood of a slice a read covered, from the labels: said for the whole set, never for the sample the read
// prints (QA 2026-09-26). A failure leaves it out; the read still stands.
async function sliceMood(f: Filters): Promise<number | null> {
  try {
    const r = await aggregate("avg_sentiment", "none", f);
    const v = r?.rows?.[0]?.value;
    return typeof v === "number" ? v : null;
  } catch {
    return null;
  }
}

export type AgentTools = ReturnType<typeof makeTools>;
