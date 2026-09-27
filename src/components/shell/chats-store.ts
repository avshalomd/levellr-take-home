// This browser's saved chats, one list for every Sidebar. There are two Sidebars (the desktop column and the phone
// drawer), and each kept its own copy: a chat deleted from the drawer at 375px stayed listed in the desktop column after
// widening to 1024px, and opening it said "This chat is not here" (QA 2026-09-26). Both now read this store through
// useSyncExternalStore. Kept free of React so it is unit-tested (chats-store.test.ts).

import type { ChatSummary } from "./history";

type Fetcher = (url: string) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

export function createChatsStore(fetcher: Fetcher = (url) => fetch(url)) {
  let chats: ChatSummary[] | null = null; // null until the first load answers
  const listeners = new Set<() => void>();
  // Deleted on screen, not yet on the server (the Undo window): a reload of the list must not bring them back.
  const pending = new Set<string>();

  const set = (next: ChatSummary[] | null) => {
    chats = next;
    for (const l of listeners) l();
  };

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    get: () => chats,
    /** Asks the server again. A chat deleted in the meantime stays out, whenever the answer lands. */
    async load() {
      try {
        const res = await fetcher("/api/chats");
        const cs = res.ok ? ((await res.json()) as ChatSummary[]) : [];
        set(cs.filter((c) => !pending.has(c.id)));
      } catch {
        set(chats ?? []);
      }
    },
    /** Gone from every list at once; the server delete follows when the Undo window closes. */
    hide(id: string) {
      pending.add(id);
      if (chats) set(chats.filter((c) => c.id !== id));
    },
    /** The Undo window is over (deleted on the server) or Undo was pressed: the next load decides. */
    release(id: string) {
      pending.delete(id);
    },
    isHidden: (id: string) => pending.has(id),
  };
}

export type ChatsStore = ReturnType<typeof createChatsStore>;

/** The page's one store. */
export const chatsStore = createChatsStore();
