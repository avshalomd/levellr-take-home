// End to end: the production agent answers every question in eval/questions.jsonl, in process, through the same
// post-steps the chat route runs (lib/agent/finish.ts: off-topic reply, cite pass, claim check). Each answer is scored:
//   correct     - an independent judge (Gemini Flash-Lite) against the question's rubric and, for counts, the true
//                 number computed by SQL at run time (so the gold can never drift from the data)
//   citations   - the claim check the app runs: ids that exist, ids the agent actually read this turn, and Jev's
//                 support probability per cited claim
//   abstention  - false-premise and out-of-scope questions must be declined or corrected, not answered
// plus latency and which tools were used. Paraphrase pairs (questions sharing `pair`) are reported as agreeing or not. Results -> eval/results/agent.json.
//
// It spends the agent model's quota (one question = up to 8 agent steps), so run it on purpose:
// A question with `before` is a follow-up: its earlier questions are asked first in the same chat, ungraded.
// usage: npm run eval:agent [-- --only L01,A02] [-- --concurrency 2] [-- --note "why this run"] [-- --out path] [-- --dump dir]
import { writeFileSync } from "node:fs";
import type { ModelMessage } from "ai";
import { z } from "zod";
import { makeAgent } from "@/lib/agent/agent";
import { afterAgent } from "@/lib/agent/finish";
import { profile } from "@/lib/data/profile";
import { citedTags, refOfTag } from "@/lib/refs";
import { getMessagesByRef } from "@/lib/data/read";
import { query } from "@/lib/data/db";
import { modelIdOf } from "@/lib/llm/errors";
import { extract } from "@/lib/llm/extract";
import { judgeModel, JUDGE_MODEL, pool, questions, toolOutputsForJudge, type Q } from "./lib";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

const Verdict = z.object({
  verdict: z.enum(["correct", "partial", "wrong"]),
  abstained: z.boolean().describe("the answer declines, or says the data does not show / cover it"),
  invented: z
    .boolean()
    .describe(
      "the answer states something as fact about the community that nothing in the rubric, the truth, the tool outputs or the cited messages supports",
    ),
  reason: z.string().describe("one or two sentences"),
});

// The messages the answer cites, in full: a tool output that runs past the judge's budget keeps only its figures,
// so a quote from a late hit would otherwise look invented.
async function citedMessages(answer: string): Promise<string> {
  const refs = citedTags(answer)
    .map(refOfTag)
    .filter((r): r is number => r !== null)
    .slice(0, 40);
  const rows = await getMessagesByRef(refs);
  return rows
    .sort((a, b) => a.ref - b.ref)
    // Whole messages: cut at 500 characters, a long news post (a 1,900-character list of Tides Remastered features)
    // lost the very details the answer quoted from it, and the judge marked them invented.
    .map((m) => `[msg${m.ref}] ${m.author}, #${m.channel}, ${m.ts.slice(0, 16)}Z: ${m.text.replace(/\s+/g, " ").slice(0, 4000)}`)
    .join("\n");
}

async function judge(q: Q, answer: string, truth: unknown, tools: string, earlier: string[] = []) {
  const cited = await citedMessages(answer);
  const who = await profile();
  const chat = earlier.length ? `EARLIER IN THE CHAT (not graded):\n${earlier.join("\n\n")}\n\n` : "";
  const input =
    `${chat}QUESTION: ${q.question}\n\nRUBRIC: ${q.expect}\n\nTRUTH: ${truth === undefined ? "(none)" : JSON.stringify(truth)}` +
    `\n\nTOOL OUTPUTS:\n${tools || "(none)"}\n\nCITED MESSAGES:\n${cited || "(none)"}\n\nANSWER:\n${answer}`;
  // --dump <dir>: what the judge read, one file per question, to check a verdict of "invented" by hand.
  if (arg("dump")) writeFileSync(`${arg("dump")}/${q.id}.judge.txt`, input);
  const { data } = await extract({
    schema: Verdict,
    model: judgeModel,
    fallback: () => null,
    timeoutMs: 60_000,
    instructions:
      `You grade answers from a chatbot for a game studio's community team. It answers questions about one Discord ` +
      `community (${who.community}, ${who.from} to ${who.to}; "now" is the last message, 2026-09-27 19:30 UTC) using ` +
      "only that data. Grade the ANSWER against the RUBRIC. If TRUTH is given, it is the exact result of a database " +
      "query: numbers in the answer must match it within the tolerance the rubric states (the answer may round). " +
      "'correct' = meets the rubric; 'partial' = right direction but misses a required point or a number is off; " +
      "'wrong' = misses the point, contradicts the rubric or truth, or answers a false premise as if it were true. " +
      "The rubric's examples are examples: other themes are fine when the tool outputs or cited messages support " +
      "them. Citation markers like [msg1234] are expected; ignore them. TOOL OUTPUTS are what the chatbot's own tools " +
      "told it, in full, and CITED MESSAGES are the full text of every message the answer cites: a number or fact found " +
      "in either is not invented. Figures the tools computed (counts, shares, engagement scores, mood or sentiment " +
      "values, dates, author activity) are the app's own measurements: when such a number appears in TOOL OUTPUTS, or " +
      "follows from them by rounding, summing or taking a share, it is not invented, even if no cited message states " +
      "it. 'invented' is for statements nothing here supports.",
    input,
  });
  return data;
}

