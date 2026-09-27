import { APICallError, NoObjectGeneratedError, RetryError, type LanguageModel } from "ai";

// One error type for every LLM failure, with a message written for the user: the UI shows it as it is and offers
// a retry. `kind` lets the caller decide what else to do; the original error is kept as `cause` for the logs.
export class LlmError extends Error {
  constructor(
    message: string,
    readonly kind: "timeout" | "off-schema" | "unavailable",
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "LlmError";
  }
}

export function toLlmError(e: unknown, timeoutMs: number): LlmError {
  if (e instanceof LlmError) return e;
  if (isTimeout(e)) return new LlmError(`The model took too long (${timeoutMs / 1000} s). Retry.`, "timeout", { cause: e });
  if (NoObjectGeneratedError.isInstance(e)) {
    return new LlmError("The model's answer did not fit the expected format. Retry.", "off-schema", { cause: e });
  }
  const detail = providerReason(e) ?? (e instanceof Error ? e.message : String(e));
  return new LlmError(`The model call failed: ${detail}`, "unavailable", { cause: e });
}

// A gateway says "Provider returned error" and puts the reason a human needs - rate limited, parameter not
// supported, model retired - inside the body (OpenRouter: error.metadata.raw). Surfacing it turns an unreadable
// failure into a fixable one; summarising it away cost a morning of blaming models for a 429 (2026-09-20).
function providerReason(e: unknown): string | undefined {
  const err = RetryError.isInstance(e) ? e.lastError : e; // a retried call wraps the real error, reason and all
  if (!APICallError.isInstance(err) || typeof err.responseBody !== "string") return undefined;
  try {
    const body = JSON.parse(err.responseBody)?.error;
    const raw = typeof body?.metadata?.raw === "string" ? body.metadata.raw : body?.message;
    return typeof raw === "string" ? raw.replace(/\s+/g, " ").slice(0, 300) : undefined;
  } catch {
    return undefined;
  }
}

function isTimeout(e: unknown): boolean {
  // The SDK aborts with a DOMException named TimeoutError; a retried call wraps the last error in a RetryError.
  const err = RetryError.isInstance(e) ? e.lastError : e;
  const name = typeof err === "object" && err !== null && "name" in err ? err.name : undefined;
  return name === "TimeoutError" || name === "AbortError";
}

export function modelIdOf(m: LanguageModel): string {
  return typeof m === "string" ? m : m.modelId;
}

/** What the chat shows when the answer stream fails: what happened and whether retrying can help. */
export function friendly(e: unknown): string {
  const s = `${String((e as { message?: string })?.message ?? e)} ${providerReason(e) ?? ""}`;
  // OpenRouter's daily allowance for free models (it covers every :free slug on the key, the fallback too): retrying
  // in a few seconds cannot help, so say when it comes back. Seen in the 25 Sep eval run.
  if (/free-models-per-day/i.test(s)) return "Today's free model allowance is used up. It resets at midnight UTC.";
  // Whole words: a bare /rate/ also matched "generate" and "accurate" and blamed the free model for our own bugs.
  if (/\b429\b|\brate.?limit|\bcapacity\b|shared_pool/i.test(s)) return "The free model is busy right now. Try again in a few seconds.";
  if (/timeout|timed out/i.test(s)) return "That took too long. Try a narrower question.";
  // A provider's own reason (a retired model, an unsupported parameter) is worth showing; our own exception text
  // ("Cannot read properties of undefined") is not - it goes to the log.
  const reason = providerReason(e);
  if (reason) return `The model could not answer: ${reason.slice(0, 200)}`;
  console.error("chat failed", e);
  return "Something went wrong while answering. Try again.";
}
