import "server-only";
import { query } from "./db";
import { moodTargetOf, type MoodTarget } from "./mood-target";

// What the dataset is, in the words its manifest gave (datasets/<name>.json -> dataset_meta.source). This is the only
// domain knowledge the app has: the agent's instructions, the page copy and the judge all read it from here, so the
// same build answers for a game subreddit, a product's Discord or anything shaped like them.
// `moodTarget`: what the mood is measured towards (./mood-target.ts); absent on data loaded before it was recorded.
export type Profile = {
  community: string;
  platform: string;
  about: string;
  from: string;
  to: string;
  moodTarget?: MoodTarget | null;
};

let cached: Promise<Profile> | null = null;

export function profile(): Promise<Profile> {
  cached ??= load().catch((e) => {
    cached = null; // a failed read is retried next time, never cached
    throw e;
  });
  return cached;
}

async function load(): Promise<Profile> {
  const rows = await query<{ key: string; value: Record<string, string> }>(
    `SELECT key, value FROM dataset_meta WHERE key IN ('source', 'window', 'mood_target')`,
  );
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    community: m.source?.community ?? "the community",
    platform: m.source?.platform ?? "",
    about: m.source?.about ?? "",
    from: (m.window?.from ?? "").slice(0, 10),
    to: (m.window?.to ?? "").slice(0, 10),
    moodTarget: moodTargetOf(m.mood_target),
  };
}
