import { describe, expect, it, vi } from "vitest";
import { createChatsStore } from "./chats-store";

const chat = (id: string) => ({ id, title: `Chat ${id}`, updated_at: "2026-09-26T08:00:00Z" });
const answering = (list: object[]) => async () => ({ ok: true, json: async () => list });

// QA 2026-09-26: a chat deleted from the phone drawer stayed listed in the desktop column, because each Sidebar kept its
// own list. Both read one store now.
describe("chatsStore", () => {
  it("gives every reader the same list, and a delete reaches all of them at once", async () => {
    const store = createChatsStore(answering([chat("a"), chat("b")]));
    const drawer = vi.fn();
    const column = vi.fn();
    store.subscribe(drawer);
    store.subscribe(column);
    await store.load();
    store.hide("a");
    expect(store.get()?.map((c) => c.id)).toEqual(["b"]);
    expect(drawer).toHaveBeenCalledTimes(2);
    expect(column).toHaveBeenCalledTimes(2);
  });

  it("keeps a deleted chat out of a reload that answers during the Undo window", async () => {
    const store = createChatsStore(answering([chat("a"), chat("b")]));
    await store.load();
    store.hide("a");
    await store.load(); // the server still has it: the delete waits for the Undo window
    expect(store.get()?.map((c) => c.id)).toEqual(["b"]);
    store.release("a"); // Undo
    await store.load();
    expect(store.get()?.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("stops telling a reader that has gone", async () => {
    const store = createChatsStore(answering([chat("a")]));
    const l = vi.fn();
    const off = store.subscribe(l);
    off();
    await store.load();
    expect(l).not.toHaveBeenCalled();
  });

  it("shows an empty list, not a skeleton for ever, when the server cannot be reached", async () => {
    const store = createChatsStore(async () => {
      throw new Error("offline");
    });
    await store.load();
    expect(store.get()).toEqual([]);
  });
});
