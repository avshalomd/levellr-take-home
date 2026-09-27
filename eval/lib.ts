import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { google } from "@ai-sdk/google";
import { z } from "zod";
import { extract } from "@/lib/llm/extract";

// Shared by both eval runners (ported from Community Pulse 90f193d, eval/lib.ts): the question file, a JSON cache on
// disk (every judgment is paid for once and a re-run is reproducible), and the judge. The judge is Gemini Flash-Lite
// on the brief's key: a different model from the agent (Gemini Flash) and from Jev (rerank, claim support), so no
// component grades its own work. The reference judged on OpenRouter; tonight the judge stays on the key we were given.

export type QType =
  | "lookup"
  | "temporal"
  | "excited"
  | "frustrated"
  | "what-to-post"
  | "aggregate"
  | "false-premise"
  | "out-of-scope";

export type Q = {
  id: string;
  type: QType;
  question: string;
  expect: string; // the rubric the judge grades against
  gold_messages?: string[]; // message ids read by hand in data/messages.json; retrieval maps them to conversations
  numeric_sql?: string; // the true answer, computed at run time so the gold cannot drift from the data
};

export const questions = (): Q[] =>
  readFileSync("eval/questions.jsonl", "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));

export const JUDGE_MODEL = process.env.EVAL_JUDGE_MODEL || "gemini-3.5-flash-lite";
export const judgeModel = () => google(JUDGE_MODEL);

export function cache<T>(path: string) {
  const data: Record<string, T> = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
  return {
    get: (k: string) => data[k],
    set: (k: string, v: T) => {
      data[k] = v;
    },
    save: () => writeFileSync(path, JSON.stringify(data, null, 1)),
  };
}

export async function pool<T, R>(items: T[], n: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

const Relevance = z.object({
  relevance: z.number().int().min(0).max(2).describe("0 = does not help, 1 = partly helps, 2 = directly answers"),
  reason: z.string().describe("one short sentence"),
});

export async function judgeRelevance(question: string, transcript: string): Promise<z.infer<typeof Relevance>> {
  const { data } = await extract({
    schema: Relevance,
    model: judgeModel,
    fallback: () => null,
    instructions:
      "You judge search results for a chatbot over a gaming community's Discord server. Given a user question and ONE " +
      "conversation from the server, rate how much the conversation helps answer the question: 2 = it directly answers " +
      "or is about exactly this, 1 = it bears on it (a relevant opinion, report or partial answer), 0 = it does not " +
      "help (only shares a word, or is about something else). Judge the content, not the wording.",
    input: `QUESTION: ${question}\n\nCONVERSATION:\n${transcript.slice(0, 6000)}`,
  });
  return data;
}

/** What the agent's tools returned this turn, as short text for the judge: a number the tools really produced is
 *  then not marked invented. Each output is cut, so the cited messages are passed to the judge separately. */
export function toolOutputsForJudge(messages: ReadonlyArray<unknown>, per = 2500, total = 16_000): string {
  const parts: string[] = [];
  for (const m of messages as { role?: string; content?: unknown }[]) {
    if (m.role !== "tool" || !Array.isArray(m.content)) continue;
    for (const p of m.content as { type?: string; toolName?: string; output?: unknown }[]) {
      if (p.type !== "tool-result") continue;
      parts.push(`## ${p.toolName}\n${JSON.stringify(p.output).slice(0, per)}`);
    }
  }
  return parts.join("\n\n").slice(0, total);
}
