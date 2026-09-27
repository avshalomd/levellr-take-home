import "server-only";
import { decide, noul } from "@/lib/llm/decide";
import { query } from "./db";
import { embedQuery, toVector } from "./embed";
import { CONV_COLUMNS, MSG_COLUMNS, whereOf } from "./filters";
import { mapPool } from "./pool";
import type { ConversationRow, Filters, MessageRef } from "./types";

// Hybrid retrieval in one SQL statement, then a Jev rerank.
//
// 1. Keywords: Postgres full-text search over the transcript. The query's words are OR-ed, not AND-ed: a
//    question in plain English ("what do people think of the new map") would otherwise match almost nothing.
// 2. Meaning: cosine distance between the query embedding and each conversation's embedding (pgvector, HNSW).
// 3. Reciprocal rank fusion merges the two lists by rank, so neither score scale has to be calibrated to the other.
// 4. Jev reads each fused candidate with the question and says how likely it is to help answer it. That probability
//    orders the final list and drops what does not help - an honest "nothing relevant" beats padding.
// Why this shape and what else was considered: docs/DECISIONS.md D9.

const CANDIDATES = 24; // what the rerank reads
const PER_LIST = 40; // what each retriever contributes to the fusion
const RRF_K = 60; // the standard constant: dampens the gap between rank 1 and rank 2
export const MIN_RELEVANCE = 0.25;

export type SearchHit = ConversationRow & {
  rrf: number;
  kw_rank: number | null;
  vec_rank: number | null;
  relevance: number | null; // Jev's probability that it helps; null when the rerank was unavailable
  messages: MessageRef[]; // members (and context), text cut to a preview, for citation chips and the thread map
};

export type SearchResult = {
  query: string;
  filters: Filters;
  candidates: number;
  rerank: "jev" | "unavailable";
  embeddings: boolean;
  hits: SearchHit[];
};

export type Candidate = ConversationRow & {
  rrf: number;
  kw_rank: number | null;
  vec_rank: number | null;
  context_ids: string[];
};

/**
 * Embeddings are on trial (docs/DECISIONS.md D10): RETRIEVAL_EMBEDDINGS=0 turns the vector half off, leaving
 * keywords + the Jev rerank, and the eval runs both ways. They stay only if they buy measurable recall.
 */
export const embeddingsOn = () => process.env.RETRIEVAL_EMBEDDINGS !== "0";

export type Arms = { keywords?: boolean; embeddings?: boolean };

/**
 * Steps 1-3: the fused candidate list, before the rerank. Exported for the eval, which scores each arm on its own
 * (keywords only, embeddings only, both) with and without the rerank - eval/retrieval.ts.
 */
export async function candidates(
  q: string,
  filters: Filters = {},
  arms: Arms = {},
  limit = CANDIDATES,
): Promise<Candidate[]> {
  const useKw = arms.keywords ?? true;
  const useVec = arms.embeddings ?? embeddingsOn();
  const vector = useVec ? await embedQuery(q) : null;
  const params: unknown[] = [useKw ? q : "", vector ? toVector(vector) : null];
  const whereKw = whereOf(filters, params);
  const whereVec = whereOf(filters, params);
  return query<Candidate>(
    `WITH q AS (SELECT replace(plainto_tsquery('english', $1)::text, '&', '|') AS t),
     kw AS (
       SELECT c.id, row_number() OVER (ORDER BY ts_rank_cd(c.tsv, to_tsquery('english', q.t)) DESC) AS r
       FROM conversations c, q
       WHERE q.t <> '' AND c.tsv @@ to_tsquery('english', q.t) AND ${whereKw}
       ORDER BY ts_rank_cd(c.tsv, to_tsquery('english', q.t)) DESC LIMIT ${PER_LIST}),
     vec AS (
       SELECT c.id, row_number() OVER (ORDER BY c.embedding <=> $2::vector) AS r
       FROM conversations c
       WHERE $2::vector IS NOT NULL AND c.embedding IS NOT NULL AND ${whereVec}
       ORDER BY c.embedding <=> $2::vector LIMIT ${PER_LIST}),
     fused AS (
       SELECT id, sum(1.0 / (${RRF_K} + r))::float AS rrf,
              min(r) FILTER (WHERE src = 'kw')::int AS kw_rank, min(r) FILTER (WHERE src = 'vec')::int AS vec_rank
       FROM (SELECT id, r, 'kw' AS src FROM kw UNION ALL SELECT id, r, 'vec' FROM vec) u GROUP BY id)
     SELECT ${CONV_COLUMNS}, f.rrf, f.kw_rank, f.vec_rank
     FROM fused f JOIN conversations c USING (id)
     ORDER BY f.rrf DESC LIMIT ${limit}`,
    params,
  );
}

export async function searchConversations(
  q: string,
  filters: Filters = {},
  k = 8,
  opts: { embeddings?: boolean } = {},
): Promise<SearchResult> {
  const useVec = opts.embeddings ?? embeddingsOn();
  const rows = await candidates(q, filters, { embeddings: useVec });

  const { scores, ok } = await rerank(q, rows);
  const ranked = rows
    .map((r, i) => ({ ...r, relevance: ok ? scores[i] : null }))
    .filter((r) => r.relevance === null || r.relevance >= MIN_RELEVANCE)
    .sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0) || b.rrf - a.rrf)
    .slice(0, k);

  const messages = await messagesFor(
    ranked.map((r) => r.id),
    ranked.flatMap((r) => r.context_ids),
  );
  const hits: SearchHit[] = ranked.map(({ context_ids, ...r }) => ({
    ...r,
    messages: messages.filter((m) => m.conversation_id === r.id || context_ids.includes(m.id)),
  }));
  return {
    query: q,
    filters,
    candidates: rows.length,
    rerank: ok ? "jev" : "unavailable",
    embeddings: useVec,
    hits,
  };
}

/** Jev, one request per candidate, all in parallel. On any failure the fused order stands and the result says so. */
export async function rerank(
  question: string,
  rows: { transcript: string }[],
): Promise<{ scores: number[]; ok: boolean }> {
  try {
    const scores = await mapPool(rows, 24, async (r) => {
      const res = await decide({
        state: { question, conversation: r.transcript.slice(0, 12_000) },
        questions: {
          helps: noul(
            "Does `conversation` contain information that helps answer `question` - a direct answer, an opinion, " +
              "a report or an experience that bears on it? A conversation that only shares a word with the " +
              "question does not help.",
          ),
        },
      });
      return res.answers.helps.noul;
    });
    return { scores, ok: true };
  } catch {
    return { scores: [], ok: false };
  }
}

export async function messagesFor(conversationIds: string[], extraIds: string[] = []): Promise<MessageRef[]> {
  if (!conversationIds.length && !extraIds.length) return [];
  return query<MessageRef>(
    `SELECT ${MSG_COLUMNS("left(m.text, 700)")}
     FROM messages m WHERE m.conversation_id = ANY($1) OR m.id = ANY($2)
     ORDER BY m.ts`,
    [conversationIds, extraIds],
  );
}
