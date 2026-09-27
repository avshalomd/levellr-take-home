import { describe, expect, it } from "vitest";
import { QUESTION_MAX, questionLength, tooLongWords } from "./question-limit";

// QA Q6: no cap on a question's length, so a pasted document would have gone to Gemini on the capped key.
describe("a question's length", () => {
  it("counts the text parts only", () => {
    expect(questionLength({ parts: [{ type: "text", text: "abc" }, { type: "step-start" }, { type: "text", text: "de" }] })).toBe(5);
    expect(questionLength(undefined)).toBe(0);
  });

  it("says in one line how long it was and what the cap is", () => {
    expect(QUESTION_MAX).toBe(2_000);
    expect(tooLongWords(100_000)).toBe("That question is 100,000 characters long. Keep it under 2,000 and ask again.");
  });
});
