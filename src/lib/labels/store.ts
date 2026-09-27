import "server-only";
import { randomUUID } from "node:crypto";
import { decide } from "@/lib/llm/decide";
import { mapPool } from "@/lib/data/pool";
import { query, transaction } from "@/lib/data/db";
import { moodTargetOf, type MoodTarget } from "@/lib/data/mood-target";
import {
  applyInstant,
  estimate,
  estimateTokens,
  JEV_USD_PER_MTOK,
  batchVerdict,
  labelState,
  MAX_TRIES,
  normalizeLabels,
  relabelPlan,
  STATE_CHARS,
  topicOf,
  topicQuestions,
  type InstantEdit,
  type Label,
} from "./taxonomy";

// The label set in the database, its edits, and the relabel (backfill) that a meaning-changing edit needs.
// Contract for the UI: GET/POST /api/taxonomy/*. Rules: ./taxonomy.ts. Design: docs/DECISIONS.md D17, D46.
//
// Topics are multi-label (D46): conversations.topic_p holds one probability per topic, and topics / topic / topic_conf
// are derived from it by the SQL functions pulse_topics() and pulse_topic_conf() (db/app.sql), the only copy of the
// membership rule. Every write here changes topic_p and then recomputes the three through RECOMPUTE, never by hand.
const RECOMPUTE = "topics = pulse_topics(topic_p), topic = (pulse_topics(topic_p))[1], topic_conf = pulse_topic_conf(topic_p)";

export const CAP_USD = 3.0; // the whole build's budget, ingest included (ingest/budget.py has the same cap)
const BATCH = 300; // conversations per step: ~15 s at the concurrency below, well inside a function's limit
const CONCURRENCY = 24;
const LEASE_S = 120;

/** `n` per topic is the conversations that touch it: a conversation counts under every topic it belongs to, so the
 *  counts can add up to more than `total`, the number of conversations. */
export type Taxonomy = {
  version: number;
  source: string;
  note: string;
  createdAt: string;
  total: number;
  labels: (Label & { n: number })[];
};
export type Job = {
  id: string;
  status: "draft" | "running" | "done" | "failed" | "cancelled";
  done: number;
  total: number;
  costUsd: number;
  estimateUsd: number;
  skipped: number; // conversations Jev would not answer after MAX_TRIES: the asked topics got probability 0
  error: string | null;
  draft: { labels: Label[] };
  runKeys: string[]; // the topics this job asks again (new or redefined); removals need no question
};

export async function community(): Promise<string> {
  const [row] = await query<{ value: { community?: string; platform?: string } }>(`SELECT value FROM dataset_meta WHERE key = 'source'`);
  return [row?.value?.community, row?.value?.platform && `(${row.value.platform})`].filter(Boolean).join(" ") || "an online community";
}

export async function budget(): Promise<{ spentUsd: number; capUsd: number }> {
  const [r] = await query<{ usd: number }>(`SELECT coalesce(sum(usd), 0)::float AS usd FROM spend`);
  return { spentUsd: +r.usd.toFixed(4), capUsd: CAP_USD };
}

/** What the community's mood is measured towards (dataset_meta.mood_target, found at onboarding), or null on data
 *  from before it was recorded. Shown read-only beside the topics; the agent's instructions read it too. */
export async function moodTarget(): Promise<MoodTarget | null> {
  try {
    const [row] = await query<{ value: unknown }>(`SELECT value FROM dataset_meta WHERE key = 'mood_target'`);
    return moodTargetOf(row?.value);
  } catch {
    return null;
  }
}

/** Everything the topics editor shows: the label set, the latest relabel, the budget and the mood target. */
export async function panel() {
  const [a, job, b, mood] = await Promise.all([active(), latestJob(), budget(), moodTarget()]);
  return { active: a, job, budget: b, moodTarget: mood };
}

