import "server-only";
import { experimental_evaluate as evaluate } from "ai";
import { LlmError } from "./errors";

// Template 3: a typed decision. Jev (TypeSafe AI) reads a state and answers a fixed set of CLOSED questions with
// calibrated probabilities. It writes no text, so there is nothing to parse and nothing to validate: the answer is
// always one of the options this code listed. Use it for the judgment a workflow makes over and over - which
// category, how severe, does this condition hold - and keep an LLM (extract.ts, agent.ts) for anything written.
// When to reach for it and when not to: .claude/docs/models.md.
//
// Three routes, one model: TypeSafe's own API and OpenRouter over plain HTTP (both paid), and the Vercel AI Gateway
// through the AI SDK's `experimental_evaluate` (free today, no new dependency). routesFor() orders them paid first,
// and decide() moves to the next one when a route fails, so one provider's bad minute is not the app's. The gateway
// speaks a different dialect - a yes/no question is "boolean" there and confidence hides in provider metadata - so
// every route is normalised here and the rest of the app sees one shape.

export type NoulQ = { type: "noul"; instructions: string; criteria?: { true: string; false: string } };
export type ChoiceQ<O extends string = string> = { type: "choice"; instructions: string; criteria: Record<O, string> };
export type ScoreQ<L extends string = string> = { type: "score"; instructions: string; criteria: readonly L[] };
export type Question = NoulQ | ChoiceQ | ScoreQ;

/** Does this condition hold? The probability IS the answer - there is no separate confidence. */
export function noul(instructions: string, criteria?: { true: string; false: string }): NoulQ {
  return criteria ? { type: "noul", instructions, criteria } : { type: "noul", instructions };
}

/**
 * Which one of these? Jev can only answer with an option listed here, so include a "none of these" option whenever
 * nothing may fit - otherwise it has to pick one of the wrong ones. Describing each option is worth more than a
 * longer question: the description is where the meaning goes.
 */
export function choice<const O extends string>(instructions: string, options: Record<O, string> | readonly O[]): ChoiceQ<O> {
  const criteria = Array.isArray(options)
    ? (Object.fromEntries(options.map((o) => [o, o])) as Record<O, string>)
    : (options as Record<O, string>);
  return { type: "choice", instructions, criteria };
}

/** Where on this ordered scale? Levels run low to high; the answer is a position, so 1.4 sits between two of them. */
export function score<const L extends string>(instructions: string, levels: readonly L[]): ScoreQ<L> {
  return { type: "score", instructions, criteria: levels };
}

export type NoulAnswer = { type: "noul"; noul: number };
export type ChoiceAnswer<O extends string = string> = {
  type: "choice";
  choice: O;
  probabilities: Record<O, number>;
  confidence: number;
};
export type ScoreAnswer<L extends string = string> = {
  type: "score";
  score: number; // a position on the scale: 0 is the first level, levels.length - 1 the last
  legend: Record<string, L>;
  probabilities: Record<string, number>;
  confidence: number;
};
export type Answer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

type AnswerFor<Q> = Q extends NoulQ
  ? NoulAnswer
  : Q extends ChoiceQ<infer O>
    ? ChoiceAnswer<O>
    : Q extends ScoreQ<infer L>
      ? ScoreAnswer<L>
      : never;

export type DecideResult<Qs extends Record<string, Question>> = {
  answers: { [K in keyof Qs]: AnswerFor<Qs[K]> };
  modelId: string;
  usage: { inputTokens: number };
};

export type DecideArgs<Qs extends Record<string, Question>> = {
  state: unknown; // a string, an object or an array of strings - whatever the decision is about
  questions: Qs; // independent questions are answered in ONE request, in parallel: ask everything at once
  timeoutMs?: number;
  model?: string;
  route?: Route; // pins ONE route and switches the failover off (tests do this); product code leaves it out
  fetchImpl?: typeof fetch; // the HTTP routes only; tests pass a fake
  evaluateImpl?: typeof evaluate; // the gateway route only; tests pass a fake
};

