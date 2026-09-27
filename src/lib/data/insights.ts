import "server-only";
import { revalidateTag, unstable_cache } from "next/cache";
import { query } from "./db";
import { toVoice, voicesOver, type Voice } from "./voices";
import {
  EMPTY_AGG,
  buildPeriods,
  isCatchAll,
  periodEnd,
  type Agg,
  type GridCell,
  type GridData,
  type Resolution,
} from "./insights-model";

// The Explore grid's reads. Both measures for every cell come back in ONE query per resolution, so the page switches
// between them without refetching; a selection's detail is a second query over exactly the cells chosen. The data is a build
// output (the loader rebuilds it), so both are cached under a key that includes the data version (dataVersion below):
// a label change writes a new taxonomy version, so no cached grid outlives the labels it was counted under.

export const INSIGHTS_TAG = "insights";

// Engagement = each conversation's engagement score (distinct authors + replies + reactions, ingest/group.py; D5), summed:
// reactions alone are too sparse on this server to rank anything. People = distinct authors, counted once per cell (the
// export has no bots or deleted accounts, so nobody is left out).
//
// Topics are multi-label (D46): a conversation touching two topics sits in both rows. So there are two row sets:
//   - `mem` has one row per (conversation, topic it touches): the cells and each topic's total count from it, so a cell
//     is "the conversations touching this topic in this period";
//   - `conv` has one row per conversation: each period's total and the grand total count from it, so they are the
//     DISTINCT conversations, never the sum of the rows above them (which counts a two-topic conversation twice).
// A conversation not labelled yet (no topics) is left out of both, as before.
const CONV = `
  SELECT c.id, c.topics,
         to_char(date_trunc($1, c.started_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS p,
         c.engagement AS eng, c.n_messages AS msgs, c.sentiment AS s
  FROM conversations c WHERE cardinality(c.topics) > 0`;
const MEM = `SELECT cv.*, t.topic FROM conv cv CROSS JOIN LATERAL unnest(cv.topics) AS t(topic)`;
const SUMS = `count(*)::int AS n, sum(eng)::int AS engagement, sum(msgs)::int AS messages, sum(s)::float AS mood_sum, count(s)::int AS mood_n`;

/** The grid in one query. `g` is what grouping(topic, p) would say over one table: 0 = a cell, 1 = a topic's total
 *  (both from `mem`, by membership), 2 = a period's total, 3 = everything (both from `conv`, distinct conversations).
 *  Exported so grid.test.ts pins which rows count by membership and which count distinct conversations. */
export const GRID_SQL = `WITH conv AS (${CONV}),
       mem AS (${MEM}),
       agg AS (
         SELECT topic, p, grouping(topic, p)::int AS g, ${SUMS}
         FROM mem GROUP BY GROUPING SETS ((topic, p), (topic))
         UNION ALL
         SELECT NULL::text, p, 2 + grouping(p)::int, ${SUMS}
         FROM conv GROUP BY GROUPING SETS ((p), ())),
       ppl AS (
         SELECT mm.topic, mm.p, grouping(mm.topic, mm.p)::int AS g, count(DISTINCT m.author)::int AS people
         FROM mem mm JOIN messages m ON m.conversation_id = mm.id
         GROUP BY GROUPING SETS ((mm.topic, mm.p), (mm.topic))
         UNION ALL
         SELECT NULL::text, cv.p, 2 + grouping(cv.p)::int, count(DISTINCT m.author)::int
         FROM conv cv JOIN messages m ON m.conversation_id = cv.id
         GROUP BY GROUPING SETS ((cv.p), ()))
       SELECT a.*, coalesce(pp.people, 0)::int AS people
       FROM agg a LEFT JOIN ppl pp
         ON pp.g = a.g AND pp.topic IS NOT DISTINCT FROM a.topic AND pp.p IS NOT DISTINCT FROM a.p`;

type Row = {
  topic: string | null;
  p: string | null;
  g: number;
  n: number;
  engagement: number;
  messages: number;
  mood_sum: number;
  mood_n: number;
  people: number;
};

const toAgg = (r: Row): Agg => ({
  n: r.n,
  engagement: r.engagement ?? 0,
  messages: r.messages ?? 0,
  moodSum: r.mood_sum ?? 0,
  moodN: r.mood_n,
  people: r.people,
});

