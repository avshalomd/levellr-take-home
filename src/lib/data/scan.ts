import "server-only";
import { decide, noul } from "@/lib/llm/decide";
import { query } from "./db";
import { CONV_COLUMNS, topicKeys, whereOf } from "./filters";
import { mapPool } from "./pool";
import { messagesFor } from "./search";
import type { ConversationRow, Filters, MessageRef } from "./types";

// The agent's main way to read the community: point at a slice of conversations by their labels, channel and time,
// ask Jev one closed question about each, and get back the ones that matter plus HOW MANY matter.
//
// Why read everything in the slice rather than retrieve a top-k (docs/DECISIONS.md D9): Jev reads each
// conversation with the question in hand, so it catches what a keyword or embedding match misses (a complaint in
// Portuguese, "runs like garbage" for performance), and because every conversation in the slice is judged, the
// number of relevant ones is a count, not a guess from a sample. Ties in relevance go to the more engaged conversation.

export const MAX_SCAN = 2500; // over this the tool asks the agent to narrow the slice instead.
export const RELEVANT = 0.5; // a conversation counts as relevant at Jev probability >= 0.5
const IN_FLIGHT = 40;
const RELEVANT_IDS = 400;

export type ScanHit = ConversationRow & { relevance: number; messages: MessageRef[] };
export type Facet = { key: string; n: number };

export type ScanResult =
  | {
      status: "ok";
      question: string;
      filters: Filters;
      scanned: number;
      relevant: number; // conversations at or above RELEVANT
      failed: number; // Jev calls that errored (counted, never silently dropped)
      relevantByWeek: Facet[];
      relevantByTopic: Facet[]; // conversations touching each topic: can add up to more than `relevant`
      relevantIds: string[]; // every relevant conversation, most relevant first, up to RELEVANT_IDS: the pool a claim is checked against
      hits: ScanHit[];
      // For a read kept to the community's own games (opts.own): those games, and how many conversations bore on the
      // question but were about something else, left out of `relevant` and the hits. Absent on any other read.
      own?: { games: string; elsewhere: number };
    }
  | {
      status: "too-broad";
      question: string;
      filters: Filters;
      total: number;
      byTopic: Facet[];
      byWeek: Facet[];
    }
  | { status: "empty"; question: string; filters: Filters };

export type ScanProgress = { done: number; total: number; relevant: number };

// Production QA 2026-09-27 (P2, P6): "What are the top frustrations players have right now?" read GTA 6's price talk in
// #off-topic as a frustration, and an excitement answer listed other games' releases, against D20. A read about what
// excites or frustrates people, or what to post, asks Jev in the same call whether what the conversation says on the
// question is about the community's own games (`own`, from dataset_meta.mood_target); one that is not is left out and
// counted apart. Still one Jev call per conversation.
const OWN = noul(
  "Is what `conversation` says on `question` about `games` (the games themselves, their updates, releases, prices, " +
    "story or the studio behind them)? Answer no when that part is about other games or franchises, films or shows, " +
    "hardware, or life outside the games, even if `games` are named in passing.",
);

/** `own`: the community's own games, for a read D20 keeps to them. `rank`: "engagement" puts the most engaged of the
 *  relevant conversations first (D5, what to post), "relevance" (the default) the most relevant. */