const MAX_STATE_TOKENS = 32_000; // Jev's context. A longer state has to be cut down before it gets here.
const DEFAULT_TIMEOUT_MS = 10_000; // per route. Short on purpose: three routes in a row must still fit a request.

/**
 * One request, every question answered. Independent questions cost no extra round trip, so ask the speculative ones
 * too ("if this IS a refund request, what is the reason?") and read only the branch that turned out to apply. A
 * second call is justified only when an earlier answer changes what you must fetch or ask next.
 */
export async function decide<const Qs extends Record<string, Question>>(args: DecideArgs<Qs>): Promise<DecideResult<Qs>> {
  const configured = args.route ? [args.route] : routesFor(args.model);
  if (configured.length === 0) throw notConfigured();
  // A route that said it is out of credit or refused the key is skipped for a while rather than paid a failed
  // round trip on every call; if every route is benched, all are tried anyway.
  const awake = configured.filter((r) => (benchedUntil.get(routeKey(r)) ?? 0) <= Date.now());
  const routes = awake.length ? awake : configured;
  // Failover: the same question, the same model, the next provider. The FIRST failure is the one reported, as in
  // extract(): it names the route the app is configured to use, and the later ones are only consequences.
  let first: LlmError | undefined;
  for (const route of routes) {
    try {
      return await decideOn(route, args);
    } catch (e) {
      first ??= e as LlmError; // decideOn throws nothing else
    }
  }
  throw first!;
}

async function decideOn<const Qs extends Record<string, Question>>(route: Route, args: DecideArgs<Qs>): Promise<DecideResult<Qs>> {
  const { state, questions, timeoutMs = DEFAULT_TIMEOUT_MS } = args;
  try {
    const raw =
      route.kind === "gateway"
        ? await viaGateway(state, questions, route.model, timeoutMs, args.evaluateImpl ?? evaluate)
        : await viaHttp(state, questions, route, timeoutMs, args.fetchImpl ?? fetch);
    // Every question asked must come back answered. A missing key would otherwise surface as "cannot read
    // properties of undefined" in whatever code reads the answer, far from the cause.
    const missing = Object.keys(questions).filter((key) => !(raw.answers as Record<string, unknown>)[key]);
    if (missing.length) throw new LlmError(`The decision model left questions unanswered: ${missing.join(", ")}.`, "off-schema");
    return raw as DecideResult<Qs>;
  } catch (e) {
    if (e instanceof LlmError) throw e;
    const name = e instanceof Error ? e.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      throw new LlmError(`The decision model took too long (${timeoutMs / 1000} s). Retry.`, "timeout", { cause: e });
    }
    throw new LlmError(`The decision model failed: ${e instanceof Error ? e.message : String(e)}`, "unavailable", { cause: e });
  }
}

// The AI SDK route. `experimental_evaluate` ships in `ai` itself, so this costs no new dependency - but it is
// experimental and the docs say the shape may change in a patch release, which is why nothing outside this file
// touches it. A bare model id routes through the Vercel AI Gateway on the OIDC token `vercel env pull` writes.
type GatewayAnswer = { type: string; probability?: number; legend?: Record<string, string>; confidence?: number };
type GatewayResult = {
  answers?: Record<string, GatewayAnswer>;
  usage?: { inputTokens?: number };
  providerMetadata?: { typesafe?: { confidence?: Record<string, number> } };
};