async function loadGrid(res: Resolution): Promise<GridData> {
  const [rows, bounds] = await Promise.all([
    query<Row>(GRID_SQL, [res]),
    query<{ lo: string; hi: string }>(
      `SELECT to_char(min(started_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS lo,
              to_char(max(started_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS hi
       FROM conversations WHERE cardinality(topics) > 0`,
    ),
  ]);

  const window = { from: bounds[0]?.lo ?? "", to: bounds[0]?.hi ?? "" };
  const periods = window.from ? buildPeriods(res, window.from, window.to) : [];
  // g: 0 = a cell, 1 = a topic's total (both by membership), 2 = a period's total, 3 = everything (both distinct).
  const cells: GridCell[] = rows.filter((r) => r.g === 0).map((r) => ({ ...toAgg(r), topic: r.topic!, p: r.p! }));
  const topics = rows
    .filter((r) => r.g === 1)
    .map((r) => ({ key: r.topic!, total: toAgg(r) }))
    .sort((a, b) => Number(isCatchAll(a.key)) - Number(isCatchAll(b.key)) || b.total.n - a.total.n);
  const periodTotals = Object.fromEntries(rows.filter((r) => r.g === 2).map((r) => [r.p!, toAgg(r)]));
  const all = rows.find((r) => r.g === 3);
  return {
    resolution: res,
    window,
    periods,
    topics,
    cells,
    periodTotals,
    norm: all ? toAgg(all) : EMPTY_AGG,
  };
}

/**
 * What the cached numbers depend on: the active label set, the last relabel step and the number of conversations. A
 * relabel or a data load from anywhere (the backfill, a script, the loader) changes it, so a cached grid can never
 * outlive the labels it was counted under. Without it the day view kept last week's topics for an hour after a relabel
 * that ran outside this page. Read through cachedVersion below, not on every request.
 */
async function dataVersion(): Promise<string> {
  try {
    const [r] = await query<{ v: string }>(
      `SELECT concat_ws('/',
         (SELECT version FROM taxonomies WHERE active),
         (SELECT extract(epoch FROM max(updated_at))::bigint FROM relabel_jobs),
         (SELECT count(*) FROM conversations)) AS v`,
    );
    return r?.v ?? "";
  } catch {
    try {
      const [r] = await query<{ v: string }>(`SELECT count(*)::text AS v FROM conversations`);
      return r?.v ?? "";
    } catch {
      return "";
    }
  }
}

// The version itself is cached too (open item 2026-09-26: it was one query on every grid load, the one query a warm
// Explore still made). The numbers change only when the topics are edited or a relabel finishes, and both routes call
// topicsChanged() below, so the next load reads the version afresh. A writer outside the app (scripts/labels.ts, the
// loader) cannot reach Next's cache; for those the version is read again at most VERSION_TTL_S after it was cached.
export const INSIGHTS_VERSION_TAG = "insights-version";
const VERSION_TTL_S = 300;
// A version that could not be read ("") is not kept: it throws out of the cached function, so the next load tries again.
const versionOrThrow = async () => {
  const v = await dataVersion();
  if (!v) throw new Error("the data version could not be read");
  return v;
};
const storedVersion = unstable_cache(versionOrThrow, ["insights-version-1"], { tags: [INSIGHTS_VERSION_TAG], revalidate: VERSION_TTL_S });
const cachedVersion = () => storedVersion().catch(() => "");

/** Call after anything that changes which topic a conversation carries, or what the topics are called: the next grid,
 *  selection or topic-name read goes to the database. `expire: 0`: the reader who just made the edit is never served
 *  the grid from before it. */
export function topicsChanged(): void {
  revalidateTag(INSIGHTS_VERSION_TAG, { expire: 0 });
}

export async function getGrid(res: Resolution): Promise<GridData> {
  const v = await cachedVersion();
  // "-4": topics are multi-label since D46 (cells by membership, totals distinct), so a grid counted the old way is not
  // served again.
  return unstable_cache(loadGrid, ["insights-grid-4", res, v], { tags: [INSIGHTS_TAG], revalidate: 3600 })(res);
}

// ---------- a selection ----------

