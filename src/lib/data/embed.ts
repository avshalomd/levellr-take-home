import "server-only";

// The query is embedded with the same model and dimensions as the conversations (ingest/embed.py), or the
// distances mean nothing.
export const EMBED_MODEL = "google/gemini-embedding-2";
export const EMBED_DIMS = 768;

export async function embedQuery(text: string, fetchImpl: typeof fetch = fetch): Promise<number[]> {
  const res = await fetchImpl("https://openrouter.ai/api/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, input: [text], dimensions: EMBED_DIMS }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`embedding failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { data: { embedding: number[] }[] };
  const v = body.data?.[0]?.embedding;
  if (!v || v.length !== EMBED_DIMS) throw new Error("embedding came back malformed");
  return v;
}

export const toVector = (v: number[]) => `[${v.join(",")}]`;
