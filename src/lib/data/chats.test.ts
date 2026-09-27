import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@/lib/agent/ui-types";
import { titleOf } from "./chats";

const q = (id: string, text: string) => ({ id, role: "user", parts: [{ type: "text", text }] }) as ChatMessage;
const declined = (id: string) => ({ id, role: "assistant", parts: [{ type: "text", text: "I can only answer about this Discord." }] }) as ChatMessage;
const fromData = (id: string) =>
  ({ id, role: "assistant", parts: [{ type: "tool-find", toolCallId: "t1", state: "output-available", input: {}, output: { hits: [] } }, { type: "text", text: "Mostly angry." }] }) as unknown as ChatMessage;

// QA 2026-09-26: a chat opened with an off-topic question kept it as its name after a real question was answered.
describe("titleOf", () => {
  it("names the chat after the first question answered from the data", () => {
    const chat = [q("u1", "What's a good pizza place in Oslo?"), declined("a1"), q("u2", "How do players feel about the anti-cheat?"), fromData("a2")];
    expect(titleOf(chat)).toBe("How do players feel about the anti-cheat?");
  });
  it("keeps the first question until one is answered from the data, and keeps that one after", () => {
    expect(titleOf([q("u1", "What's a good pizza place in Oslo?"), declined("a1")])).toBe("What's a good pizza place in Oslo?");
    expect(titleOf([q("u1", "What's a good pizza place in Oslo?"), declined("a1"), q("u2", "And in Bergen?")])).toBe("What's a good pizza place in Oslo?");
    const settled = [q("u1", "How do players feel about the anti-cheat?"), fromData("a1"), q("u2", "Which maps do people like?"), fromData("a2")];
    expect(titleOf(settled)).toBe("How do players feel about the anti-cheat?");
    expect(titleOf([])).toBe("New chat");
  });
  // Review 2026-09-26: any tool part counted, so a look at what the data covers, or a failed one named
  // the chat after a question never answered from the data.
  it("counts only a finished read of the data as an answer from it", () => {
    const answeredWith = (id: string, part: object) => ({ id, role: "assistant", parts: [part, { type: "text", text: "…" }] }) as unknown as ChatMessage;
    const overview = { type: "tool-dataset_overview", toolCallId: "t1", state: "output-available", input: {}, output: { community: "x" } };
    const failed = { type: "tool-scan", toolCallId: "t1", state: "output-error", input: {}, errorText: "Something went wrong while answering. Try again." };
    const running = { type: "tool-aggregate", toolCallId: "t1", state: "input-available", input: {} };
    const missing = { type: "tool-read_conversation", toolCallId: "t1", state: "output-available", input: { id: "conv9" }, output: null };
    for (const part of [overview, failed, running, missing])
      expect(titleOf([q("u1", "What's a good pizza place in Oslo?"), answeredWith("a1", part), q("u2", "Which maps do people like?"), fromData("a2")]), JSON.stringify(part)).toBe(
        "Which maps do people like?",
      );
  });
  it("still cuts a long question at a word", () => {
    const long = "How do players on the European servers feel about the new anti-cheat system since the last update?";
    expect(titleOf([q("u1", long)])).toMatch(/^How do players on the European servers feel about the new…$/);
  });
});