/** The active label set with conversation counts. The first call on a fresh database adopts the labels in the data. */
export async function active(): Promise<Taxonomy> {
  let [t] = await query<{ version: number; source: string; note: string; created_at: string; labels: Label[] }>(
    `SELECT version, source, note, created_at, labels FROM taxonomies WHERE active`,
  );
  if (!t) {
    // Every topic the data was asked about (topic_p's keys), plus "other" which normalizeLabels adds.
    const keys = await query<{ key: string }>(
      `SELECT DISTINCT key FROM conversations, jsonb_object_keys(coalesce(topic_p, '{}'::jsonb)) AS key ORDER BY 1`,
    );
    const labels = normalizeLabels(keys.map((k) => ({ key: k.key, name: k.key.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase()), description: "" })));
    [t] = await query(
      `INSERT INTO taxonomies (source, note, labels, active) VALUES ('adopted', 'labels found in the data', $1, true)
       RETURNING version, source, note, created_at, labels`,
      [JSON.stringify(labels)],
    );
  }
  // A conversation counts under every topic it belongs to (membership, not one bucket each).
  const [counts, [all]] = await Promise.all([
    query<{ key: string; n: number }>(`SELECT key, count(*)::int AS n FROM conversations, unnest(topics) AS key GROUP BY 1`),
    query<{ n: number }>(`SELECT count(*)::int AS n FROM conversations`),
  ]);
  const byKey = new Map(counts.map((r) => [r.key, r.n]));
  return {
    version: t.version,
    source: t.source,
    note: t.note,
    createdAt: t.created_at,
    total: all?.n ?? 0,
    labels: t.labels.map((l) => ({ ...l, n: byKey.get(l.key) ?? 0 })),
  };
}

export async function latestJob(): Promise<Job | null> {
  const [j] = await query<JobRow>(`SELECT * FROM relabel_jobs WHERE status <> 'draft' ORDER BY created_at DESC LIMIT 1`);
  return j ? jobOf(j) : null;
}

/** Rename, describe or combine: answered from the labels already in the database, in one transaction. */
export async function editInstant(edit: InstantEdit): Promise<Taxonomy> {
  await refuseWhileRunning();
  const cur = await active();
  const { labels, remap } = applyInstant(cur.labels.map(({ key, name, description }) => ({ key, name, description })), edit);
  const note =
    edit.op === "merge" ? `combined ${edit.keys.join(" + ")}` : edit.op === "rename" ? `renamed ${edit.key}` : `described ${edit.key}`;
  const parts = Object.keys(remap);
  const moves = parts.length ? mergeStatements(parts, remap[parts[0]]) : [];
  await transaction([
    ...moves,
    [`UPDATE taxonomies SET active = false WHERE active`],
    [`INSERT INTO taxonomies (source, note, labels, active) VALUES ('edited', $1, $2, true)`, [note, JSON.stringify(labels)]],
  ]);
  return active();
}

/**
 * Combining topics, as SQL over topic_p: the combined topic's probability is the HIGHEST of its parts' (a conversation
 * about any part is about the whole: OR), the parts' own entries are dropped, and the derived columns are recomputed.
 * Only conversations that carried a part are touched. Exported so the rule is pinned by store.test.ts.
 */
export function mergeStatements(parts: string[], into: string): [string, unknown[]][] {
  return [
    [
      `UPDATE conversations SET topic_p = (topic_p - $1::text[]) || jsonb_build_object($2::text,
         (SELECT max(value::float8) FROM jsonb_each_text(topic_p) WHERE key = ANY($1::text[])))
       WHERE topic_p ?| $1::text[]`,
      [parts, into],
    ],
    [`UPDATE conversations SET ${RECOMPUTE} WHERE topic_p ? $1`, [into]],
  ];
}

/**
 * A finished relabel, as SQL: the answers for the asked topics overwrite theirs in topic_p, every key that is not a
 * topic of the new set is dropped (a removed topic, free), and the derived columns are recomputed for every
 * conversation. The job's rows and failures go with it, in the same transaction (finish below).
 */
