// Retrieval arms, head to head: does each half of hybrid search, and the Jev rerank, earn its place? (DECISIONS.md)
// Ported from Community Pulse 90f193d (eval/retrieval.ts); the gold is message ids here, not Reddit thread ids.
//
// For every lookup question, six ranked lists of 8 conversations:
//   kw, vec, hybrid              - the first 8 of each retriever's fused order (no rerank)
//   kw+jev, vec+jev, hybrid+jev  - 24 candidates from that retriever, reranked by Jev, as production does
// Relevance comes from POOLING (the TREC method): the union of all six lists is judged once per conversation by an
// independent model (Gemini Flash-Lite), blind to the arm. Recall is measured against every relevant conversation any
// arm found, the fair denominator when nobody knows the true total. "Gold found" is whether a conversation holding
// one of the messages the question was written from (read by hand in data/messages.json) is in the top 8; the
// message ids are mapped to conversations at run time, so a regrouping of the data does not stale the gold.
//
// usage: npm run eval:retrieval   -> eval/results/retrieval.json
import { writeFileSync } from "node:fs";
import { query } from "@/lib/data/db";
import { candidates, MIN_RELEVANCE, rerank, type Arms } from "@/lib/data/search";
import { cache, judgeRelevance, JUDGE_MODEL, pool, questions } from "./lib";

const K = 8;
const ARMS: { name: string; arms: Arms; rerank: boolean }[] = [
  { name: "kw", arms: { keywords: true, embeddings: false }, rerank: false },
  { name: "vec", arms: { keywords: false, embeddings: true }, rerank: false },
  { name: "hybrid", arms: { keywords: true, embeddings: true }, rerank: false },
  { name: "kw+jev", arms: { keywords: true, embeddings: false }, rerank: true },
  { name: "vec+jev", arms: { keywords: false, embeddings: true }, rerank: true },
  { name: "hybrid+jev", arms: { keywords: true, embeddings: true }, rerank: true },
];

type ArmResult = {
  returned: number;
  precision: number;
  recall: number;
  ndcg: number;
  gold_hit: boolean | null;
  gold_rr: number | null;
  ms: number;
  ids: string[];
};

async function listFor(q: string, a: (typeof ARMS)[number]) {
  const t0 = Date.now();
  const rows = await candidates(q, {}, a.arms, a.rerank ? 24 : K);
  let out = rows;
  if (a.rerank) {
    // A rerank that failed (Jev busy or rate-limited) returns no scores; scoring that as "nothing relevant" would
    // record a number for a call that never ran. Retry, then stop the run.
    let { scores, ok } = await rerank(q, rows);
    for (let i = 0; !ok && i < 3; i++) {
      await new Promise((r) => setTimeout(r, 20_000));
      ({ scores, ok } = await rerank(q, rows));
    }
    if (!ok) throw new Error(`rerank unavailable for "${q}" (${a.name}) after 4 tries: no score recorded`);
    out = rows
      .map((r, i) => ({ ...r, s: scores[i] ?? 0 }))
      .filter((r) => r.s >= MIN_RELEVANCE)
      .sort((x, y) => y.s - x.s)
      .slice(0, K);
  }
  return { hits: out.map((r) => ({ id: r.id, transcript: r.transcript })), ms: Date.now() - t0 };
}

const dcg = (rels: number[]) => rels.reduce((s, r, i) => s + (2 ** r - 1) / Math.log2(i + 2), 0);

async function goldConversations(ids: string[]): Promise<Set<string>> {
  const rows = await query<{ conversation_id: string }>(
    "SELECT DISTINCT conversation_id FROM messages WHERE id = ANY($1)",
    [ids],
  );
  return new Set(rows.map((r) => r.conversation_id));
}

async function main() {
  const qs = questions().filter((q) => q.type === "lookup");
  const judged = cache<{ relevance: number; reason: string }>("eval/results/judgments.json");
  const perQ: { id: string; question: string; pool: number; relevant_in_pool: number; gold: number; arms: Record<string, ArmResult> }[] = [];
  for (const q of qs) {
    const gold = q.gold_messages?.length ? await goldConversations(q.gold_messages) : null;
    const lists = await pool(ARMS, 3, (a) => listFor(q.question, a));
    const byId = new Map(lists.flatMap((l) => l.hits).map((h) => [h.id, h]));
    await pool([...byId.values()], 8, async (h) => {
      const key = `${q.id}|${h.id}`;
      if (!judged.get(key)) judged.set(key, await judgeRelevance(q.question, h.transcript));
    });
    judged.save();
    const rel = (id: string) => judged.get(`${q.id}|${id}`)!.relevance;
    const relevantPool = [...byId.keys()].filter((id) => rel(id) > 0);
    const ideal = dcg(relevantPool.map(rel).sort((a, b) => b - a).slice(0, K));
    const arms = Object.fromEntries(
      ARMS.map((a, i) => {
        const hits = lists[i].hits;
        const rels = hits.map((h) => rel(h.id));
        const goldRank = gold ? hits.findIndex((h) => gold.has(h.id)) : -1;
        const r: ArmResult = {
          returned: hits.length,
          precision: hits.length ? rels.filter((x) => x > 0).length / hits.length : 0,
          recall: relevantPool.length ? rels.filter((x) => x > 0).length / relevantPool.length : 0,
          ndcg: ideal ? dcg(rels) / ideal : 0,
          gold_hit: gold ? goldRank >= 0 : null,
          gold_rr: gold ? (goldRank >= 0 ? 1 / (goldRank + 1) : 0) : null,
          ms: lists[i].ms,
          ids: hits.map((h) => `${h.id}:${rel(h.id)}`),
        };
        return [a.name, r];
      }),
    );
    perQ.push({ id: q.id, question: q.question, pool: byId.size, relevant_in_pool: relevantPool.length, gold: gold?.size ?? 0, arms });
    console.log(
      q.id,
      Object.entries(arms)
        .map(([n, m]) => `${n} P${m.precision.toFixed(2)} R${m.recall.toFixed(2)}${m.gold_hit === null ? "" : m.gold_hit ? " +" : " -"}`)
        .join(" | "),
    );
  }
  const mean = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => x !== null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const summary = Object.fromEntries(
    ARMS.map((a) => {
      const ms = perQ.map((p) => p.arms[a.name]);
      return [
        a.name,
        {
          precision_at_8: mean(ms.map((m) => m.precision)),
          recall_at_8: mean(ms.map((m) => m.recall)),
          ndcg_at_8: mean(ms.map((m) => m.ndcg)),
          gold_hit_rate: mean(ms.map((m) => (m.gold_hit === null ? null : Number(m.gold_hit)))),
          gold_mrr: mean(ms.map((m) => m.gold_rr)),
          median_ms: ms.map((m) => m.ms).sort((x, y) => x - y)[Math.floor(ms.length / 2)],
        },
      ];
    }),
  );
  const out = { run_at: new Date().toISOString(), judge: JUDGE_MODEL, k: K, questions: perQ.length, summary, per_question: perQ };
  writeFileSync("eval/results/retrieval.json", JSON.stringify(out, null, 1));
  console.table(summary);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
