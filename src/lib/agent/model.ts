import "server-only";
import { wrapLanguageModel, type LanguageModel } from "ai";
import { google } from "@ai-sdk/google";
import { aiProvider, getFallbackModel, getModel } from "@/lib/ai";

/**
 * The chat model, with the fallback wired in at the call level: if the primary free model refuses the call
 * (429 from a busy shared pool, a retired slug), the same call goes to the fallback. A failure after the stream
 * has started is not retried - by then the user has seen tokens, and a silent switch would splice two answers.
 */
export function chatModel(): LanguageModel {
  const primary = getModel();
  const fallback = getFallbackModel();
  if (!fallback || typeof primary === "string" || typeof fallback === "string") return primary;
  return wrapLanguageModel({
    model: primary as Parameters<typeof wrapLanguageModel>[0]["model"],
    middleware: {
      wrapStream: async ({ doStream, params }) => {
        try {
          return await doStream();
        } catch {
          return (fallback as Parameters<typeof wrapLanguageModel>[0]["model"] & { doStream: typeof doStream }).doStream(
            params as never,
          );
        }
      },
      wrapGenerate: async ({ doGenerate, params }) => {
        try {
          return await doGenerate();
        } catch {
          return (fallback as { doGenerate: (p: unknown) => ReturnType<typeof doGenerate> }).doGenerate(params);
        }
      },
    },
  });
}

/**
 * The model for the forced last step, where the agent must answer without tools. The primary free model, handed a
 * history full of tool calls and no tools, keeps writing tool-call markup as its answer (F02, twice); a different
 * model reads the same history and writes prose. Falls back to the chat model when no fallback is configured.
 */
export function answerModel(): LanguageModel {
  return getFallbackModel() ?? chatModel();
}

/**
 * The model for text work after the answer: rewriting a weak claim once, and adding citations to an answer that has
 * none (revise.ts). On the brief's Gemini key that is Flash-Lite, so the agent's Flash quota goes to answers only
 * (TEXT_MODEL overrides it); on any other provider, the answer model.
 */
export function textModel(): LanguageModel {
  if (process.env.AI_SIMULATE_DOWN !== "1" && aiProvider() === "google") return google(process.env.TEXT_MODEL || "gemini-3.5-flash-lite");
  return answerModel();
}