async function main() {
  const only = arg("only")?.split(",");
  const qs = questions().filter((q) => !only || only.includes(q.id));
  const runs = await pool(qs, Number(arg("concurrency") ?? 2), async (q) => {
    const t0 = Date.now();
    const truth = q.numeric_sql ? await query(q.numeric_sql) : undefined;
    for (let attempt = 1; ; attempt++) {
      try {
        const { agent, model } = await makeAgent();
        // A follow-up (q.before): the earlier questions are asked first in the same chat, each answer carried in the
        // messages the model is sent, as the chat route sends them, and their tool results passed as the chat's earlier
        // results (finish.ts `earlier`). Only the last question is timed and graded.
        const chat: ModelMessage[] = [];
        const earlier: { content: ReadonlyArray<unknown> }[] = [];
        const said: string[] = [];
        for (const b of q.before ?? []) {
          const prior = await agent.generate({
            messages: [...chat, { role: "user", content: b }],
            abortSignal: AbortSignal.timeout(240_000),
          });
          chat.push({ role: "user", content: b }, ...prior.responseMessages);
          earlier.push(...prior.steps);
          said.push(`Q: ${b}\nA: ${prior.text}`);
        }
        const t1 = Date.now();
        const input: ModelMessage[] = [...chat, { role: "user", content: q.question }];
        const r = await agent.generate({ messages: input, abortSignal: AbortSignal.timeout(240_000) });
        const ms = Date.now() - (q.before?.length ? t1 : t0);
        const tools = r.steps.flatMap((s) => s.toolCalls.map((c) => ({ tool: c.toolName, input: c.input })));
        // What the reader sees: the chat route's own post-steps, not a copy of them.
        // Every step's messages, as the chat route passes them: in AI SDK 7 `r.response.messages` is the last step's
        // only, so the eval's cite pass and count checks ran without this turn's tool results, unlike production.
        const turn = r.responseMessages;
        const after = await afterAgent({
          steps: r.steps,
          history: [...input, ...turn],
          ...(earlier.length ? { earlier } : {}),
        });
        const v = after.checked ?? null;
        // The same messages for the judge: given the last step's only, it read "(none)" for tool outputs and marked
        // tool-computed figures invented.
        const j = await judge(q, after.text, truth, toolOutputsForJudge([...chat, ...turn]), said);
        const citations = v?.claims.flatMap((c) => c.citations) ?? [];
        console.log(
          `${q.id.padEnd(4)} ${j.verdict.padEnd(8)} ${String(Math.round(ms / 1000)).padStart(3)}s ${tools.map((t) => t.tool).join(",")}  ${j.reason.slice(0, 110)}`,
        );
        return {
          id: q.id,
          type: q.type,
          pair: q.pair,
          question: q.question,
          answer: after.text,
          grounding: after.grounding.kind,
          revision: after.revision ? { status: after.revision.status, kept: "kept" in after.revision ? after.revision.kept : undefined } : undefined,
          model: modelIdOf(model),
          ms,
          tools,
          truth,
          judge: j,
          citations: {
            total: citations.length,
            invalid: citations.filter((c) => c.status === "unknown-id").length,
            not_retrieved: citations.filter((c) => c.status === "not-retrieved").length,
            claims_cited: v?.cited ?? 0,
            claims_supported: v?.supported ?? 0,
            claims_unchecked: v?.unchecked ?? 0, // the check never reached them (Jev busy): not scored as unsupported
            uncited_sentences: v?.uncitedSentences ?? 0,
          },
        };
      } catch (e) {
        if (attempt >= 3) {
          console.log(`${q.id.padEnd(4)} ERROR ${String(e).slice(0, 160)}`);
          return { id: q.id, type: q.type, question: q.question, error: String(e).slice(0, 500), ms: Date.now() - t0 };
        }
        await new Promise((res) => setTimeout(res, 20_000)); // a rate limit on the capped key clears in seconds
      }
    }
  });

  const ok = runs.filter((r): r is Extract<(typeof runs)[number], { judge: unknown }> => "judge" in r);
  const score = (v: string) => (v === "correct" ? 1 : v === "partial" ? 0.5 : 0);
  const byType = Object.fromEntries(
    [...new Set(qs.map((q) => q.type))].map((t) => {
      const rs = ok.filter((r) => r.type === t);
      return [t, { n: rs.length, score: rs.length ? rs.reduce((s, r) => s + score(r.judge.verdict), 0) / rs.length : null }];
    }),
  );
  const cites = ok.reduce(
    (s, r) => ({
      total: s.total + r.citations.total,
      invalid: s.invalid + r.citations.invalid,
      not_retrieved: s.not_retrieved + r.citations.not_retrieved,
      cited: s.cited + r.citations.claims_cited,
      supported: s.supported + r.citations.claims_supported,
      unchecked: s.unchecked + r.citations.claims_unchecked,
    }),
    { total: 0, invalid: 0, not_retrieved: 0, cited: 0, supported: 0, unchecked: 0 },
  );
  const declineQs = ok.filter((r) => r.type === "false-premise" || r.type === "out-of-scope");
  const answerQs = ok.filter((r) => r.type !== "false-premise" && r.type !== "out-of-scope");
  const lat = ok.map((r) => r.ms).sort((a, b) => a - b);
  const summary = {
    questions: qs.length,
    errors: runs.length - ok.length,
    score: ok.length ? ok.reduce((s, r) => s + score(r.judge.verdict), 0) / ok.length : null,
    correct: ok.filter((r) => r.judge.verdict === "correct").length,
    partial: ok.filter((r) => r.judge.verdict === "partial").length,
    wrong: ok.filter((r) => r.judge.verdict === "wrong").length,
    by_type: byType,
    abstained_when_it_should: `${declineQs.filter((r) => r.judge.abstained || r.judge.verdict === "correct").length}/${declineQs.length}`,
    abstained_when_it_should_not: `${answerQs.filter((r) => r.judge.abstained).length}/${answerQs.length}`,
    invented: ok.filter((r) => r.judge.invented).length,
    citations: {
      ...cites,
      supported_share: cites.cited - cites.unchecked ? cites.supported / (cites.cited - cites.unchecked) : null,
    },
    latency_ms: { p50: lat[Math.floor(lat.length / 2)], p90: lat[Math.floor(lat.length * 0.9)] },
    // Paraphrase pairs: the same question in other words should get the same verdict (and, for counts, the same number).
    pairs: Object.fromEntries(
      [...new Set(ok.map((r) => r.pair).filter((p): p is string => !!p))].map((p) => {
        const rs = ok.filter((r) => r.pair === p);
        return [p, { verdicts: Object.fromEntries(rs.map((r) => [r.id, r.judge.verdict])), agree: new Set(rs.map((r) => r.judge.verdict)).size === 1 }];
      }),
    ),
    tool_use: Object.fromEntries(
      [...new Set(ok.flatMap((r) => r.tools.map((t) => t.tool)))].map((t) => [t, ok.filter((r) => r.tools.some((x) => x.tool === t)).length]),
    ),
  };
  const out = {
    run_at: new Date().toISOString(),
    agent_model: ok[0]?.model,
    judge: JUDGE_MODEL,
    note: arg("note"),
    summary,
    runs,
  };
  writeFileSync(arg("out") ?? "eval/results/agent.json", JSON.stringify(out, null, 1));
  console.log(JSON.stringify(summary, null, 1));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
