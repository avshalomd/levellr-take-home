// The chat's error line. The server writes its own errors for people (lib/llm/errors.ts); what reaches the page
// without passing through it is the browser's, and "Failed to fetch" tells the reader nothing about what to do.
// Chrome's own word for a response cut off mid-stream is a bare lowercase "network error" (QA 2026-09-26).
const DROPPED = /failed to fetch|networkerror|network error|load failed|network connection was lost/i;

/** The connection went, not the answer: the server finishes and saves an answer whoever is still listening
 *  (api/chat), so the page looks for the saved one before it offers to ask again (Chat.tsx). */
export const isDropped = (message: string | undefined) => DROPPED.test(message ?? "");

/** Said while the page looks for the answer the server saved. */
export const DROPPED_LOADING = "The connection dropped. Loading the answer…";

// The platform's refusal of a request past its size limit (4.5 MB on Vercel): the chat is sent whole with each
// question, and a long chat of answers from the data could reach it (QA P18). Sending it again cannot help.
const TOO_BIG = /FUNCTION_PAYLOAD_TOO_LARGE|request entity too large/i;

// When the free model's daily allowance is spent, retrying in a moment cannot help (api/chat, lib/llm/errors.ts).
const OUT_OF_ALLOWANCE = /allowance is used up/i;

/** A refusal the route wrote for people ({ error: "..." }): the request is wrong as it stands, so sending it again gets
 *  the same answer. A question past the length cap (QA P11) is put back in the box to shorten instead (Chat.tsx). */
const refusalOf = (m: string): string | undefined => {
  if (!m.startsWith("{")) return undefined;
  try {
    const said = (JSON.parse(m) as { error?: unknown }).error;
    return typeof said === "string" && said.trim() ? said.trim() : undefined;
  } catch {
    return undefined;
  }
};

export function chatErrorWords(message: string | undefined): string {
  const m = (message ?? "").trim();
  if (!m) return "The answer could not be finished.";
  if (isDropped(m)) return "The connection dropped before the answer finished. Check your connection and try again.";
  if (TOO_BIG.test(m)) return "This chat has grown too long to send. Start a new chat to ask more.";
  // A page instead of an error (a 404 or a platform error page): its HTML reached the chat raw.
  if (/^<!doctype|<html[\s>]/i.test(m)) return "The server could not answer. Try again in a moment.";
  // A refusal the route wrote arrives as its JSON; anything else that is not JSON after all is shown as it came.
  return refusalOf(m) ?? m;
}

/**
 * What the error line offers: to send the question again, to start a new chat, or nothing. Only what sending again
 * could change is retried. QA P18: a refusal the model gives for the chat's shape comes back the same however often it
 * is sent, and "Try again" failed the same way for ever, so a retry that fails with the same words offers a new chat
 * instead. `retried`: the words of the error the last "Try again" was pressed on.
 */
export function errorAction(message: string | undefined, retried?: string | null): "retry" | "new-chat" | null {
  const m = (message ?? "").trim();
  if (OUT_OF_ALLOWANCE.test(m) || refusalOf(m)) return null;
  if (TOO_BIG.test(m) || (retried != null && retried === message)) return "new-chat";
  return "retry";
}
