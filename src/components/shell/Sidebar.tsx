"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { ChartNoAxesColumn, MessageCircle, Plus, Trash2 } from "lucide-react";
import { undoable } from "./undoable";
import { NewChatLink, useNewChat } from "./new-chat";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { chatIdOf, clipTitle, groupChats, type ChatSummary } from "./history";
import { chatsStore } from "./chats-store";

// The app's left rail: a new chat, the two places (Ask and Explore), and this browser's saved chats. From the reference,
// less its brand (the header above carries the name and the data's window here). The list reloads whenever a chat finishes an answer (Chat dispatches "chats:changed"), so a new conversation appears in
// it without a page load.

export const CHATS_CHANGED = "chats:changed";

const NAV = [
  { href: "/", label: "Ask", icon: MessageCircle, active: (p: string) => p === "/" || p.startsWith("/c/") },
  { href: "/explore", label: "Explore", icon: ChartNoAxesColumn, active: (p: string) => p.startsWith("/explore") },
];

const PlainLink = ({ onNavigate, ...props }: React.ComponentProps<typeof Link> & { onNavigate?: () => void }) => <Link {...props} onClick={onNavigate} />;

const spring = { type: "spring", bounce: 0, duration: 0.35 } as const;

// How long Undo is offered. 5s was too short to reach the button (reference QA: a chat was deleted for good first).
export const UNDO_MS = 10_000;

// The list itself lives in one store shared by every Sidebar (chats-store.ts): there are two, the desktop column and the
// phone drawer, and a delete in one must show in the other at once (QA 2026-09-26).
const load = () => void chatsStore.load();
const noChats = () => null;

