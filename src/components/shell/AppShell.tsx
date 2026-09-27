"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { Menu, SquarePen, X } from "lucide-react";
import { APP_NAME } from "@/lib/app";
import { focusablesIn, precedesInPage, wrapTarget } from "@/components/evidence/panel-focus";
import { Sidebar } from "./Sidebar";
import { ThemeToggle } from "./ThemeToggle";
import { NewChatLink } from "./new-chat";

// The frame around the page: a title bar on the paper ground (the product name, the community and window the data
// covers, the theme toggle), the saved chats in a column on its left, and the chat on a white sheet set into it. Below
// 1024px the sidebar becomes a drawer behind a menu button, and slides back out the
// way it came in. The title bar stays at every width.
//
// MotionConfig reducedMotion="user": with the system's reduce-motion setting on, every spring in the app becomes an
// instant change of position while opacity still fades, so nothing slides but nothing pops either.

/** Which data the app answers from, under the product name. */
export const APP_SUBTITLE = "Veil of Ages Discord · 13–27 Sep 2026";

const spring = { type: "spring", bounce: 0, duration: 0.4 } as const;

export function AppShell({ children }: { children: ReactNode }) {
  const [drawer, setDrawer] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const drawerBox = useRef<HTMLElement>(null);

  // The drawer is a dialog: opening it moves focus to New chat and Tab stays inside it; closing it without going
  // anywhere (its close button, Esc, the scrim, a swipe) hands focus back to the menu button. Picking a chat closes it
  // without that, since focus then belongs to the new page.
  const closeDrawer = () => {
    setDrawer(false);
    menuButton.current?.focus();
  };
  useEffect(() => {
    if (!drawer) return;
    const box = drawerBox.current;
    if (box) (box.querySelector<HTMLElement>("[data-first-focus]") ?? focusablesIn(box)[0])?.focus();
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setDrawer(false);
      menuButton.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawer]);
  const trapTab = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== "Tab") return;
    const to = wrapTarget(focusablesIn(e.currentTarget), document.activeElement as HTMLElement | null, e.shiftKey, precedesInPage, e.currentTarget);
    if (to) {
      e.preventDefault();
      to.focus();
    }
  };

  return (
    <MotionConfig reducedMotion="user">
      <div data-shell className="flex h-dvh flex-col overflow-hidden bg-paper">
        {/* The first Tab stop: past the saved chats, straight to the page. */}
        <a
          href="#main"
          // Focus moves by hand: following "#main" would add a history entry.
          onClick={(e) => {
            e.preventDefault();
            document.getElementById("main")?.focus();
          }}
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-full focus:bg-background focus:px-4 focus:py-2 focus:text-[14px] focus:font-medium focus:shadow-lg"
        >
          Skip to main content
        </a>

        <header className="flex h-12 shrink-0 items-center gap-1 px-2 lg:gap-3 lg:px-5">
          <button
            ref={menuButton}
            type="button"
            onClick={() => setDrawer(true)}
            aria-label="Open your chats"
            aria-expanded={drawer}
            aria-controls="menu-drawer"
            className="pressable grid size-10 shrink-0 place-items-center rounded-full hover:bg-foreground/[0.05] lg:hidden"
          >
            <Menu className="size-5" />
          </button>
          {/* Home is a new chat: the page renders a fresh chat id each time (app/page.tsx). Through NewChatLink, since
              a chat started at "/" only moved its address (new-chat.tsx). */}
          <NewChatLink className="flex min-w-0 items-baseline gap-2.5">
            <span className="shrink-0 text-[15px] font-semibold tracking-[-0.01em] whitespace-nowrap">{APP_NAME}</span>
            <span className="truncate text-[13px] text-muted-foreground">{APP_SUBTITLE}</span>
          </NewChatLink>
          <span className="flex-1" />
          <ThemeToggle className="size-9" />
          <NewChatLink aria-label="New chat" className="pressable grid size-10 shrink-0 place-items-center rounded-full hover:bg-foreground/[0.05] lg:hidden">
            <SquarePen className="size-[18px]" />
          </NewChatLink>
        </header>

        <div className="flex min-h-0 flex-1">
          <aside className="hidden w-[248px] shrink-0 lg:flex">
            <Sidebar />
          </aside>

          <div className="flex min-w-0 flex-1 flex-col lg:pr-2 lg:pb-2">
            {/* A chat has its own scroller, and under it main is clipped so nothing else can scroll it (reference QA:
                hidden text in an evidence list made main taller than the window and scrolled the whole chat).
                `clip`, not `hidden`: a hidden overflow can still be scrolled by focus() and scrollIntoView. */}
            <main
              id="main"
              tabIndex={-1}
              className="relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto bg-background outline-none has-[[data-chat]]:overflow-x-clip has-[[data-chat]]:overflow-y-clip lg:rounded-[18px] lg:border lg:border-foreground/[0.06] lg:shadow-[0_1px_3px_rgb(0_0_0/0.04),0_8px_24px_-12px_rgb(0_0_0/0.08)]"
            >
              {children}
            </main>
          </div>
        </div>

        <AnimatePresence>
          {drawer && (
            <>
              <motion.div
                key="scrim"
                className="fixed inset-0 z-40 bg-black/25 lg:hidden"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                onClick={closeDrawer}
              />
              <motion.aside
                key="drawer"
                id="menu-drawer"
                ref={drawerBox}
                onKeyDown={trapTab}
                role="dialog"
                aria-modal="true"
                aria-label="Your chats"
                className="fixed inset-y-0 left-0 z-50 flex w-[min(300px,84vw)] bg-paper pt-2 shadow-2xl lg:hidden"
                initial={{ x: "-100%" }}
                animate={{ x: 0 }}
                exit={{ x: "-100%" }}
                transition={spring}
                // Swipe it away to the left, the way it came in; a short flick is enough.
                drag="x"
                dragConstraints={{ left: 0, right: 0 }}
                dragElastic={{ left: 0.6, right: 0 }}
                onDragEnd={(_, info) => (info.offset.x < -80 || info.velocity.x < -400) && closeDrawer()}
              >
                {/* A delete closes the drawer and hands focus to the menu button, so its Undo toast covers nothing. */}
                <Sidebar onNavigate={() => setDrawer(false)} onDeleted={closeDrawer} />
                {/* A visible way out besides Esc, the scrim and a swipe. */}
                <button
                  type="button"
                  onClick={closeDrawer}
                  aria-label="Close your chats"
                  className="pressable absolute top-3 right-3 grid size-9 place-items-center rounded-full text-foreground/70 hover:bg-foreground/[0.06] hover:text-foreground"
                >
                  <X className="size-[18px]" />
                </button>
              </motion.aside>
            </>
          )}
        </AnimatePresence>
      </div>
    </MotionConfig>
  );
}
