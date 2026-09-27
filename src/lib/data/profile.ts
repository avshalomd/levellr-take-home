import "server-only";
import { communityInProse } from "@/lib/community";
import { query } from "./db";

// What the dataset is, in the words its manifest gave (datasets/levellr.json -> dataset_meta), and when "now" is.
// The agent's instructions and the scope check read it from here.
// `now` is the last message's time (docs/DESIGN.md decision 1): the export ends on 27 September 2026 at 19:30 UTC, and
// "the last 3 days" counts back from there, not from the server's clock.
export type Profile = {
  community: string;
  platform: string;
  about: string;
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
  now: string; // ISO timestamp, or "" when the loader recorded no window
  /** What mood is measured towards (dataset_meta.mood_target, D7): the community's own games and their developer.
   *  Excitement, frustration and post ideas are about this, not other games (D20). Absent when the loader stored none. */
  target?: string;
};

let cached: Promise<Profile> | null = null;

export function profile(): Promise<Profile> {
  cached ??= load().catch((e) => {
    cached = null; // a failed read is retried next time, never cached
    throw e;
  });
  return cached;
}

type Meta = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");

/** The profile from dataset_meta's rows. "now" may be stored on its own, inside the window, or not at all: then the
 *  window's end is now. */
export function profileOf(m: Meta): Profile {
  const source = (m.source ?? {}) as Meta;
  const window = (m.window ?? {}) as Meta;
  const nowRaw = m.now;
  const now = str(nowRaw) || str((nowRaw as Meta | undefined)?.ts) || str(window.now) || str(window.to);
  const nowDate = now ? new Date(now) : null;
  return {
    // As it reads in a sentence ("the Veil of Ages Discord"), not the export's label (QA Q7).
    community: communityInProse(str(source.community)),
    platform: str(source.platform).replace(/-json$/, "") || "discord",
    about: str(source.about),
    from: str(window.from).slice(0, 10),
    to: str(window.to).slice(0, 10) || now.slice(0, 10),
    now: nowDate && !Number.isNaN(nowDate.getTime()) ? nowDate.toISOString() : "",
    ...(str(m.mood_target) ? { target: str(m.mood_target) } : {}),
  };
}

async function load(): Promise<Profile> {
  const rows = await query<{ key: string; value: unknown }>(
    `SELECT key, value FROM dataset_meta WHERE key IN ('source', 'window', 'now', 'mood_target')`,
  );
  return profileOf(Object.fromEntries(rows.map((r) => [r.key, r.value])));
}