export function finishStatements(jobId: string, keep: string[]): [string, unknown[]][] {
  return [
    [
      `UPDATE conversations c SET topic_p = coalesce(c.topic_p, '{}'::jsonb) || r.topic_p FROM relabel_results r
       WHERE r.job_id = $1 AND r.conversation_id = c.id`,
      [jobId],
    ],
    [
      `UPDATE conversations SET topic_p = (SELECT coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
         FROM jsonb_each(topic_p) WHERE key = ANY($1::text[]))
       WHERE topic_p IS NOT NULL`,
      [keep],
    ],
    [`UPDATE conversations SET ${RECOMPUTE}`, []],
  ];
}

/** A label set that changes meaning: priced, and stored as a draft until someone confirms it. Only the new and the
 *  redefined topics are asked again (relabelPlan), so only they are priced; a draft that only removes topics is free. */
export async function propose(input: { key?: string; name: string; description: string }[]) {
  const labels = normalizeLabels(input);
  if (labels.length < 3) throw new Error("There need to be at least two topics besides Other.");
  if (labels.some((l) => l.key !== "other" && !l.description)) throw new Error("Every topic needs a description: it is what the sorting reads.");
  const cur = await active();
  const plan = relabelPlan(cur.labels, labels);
  if (!plan.run.length && !plan.removed.length) throw new Error("These are the topics in use already: nothing to change.");
  const [s] = await query<{ n: number; avg: number }>(
    `SELECT count(*)::int AS n, coalesce(avg(least(length(transcript), $1) + 40), 0)::float AS avg FROM conversations`,
    [STATE_CHARS],
  );
  const est = estimate(s.n, s.avg, labels, plan.run);
  const b = await budget();
  const id = randomUUID();
  await query(
    `INSERT INTO relabel_jobs (id, base, labels, status, total, estimate_usd, run_keys) VALUES ($1, $2, $3, 'draft', $4, $5, $6)`,
    [id, cur.version, JSON.stringify(labels), plan.run.length ? s.n : 0, est.usd, plan.run],
  );
  // Named for the reader, never by key: which topics are asked again, and which go (free).
  const nameOf = (key: string) => labels.find((l) => l.key === key)?.name ?? cur.labels.find((l) => l.key === key)?.name ?? key;
  return {
    draftId: id,
    labels,
    estimate: est,
    affordable: b.spentUsd + est.usd <= b.capUsd,
    budget: b,
    asks: plan.run.map(nameOf),
    removes: plan.removed.map(nameOf),
  };
}

export async function start(draftId: string): Promise<Job> {
  await refuseWhileRunning();
  const [j] = await query<JobRow>(`SELECT * FROM relabel_jobs WHERE id = $1`, [draftId]);
  if (!j || j.status !== "draft") throw new Error("That draft does not exist or has already run.");
  const b = await budget();
  if (b.spentUsd + j.estimate_usd > b.capUsd)
    throw new Error(`Not enough budget: $${b.spentUsd.toFixed(2)} of $${b.capUsd.toFixed(2)} spent, sorting again needs about $${j.estimate_usd.toFixed(2)}.`);
  const [r] = await query<JobRow>(`UPDATE relabel_jobs SET status = 'running', updated_at = now() WHERE id = $1 RETURNING *`, [draftId]);
  // Nothing to ask (the draft only removes topics): applied now, free, with no batch to drive.
  if (!(r.run_keys ?? []).length) {
    await finish(r.id, r.labels);
    const [done] = await query<JobRow>(`SELECT * FROM relabel_jobs WHERE id = $1`, [r.id]);
    return jobOf(done);
  }
  return jobOf(r);
}

/** A relabel stopped by an outage or the budget picks up where it stopped: its finished batches are kept. */
export async function resume(jobId: string): Promise<Job> {
  await refuseWhileRunning();
  const [j] = await query<JobRow>(`SELECT * FROM relabel_jobs WHERE id = $1`, [jobId]);
  if (!j || j.status !== "failed") throw new Error("Only a sort that stopped can be resumed.");
  const b = await budget();
  const left = (j.estimate_usd * (j.total - j.done)) / Math.max(j.total, 1);
  if (b.spentUsd + left > b.capUsd) throw new Error(`Not enough budget left to finish: about $${left.toFixed(2)} more is needed.`);
  const [r] = await query<JobRow>(
    `UPDATE relabel_jobs SET status = 'running', error = NULL, lease = NULL, updated_at = now() WHERE id = $1 RETURNING *`,
    [jobId],
  );
  return jobOf(r);
}

