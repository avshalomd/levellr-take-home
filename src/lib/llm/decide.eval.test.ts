// Proves the decision model answers through every route that has a key, and that this file's translation of each
// dialect holds against the real thing. Skipped unless EVAL=1, like templates.eval.test.ts, so neither
// `npm run check` nor `npm run test:int` ever depends on a provider's good minute. Run:
//   EVAL=1 npx dotenv -e .env.local -- npx vitest run src/lib/llm/decide.eval.test.ts
// A fraction of a cent per route, and worth running once before relying on decide(): the legend a gateway score
// comes back WITHOUT was found here, and no amount of mocking would have shown it.
import { describe, expect, it } from "vitest";
import { choice, decide, isConfident, levelOf, noul, score, type Route } from "./decide";

const routes: Record<string, Route | undefined> = {
  typesafe: process.env.TYPESAFE_API_KEY
    ? { kind: "http", url: "https://api.typesafe.ai/v1/systemone", key: process.env.TYPESAFE_API_KEY, model: "jev-1.13.0" }
    : undefined,
  openrouter: process.env.OPENROUTER_API_KEY
    ? { kind: "http", url: "https://openrouter.ai/api/alpha/decisions", key: process.env.OPENROUTER_API_KEY, model: "typesafe/jev-1.13" }
    : undefined,
  gateway: process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN ? { kind: "gateway", model: "typesafe-ai/jev" } : undefined,
};

// One state with a fact for each question type, and one trap: a percentage that is not a price, and a product
// that is explicitly unchanged. A route that "works" but reads the trap wrongly is not working.
const state =
  "Our roaster raised green bean costs, so espresso blend goes to 14.20/kg from 1 November - about 5% up. " +
  "Decaf is unchanged. We need the signed addendum back before the 25th or the old rate lapses.";

const questions = {
  needsHuman: noul("This message requires a person to act before a stated deadline."),
  kind: choice("What is this message mainly about?", {
    price_change: "a supplier is changing prices",
    invoice_dispute: "a disagreement about an invoice",
    other: "none of these",
  }),
  urgency: score("How urgent is this for the buyer?", ["not urgent", "this week", "today"]),
};

describe.skipIf(process.env.EVAL !== "1")("decide() against the live model", () => {
  // No pinned route: whatever routesFor() picks from the environment, which is the path the app itself takes.
  it("answers through the default routing", async () => {
    const { answers } = await decide({ state, questions });
    expect(answers.kind.choice).toBe("price_change");
  }, 30_000);

  for (const [name, route] of Object.entries(routes)) {
    it.skipIf(!route)(`${name} answers, and every answer arrives in this file's shape`, async () => {
      const { answers, modelId, usage } = await decide({ state, questions, route });
      expect(answers.kind.choice).toBe("price_change");
      expect(isConfident(answers.kind)).toBe(true);
      expect(answers.needsHuman.noul).toBeGreaterThan(0.8);
      expect(levelOf(answers.urgency)).toBe("this week"); // the legend has to survive the route's dialect
      expect(usage.inputTokens).toBeGreaterThan(0);
      expect(modelId).toBeTruthy();
    }, 30_000);
  }
});