async function viaGateway(
  state: unknown,
  questions: Record<string, Question>,
  model: string,
  timeoutMs: number,
  evaluateImpl: typeof evaluate,
) {
  const asked = Object.fromEntries(
    Object.entries(questions).map(([k, q]) => [k, q.type === "noul" ? { ...q, type: "boolean" } : q]),
  );
  const call = { model, state, questions: asked, abortSignal: AbortSignal.timeout(timeoutMs) };
  const result = (await evaluateImpl(call as unknown as Parameters<typeof evaluate>[0])) as unknown as GatewayResult;
  // Confidence is not on the answer here: it sits in provider metadata, per question, and a boolean has none at
  // all. A score comes back without its legend, too - the levels exist only in the question we sent - so it is
  // rebuilt from the question, which is what makes levelOf() work the same on both routes.
  const confidence = result.providerMetadata?.typesafe?.confidence ?? {};
  const answers = Object.fromEntries(
    Object.entries(result.answers ?? {}).map(([key, a]) => {
      if (a.type === "boolean") return [key, { type: "noul", noul: a.probability }];
      const filled: GatewayAnswer = { ...a, confidence: a.confidence ?? confidence[key] ?? 0 };
      if (a.type === "score" && !a.legend) {
        const levels = (questions[key] as ScoreQ | undefined)?.criteria ?? [];
        filled.legend = Object.fromEntries(levels.map((level, i) => [String(i), level]));
      }
      return [key, filled];
    }),
  );
  return { answers, modelId: model, usage: { inputTokens: result.usage?.inputTokens ?? 0 } };
}

