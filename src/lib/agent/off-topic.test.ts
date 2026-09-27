import { describe, expect, it } from "vitest";
import { isOffTopic, offTopicReply, spanInWords } from "./off-topic";

// QA 2026-09-26, round 5: "What's the weather in Oslo?" got only "I can't access live weather data.", while a pizza
// question got the conversations' scope and questions to ask. Every off-topic reply is now one form, written in code.
const veil = { community: "Veil of Ages Discord", from: "2026-09-13", to: "2026-09-27" };

describe("offTopicReply", () => {
  it("says it can't answer, what it knows, and offers the brief's three questions", () => {
    expect(offTopicReply(veil)).toBe(
      "I can't answer that. I only know what Veil of Ages Discord talked about from 13 September to 27 September 2026. You could ask:\n\n" +
        "- What have players been frustrated about in the last few days?\n- What are people most excited about right now?\n- What should we post about this week?",
    );
  });
  it("is built from the loaded dataset, never hard-coded", () => {
    expect(offTopicReply({ community: "the Levellr Discord", from: "2025-12-18", to: "2026-01-24" })).toMatch(
      /^I can't answer that\. I only know what the Levellr Discord talked about from 18 December 2025 to 24 January 2026\. You could ask:/,
    );
    expect(offTopicReply({ community: "the community", from: "", to: "" })).toMatch(
      /^I can't answer that\. I only know what the community talked about\. You could ask:/,
    );
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
