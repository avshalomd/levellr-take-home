// Live check of both templates against the configured model. Skipped unless EVAL=1, so `npm run check` never
// needs a network or a key. Run: EVAL=1 npx dotenv -e .env.local -- vitest run src/lib/llm/templates.eval.test.ts
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { extract } from "./extract";
import { runAgent } from "./agent";
import { clock } from "./tools/clock";

describe.skipIf(process.env.EVAL !== "1")("LLM templates, live", () => {
  it("extract returns a schema-checked object", async () => {
    const { data } = await extract({
      schema: z.object({ items: z.array(z.object({ product: z.string(), price: z.number() })) }),
      instructions: "List every product with its price in EUR.",
      input: "Milk 1L is now EUR 1.85 and butter 250g EUR 3.40.",
    });
    expect(data.items.map((i) => i.price).sort()).toEqual([1.85, 3.4]);
  }, 60_000);

  it("runAgent calls a tool before answering", async () => {
    const r = await runAgent({
      instructions: "Answer in one short sentence. Use the clock tool for anything about today's date.",
      tools: { clock },
      prompt: "What is today's date in Oslo?",
    });
    expect(r.trace.some((t) => t.tool === "clock")).toBe(true);
    expect(r.text.length).toBeGreaterThan(0);
  }, 90_000);
});