/** `onDeleted`: the phone and tablet drawer closes once a chat is deleted from it (AppShell). */
export function Sidebar({ onNavigate, onDeleted }: { onNavigate?: () => void; onDeleted?: () => void }) {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const newChat = useNewChat();
  const chats = useSyncExternalStore(chatsStore.subscribe, chatsStore.get, noChats);
  const openId = chatIdOf(pathname);

  // Each Sidebar asks again when it mounts (the drawer mounts afresh each time it opens) and when a chat changes.
  useEffect(() => {
    load();
    window.addEventListener(CHATS_CHANGED, load);
    return () => window.removeEventListener(CHATS_CHANGED, load);
  }, []);

  // Grouped on the client, against the reader's own clock and day boundaries.
  const groups = useMemo(() => (chats ? groupChats(chats, new Date()) : []), [chats]);

  // Gone from the list at once, deleted only once the Undo window closes (undoable.ts). Deleting the chat on screen
  // opens a new one; Undo reopens it, marked in the list, unless the reader has gone somewhere else meanwhile. Focus
  // moves to the next chat's link, not its delete button, so a second Enter cannot delete a second chat (QA 2026-09-26).
  const remove = (chat: ChatSummary, from: HTMLElement) => {
    const wasOpen = openId === chat.id;
    // The next chat in the list as it stands (not a row still fading out from an earlier delete), else the one before.
    const order = (chats ?? []).filter((c) => !chatsStore.isHidden(c.id));
    const i = order.findIndex((c) => c.id === chat.id);
    const target = order[i + 1] ?? order[i - 1];
    // Looked for in this list, not the page: the desktop column is in the page, hidden, while the drawer is open.
    const next = target && (from.closest("nav") ?? document).querySelector<HTMLElement>(`a[href="/c/${target.id}"]`);
    (next ?? document.getElementById("main"))?.focus({ preventScroll: true });
    chatsStore.hide(chat.id);
    if (wasOpen) newChat({ replace: true });
    const d = undoable(async () => {
      const res = await fetch(`/api/chats/${chat.id}`, { method: "DELETE" }).catch(() => null);
      chatsStore.release(chat.id);
      if (!res?.ok) {
        toast("That chat could not be deleted. Try again in a moment.");
        load();
      }
    });
    // Named, so two deletes a moment apart leave two toasts that say which Undo brings back which chat. The hidden
    // words are read out with it (sonner's list is a polite live region): Undo is otherwise reachable by keyboard only
    // through Alt+T, which nothing said (QA 2026-09-26). Below 1024px it sits at the bottom, clear of the drawer's New
    // chat, which a top toast covered (the bottom offset in app/layout.tsx keeps it above the composer). The drawer then
    // closes: bottom-centre, the toast still covered it at 768px (x206-562 over a drawer to x300) and at 375px (QA
    // 2026-09-26), and beside it there is no room on a phone. Focus goes to the menu button (onDeleted); the toast's
    // spoken words say how to reach Undo from there.
    const title = (
      <>
        Deleted “{clipTitle(chat.title)}”<span className="sr-only">. To undo, press Alt+T, then Tab to the Undo button.</span>
      </>
    );
    toast(title, {
      duration: UNDO_MS,
      position: window.matchMedia("(min-width: 1024px)").matches ? "top-center" : "bottom-center",
      action: {
        label: "Undo",
        onClick: () => {
          d.undo();
          chatsStore.release(chat.id);
          load();
          if (wasOpen && window.location.pathname === "/") router.push(`/c/${chat.id}`);
        },
      },
      onAutoClose: d.settle,
      onDismiss: d.settle,
    });
    onDeleted?.();
  };

  return (
    <nav aria-label="App" className="flex h-full w-full flex-col px-3 pt-3 pb-3 lg:pt-1">
      {/* Short of the drawer's close button in its top-right corner, below 1024px. */}
      <NewChatLink
        onNavigate={onNavigate}
        data-first-focus
        className="pressable mr-11 flex items-center gap-2 rounded-xl border border-foreground/[0.08] bg-background px-3 py-2 text-[14px] font-medium shadow-[0_1px_2px_rgb(0_0_0/0.04)] hover:border-foreground/15 lg:mr-0"
      >
        <Plus className="size-4 text-pulse" strokeWidth={2.25} />
        New chat
      </NewChatLink>

      <ul className="mt-4 space-y-0.5">
        {NAV.map(({ href, label, icon: Icon, active }) => {
          const on = active(pathname);
          const Item = href === "/" ? NewChatLink : PlainLink;
          return (
            <li key={href}>
              <Item
                href={href}
                onNavigate={onNavigate}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[14px] transition-colors",
                  on ? "bg-foreground/[0.06] font-medium text-foreground" : "text-foreground/70 hover:bg-foreground/[0.04] hover:text-foreground",
                )}
              >
                <Icon className={cn("size-4", on ? "text-pulse" : "text-muted-foreground")} />
                {label}
              </Item>
            </li>
          );
        })}
      </ul>

      <div className="-mx-3 mt-6 min-h-0 flex-1 overflow-y-auto px-3 [scrollbar-width:thin]">
        {chats === null ? (
          <div className="space-y-2 px-2.5 pt-1" aria-hidden>
            {[70, 55, 80].map((w) => (
              <div key={w} className="h-3.5 animate-pulse rounded bg-foreground/[0.06]" style={{ width: `${w}%` }} />
            ))}
          </div>
        ) : groups.length === 0 ? (
          <p className="px-2.5 text-[13px] leading-relaxed text-muted-foreground">Your questions and their answers will be kept here.</p>
        ) : (
          groups.map((g) => (
            <section key={g.label} className="mb-4">
              <h2 className="px-2.5 pb-1 text-[12px] font-medium text-muted-foreground">{g.label}</h2>
              <ul>
                <AnimatePresence initial={false}>
                  {g.chats.map((c) => (
                    // The row clips only while its height animates, in or out. Clipped at rest, it cut off the
                    // link's focus ring and the delete button's (QA 2026-09-26).
                    <motion.li
                      key={c.id}
                      layout="position"
                      initial={{ opacity: 0, height: 0, overflow: "hidden" }}
                      animate={{ opacity: 1, height: "auto", transitionEnd: { overflow: "visible" } }}
                      exit={{ opacity: 0, height: 0, overflow: "hidden" }}
                      transition={spring}
                      className="group relative"
                    >
                      <Link
                        href={`/c/${c.id}`}
                        prefetch={false}
                        onClick={onNavigate}
                        aria-current={openId === c.id ? "page" : undefined}
                        title={c.title}
                        className={cn(
                          "block truncate rounded-lg py-1.5 pr-9 pl-2.5 text-[14px] leading-5 transition-colors",
                          openId === c.id ? "bg-foreground/[0.07] font-medium text-foreground" : "text-foreground/75 hover:bg-foreground/[0.04] hover:text-foreground",
                        )}
                      >
                        {c.title}
                      </Link>
                      <button
                        type="button"
                        onClick={(e) => remove(c, e.currentTarget)}
                        aria-label={`Delete the chat “${c.title}”`}
                        title="Delete this chat"
                        className="absolute top-1/2 right-1 grid size-7 -translate-y-1/2 place-items-center rounded-md text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-foreground/[0.06] hover:text-foreground focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            </section>
          ))
        )}
      </div>

      <p className="px-2.5 pt-3 text-[12px] leading-relaxed text-muted-foreground">
        Your chats are kept for this browser, with no sign-in. Another browser or device starts its own list.
      </p>
    </nav>
  );
}
