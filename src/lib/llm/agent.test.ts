import { describe, expect, it } from "vitest";
import { tool } from "ai";
import { z } from "zod";
import { runAgent, LlmError } from "./agent";
import { clock } from "./tools/clock";
import { scriptedModel, slowModel } from "./test-models";

const base = { instructions: "Answer the question. Use the tools.", prompt: "What day is it?" };

describe("runAgent", () => {
  it("calls a tool, then answers, and traces the call", async () => {
    const model = scriptedModel([{ call: "clock", input: { timeZone: "Europe/Oslo" } }, "It is Tuesday."]);
    const r = await runAgent({ ...base, tools: { clock }, model: () => model });
    expect(r.text).toBe("It is Tuesday.");
    expect(r.steps).toBe(2);
    expect(r.hitStepCap).toBe(false);
    expect(r.trace).toHaveLength(1);
    expect(r.trace[0]).toMatchObject({ step: 1, tool: "clock", input: { timeZone: "Europe/Oslo" } });
    expect(r.trace[0].output).toHaveProperty("iso");
  });

  it("stops at the step cap and says so", async () => {
    const model = scriptedModel([{ call: "clock" }]); // never answers
    const r = await runAgent({ ...base, tools: { clock }, maxSteps: 3, model: () => model });
    expect(r.steps).toBe(3);
    expect(r.hitStepCap).toBe(true);
    expect(r.text).toBe("");
  });

  it("hands a failing tool's error back to the model and keeps going", async () => {
    const broken = tool({
      description: "Look up a product",
      inputSchema: z.object({ sku: z.string() }),
      execute: async (): Promise<{ name: string }> => {
        throw new Error("database down");
      },
    });
    const model = scriptedModel([{ call: "lookup", input: { sku: "A1" } }, "I could not look it up."]);
    const r = await runAgent({ ...base, tools: { lookup: broken }, model: () => model });
    expect(r.text).toBe("I could not look it up.");
    expect(r.trace[0]).toMatchObject({ tool: "lookup", error: expect.stringMatching(/database down/) });
  });

  it("turns a timeout into an LlmError", async () => {
    const err = await runAgent({ ...base, tools: { clock }, timeoutMs: 50, model: () => slowModel(1_000) }).catch((e) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect(err.kind).toBe("timeout");
  });
});
