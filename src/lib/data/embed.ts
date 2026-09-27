import "server-only";
import { embed } from "ai";
import { google } from "@ai-sdk/google";

// The query is embedded with the same model and dimensions as the conversations (ingest/embed.py), or the distances
// mean nothing: gemini-embedding-2 at 768 dimensions, on the brief's key. The ingest side embeds documents
// (RETRIEVAL_DOCUMENT); a question is embedded as RETRIEVAL_QUERY. 768 is below the model's native size, so the vector
// is L2-normalized here, as the stored ones are, for cosine distance to compare like with like.
export const EMBED_MODEL = process.env.EMBED_MODEL ?? "gemini-embedding-2";
export const EMBED_DIMS = 768;

export async function embedQuery(text: string): Promise<number[]> {
  const { embedding } = await embed({
    model: google.embeddingModel(EMBED_MODEL),
    value: text,
    providerOptions: { google: { outputDimensionality: EMBED_DIMS, taskType: "RETRIEVAL_QUERY" } },
    abortSignal: AbortSignal.timeout(15_000),
    maxRetries: 1,
  });
  if (embedding.length !== EMBED_DIMS)
    throw new Error(`embedding came back with ${embedding.length} dimensions`);
  return normalize(embedding);
}

export function normalize(v: number[]): number[] {
  const norm = Math.hypot(...v);
  return norm ? v.map((x) => x / norm) : v;
}

export const toVector = (v: number[]) => `[${v.join(",")}]`;
