// Ask the agent one question from the terminal, the same path the chat route runs (agent, then the claim check and the
// corroboration), and print the answer, the steps and the verification. For checking a build against the live data.
// usage: npx dotenv -e .env.local -- npx tsx --conditions react-server scripts/ask.ts "What are people most excited about right now?"
import { makeAgent } from "@/lib/agent/agent";
import { afterAgent } from "@/lib/agent/finish";
import { corroborate } from "@/lib/agent/corroborate";

const question =
  process.argv.slice(2).join(" ") || "What have players been frustrated about in the last few days?";

async function main() {
  const t0 = Date.now();
  const { agent } = await makeAgent();
  const input = [{ role: "user" as const, content: question }];
  const result = await agent.generate({ messages: input });
  console.log(`Q: ${question}\n`);
  for (const [i, s] of result.steps.entries())
    for (const part of s.content) {
      const p = part as { type: string; toolName?: string; input?: unknown; output?: unknown };
      if (p.type === "tool-call") console.log(`step ${i}: ${p.toolName} ${JSON.stringify(p.input)}`);
      if (p.type === "tool-result") {
        const o = p.output as Record<string, unknown> | null;
        const brief =
          o && typeof o === "object"
            ? {
                status: o.status,
                scanned: o.scanned,
                relevant: o.relevant,
                hits: Array.isArray(o.hits) ? o.hits.length : undefined,
                rows: Array.isArray(o.rows) ? o.rows.length : undefined,
              }
            : o;
        console.log(`   -> ${JSON.stringify(brief)}`);
      }
    }
  const history = [...input, ...result.response.messages];
  const after = await afterAgent({ steps: result.steps, history });
  console.log(`\nA:\n${after.text}\n`);
  console.log(`grounding: ${JSON.stringify(after.grounding)}`);
  const v = after.verification as
    | {
        status: string;
        claims?: { claim: string; citations: { status: string; support: number | null }[] }[];
      }
    | undefined;
  console.log(`verification: ${v?.status}`);
  for (const c of v?.claims ?? [])
    console.log(
      `  - ${c.claim.slice(0, 90)} :: ${c.citations.map((x) => `${x.status}${x.support === null ? "" : `@${x.support.toFixed(2)}`}`).join(", ")}`,
    );
  if (after.revision)
    console.log(
      `revision: ${JSON.stringify({ status: after.revision.status, kept: (after.revision as { kept?: boolean }).kept })}`,
    );
  if (after.checked) {
    const cor = await corroborate(after.checked, result.steps);
    console.log(
      `corroboration: ${JSON.stringify({ status: cor.status, pool: (cor as { pool?: number }).pool, found: (cor as { found?: number }).found, failed: (cor as { failed?: number }).failed })}`,
    );
  }
  console.log(`\n${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
