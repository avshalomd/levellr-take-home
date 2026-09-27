import { APICallError } from "ai";
import { describe, expect, it, vi } from "vitest";
import { friendly } from "./errors";

// OpenRouter puts the reason in the body, not the message (openrouter-models skill), so the tests build the real shape.
const openRouter = (raw: string) =>
  new APICallError({
    message: "Provider returned error",
    url: "https://openrouter.ai/api/v1/chat/completions",
    requestBodyValues: {},
    statusCode: 429,
    responseBody: JSON.stringify({ error: { message: "Provider returned error", metadata: { raw } } }),
  });

describe("friendly", () => {
  it("says when the daily free allowance comes back, instead of asking for a retry that cannot work", () => {
    expect(friendly(openRouter("Rate limit exceeded: free-models-per-day-high-balance. "))).toMatch(/allowance is used up/);
    expect(friendly(new Error("Rate limit exceeded: free-models-per-day"))).toMatch(/midnight UTC/);
  });

  it("keeps the short-retry message for a busy shared pool", () => {
    expect(friendly(openRouter("upstream_provider_shared_pool is busy"))).toMatch(/busy right now/);
  });

  it("shows a provider's own reason, and never our own exception text", () => {
    expect(friendly(openRouter("This model has been retired"))).toBe("The model could not answer: This model has been retired");
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(friendly(new TypeError("Cannot read properties of undefined (reading 'slice')"))).toBe("Something went wrong while answering. Try again.");
  });

  it("does not read words like 'generate' as a rate limit", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(friendly(new Error("Failed to generate an accurate answer"))).not.toMatch(/busy/);
    expect(friendly(new Error("HTTP 429 Too Many Requests"))).toMatch(/busy/);
  });
});