/** One topic over one run of periods: the unit a selection is sent as (consecutive cells already merged). */
export type SelectionRange = { topic: string; from: string; to: string }; // [from, to), YYYY-MM-DD

/** A Discord session (the pieces of one 15-minute-gap session share it, D3) as the selection lists it: the export has
 *  no threads or titles, so a session is named by its channel and its first message. `ref` is its first piece inside
 *  the selection, the convN handle the chat's read_conversation tool takes. */
export type Session = {
  sessionId: string;
  ref: number;
  channel: string;
  opening: string; // the session's first message
  started: string; // first conversation of the session inside the selection
  engagement: number;
  conversations: number;
  messages: number;
  moodAvg: number | null;
};

/** The five most active people in the selected cells (voices.ts counts them the same way topVoices does); `totals.people`
 * is the denominator. `totals` counts distinct conversations: one touching two selected topics counts once. */
export type SelectionDetail = { totals: Agg; sessions: Session[]; voices: Voice[] };


/** Ranges from a resolution and period keys, for callers that send cells. */
export const rangeOf = (topic: string, start: string, res: Resolution): SelectionRange => ({
  topic,
  from: start,
  to: periodEnd(start, res),
});

/**
 * A selection's detail in one query. A conversation is in the selection when it touches one of the selected topics
 * inside that topic's dates (membership, D46), and `conv` takes it ONCE (DISTINCT) however many selected cells it
 * touches: the totals, sessions and people of a selection across two topics never count a two-topic conversation twice.
 * Exported so the rule is pinned without a database (insights.test.ts).
 */
export const SELECTION_SQL = `WITH sel AS (SELECT * FROM unnest($1::text[], $2::date[], $3::date[]) AS s(topic, lo, hi)),
     conv AS (
       SELECT DISTINCT c.id, c.ref, c.session_id, c.channel, c.started_at, c.engagement AS eng, c.n_messages,
              c.sentiment AS s
       FROM conversations c JOIN sel ON sel.topic = ANY(c.topics)
        AND c.started_at >= sel.lo::timestamp AT TIME ZONE 'UTC' AND c.started_at < sel.hi::timestamp AT TIME ZONE 'UTC')
     SELECT
       (SELECT json_build_object(
          'n', count(*), 'engagement', coalesce(sum(eng), 0), 'messages', coalesce(sum(n_messages), 0),
          'mood_sum', coalesce(sum(s), 0), 'mood_n', count(s),
          'people', (SELECT count(DISTINCT m.author) FROM messages m JOIN conv ON m.conversation_id = conv.id))
        FROM conv) AS totals,
       (SELECT json_agg(t) FROM (
          SELECT session_id AS "sessionId", min(ref)::int AS ref, min(channel) AS channel,
                 (SELECT left(m.text, 200) FROM messages m WHERE m.id = conv.session_id) AS opening,
                 to_char(min(started_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS started,
                 sum(eng)::int AS engagement, count(*)::int AS conversations, sum(n_messages)::int AS messages,
                 round(avg(s)::numeric, 3)::float AS "moodAvg"
          FROM conv GROUP BY session_id ORDER BY sum(eng) DESC, sum(n_messages) DESC LIMIT 5) t) AS sessions,
       (SELECT json_agg(v) FROM (${voicesOver("SELECT id FROM conv", "5")}) v) AS voices`;

async function loadSelection(ranges: SelectionRange[]): Promise<SelectionDetail> {
  const [row] = await query<{ totals: Row; sessions: Session[] | null; voices: (Voice & { total_authors?: number })[] | null }>(
    SELECTION_SQL,
    [ranges.map((r) => r.topic), ranges.map((r) => r.from), ranges.map((r) => r.to)],
  );
  return { totals: toAgg(row.totals), sessions: row.sessions ?? [], voices: (row.voices ?? []).map(toVoice) };
}

export async function getSelection(ranges: SelectionRange[]): Promise<SelectionDetail> {
  const v = await cachedVersion();
  const key = JSON.stringify([...ranges].sort((a, b) => a.topic.localeCompare(b.topic) || a.from.localeCompare(b.from)));
  return unstable_cache(() => loadSelection(ranges), ["insights-selection-3", v, key], { tags: [INSIGHTS_TAG], revalidate: 3600 })();
}
