// The chat's error line. The server writes its own errors for people (lib/llm/errors.ts); what reaches the page
// without passing through it is the browser's, and "Failed to fetch" tells the reader nothing about what to do.
// Chrome's own word for a response cut off mid-stream is a bare lowercase "network error" (QA 2026-09-26).
const DROPPED = /failed to fetch|networkerror|network error|load failed|network connection was lost/i;

const isDropped = (message: string | undefined) => DROPPED.test(message ?? "");

export function chatErrorWords(message: string | undefined): string {
  const m = (message ?? "").trim();
  if (!m) return "The answer could not be finished.";
  if (isDropped(m)) return "The connection dropped before the answer finished. Check your connection and try again.";
  return m;
}
