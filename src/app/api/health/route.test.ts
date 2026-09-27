import { describe, expect, it, vi } from "vitest";
import { apiError, failingModel, scriptedModel } from "@/lib/llm/test-models";

// The deep check exists so "configured" is never mistaken for "usable" - and when the model is NOT usable, the
// reason has to be the provider's own words. No database and no network here: both modules are replaced.
const model = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/db", () => ({ db: { execute: async () => [] }, dbConfigured: true }));
vi.mock("@/lib/ai", () => ({ aiProvider: () => "openrouter", getModel: () => model.current }));

import { GET } from "./route";

describe("GET /api/health", () => {
  it("does not call the model unless deep=1", async () => {
    model.current = failingModel([new Error("must not be called")]);
    const body = await (await GET(new Request("http://x/api/health"))).json();
    expect(body).toMatchObject({ ok: true, database: "up", ai: { provider: "openrouter" } });
    expect(body.ai.usable).toBeUndefined();
  });

  it("reports a usable model on deep=1", async () => {
    model.current = scriptedModel(["ok"]);
    const body = await (await GET(new Request("http://x/api/health?deep=1"))).json();
    expect(body.ai.usable).toBe(true);
  });

  it("names the provider's reason when the model is down, not the gateway's summary", async () => {
    const retired = { error: { message: "Provider returned error", metadata: { raw: "This model is unavailable for free" } } };
    model.current = failingModel([apiError(404, retired)]);
    const res = await GET(new Request("http://x/api/health?deep=1"));
    const body = await res.json();
    expect(res.status).toBe(200); // the database is up: a dead model is a warning for deploy.sh, not a failed deploy
    expect(body.ai.usable).toBe(false);
    expect(body.ai.error).toMatch(/unavailable for free/);
    expect(body.ai.error).not.toMatch(/Provider returned error/);
  });
});
