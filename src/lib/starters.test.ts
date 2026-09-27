import { describe, expect, it } from "vitest";
import { inSentence, starterQuestions, topicQuestion } from "./starters";

describe("starter questions", () => {
  it("are the brief's three example questions", () => {
    expect(starterQuestions()).toEqual([
      "What have players been frustrated about in the last few days?",
      "What are people most excited about right now?",
      "What should we post about this week?",
    ]);
  });
});

// QA Q5: a topic chip asked about "ebontide and new quests"; the question is also the chat's title.
describe("a topic chip's question", () => {
  it("keeps a proper noun's capitals", () => {
    expect(topicQuestion("Ebontide and new quests")).toBe("What are people saying about Ebontide and new quests?");
    expect(topicQuestion("Tides Remastered")).toBe("What are people saying about Tides Remastered?");
    expect(topicQuestion("Domains")).toBe("What are people saying about Domains?");
    expect(topicQuestion("Bushido final update")).toBe("What are people saying about Bushido final update?");
    expect(topicQuestion("RPG-era games")).toBe("What are people saying about RPG-era games?");
  });

  it("lower-cases a leading common word only", () => {
    expect(topicQuestion("Pricing, editions and monetisation")).toBe(
      "What are people saying about pricing, editions and monetisation?",
    );
    expect(topicQuestion("Other games")).toBe("What are people saying about other games?");
    expect(inSentence("Lore and story")).toBe("lore and story");
  });
});

describe("a Title Case topic name", () => {
  it("drops the capitals of its common words and keeps a name's", () => {
    expect(inSentence("Performance & Bugs")).toBe("performance & bugs");
    expect(inSentence("Tides Remastered")).toBe("Tides Remastered");
  });
});
