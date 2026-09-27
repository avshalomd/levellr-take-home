// The chat's error line. The server writes its own errors for people (lib/llm/errors.ts); what reaches the page
// without passing through it is the browser's, and "Failed to fetch" tells the reader nothing about what to do.
// Chrome's own word for a response cut off mid-stream is a bare lowercase "network error" (QA 2026-09-26).
const DROPPED = /failed to fetch|networkerror|network error|load failed|network connection was lost/i;

/** The connection went, not the answer: the server finishes and saves an answer whoever is still listening
 *  (api/chat), so the page looks for the saved one before it offers to ask again (Chat.tsx). */
export const isDropped = (message: string | undefined) => DROPPED.test(message ?? "");

/** Said while the page looks for the answer the server saved. */
export const DROPPED_LOADING = "The connection dropped. Loading the answer…";

export function chatErrorWords(message: string | undefined): string {
  const m = (message ?? "").trim();
  if (!m) return "The answer could not be finished.";
  if (isDropped(m)) return "The connection dropped before the answer finished. Check your connection and try again.";
  // A page instead of an error (a 404 or a platform error page): its HTML reached the chat raw.
  if (/^<!doctype|<html[\s>]/i.test(m)) return "The server could not answer. Try again in a moment.";
  // A refusal the route wrote for people ({ error: "..." }, e.g. a question past the length cap) arrives as its JSON.
  if (m.startsWith("{")) {
    try {
      const said = (JSON.parse(m) as { error?: unknown }).error;
      if (typeof said === "string" && said.trim()) return said.trim();
    } catch {
      /* not JSON after all: shown as it came */
    }
  }
  return m;
}
