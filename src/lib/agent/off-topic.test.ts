import { describe, expect, it } from "vitest";
import { isOffTopic, offTopicReply, spanInWords } from "./off-topic";

// QA 2026-09-26, round 5: "What's the weather in Oslo?" got only "I can't access live weather data.", while a pizza
// question got the conversations' scope and questions to ask. Every off-topic reply is now one form, written in code.
const pubg = { community: "r/PUBATTLEGROUNDS", from: "2026-06-18", to: "2026-09-24" };
const topics = [
  { key: "other", name: "Other", n: 5000 },
  { key: "cheating-bans", name: "Cheating & Bans", n: 1200 },
  { key: "performance-access", name: "Performance & Access", n: 900 },
];

describe("offTopicReply", () => {
  // QA 2026-09-26, production: the reply says plainly it cannot answer, and what it knows, from the dataset's own name
  // and dates; it no longer repeats the model's words for the question.
  it("says it can't answer, what it knows, and offers three questions, for the weather and for pizza alike", () => {
    expect(offTopicReply(pubg, topics)).toBe(
      "I can't answer that. I only know what r/PUBATTLEGROUNDS talked about from 18 June to 24 September 2026. You could ask:\n\n" +
        "- What are people saying about cheating & bans lately?\n- What are people asking for most?\n- Who are the most active voices in the community?",
    );
  });
  it("is built from the loaded dataset, never hard-coded", () => {
    expect(offTopicReply({ community: "the Levellr Discord", from: "2025-12-18", to: "2026-01-24" })).toMatch(
      /^I can't answer that\. I only know what the Levellr Discord talked about from 18 December 2025 to 24 January 2026\. You could ask:/,
    );
    expect(offTopicReply({ community: "the community", from: "", to: "" })).toMatch(/^I can't answer that\. I only know what the community talked about\. You could ask:/);
  });
  it("offers questions even with no topics known", () => {
    expect(offTopicReply(pubg).split("\n").filter((l) => l.startsWith("- "))).toEqual(["- What are people asking for most?", "- Who are the most active voices in the community?", "- Which problems are reported most often?"]);
  });
});

describe("its pieces", () => {
  it("writes the span in words, the year once when both dates share it", () => {
    expect(spanInWords("2026-06-18", "2026-09-24")).toBe("from 18 June to 24 September 2026");
    expect(spanInWords("2025-12-18", "2026-01-24")).toBe("from 18 December 2025 to 24 January 2026");
    expect(spanInWords("", "2026-01-24")).toBe("");
  });
  it("recognises the reply's tool result", () => {
    expect(isOffTopic({ status: "off-topic", text: "t" })).toBe(true);
    expect(isOffTopic({ status: "ok" })).toBe(false);
  });
});
