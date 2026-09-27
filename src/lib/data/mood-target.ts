// What the community's mood is about. Sentiment is asked "towards" something (ingest/enrich.py mood_target), and the
// loader stores that string in dataset_meta.mood_target. The reference stored an object ({target, why, alternatives});
// both shapes are read, so the topics editor can show it and a relabel can send it. Pure and free of server imports.

export type MoodTarget = { target: string; why: string; alternatives: string[] };

/** A stored mood target, or null when it is missing or not a shape the loader writes. */
export function moodTargetOf(value: unknown): MoodTarget | null {
  if (typeof value === "string") return value.trim() ? { target: value.trim(), why: "", alternatives: [] } : null;
  if (!value || typeof value !== "object") return null;
  const v = value as { target?: unknown; why?: unknown; alternatives?: unknown };
  if (typeof v.target !== "string" || !v.target.trim()) return null;
  return {
    target: v.target.trim(),
    why: typeof v.why === "string" ? v.why.trim() : "",
    alternatives: Array.isArray(v.alternatives) ? v.alternatives.filter((a): a is string => typeof a === "string" && a.trim() !== "") : [],
  };
}
