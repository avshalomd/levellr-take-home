import type { ModelMessage } from "ai";
import { describe, expect, it } from "vitest";
import { chatToolSteps, flattenForAnswer, retrievedRefs, toolsRan } from "./agent";

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

// QA 2026-09-27: a follow-up's claims are checked against every message any turn's tools showed, read from the UI
// messages the chat sends with the question.
describe("chatToolSteps", () => {
  const chat = [
    { parts: [{ type: "text", text: "What are people saying about Domains?" }] },
    {
      parts: [
        { type: "tool-scan", state: "output-available", output: { status: "ok", hits: [{ quote: "[msg11570] screen goes gray" }] } },
        { type: "tool-find", state: "input-available", input: { query: "boss" } },
        { type: "tool-read_conversation", state: "output-available", output: { messages: [{ ref: 10114, reply_to: null }] } },
        { type: "tool-aggregate", state: "output-available", output: { status: "refused", reason: "too broad" } },
        { type: "text", text: "People say [msg11570]." },
      ],
    },
    { parts: [{ type: "text", text: "which of those are bugs?" }] },
  ];

  it("reads every earlier turn's tool results, and no call that has no result", () => {
    const steps = chatToolSteps(chat);
    expect(steps.flatMap((s) => s.content.map((p) => p.toolName))).toEqual(["scan", "read_conversation", "aggregate"]);
    expect([...retrievedRefs(steps)].sort()).toEqual(["msg10114", "msg11570"]);
  });

  it("counts a tool as run only when it gave a result, not a refusal", () => {
    const ran = toolsRan(chatToolSteps(chat));
    expect(ran.has("scan")).toBe(true);
    expect(ran.has("find")).toBe(false);
  });
});
