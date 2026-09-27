// The bare pattern for testing structured output with a mock model. The templates in src/lib/llm/ build on it (their tests: src/lib/llm/*.test.ts).
import { describe, expect, it } from "vitest";
import { generateText, NoObjectGeneratedError, Output, type LanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";

const schema = z.object({ label: z.enum(["ok", "problem"]), reason: z.string() });

async function classify(model: LanguageModel, input: string) {
  const { output } = await generateText({
    model,
    instructions: "Classify the message as ok or problem, with a one-line reason.",
    prompt: input,
    output: Output.object({ schema }),
  });
  return output;
}

function mockModel(text: string) {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: "text", text }],
      finishReason: { unified: "stop", raw: undefined },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 1, text: 1, reasoning: undefined },
      },
      warnings: [],
    }),
  });
}

describe("structured output with a mock model", () => {
  it("returns the parsed, schema-checked object", async () => {
    const out = await classify(mockModel('{"label":"problem","reason":"price changed"}'), "anything");
    expect(out).toEqual({ label: "problem", reason: "price changed" });
  });

  it("throws NoObjectGeneratedError when the model returns something off-schema", async () => {
    await expect(classify(mockModel('{"label":"maybe"}'), "anything")).rejects.toBeInstanceOf(
      NoObjectGeneratedError,
    );
  });
});
