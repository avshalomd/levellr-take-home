// Mock models for the LLM tests: no network, no key. A test hands one to extract() or runAgent() as `model`.
import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";

type Part = { type: "text"; text: string } | { type: "tool-call"; toolCallId: string; toolName: string; input: string };

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};

// Each model call returns the next reply in the list (the last one repeats): a reply is text, or a tool call.
export function scriptedModel(replies: Array<string | { call: string; input?: object }>, modelId?: string) {
  let i = 0;
  return new MockLanguageModelV4({
    modelId,
    doGenerate: async () => {
      const r = replies[Math.min(i, replies.length - 1)];
      i += 1;
      const part: Part =
        typeof r === "string"
          ? { type: "text", text: r }
          : { type: "tool-call", toolCallId: `call-${i}`, toolName: r.call, input: JSON.stringify(r.input ?? {}) };
      return {
        content: [part],
        finishReason: { unified: part.type === "tool-call" ? "tool-calls" : "stop", raw: undefined },
        usage,
        warnings: [],
      };
    },
  });
}

// A model that answers only after `ms`, to drive the timeout path.
export function slowModel(ms: number) {
  return new MockLanguageModelV4({
    doGenerate: async ({ abortSignal }) => {
      await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, ms);
        abortSignal?.addEventListener("abort", () => {
          clearTimeout(t);
          reject(abortSignal.reason);
        });
      });
      return { content: [{ type: "text", text: "late" }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] };
    },
  });
}

// A model whose calls throw in order, then answer from `replies`. With no replies it keeps throwing the last
// error, which is what a real outage looks like: the SDK's own retry must not be able to turn it into an answer.
export function failingModel(errors: unknown[], replies: string[] = [], modelId?: string) {
  const scripted = replies.length ? scriptedModel(replies, modelId) : null;
  let i = 0;
  return new MockLanguageModelV4({
    modelId,
    doGenerate: async (options) => {
      const e = scripted ? errors[i] : (errors[Math.min(i, errors.length - 1)] ?? errors.at(-1));
      i += 1;
      if (e) throw e;
      if (!scripted) throw new Error("failingModel: no reply scripted");
      return scripted.doGenerate(options);
    },
  });
}

// The shape a gateway returns: a status code and the provider's own words in the body.
export function apiError(statusCode: number, body: unknown) {
  return new APICallError({
    message: "Provider returned error",
    url: "https://example.test/chat/completions",
    requestBodyValues: {},
    statusCode,
    responseBody: JSON.stringify(body),
  });
}
