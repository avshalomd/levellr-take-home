import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getFallbackModel, getModel } from "./ai";
import { modelIdOf } from "./llm/errors";

describe("AI_SIMULATE_DOWN", () => {
  afterEach(() => {
    delete process.env.AI_SIMULATE_DOWN;
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("makes getModel fail even when a key is set", () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    process.env.AI_SIMULATE_DOWN = "1";
    expect(() => getModel()).toThrow(/LLM unavailable/);
  });

  it("leaves the configured provider alone when unset", () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    expect(() => getModel()).not.toThrow();
  });
});

// Which model answers is decided by two env vars, and an env file is where they go wrong: a line left as `NAME=`
// is an empty string, not "unset".
describe("AI_MODEL and AI_MODEL_FALLBACK", () => {
  const vars = ["OPENROUTER_API_KEY", "AI_MODEL", "AI_MODEL_FALLBACK", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"];
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const v of vars) {
      saved[v] = process.env[v];
      delete process.env[v];
    }
    process.env.OPENROUTER_API_KEY = "test-key";
  });
  afterEach(() => {
    for (const v of vars) {
      if (saved[v] === undefined) delete process.env[v];
      else process.env[v] = saved[v];
    }
  });

  it("uses the default model when AI_MODEL is set to nothing", () => {
    process.env.AI_MODEL = "";
    expect(modelIdOf(getModel())).toBe("openai/gpt-5.6-luna");
  });

  it("lets AI_MODEL override the default", () => {
    process.env.AI_MODEL = "deepseek/deepseek-v4-flash-0731";
    expect(modelIdOf(getModel())).toBe("deepseek/deepseek-v4-flash-0731");
  });

  it("has a second model by default, and AI_MODEL_FALLBACK set to nothing switches it off", () => {
    expect(modelIdOf(getFallbackModel()!)).toBe("deepseek/deepseek-v4.1-flash");
    process.env.AI_MODEL_FALLBACK = "";
    expect(getFallbackModel()).toBeNull();
  });

  it("offers no fallback when it would be the same model as the primary", () => {
    process.env.AI_MODEL = "deepseek/deepseek-v4.1-flash";
    expect(getFallbackModel()).toBeNull();
  });
});