export async function scan(
  question: string,
  filters: Filters,
  opts: {
    top?: number;
    onProgress?: (p: ScanProgress) => void;
    own?: string;
    rank?: "relevance" | "engagement";
  } = {},
): Promise<ScanResult> {
  const top = opts.top ?? 10;
  const params: unknown[] = [];
  const where = whereOf(filters, params);
  const [{ n }] = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM conversations c WHERE ${where}`,
    params,
  );
  if (n === 0) return { status: "empty", question, filters };
  if (n > MAX_SCAN) {
    const [byTopic, byWeek] = await Promise.all([
      // Conversations touching each topic: one conversation counts under each of its topics (D46).
      query<Facet>(
        `SELECT tk.key, count(*)::int AS n FROM conversations c CROSS JOIN LATERAL ${topicKeys("c")} AS tk(key)
         WHERE ${where} GROUP BY 1 ORDER BY 2 DESC`,
        params,
      ),
      query<Facet>(
        `SELECT to_char(date_trunc('week', started_at), 'YYYY-MM-DD') AS key, count(*)::int AS n FROM conversations c WHERE ${where} GROUP BY 1 ORDER BY 1`,
        params,
      ),
    ]);
    return { status: "too-broad", question, filters, total: n, byTopic, byWeek };
  }

  const rows = await query<ConversationRow & { context_ids: string[] }>(
    `SELECT ${CONV_COLUMNS} FROM conversations c WHERE ${where}`,
    params,
  );

  const q = noul(
    "Does `conversation` contain something that helps answer `question`: a direct answer, an opinion, a report or " +
      "an experience that bears on it? Sharing a word or a topic with the question is not enough.",
  );
  let done = 0;
  let relevantSoFar = 0;
  let failed = 0;
  let elsewhere = 0;
  const scores = await mapPool(rows, IN_FLIGHT, async (r) => {
    let p: number | null = null;
    try {
      const res = await decide({
        state: {
          question,
          conversation: r.transcript.slice(0, 12_000),
          ...(opts.own ? { games: opts.own } : {}),
        },
        questions: opts.own ? { q, own: OWN } : { q },
      });
      const got = res.answers as Record<string, { noul: number } | undefined>;
      const relevance = got.q!.noul;
      // Bears on the question, but about something else: left out, and counted apart.
      const ours = got.own?.noul;
      if (opts.own && relevance >= RELEVANT && ours !== undefined && ours < RELEVANT) {
        elsewhere++;
        p = 0;
      } else p = relevance;
    } catch {
      failed++;
    }
    done++;
    if (p !== null && p >= RELEVANT) relevantSoFar++;
    if (opts.onProgress && (done % 25 === 0 || done === rows.length))
      opts.onProgress({ done, total: rows.length, relevant: relevantSoFar });
    return p;
  });

  const scored = rows.map((r, i) => ({ ...r, relevance: scores[i] ?? 0 }));
  const relevantRows = scored.filter((r) => r.relevance >= RELEVANT);
  // A row counts once under each key it has: once per week, but under every topic it touches (D46), so the topic
  // facet can add up to more than `relevant`.
  const facet = (keys: (r: (typeof scored)[number]) => string[]): Facet[] => {
    const m = new Map<string, number>();
    for (const r of relevantRows) for (const k of keys(r)) m.set(k, (m.get(k) ?? 0) + 1);
    return [...m].map(([k, v]) => ({ key: k, n: v }));
  };
  const weekOf = (iso: string) => {
    const d = new Date(iso);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // Monday, as Postgres date_trunc('week')
    return d.toISOString().slice(0, 10);
  };

  // Ranked by engagement, the relevant conversations come first, most engaged first, and the nearly relevant only fill
  // what is left (production QA 2026-09-27, P4: post ideas rested on the most relevant, not what drew people in).
  const byRelevance = (a: (typeof scored)[number], b: (typeof scored)[number]) =>
    b.relevance - a.relevance || b.engagement - a.engagement;
  const best = (
    opts.rank === "engagement"
      ? [
          ...relevantRows.toSorted((a, b) => b.engagement - a.engagement || b.relevance - a.relevance),
          ...scored.filter((r) => r.relevance >= RELEVANT * 0.6 && r.relevance < RELEVANT).sort(byRelevance),
        ]
      : scored.filter((r) => r.relevance >= RELEVANT * 0.6).sort(byRelevance)
  ).slice(0, top);
  const messages = await messagesFor(
    best.map((r) => r.id),
    best.flatMap((r) => r.context_ids),
  );
  return {
    status: "ok",
    question,
    filters,
    scanned: rows.length,
    relevant: relevantRows.length,
    failed,
    relevantByWeek: facet((r) => [weekOf(r.started_at)]).sort((a, b) => a.key.localeCompare(b.key)),
    relevantByTopic: facet((r) => (r.topics?.length ? r.topics : ["unlabelled"])).sort((a, b) => b.n - a.n),
    relevantIds: relevantRows
      .toSorted((a, b) => b.relevance - a.relevance || b.engagement - a.engagement)
      .slice(0, RELEVANT_IDS)
      .map((r) => r.id),
    hits: best.map(({ context_ids, ...r }) => ({
      ...r,
      messages: messages.filter((m) => m.conversation_id === r.id || context_ids.includes(m.id)),
    })),
    ...(opts.own ? { own: { games: opts.own, elsewhere } } : {}),
  };
}
