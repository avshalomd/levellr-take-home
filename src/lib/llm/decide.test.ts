import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  choice,
  confidenceOf,
  decide,
  isConfident,
  levelOf,
  noul,
  outOfCredit,
  resetBench,
  routeFor,
  routesFor,
  score,
  stateTooLong,
  type ChoiceAnswer,
  type NoulAnswer,
  type Question,
  type Route,
  type ScoreAnswer,
} from "./decide";
import { LlmError } from "./errors";

// Both routes are faked, so the suite runs offline. What was SENT matters as much as what came back: "one request,
// every question" is the design, and the gateway speaks a different dialect that this file has to translate.
type SentBody = { model: string; state: unknown; questions: Record<string, { type: string; criteria?: unknown }> };

function fakeFetch(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const calls: { url: string; body: SentBody; headers: Record<string, string> }[] = [];
  const impl = (async (url: string, options: { body: string; headers: Record<string, string> }) => {
    calls.push({ url, body: JSON.parse(options.body), headers: options.headers });
    return {
      ok: init.ok ?? true,
      status: init.status ?? 200,
      text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    } as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function fakeEvaluate(result: unknown) {
  const calls: { questions: Record<string, Question> }[] = [];
  const impl = (async (args: { questions: Record<string, Question> }) => {
    calls.push(args);
    return result;
  }) as unknown as Parameters<typeof decide>[0]["evaluateImpl"];
  return { impl, calls };
}

const questions = {
  needs_human: noul("This message requires a person to act before a stated deadline."),
  kind: choice("What is this message mainly about?", {
    price_change: "a supplier is changing prices",
    invoice_dispute: "a disagreement about an invoice",
    other: "none of these",
  }),
  urgency: score("How urgent is this for the buyer?", ["not urgent", "this week", "today"]),
};

const httpAnswers: { needs_human: NoulAnswer; kind: ChoiceAnswer; urgency: ScoreAnswer } = {
  needs_human: { type: "noul", noul: 0.97 },
  kind: { type: "choice", choice: "price_change", probabilities: { price_change: 0.95, other: 0.05 }, confidence: 0.95 },
  urgency: {
    type: "score",
    score: 1.08,
    legend: { "0": "not urgent", "1": "this week", "2": "today" },
    probabilities: { "0": 0.02, "1": 0.88, "2": 0.1 },
    confidence: 0.82,
  },
};
const httpOk = { model: "typesafe/jev-1.13-20260917", answers: httpAnswers, usage: { input_tokens: 493 } };
const httpRoute: Route = { kind: "http", url: "https://openrouter.ai/api/alpha/decisions", key: "k", model: "typesafe/jev-1.13" };

beforeEach(() => {
  for (const v of ["TYPESAFE_API_KEY", "TYPESAFE_AI_API_KEY", "AI_GATEWAY_API_KEY", "VERCEL_OIDC_TOKEN", "VERCEL", "OPENROUTER_API_KEY", "JEV_MODEL"]) {
    vi.stubEnv(v, "");
  }
});
afterEach(() => vi.unstubAllEnvs());

describe("decide over HTTP", () => {
  it("asks every question in ONE request", async () => {
    const { impl, calls } = fakeFetch(httpOk);
    await decide({ state: "espresso to 14.20 from 1 November", questions, route: httpRoute, fetchImpl: impl });
    expect(calls).toHaveLength(1);
    expect(Object.keys(calls[0].body.questions)).toEqual(["needs_human", "kind", "urgency"]);
    expect(calls[0].body.questions.needs_human.type).toBe("noul"); // this dialect keeps the native name
  });

  it("returns the answers, the model that actually ran, and what it read", async () => {
    const { impl } = fakeFetch(httpOk);
    const result = await decide({ state: "x", questions, route: httpRoute, fetchImpl: impl });
    expect(result.answers.kind.choice).toBe("price_change");
    expect(result.answers.urgency.score).toBeCloseTo(1.08);
    expect(result.modelId).toBe("typesafe/jev-1.13-20260917"); // the dated build, not the alias asked for
    expect(result.usage.inputTokens).toBe(493);
  });

  it("sends an array of options as its own descriptions", async () => {
    const answered = { ...httpOk, answers: { q: { type: "choice", choice: "a", probabilities: { a: 0.9, b: 0.1 }, confidence: 0.9 } } };
    const { impl, calls } = fakeFetch(answered);
    await decide({ state: "x", questions: { q: choice("Which?", ["a", "b"]) }, route: httpRoute, fetchImpl: impl });
    expect(calls[0].body.questions.q.criteria).toEqual({ a: "a", b: "b" });
  });

  // A 429 from a shared pool arrives as HTTP 200 with the error inside the body. Read as a success it becomes a
  // crash on `answers.kind` far from the cause - the same failure that cost a morning on 2026-09-20.
  it("treats an error inside a 200 as a failure, in the provider's own words", async () => {
    const { impl } = fakeFetch({ error: { code: 429, message: "rate limited by upstream_provider_shared_pool" } });
    const err = await decide({ state: "x", questions, route: httpRoute, fetchImpl: impl }).catch((e) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect(err.kind).toBe("unavailable");
    expect(err.message).toMatch(/shared_pool/);
  });

  it("surfaces the provider's reason from a failed request, not the gateway's summary", async () => {
    const body = { error: { message: "Provider returned error", metadata: { raw: "state exceeds 32000 tokens" } } };
    const { impl } = fakeFetch(body, { ok: false, status: 400 });
    const err = await decide({ state: "x", questions, route: httpRoute, fetchImpl: impl }).catch((e) => e);
    expect(err.message).toMatch(/exceeds 32000 tokens/);
    expect(err.message).not.toMatch(/Provider returned error/);
  });

  it("rejects a well-formed response with no answers rather than returning undefined", async () => {
    const { impl } = fakeFetch({ model: "jev", usage: {} });
    const err = await decide({ state: "x", questions, route: httpRoute, fetchImpl: impl }).catch((e) => e);
    expect(err.kind).toBe("off-schema");
  });

  it("turns a timeout into an LlmError the user can read", async () => {
    const impl = (async () => {
      throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
    }) as unknown as typeof fetch;
    const err = await decide({ state: "x", questions, route: httpRoute, timeoutMs: 50, fetchImpl: impl }).catch((e) => e);
    expect(err.kind).toBe("timeout");
    expect(err.message).toMatch(/0.05 s/);
  });
});

// One provider's bad minute must not be the app's: with several routes configured, decide() walks them in
// routesFor() order. Pinning a route (or a model id, which only one route understands) switches that off.
describe("decide failover", () => {
  // Answers per URL, so a test can take one provider down and leave the next one up.
  function fetchByUrl(byUrl: Record<string, { body: unknown; ok?: boolean; status?: number }>) {
    const urls: string[] = [];
    const impl = (async (url: string) => {
      urls.push(url);
      const r = byUrl[url];
      return { ok: r.ok ?? true, status: r.status ?? 200, text: async () => JSON.stringify(r.body) } as Response;
    }) as unknown as typeof fetch;
    return { impl, urls };
  }
  const TYPESAFE = "https://api.typesafe.ai/v1/systemone";
  const OPENROUTER = "https://openrouter.ai/api/alpha/decisions";
  const down = { body: { error: { message: "upstream unavailable" } }, ok: false, status: 503 };

  beforeEach(() => resetBench());
  const typesafeOk = { body: { ...httpOk, model: "jev-1.13.0" } };
  const broke = { body: { error: { message: "Insufficient credits. Add more using https://openrouter.ai/settings/credits" } }, ok: false, status: 402 };

  it("moves to the next configured route when the first one fails", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "ts");
    vi.stubEnv("OPENROUTER_API_KEY", "or");
    const { impl, urls } = fetchByUrl({ [OPENROUTER]: down, [TYPESAFE]: typesafeOk });
    const result = await decide({ state: "x", questions, fetchImpl: impl });
    expect(urls).toEqual([OPENROUTER, TYPESAFE]);
    expect(result.answers.kind.choice).toBe("price_change");
    expect(result.modelId).toBe("jev-1.13.0"); // says which route answered
  });

  it("reports the FIRST route's failure when every route fails", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "ts");
    vi.stubEnv("OPENROUTER_API_KEY", "or");
    const second = { body: { error: { message: "rate limited" } }, ok: false, status: 429 };
    const { impl } = fetchByUrl({ [OPENROUTER]: down, [TYPESAFE]: second });
    const err = await decide({ state: "x", questions, fetchImpl: impl }).catch((e) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect(err.message).toMatch(/upstream unavailable/);
  });

  // The TypeSafe account ran down to its last dollar on 2026-09-25: an empty account must cost one failed request,
  // not one on every call, and the answer must still come from the next route.
  it("skips a route that said it is out of credit, for a while, and still answers", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "ts");
    vi.stubEnv("OPENROUTER_API_KEY", "or");
    const { impl, urls } = fetchByUrl({ [OPENROUTER]: broke, [TYPESAFE]: typesafeOk });
    await decide({ state: "x", questions, fetchImpl: impl });
    await decide({ state: "x", questions, fetchImpl: impl });
    expect(urls).toEqual([OPENROUTER, TYPESAFE, TYPESAFE]);
    vi.useFakeTimers({ now: Date.now() + 11 * 60_000 });
    await decide({ state: "x", questions, fetchImpl: impl });
    vi.useRealTimers();
    expect(urls.slice(3)).toEqual([OPENROUTER, TYPESAFE]); // tried again once the pause is over
  });

  it("does not bench a route for a passing fault like a rate limit or an outage", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "ts");
    vi.stubEnv("OPENROUTER_API_KEY", "or");
    const { impl, urls } = fetchByUrl({ [OPENROUTER]: down, [TYPESAFE]: typesafeOk });
    await decide({ state: "x", questions, fetchImpl: impl });
    await decide({ state: "x", questions, fetchImpl: impl });
    expect(urls).toEqual([OPENROUTER, TYPESAFE, OPENROUTER, TYPESAFE]);
  });

  it("still tries every route when all of them are benched", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "ts");
    vi.stubEnv("OPENROUTER_API_KEY", "or");
    const { impl } = fetchByUrl({ [OPENROUTER]: broke, [TYPESAFE]: broke });
    await decide({ state: "x", questions, fetchImpl: impl }).catch(() => {});
    const { impl: back, urls } = fetchByUrl({ [OPENROUTER]: { body: httpOk }, [TYPESAFE]: typesafeOk });
    await decide({ state: "x", questions, fetchImpl: back });
    expect(urls).toEqual([OPENROUTER]);
  });

  it("reads a credit or key refusal as lasting, and a rate limit as passing", () => {
    expect(outOfCredit(402, "")).toBe(true);
    expect(outOfCredit(401, "bad key")).toBe(true);
    expect(outOfCredit(400, '{"error":{"message":"Insufficient credit balance"}}')).toBe(true);
    expect(outOfCredit(429, "quota exceeded, no credit left this minute")).toBe(false);
    expect(outOfCredit(503, "upstream unavailable")).toBe(false);
  });

  it("never leaves a pinned route", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "or");
    const { impl, urls } = fetchByUrl({ [TYPESAFE]: down, [OPENROUTER]: { body: httpOk } });
    const pinned: Route = { kind: "http", url: TYPESAFE, key: "k", model: "jev-1.13.0" };
    const err = await decide({ state: "x", questions, route: pinned, fetchImpl: impl }).catch((e) => e);
    expect(err.kind).toBe("unavailable");
    expect(urls).toEqual([TYPESAFE]);
  });

  // A model id belongs to one provider's vocabulary; sent to the next route it would be a second, confusing error.
  it("does not fail over when JEV_MODEL overrides the model", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "ts");
    vi.stubEnv("OPENROUTER_API_KEY", "or");
    vi.stubEnv("JEV_MODEL", "jev-1.12.0");
    expect(routesFor()).toEqual([{ kind: "http", url: OPENROUTER, key: "or", model: "jev-1.12.0" }]);
  });

  it("treats a question that came back unanswered as off-schema, not as undefined", async () => {
    const partial = { ...httpOk, answers: { needs_human: httpAnswers.needs_human, kind: httpAnswers.kind } };
    const { impl } = fakeFetch(partial);
    const err = await decide({ state: "x", questions, route: httpRoute, fetchImpl: impl }).catch((e) => e);
    expect(err.kind).toBe("off-schema");
    expect(err.message).toMatch(/urgency/);
  });
});