export async function cancel(jobId: string): Promise<Job> {
  const [r] = await query<JobRow>(
    `UPDATE relabel_jobs SET status = 'cancelled', updated_at = now() WHERE id = $1 AND status IN ('draft', 'running') RETURNING *`,
    [jobId],
  );
  await query(`DELETE FROM relabel_results WHERE job_id = $1`, [jobId]);
  await query(`DELETE FROM relabel_failures WHERE job_id = $1`, [jobId]);
  if (!r) throw new Error("Nothing to cancel.");
  return jobOf(r);
}

/**
 * One batch of a running relabel. The client calls it in a loop; a lease makes sure two callers (two tabs) never
 * label the same batch. Only the job's run_keys are asked. When the last conversation is labelled, the results are
 * merged into topic_p and the draft becomes the active label set - all in one transaction.
 */
export async function step(jobId: string): Promise<Job> {
  const [j] = await query<JobRow>(
    `UPDATE relabel_jobs SET lease = now() + make_interval(secs => $2) WHERE id = $1 AND status = 'running'
       AND (lease IS NULL OR lease < now()) RETURNING *`,
    [jobId, LEASE_S],
  );
  if (!j) {
    const [cur] = await query<JobRow>(`SELECT * FROM relabel_jobs WHERE id = $1`, [jobId]);
    if (!cur) throw new Error("No such sort.");
    return jobOf(cur); // finished, cancelled, or another caller holds the lease: report where it stands
  }
  try {
    const labels = j.labels;
    const asked = labels.filter((l) => (j.run_keys ?? []).includes(l.key));
    // Conversations that have failed MAX_TRIES times get probability 0 for the asked topics and leave the queue.
    await query(
      `WITH gave_up AS (
         INSERT INTO relabel_results (job_id, conversation_id, topic_p)
         SELECT job_id, conversation_id, (SELECT coalesce(jsonb_object_agg(k, 0), '{}'::jsonb) FROM unnest($3::text[]) AS k)
         FROM relabel_failures WHERE job_id = $1 AND n >= $2
         ON CONFLICT DO NOTHING RETURNING 1)
       UPDATE relabel_jobs SET skipped = skipped + (SELECT count(*) FROM gave_up) WHERE id = $1`,
      [jobId, MAX_TRIES, asked.map((l) => l.key)],
    );
    const batch = asked.length
      ? await query<{ id: string; transcript: string }>(
          `SELECT c.id, c.transcript FROM conversations c
           WHERE NOT EXISTS (SELECT 1 FROM relabel_results r WHERE r.job_id = $1 AND r.conversation_id = c.id)
           ORDER BY c.id LIMIT $2`,
          [jobId, BATCH],
        )
      : [];
    if (batch.length) {
      const b = await budget();
      const batchEst = estimate(batch.length, STATE_CHARS, labels, j.run_keys).usd;
      if (b.spentUsd + batchEst > b.capUsd) throw new Error(`Stopped at the budget cap ($${b.capUsd.toFixed(2)}).`);
      const who = await community();
      // Every asked topic in ONE request per conversation: the state (the costly part) is paid once, not per topic.
      const questions = topicQuestions(asked);
      let tokens = 0;
      const failed: { id: string; error: string }[] = [];
      const rows = (
        await mapPool(batch, CONCURRENCY, async (c) => {
          try {
            const state = labelState(c, who);
            const res = await decide({ state, questions });
            tokens += res.usage.inputTokens || estimateTokens(JSON.stringify(state));
            const p = Object.fromEntries(Object.entries(res.answers).map(([name, a]) => [topicOf(asked, name), a.noul]));
            return { id: c.id, p };
          } catch (e) {
            failed.push({ id: c.id, error: String((e as Error).message ?? e).slice(0, 300) });
            return null;
          }
        })
      ).filter((r): r is { id: string; p: Record<string, number> } => r !== null);
      if (batchVerdict(batch.length, rows.length) === "outage")
        throw new Error(`Jev did not answer for a whole batch (${failed[0]?.error ?? "no error text"}). Resume when it is back.`);
      const usd = (tokens * JEV_USD_PER_MTOK) / 1e6;
      await transaction([
        [
          `INSERT INTO relabel_results (job_id, conversation_id, topic_p)
           SELECT $1, r.id, r.p FROM jsonb_to_recordset($2::jsonb) AS r(id text, p jsonb) ON CONFLICT DO NOTHING`,
          [jobId, JSON.stringify(rows)],
        ],
        [
          `INSERT INTO relabel_failures (job_id, conversation_id, error) SELECT $1, * FROM unnest($2::text[], $3::text[])
           ON CONFLICT (job_id, conversation_id) DO UPDATE SET n = relabel_failures.n + 1, error = excluded.error`,
          [jobId, failed.map((f) => f.id), failed.map((f) => f.error)],
        ],
        [`INSERT INTO spend (kind, tokens, usd, note) VALUES ('jev-relabel', $1, $2, $3)`, [tokens, usd, jobId]],
        [
          `UPDATE relabel_jobs SET done = (SELECT count(*) FROM relabel_results WHERE job_id = $1), tokens = tokens + $2,
             cost_usd = cost_usd + $3, lease = NULL, updated_at = now() WHERE id = $1`,
          [jobId, tokens, usd],
        ],
      ]);
    }
    const [{ left }] = await query<{ left: number }>(
      `SELECT count(*)::int AS left FROM conversations c
       WHERE NOT EXISTS (SELECT 1 FROM relabel_results r WHERE r.job_id = $1 AND r.conversation_id = c.id)`,
      [jobId],
    );
    if (left === 0 || !asked.length) await finish(jobId, labels);
    else await query(`UPDATE relabel_jobs SET lease = NULL WHERE id = $1`, [jobId]);
  } catch (e) {
    await query(`UPDATE relabel_jobs SET status = 'failed', error = $2, lease = NULL, updated_at = now() WHERE id = $1`, [jobId, String((e as Error).message ?? e).slice(0, 500)]);
  }
  const [r] = await query<JobRow>(`SELECT * FROM relabel_jobs WHERE id = $1`, [jobId]);
  return jobOf(r);
}

