import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { google } from "@ai-sdk/google";
import { z } from "zod";
import { extract } from "@/lib/llm/extract";

// Shared by both eval runners: the question file, a JSON cache on
// disk (every judgment is paid for once and a re-run is reproducible), and the judge. The judge is Gemini Flash-Lite
// on the brief's key: a different model from the agent (Gemini Flash) and from Jev (rerank, claim support), so no
// component grades its own work.

export type QType =
  | "lookup"
  | "temporal"
  | "excited"
  | "frustrated"
  | "what-to-post"
  | "aggregate"
  | "voices"
  | "false-premise"
  | "out-of-scope";

export type Q = {
  id: string;
  type: QType;
  question: string;
  expect: string; // the rubric the judge grades against
  gold_messages?: string[]; // message ids read by hand in data/messages.json; retrieval maps them to conversations
  numeric_sql?: string; // the true answer, computed at run time so the gold cannot drift from the data
  pair?: string; // questions sharing a pair ask the same thing in other words: their answers should agree
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

/** What the agent's tools returned this turn, in full, for the judge: a figure the tools computed (a count, a share,
 *  an engagement score, a mood) is then not marked invented. An earlier version cut each output to 2,500 characters,
 *  and the judge marked tool-computed figures from the cut-off tail as invented. Outputs are pretty-printed so that,
 *  past the `total` budget (Flash-Lite reads far more than this), only the lines carrying a figure are kept. */
export function toolOutputsForJudge(messages: ReadonlyArray<unknown>, total = 200_000): string {
  const parts: string[] = [];
  let used = 0;
  for (const m of messages as { role?: string; content?: unknown }[]) {
    if (m.role !== "tool" || !Array.isArray(m.content)) continue;
    for (const p of m.content as { type?: string; toolName?: string; output?: unknown }[]) {
      if (p.type !== "tool-result") continue;
      // The model's own view of a result is text (toModelOutput): given as text, not a JSON-escaped string on one line.
      const o = p.output as { type?: string; value?: unknown } | undefined;
      const full = o?.type === "text" && typeof o.value === "string" ? o.value : (JSON.stringify(o?.type === "json" ? o.value : o, null, 1) ?? "");
      const body =
        used + full.length <= total
          ? full
          : `(long output: only the lines with a figure are kept)\n${full
              .split("\n")
              .filter((l) => /\d/.test(l))
              .join("\n")}`;
      used += body.length;
      parts.push(`## ${p.toolName}\n${body}`);
    }
  }
  return parts.join("\n\n");
}
