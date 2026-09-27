import { describe, expect, it } from "vitest";
import { chatErrorWords, errorAction, isDropped } from "./error-words";

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

describe("isDropped", () => {
  it("is a lost connection, never an error the server wrote", () => {
    expect(isDropped("network error")).toBe(true);
    expect(isDropped("Failed to fetch")).toBe(true);
    expect(isDropped("The free model is busy right now. Try again in a few seconds.")).toBe(false);
    expect(isDropped(undefined)).toBe(false);
  });
});

describe("a refusal the route wrote", () => {
  it("shows its line, not its JSON (QA Q6)", () => {
    expect(chatErrorWords('{"error":"That question is 5,000 characters long. Keep it under 2,000 and ask again."}')).toBe(
      "That question is 5,000 characters long. Keep it under 2,000 and ask again.",
    );
    expect(chatErrorWords("{not json")).toBe("{not json");
  });
});

describe("a chat too long to send", () => {
  it("says so, not the platform's page (QA P18)", () => {
    expect(chatErrorWords("Request Entity Too Large\n\nFUNCTION_PAYLOAD_TOO_LARGE\n\nfra1::abc")).toBe(
      "This chat has grown too long to send. Start a new chat to ask more.",
    );
  });
});

describe("errorAction", () => {
  const refused = "The model could not answer this turn. Try again, or start a new chat.";
  it("offers a retry once, then a new chat when the retry failed the same way (QA P18)", () => {
    expect(errorAction(refused)).toBe("retry");
    expect(errorAction(refused, refused)).toBe("new-chat");
    expect(errorAction("The free model is busy right now. Try again in a few seconds.", refused)).toBe("retry");
  });
  it("offers nothing for a refusal the route wrote: the question goes back in the box (QA P11)", () => {
    expect(errorAction('{"error":"That question is 2,519 characters long. Keep it under 2,000 and ask again."}')).toBeNull();
  });
  it("offers nothing when the day's allowance is spent, and a new chat when the chat is too long to send", () => {
    expect(errorAction("Today's free model allowance is used up. It resets at midnight UTC.")).toBeNull();
    expect(errorAction("Request Entity Too Large FUNCTION_PAYLOAD_TOO_LARGE")).toBe("new-chat");
  });
});
