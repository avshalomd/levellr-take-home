"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ComponentProps, MouseEvent } from "react";

// Every way to a new chat goes through here. A chat started on the new-chat page only moves its address to /c/<id>
// (Chat.tsx keeps the stream alive that way), so the page underneath is still the new-chat page, and a plain
// navigation to "/" left the old conversation on screen (QA 2026-09-25/26). Then, or while still at "/", a refresh renders
// that page afresh, with a new id and an empty chat; from a real page (a saved chat, Explore) the navigation alone
// does it, and a refresh on top rendered the new chat twice. `replace` is for a delete: Back should not return to a
// deleted chat.
let movedFromNew = false;

/** Chat.tsx: this new-chat page's address was moved to /c/<id> (true), or that page is gone (false). */
export const noteAddressMoved = (moved: boolean) => {
  movedFromNew = moved;
};

// A new chat asked for from a link opens with the cursor in its question box; a first page load does not, or the
// skip link would lose its place as the first Tab stop.
let focusAsked = false;

/** Chat.tsx, as it mounts: whether it was opened by New chat (and the ask is used up). */
export const takeFocusAsk = () => {
  const asked = focusAsked;
  focusAsked = false;
  return asked;
};

export function useNewChat() {
  const router = useRouter();
  return ({ replace = false, focus = false } = {}) => {
    focusAsked = focus;
    if (replace) router.replace("/");
    else router.push("/");
    // Also when the chat is still at "/": a question the server never saved (it failed) keeps the new-chat address,
    // and a push to the same address changes nothing (review 2026-09-26).
    if (movedFromNew || window.location.pathname === "/") router.refresh();
    movedFromNew = false;
  };
}

/** A link to a new chat. A modified click (a new tab, a new window) is left to the browser. */
export function NewChatLink({ onNavigate, ...props }: Omit<ComponentProps<typeof Link>, "href"> & { onNavigate?: () => void }) {
  const newChat = useNewChat();
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    onNavigate?.();
    newChat({ focus: true });
  };
  return <Link href="/" {...props} onClick={onClick} />;
}
