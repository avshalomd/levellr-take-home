"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { MotionConfig } from "motion/react";
import { APP_NAME } from "@/lib/app";
import { ThemeToggle } from "./ThemeToggle";

// The frame around the page: a title bar on the paper ground, the chat on a white sheet set into it. The reference's
// sidebar of saved chats and its phone drawer are cut here (chat history is out of scope tonight), so the bar carries
// the product name, the community and window the data covers, and the theme toggle.
//
// MotionConfig reducedMotion="user": with the system's reduce-motion setting on, every spring in the app becomes an
// instant change of position while opacity still fades, so nothing slides but nothing pops either.

/** Which data the app answers from, under the product name. */
export const APP_SUBTITLE = "Veil of Ages Discord · 13–27 Sep 2026";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <div data-shell className="flex h-dvh flex-col overflow-hidden bg-paper">
        {/* The first Tab stop: straight to the page. */}
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

        <header className="flex h-12 shrink-0 items-center gap-3 px-4 lg:px-5">
          {/* Home is a new chat: the page renders a fresh chat id each time (app/page.tsx). */}
          <Link href="/" className="flex min-w-0 items-baseline gap-2.5">
            <span className="shrink-0 text-[15px] font-semibold tracking-[-0.01em] whitespace-nowrap">{APP_NAME}</span>
            <span className="truncate text-[13px] text-muted-foreground">{APP_SUBTITLE}</span>
          </Link>
          <span className="flex-1" />
          <ThemeToggle className="size-9" />
        </header>

        <div className="flex min-h-0 flex-1 flex-col lg:px-2 lg:pb-2">
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
    </MotionConfig>
  );
}
