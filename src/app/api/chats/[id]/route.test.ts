import { beforeEach, describe, expect, it, vi } from "vitest";

// The Stop save: the chat as the reader's screen shows it. Bad input never reaches the database, and a request with no
// owner cookie is refused rather than written under nobody.
const owner = vi.hoisted(() => ({ id: "o" as string | null }));
vi.mock("@/lib/owner", () => ({ ownerId: vi.fn(async () => owner.id) }));
vi.mock("@/lib/data/chats", () => ({ keepChat: vi.fn(), getChat: vi.fn(), deleteChat: vi.fn() }));

import { keepChat } from "@/lib/data/chats";
import { PUT } from "./route";

const put = (body: unknown) =>
  PUT(new Request("http://x/api/chats/c1", { method: "PUT", body: typeof body === "string" ? body : JSON.stringify(body) }), {
    params: Promise.resolve({ id: "c1" }),
  } as never);
const message = { id: "q1", role: "user", parts: [{ type: "text", text: "Hi" }] };

describe("PUT /api/chats/:id", () => {
  beforeEach(() => {
    owner.id = "o";
    vi.mocked(keepChat).mockReset();
  });

  it("keeps the messages it was sent, under the reader's own owner", async () => {
    const res = await put({ messages: [message] });
    expect(res.status).toBe(204);
    expect(keepChat).toHaveBeenCalledWith("c1", "o", [message]);
  });

  it("refuses a body that is not a message list", async () => {
    for (const bad of ["not json", {}, { messages: [{ id: "x", role: "robot", parts: [] }] }, { messages: Array(201).fill(message) }]) {
      expect((await put(bad)).status).toBe(400);
    }
    expect(keepChat).not.toHaveBeenCalled();
  });

  it("refuses a request with no owner", async () => {
    owner.id = null;
    expect((await put({ messages: [message] })).status).toBe(401);
    expect(keepChat).not.toHaveBeenCalled();
  });
});
