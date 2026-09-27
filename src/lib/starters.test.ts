import { describe, expect, it } from "vitest";
import { starterQuestions } from "./starters";

describe("starter questions", () => {
  it("are the brief's three example questions", () => {
    expect(starterQuestions()).toEqual([
      "What have players been frustrated about in the last few days?",
      "What are people most excited about right now?",
      "What should we post about this week?",
    ]);
  });
});
