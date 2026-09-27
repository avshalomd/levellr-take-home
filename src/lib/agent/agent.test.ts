import type { ModelMessage } from "ai";
import { describe, expect, it } from "vitest";
import { flattenForAnswer } from "./agent";

// The forced last step: a history of tool calls becomes one plain brief, so no model has a tool call to imitate.
describe("flattenForAnswer", () => {
  const history: ModelMessage[] = [
    { role: "system", content: "instructions" },
    { role: "user", content: "Why did Krafton shut down the EU servers?" },
    {
      role: "assistant",
      content: [
        { type: "tool-call", toolCallId: "c1", toolName: "find", input: { query: "EU server shutdown" } },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "c1",
          toolName: "find",
          output: { type: "text", value: "3 conversations: maintenance notice [t3_a]" },
        },
      ],
    },
  ];

  it("returns a single user message with no tool-call parts", () => {
    const out = flattenForAnswer(history);
    expect(out).toHaveLength(1);
    expect(out[0].role).toBe("user");
    expect(typeof out[0].content).toBe("string");
  });

  it("keeps the question, what was looked up and what came back, and drops the system prompt", () => {
    const text = flattenForAnswer(history)[0].content as string;
    expect(text).toContain("QUESTION: Why did Krafton shut down the EU servers?");
    expect(text).toContain('LOOKED UP (find): {"query":"EU server shutdown"}');
    expect(text).toContain("RESULT (find):\n3 conversations: maintenance notice [t3_a]");
    expect(text).not.toContain("instructions");
  });
});
