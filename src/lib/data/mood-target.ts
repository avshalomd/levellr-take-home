// What the community's mood is about. Sentiment is asked "towards" something (ingest/enrich.py), and that something is
// found at onboarding: a language model reads a sample and names it, e.g. "the game PUBG: Battlegrounds and Krafton,
// its developer", with why and what else it could have been (docs/DECISIONS.md D46). It is stored in
// dataset_meta.mood_target. Data loaded before it was recorded has none, so every reader takes null and keeps its
// older wording. Pure and free of server imports: the topics editor shows it too.

export type MoodTarget = { target: string; why: string; alternatives: string[] };

/** A stored mood target, or null when it is missing or not the shape the loader writes. */
export function moodTargetOf(value: unknown): MoodTarget | null {
  if (!value || typeof value !== "object") return null;
  const v = value as { target?: unknown; why?: unknown; alternatives?: unknown };
  if (typeof v.target !== "string" || !v.target.trim()) return null;
  return {
    target: v.target.trim(),
    why: typeof v.why === "string" ? v.why.trim() : "",
    alternatives: Array.isArray(v.alternatives) ? v.alternatives.filter((a): a is string => typeof a === "string" && a.trim() !== "") : [],
  };
}