async function finish(jobId: string, labels: Label[]) {
  await transaction([
    ...finishStatements(jobId, labels.map((l) => l.key)),
    [`UPDATE taxonomies SET active = false WHERE active`],
    [`INSERT INTO taxonomies (source, note, labels, active) VALUES ('relabelled', $1, $2, true)`, [`relabel ${jobId}`, JSON.stringify(labels)]],
    [`UPDATE relabel_jobs SET status = 'done', lease = NULL, updated_at = now() WHERE id = $1`, [jobId]],
    [`DELETE FROM relabel_results WHERE job_id = $1`, [jobId]],
    [`DELETE FROM relabel_failures WHERE job_id = $1`, [jobId]],
  ]);
}

async function refuseWhileRunning() {
  const [r] = await query<{ id: string }>(`SELECT id FROM relabel_jobs WHERE status = 'running' LIMIT 1`);
  if (r) throw new Error("The conversations are being sorted. Wait for it to finish, or cancel it.");
}

type JobRow = {
  id: string;
  status: Job["status"];
  done: number;
  total: number;
  cost_usd: number;
  estimate_usd: number;
  error: string | null;
  skipped: number;
  labels: Label[];
  run_keys: string[];
};
const jobOf = (j: JobRow): Job => ({
  id: j.id,
  status: j.status,
  done: j.done,
  total: j.total,
  costUsd: +j.cost_usd.toFixed(4),
  estimateUsd: j.estimate_usd,
  error: j.error,
  skipped: j.skipped ?? 0,
  draft: { labels: j.labels },
  runKeys: j.run_keys ?? [],
});
