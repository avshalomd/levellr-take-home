import { describe, expect, it } from "vitest";
import { chatErrorWords } from "./error-words";

describe("chatErrorWords", () => {
  it("turns each browser's network failure into words about the connection", () => {
    // "network error": Chrome's, for a stream cut off mid-answer; it reached the page raw (QA 2026-09-26).
    for (const m of ["Failed to fetch", "NetworkError when attempting to fetch resource.", "Load failed", "network error"])
      expect(chatErrorWords(m)).toMatch(/connection dropped/);
  });
  it("keeps the server's own sentence, and has one for an empty error", () => {
    expect(chatErrorWords("The free model is busy right now. Try again in a few seconds.")).toMatch(/busy/);
    expect(chatErrorWords("")).toBe("The answer could not be finished.");
  });
  it("never shows an error page's HTML", () => {
    expect(chatErrorWords("<!DOCTYPE html><html><body>404</body></html>")).toBe("The server could not answer. Try again in a moment.");
  });
});
