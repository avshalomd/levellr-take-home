import "server-only";
import { anthropic } from "@ai-sdk/anthropic";
import { createOpenAI, openai } from "@ai-sdk/openai";
import { google } from "@ai-sdk/google";
import type { LanguageModel } from "ai";

/**
 * One place that decides which LLM the app talks to.
 * Order: an explicit provider key (the one the task hands over) wins,
 * then the Vercel AI Gateway (OIDC token from `vercel env pull`, or AI_GATEWAY_API_KEY).
 * Override the model with AI_MODEL (provider-native id, or "provider/model" for the gateway).
 * AI_SIMULATE_DOWN=1 makes every model call fail, so manual QA can walk the LLM-down path
 * (restart the dev server with it set; never set it on Vercel).
 */

// Measured on 2026-09-20 over a 10-case extraction eval on OpenRouter (docs in .claude/docs/models.md):
// gpt-5.6-luna 10/10 at 2.3 s median (~$0.28 per 1000 calls), deepseek-v4.1-flash 10/10 at 4.1 s (~$0.36).
// Both are PAID slugs on purpose. A ":free" slug is retired without notice - deepseek's was, mid-morning that
// day, and every production call 404'd while local work carried on - and the free pools 429 under load, which
// reads as "the model is bad" when it is only busy. AI_MODEL / AI_MODEL_FALLBACK override either without a deploy.
const PRIMARY_OPENROUTER_MODEL = "openai/gpt-5.6-luna";
const FALLBACK_OPENROUTER_MODEL = "deepseek/deepseek-v4.1-flash";

// OpenRouter speaks the OpenAI chat-completions API, so the installed OpenAI provider covers it: no new dependency.
const openrouter = (slug: string) =>
  createOpenAI({ baseURL: "https://openrouter.ai/api/v1", apiKey: process.env.OPENROUTER_API_KEY }).chat(slug);

export function aiProvider(): "anthropic" | "openai" | "google" | "openrouter" | "gateway" | "none" {
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) return "google";
  if (process.env.OPENROUTER_API_KEY) return "openrouter";
  if (process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN || process.env.VERCEL) return "gateway";
  return "none";
}

export function getModel(): LanguageModel {
  if (process.env.AI_SIMULATE_DOWN === "1") {
    throw new Error("LLM unavailable (AI_SIMULATE_DOWN=1 is set for QA of the failure path).");
  }
  // `||`, not `??`: a bare `AI_MODEL=` line in an env file is an empty string, and it would be sent as the model id.
  const m = process.env.AI_MODEL || undefined;
  switch (aiProvider()) {
    case "anthropic":
      return anthropic(m ?? "claude-sonnet-5");
    case "openai":
      return openai(m ?? "gpt-5.4-mini");
    case "google":
      return google(m ?? "gemini-3.8-flash");
    case "openrouter":
      return openrouter(m ?? PRIMARY_OPENROUTER_MODEL);
    case "gateway":
      return m ?? "anthropic/claude-sonnet-5"; // a plain string routes through the AI Gateway
    default:
      throw new Error(
        "No LLM configured: set OPENROUTER_API_KEY (or ANTHROPIC_API_KEY / OPENAI_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY) in .env.local, or run `vercel env pull .env.local` for the AI Gateway.",
      );
  }
}

/**
 * The second model to try when the first one fails, on the same key and the same API. Only OpenRouter has one
 * here: its pools throttle and its slugs come and go, and a second model is the cheapest answer to that.
 * Returns null for a single-model provider, so its one failure state stays honest.
 * AI_MODEL_FALLBACK="" switches it off; AI_SIMULATE_DOWN=1 does too, so QA still sees the failure path.
 */
export function getFallbackModel(): LanguageModel | null {
  if (process.env.AI_SIMULATE_DOWN === "1") return null;
  if (aiProvider() !== "openrouter") return null;
  const slug = process.env.AI_MODEL_FALLBACK ?? FALLBACK_OPENROUTER_MODEL;
  if (!slug || slug === (process.env.AI_MODEL || PRIMARY_OPENROUTER_MODEL)) return null;
  return openrouter(slug);
}