// The gateway is a different dialect of the same model: a yes/no question is called "boolean" there, its answer
// carries `probability` instead of `noul`, and confidence for the other types is in provider metadata rather than
// on the answer. Every one of those is a silent wrong-answer bug if the translation slips.
describe("decide through the AI Gateway", () => {
  const gatewayResult = {
    answers: {
      needs_human: { type: "boolean", probability: 0.95 },
      kind: { type: "choice", choice: "price_change", probabilities: { price_change: 1, other: 0 } },
      urgency: { type: "score", score: 1.09, probabilities: { "0": 0.02, "1": 0.87, "2": 0.11 } },
    },
    usage: { inputTokens: 365 },
    providerMetadata: { typesafe: { confidence: { kind: 0.99, urgency: 0.8 } } },
  };
  const gatewayRoute: Route = { kind: "gateway", model: "typesafe-ai/jev" };
  const asked = questions;

  it("sends a noul question under the name the gateway uses", async () => {
    const { impl, calls } = fakeEvaluate(gatewayResult);
    await decide({ state: "x", questions: asked, route: gatewayRoute, evaluateImpl: impl });
    expect(calls).toHaveLength(1);
    expect(calls[0].questions.needs_human.type).toBe("boolean");
    expect(calls[0].questions.needs_human.instructions).toBe(questions.needs_human.instructions);
    expect(calls[0].questions.kind.type).toBe("choice"); // unchanged
  });

  it("converts the answer back, and finds the confidence the gateway hid in metadata", async () => {
    const { impl } = fakeEvaluate(gatewayResult);
    const result = await decide({ state: "x", questions: asked, route: gatewayRoute, evaluateImpl: impl });
    expect(result.answers.needs_human).toEqual({ type: "noul", noul: 0.95 });
    expect(result.answers.kind.confidence).toBe(0.99);
    expect(result.usage.inputTokens).toBe(365);
  });

  // The gateway returns a score with no legend - the levels exist only in the question that was sent - so
  // levelOf() would read undefined and throw. Found by running the real thing, not by this mock.
  it("rebuilds the legend a score answer comes back without", async () => {
    const { impl } = fakeEvaluate(gatewayResult);
    const result = await decide({ state: "x", questions: asked, route: gatewayRoute, evaluateImpl: impl });
    expect(result.answers.urgency.legend).toEqual({ "0": "not urgent", "1": "this week", "2": "today" });
    expect(levelOf(result.answers.urgency)).toBe("this week");
    expect(result.answers.urgency.confidence).toBe(0.8);
  });

  it("turns a gateway failure into an LlmError like any other", async () => {
    const impl = (async () => {
      throw new Error("model not found: typesafe-ai/jev");
    }) as unknown as Parameters<typeof decide>[0]["evaluateImpl"];
    const err = await decide({ state: "x", questions: asked, route: gatewayRoute, evaluateImpl: impl }).catch((e) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect(err.message).toMatch(/model not found/);
  });
});

describe("routeFor", () => {
  it("prefers OpenRouter, and uses TypeSafe's own API under the name that API uses", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "or");
    expect(routeFor()).toMatchObject({ kind: "http", url: "https://openrouter.ai/api/alpha/decisions", model: "typesafe/jev-1.13" });
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubEnv("TYPESAFE_API_KEY", "ts");
    expect(routeFor()).toMatchObject({ kind: "http", url: "https://api.typesafe.ai/v1/systemone", model: "jev-1.13.0" });
  });

  it("accepts the AI SDK provider's spelling of the key too", () => {
    vi.stubEnv("TYPESAFE_AI_API_KEY", "ts");
    expect(routeFor()).toMatchObject({ kind: "http", url: "https://api.typesafe.ai/v1/systemone" });
  });

  // The paid route outranks the free gateway on purpose: the gateway serves Jev at no charge today, so its
  // throughput is nobody's promise, and a free tier throttling under load looks exactly like a broken model.
  it("prefers paid OpenRouter over the free gateway, on a pinned version", () => {
    vi.stubEnv("VERCEL_OIDC_TOKEN", "oidc");
    vi.stubEnv("OPENROUTER_API_KEY", "or");
    expect(routeFor()).toMatchObject({ kind: "http", model: "typesafe/jev-1.13" });
  });

  it("uses the gateway when it is the only route, on the token `vercel env pull` writes", () => {
    vi.stubEnv("VERCEL_OIDC_TOKEN", "oidc");
    expect(routeFor()).toEqual({ kind: "gateway", model: "typesafe-ai/jev" });
  });

  it("turns a missing key into an LlmError instead of a crash", async () => {
    expect(() => routeFor()).toThrow(LlmError);
    expect(() => routeFor()).toThrow(/No decision model configured/);
    const err = await decide({ state: "x", questions }).catch((e) => e);
    expect(err.message).toMatch(/No decision model configured/);
  });

  it("lists every configured route, paid first", () => {
    vi.stubEnv("VERCEL_OIDC_TOKEN", "oidc");
    vi.stubEnv("OPENROUTER_API_KEY", "or");
    vi.stubEnv("TYPESAFE_API_KEY", "ts");
    expect(routesFor().map((r) => (r.kind === "http" ? r.url : "gateway"))).toEqual([
      "https://openrouter.ai/api/alpha/decisions",
      "https://api.typesafe.ai/v1/systemone",
      "gateway",
    ]);
  });
});

describe("confidence", () => {
  // A noul has no separate confidence: 0.02 is a confident NO, and reading it as "0.02 confident" inverts the
  // decision. This is the one place a caller can silently get the pattern backwards.
  it("reads a confident no as confident", () => {
    expect(confidenceOf({ type: "noul", noul: 0.02 })).toBeCloseTo(0.98);
    expect(isConfident({ type: "noul", noul: 0.02 })).toBe(true);
    expect(isConfident({ type: "noul", noul: 0.5 })).toBe(false);
  });

  it("uses the model's own confidence for a choice and a score", () => {
    expect(isConfident(httpAnswers.kind)).toBe(true);
    expect(isConfident(httpAnswers.urgency, 0.9)).toBe(false); // 0.82: this one goes to a human
  });

  it("names the level a score landed on", () => {
    expect(levelOf(httpAnswers.urgency)).toBe("this week");
  });
});

describe("stateTooLong", () => {
  it("flags a state past Jev's context before the request is made", () => {
    expect(stateTooLong("short")).toBe(false);
    expect(stateTooLong("x".repeat(100_000))).toBe(true);
  });
});