// The HTTP route: TypeSafe's own API, or OpenRouter, which passes the request on to TypeSafe. Same model, same
// question dialect as this file's own types, so nothing needs converting.
async function viaHttp(
  state: unknown,
  questions: Record<string, Question>,
  route: Extract<Route, { kind: "http" }>,
  timeoutMs: number,
  fetchImpl: typeof fetch,
) {
  const response = await fetchImpl(route.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${route.key}`, "X-Title": "takehome" },
    body: JSON.stringify({ model: route.model, state, questions }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await response.text();
  if (!response.ok) {
    if (outOfCredit(response.status, body)) bench(route);
    throw new LlmError(`The decision model failed: ${reason(body, response.status)}`, "unavailable");
  }
  const data = JSON.parse(body);
  // A gateway can answer 200 with an error inside it, which is how a 429 arrives dressed as a success.
  if (data?.error && !data?.answers) throw new LlmError(`The decision model failed: ${reason(body, 200)}`, "unavailable");
  if (!data?.answers) throw new LlmError("The decision model returned no answers.", "off-schema");
  return { answers: data.answers, modelId: data.model ?? route.model, usage: { inputTokens: data.usage?.input_tokens ?? 0 } };
}

/**
 * Split by confidence: act on the confident answers, send the rest to a person or a reasoning model. This is the
 * pattern that makes a cheap model usable on work where a mistake costs something, and it holds only because Jev's
 * probabilities are CALIBRATED - of the answers it gives 0.9 to, about 90% are right AS A GROUP. That is never a
 * statement about the one answer in front of you. Pick the threshold by running your own labelled cases.
 */
export function confidenceOf(answer: Answer): number {
  return answer.type === "noul" ? Math.max(answer.noul, 1 - answer.noul) : answer.confidence;
}

export function isConfident(answer: Answer, threshold = 0.85): boolean {
  return confidenceOf(answer) >= threshold;
}

/** The level a score landed on, for code that wants the label rather than the position. */
export function levelOf<L extends string>(answer: ScoreAnswer<L>): L {
  return answer.legend[String(Math.round(answer.score))];
}

/**
 * A rough guard for the CALLER to use before sending: Jev reads 32K tokens. decide() does not call it, on purpose -
 * three characters per token is an estimate and would reject some states that fit. A state that really is too long
 * is refused by the provider, and that refusal reaches the user in the provider's own words.
 */
export function stateTooLong(state: unknown): boolean {
  return JSON.stringify(state).length / 3 > MAX_STATE_TOKENS;
}

export type Route =
  | { kind: "gateway"; model: string }
  | { kind: "http"; url: string; key: string; model: string };

// Out of credit, or a key the provider refuses: neither fixes itself in seconds, unlike a 429 or a 503.
const BENCH_MS = 10 * 60_000;
const benchedUntil = new Map<string, number>();
const routeKey = (r: Route) => (r.kind === "http" ? r.url : "gateway");
const bench = (r: Route) => benchedUntil.set(routeKey(r), Date.now() + BENCH_MS);
/** For tests: forget which routes were benched. */
export const resetBench = () => benchedUntil.clear();

export function outOfCredit(status: number, body: string): boolean {
  if (status === 401 || status === 402 || status === 403) return true;
  return status !== 429 && /insufficient (credit|fund|balance)|out of credit|credits? (exhausted|balance)|no credit/i.test(body);
}

/**
 * Jev is reachable three ways, and the order here is deliberate: a PAID route first, the free one last.
 * OpenRouter, then TypeSafe's own API (both billed, both at the same list price - the whole hour costs cents),
 * then the Vercel AI Gateway, which currently serves Jev at no charge and therefore has a throughput nobody has
 * promised. That is the same reasoning as the paid LLM default in ai.ts: a free tier throttling under load is
 * indistinguishable from a broken model, and finding that out mid-demo is the failure worth paying to avoid.
 * OpenRouter leads since 2026-09-25: the TypeSafe account was down to its last dollar, OpenRouter answered the same
 * pinned model faster (349 ms against 668 ms), and TypeSafe stays the fallback for an OpenRouter outage.
 * Each route names the model its own API knows, which is why a JEV_MODEL override switches the failover off: the
 * id would be wrong on every other route. `||` rather than `??` throughout: `JEV_MODEL=` with nothing after
 * it is a string, not undefined, and it would otherwise send an empty model id.
 */
export function routesFor(model?: string): Route[] {
  const want = model || process.env.JEV_MODEL || "";
  const routes: Route[] = [];
  const openrouter = process.env.OPENROUTER_API_KEY;
  // Pinned on purpose: "jev-latest" can move under the thresholds this app's decisions are tuned to.
  if (openrouter) {
    routes.push({ kind: "http", url: "https://openrouter.ai/api/alpha/decisions", key: openrouter, model: want || "typesafe/jev-1.13" });
  }
  // Both spellings: TypeSafe's own SDK reads TYPESAFE_API_KEY, the AI SDK provider TYPESAFE_AI_API_KEY.
  const typesafe = process.env.TYPESAFE_API_KEY || process.env.TYPESAFE_AI_API_KEY;
  if (typesafe) {
    routes.push({ kind: "http", url: "https://api.typesafe.ai/v1/systemone", key: typesafe, model: want || "jev-1.13.0" });
  }
  if (process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN || process.env.VERCEL) {
    routes.push({ kind: "gateway", model: want || "typesafe-ai/jev" });
  }
  // JEV_MODEL names the model in ONE route's vocabulary, so an override makes sense on the first route only.
  return want ? routes.slice(0, 1) : routes;
}

/** The route decide() tries first. Throws the same readable error decide() does when nothing is configured. */
export function routeFor(model?: string): Route {
  const [first] = routesFor(model);
  if (!first) throw notConfigured();
  return first;
}

function notConfigured(): LlmError {
  return new LlmError(
    "No decision model configured: set TYPESAFE_API_KEY or OPENROUTER_API_KEY, or run `vercel env pull .env.local`.",
    "unavailable",
  );
}

// The provider's own words, not the gateway's summary - the same rule as errors.ts, and for the same reason.
function reason(body: string, status: number): string {
  try {
    const error = JSON.parse(body)?.error;
    const text = error?.metadata?.raw ?? error?.message ?? error;
    if (typeof text === "string") return `${text.replace(/\s+/g, " ").slice(0, 300)} (HTTP ${status})`;
  } catch {
    /* not JSON: fall through to the raw body */
  }
  return `HTTP ${status}: ${body.slice(0, 200)}`;
}
